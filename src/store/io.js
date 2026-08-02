// io.js — full export and NON-DESTRUCTIVE import (spec §8).
//
// "Import must be non-destructive: merge with conflict reporting, never silent
// overwrite." So this module never decides for the user. It produces a PLAN —
// what would be added, what collides, and what is already identical — and the
// caller applies it once the collisions have been answered. Nothing that a
// user chose is replaced without them saying so.
//
// Export is the ONLY backup (spec §8), which sets the bar for the round trip:
// export → wipe → import must restore identical state (acceptance §11.7), and
// test/io.test.js asserts exactly that.

import { defaultState, STATE_VERSION } from './state.js';

export const EXPORT_SCHEMA = 'photo-field-tools-export-v1';

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

/**
 * Everything, in one object: gear, calibration profiles, hotspot matrices,
 * saved locations and settings (spec §8).
 *
 * @param {object} state
 * @param {string} [now] ISO timestamp; injectable so tests are deterministic.
 */
export function buildExport(state, now = new Date().toISOString()) {
  return {
    schema: EXPORT_SCHEMA,
    exported: now,
    stateVersion: STATE_VERSION,
    deviceId: state.deviceId,
    deviceLabel: state.deviceLabel,
    settings: { ...state.settings },
    lenses: deepCopy(state.lenses),
    // Built-in tubes are re-seeded on load from constants, so exporting them
    // would resurrect a deleted built-in or duplicate it on a later version.
    // Only user-added tubes are portable data.
    tubes: deepCopy(state.tubes.filter((t) => !t.builtin)),
    teleconverters: deepCopy(state.teleconverters),
    calibrations: deepCopy(state.calibrations),
    hotspots: deepCopy(state.hotspots),
    locations: deepCopy(state.locations),
    lastLocation: state.lastLocation ? { ...state.lastLocation } : null,
  };
}

export function exportFilename(now = new Date()) {
  const d = now.toISOString().slice(0, 10);
  return `photo-field-tools-${d}.json`;
}

const deepCopy = (v) => JSON.parse(JSON.stringify(v ?? null));

/* ------------------------------------------------------------------ *
 * Import — validation
 * ------------------------------------------------------------------ */

/** Collections that merge by identity, and the field that identifies them. */
const COLLECTIONS = [
  { key: 'lenses', id: (x) => x.id, label: 'Lens' },
  { key: 'tubes', id: (x) => x.id, label: 'Extension tube' },
  { key: 'teleconverters', id: (x) => x.id, label: 'Teleconverter' },
  { key: 'calibrations', id: (x) => x.key, label: 'Calibration profile' },
  // Hotspot matrices are identified by the pair the import schema carries.
  { key: 'hotspots', id: (x) => `${x.lens}|${x.body}`, label: 'Hotspot matrix' },
  { key: 'locations', id: (x) => x.id, label: 'Saved location' },
];

/** Parse and validate an export file. Collects every problem, never throws. */
export function parseImport(raw) {
  const errors = [];
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch (err) {
      return { ok: false, value: null, errors: [`Not valid JSON: ${err.message}`] };
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, value: null, errors: ['Not a photo-field-tools export.'] };
  }
  if (obj.schema !== EXPORT_SCHEMA) {
    errors.push(`Expected "schema": "${EXPORT_SCHEMA}", found ${JSON.stringify(obj.schema ?? null)}.`);
  }
  for (const { key } of COLLECTIONS) {
    if (obj[key] != null && !Array.isArray(obj[key])) errors.push(`"${key}" must be an array.`);
  }
  if (obj.settings != null && typeof obj.settings !== 'object') errors.push('"settings" must be an object.');
  if (errors.length) return { ok: false, value: null, errors };
  return { ok: true, value: obj, errors: [] };
}

/* ------------------------------------------------------------------ *
 * Import — planning
 * ------------------------------------------------------------------ */

/**
 * Work out what an import would do, WITHOUT doing it.
 *
 * Three outcomes per record:
 *  - `added`     — no record with that identity exists here
 *  - `identical` — already present and byte-identical; nothing to decide
 *  - `conflicts` — present but DIFFERENT. Reported, never auto-applied.
 *
 * Settings are handled separately and deliberately: a value that is still at
 * its factory default is not a user decision, so replacing it discards
 * nothing and is not a conflict. That is what makes export → wipe → import an
 * exact restore (acceptance §11.7) while a merge into a configured app still
 * asks before changing a preference the user actually set.
 */
export function planImport(current, incoming) {
  const plan = { added: [], identical: [], conflicts: [], settings: null };
  const defaults = defaultState().settings;

  for (const { key, id, label } of COLLECTIONS) {
    const mine = Array.isArray(current[key]) ? current[key] : [];
    const theirs = Array.isArray(incoming[key]) ? incoming[key] : [];
    const byId = new Map(mine.map((x) => [id(x), x]));
    for (const record of theirs) {
      const rid = id(record);
      const existing = byId.get(rid);
      const entry = { collection: key, label, id: rid, incoming: record, name: describe(key, record) };
      if (!existing) plan.added.push(entry);
      else if (sameJson(existing, record)) plan.identical.push({ ...entry, current: existing });
      else plan.conflicts.push({ ...entry, current: existing });
    }
  }

  if (incoming.settings) {
    const changed = Object.keys(incoming.settings).filter(
      (k) => !sameJson(current.settings[k], incoming.settings[k]),
    );
    // Only the keys where the CURRENT value is a real user choice can conflict.
    const contested = changed.filter((k) => !sameJson(current.settings[k], defaults[k]));
    plan.settings = {
      changed,
      contested,
      incoming: incoming.settings,
      // Free to apply: differs from what is here, but what is here is a default.
      free: changed.filter((k) => !contested.includes(k)),
    };
  }

  plan.total = plan.added.length + plan.identical.length + plan.conflicts.length;
  return plan;
}

function describe(key, record) {
  switch (key) {
    case 'lenses': return record.name || record.id;
    case 'tubes': return record.label || `${record.mm} mm`;
    case 'teleconverters': return record.label || `${record.factor}×`;
    case 'calibrations': return `${record.facing} · ${record.diffuser} · path ${record.path}`;
    case 'hotspots': return `${record.lens} on ${record.body}`;
    case 'locations': return record.name || `${record.lat}, ${record.lon}`;
    default: return record.id || '(record)';
  }
}

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/* ------------------------------------------------------------------ *
 * Import — applying
 * ------------------------------------------------------------------ */

/**
 * Apply a plan to a state object, returning a NEW state.
 *
 * @param {object} current
 * @param {object} incoming the parsed export
 * @param {object} plan from planImport
 * @param {object} [choices]
 * @param {Set<string>|string[]} [choices.takeConflicts] conflict ids to REPLACE
 *        with the incoming version. Anything not listed keeps the current
 *        value — the default is always "change nothing the user chose".
 * @param {boolean} [choices.takeContestedSettings] apply settings the user has
 *        actually changed on this device. Defaults to false.
 */
export function applyImport(current, incoming, plan, choices = {}) {
  const take = new Set(choices.takeConflicts || []);
  const next = { ...current };
  const applied = { added: 0, replaced: 0, kept: 0, settings: [] };

  for (const { key, id } of COLLECTIONS) {
    const mine = Array.isArray(current[key]) ? [...current[key]] : [];
    const byId = new Map(mine.map((x, i) => [id(x), i]));

    for (const entry of plan.added) {
      if (entry.collection !== key) continue;
      mine.push(deepCopy(entry.incoming));
      applied.added += 1;
    }
    for (const entry of plan.conflicts) {
      if (entry.collection !== key) continue;
      if (take.has(entry.id)) {
        mine[byId.get(entry.id)] = deepCopy(entry.incoming);
        applied.replaced += 1;
      } else {
        applied.kept += 1;
      }
    }
    next[key] = mine;
  }

  if (plan.settings) {
    const s = { ...current.settings };
    for (const k of plan.settings.free) {
      s[k] = plan.settings.incoming[k];
      applied.settings.push(k);
    }
    if (choices.takeContestedSettings) {
      for (const k of plan.settings.contested) {
        s[k] = plan.settings.incoming[k];
        applied.settings.push(k);
      }
    }
    next.settings = s;
  }

  // Identity and last location ride along only when this device has none —
  // same rule as settings: filling a blank overwrites nothing.
  if (incoming.deviceId && !current.deviceId) next.deviceId = incoming.deviceId;
  if (incoming.deviceLabel && current.deviceLabel === defaultState().deviceLabel) {
    next.deviceLabel = incoming.deviceLabel;
  }
  if (incoming.lastLocation && !current.lastLocation) {
    next.lastLocation = { ...incoming.lastLocation };
  }

  return { state: next, applied };
}

/** One line the UI can show after an import, naming what actually happened. */
export function summariseImport(applied, plan) {
  const bits = [];
  bits.push(`${applied.added} added`);
  if (applied.replaced) bits.push(`${applied.replaced} replaced`);
  if (applied.kept) bits.push(`${applied.kept} kept (conflicts left as they were)`);
  if (plan.identical.length) bits.push(`${plan.identical.length} already identical`);
  if (applied.settings.length) bits.push(`${applied.settings.length} settings restored`);
  return bits.join(', ');
}
