// state.js — the whole app's state, and the only code that touches storage.
//
// PERSISTENCE CHOICE (spec §8). localStorage, one key, whole-state JSON.
// Spec §8 permits IndexedDB "if any store exceeds practical localStorage
// limits". Nothing here can: the largest object is a hotspot matrix, which is
// a few hundred numbers. Rather than carry an IndexedDB layer that never runs
// — untested code on the path that holds the user's only copy of their
// calibration work — this uses localStorage and FAILS LOUDLY on quota, so a
// write that did not happen is never mistaken for one that did.
//
// PRIVACY (Doctrine §9): no server, no account, no telemetry. The device id
// below is a random local string used only to key calibration profiles to the
// hardware they were measured on. It is generated on this device, never leaves
// it, and is included in exports only so a restore keeps matching its profiles.

import {
  DEFAULT_BODY, DEFAULT_COC_BASIS, DEFAULT_DIFFUSER, DEFAULT_OVERLAP,
  DEFAULT_STRICTNESS, BODIES, MEIKE_TUBES,
} from '../core/constants.js';

const STORAGE_KEY = 'photo-field-tools/v1';
export const STATE_VERSION = 1;

/* ------------------------------------------------------------------ *
 * Defaults
 * ------------------------------------------------------------------ */

/**
 * ACCEPTANCE §11.9: NO LENS DATA SHIPS PRELOADED. `lenses` is empty and must
 * stay empty — a seeded list would be invented gear, and Doctrine §5 forbids
 * presenting generated content as fact. The Meike tubes are different: spec §3
 * says to preload them, and they are hardware Noah owns.
 */
export function defaultState() {
  return {
    version: STATE_VERSION,
    deviceId: null,          // assigned on first load, see ensureDeviceId
    deviceLabel: 'This device',
    settings: {
      bodyId: DEFAULT_BODY,
      lensId: null,
      cocBasis: DEFAULT_COC_BASIS,
      // Wavelength follows the body profile until the user overrides it, which
      // is what "defaults from the body profile" means in spec §2.
      wavelengthNm: BODIES[DEFAULT_BODY].defaultWavelengthNm,
      wavelengthAuto: true,
      units: 'metric',
      theme: 'dark',              // spec §9: dark theme default
      strictness: DEFAULT_STRICTNESS,
      overlap: DEFAULT_OVERLAP,
      diffuser: DEFAULT_DIFFUSER,
      meterAverageFrames: 8,
      lastModule: null,
    },
    lenses: [],
    tubes: MEIKE_TUBES.map((t) => ({ ...t })),
    teleconverters: [],
    calibrations: [],
    hotspots: [],
    locations: [],
    lastLocation: null,
  };
}

/* ------------------------------------------------------------------ *
 * Load / save
 * ------------------------------------------------------------------ */

let state = defaultState();
const listeners = new Set();

/** Last storage error, surfaced in Settings rather than swallowed. */
export let storageError = null;

function readStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    // A corrupt or unreadable store must not take the app down, and must not
    // pretend the data was never there.
    storageError = `Could not read saved data: ${err.message}`;
    return null;
  }
}

function writeStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    storageError = null;
    return true;
  } catch (err) {
    // Quota, private-mode, or a disabled store. Say so — silently dropping a
    // write is how someone loses a calibration they believe is saved.
    storageError = err && err.name === 'QuotaExceededError'
      ? 'Storage is full. Export your data, then remove what you no longer need.'
      : `Could not save: ${err && err.message ? err.message : 'storage unavailable'}`;
    return false;
  }
}

/** Merge a loaded object over the defaults, so a new field never lands undefined. */
function hydrate(loaded) {
  const base = defaultState();
  if (!loaded || typeof loaded !== 'object') return base;
  return {
    ...base,
    ...loaded,
    settings: { ...base.settings, ...(loaded.settings || {}) },
    // Built-in tubes are re-seeded every load so a future addition appears,
    // while any user-added tube in storage is kept.
    tubes: mergeTubes(base.tubes, loaded.tubes),
    lenses: Array.isArray(loaded.lenses) ? loaded.lenses : [],
    teleconverters: Array.isArray(loaded.teleconverters) ? loaded.teleconverters : [],
    calibrations: Array.isArray(loaded.calibrations) ? loaded.calibrations : [],
    hotspots: Array.isArray(loaded.hotspots) ? loaded.hotspots : [],
    locations: Array.isArray(loaded.locations) ? loaded.locations : [],
  };
}

function mergeTubes(builtin, stored) {
  if (!Array.isArray(stored)) return builtin;
  const userAdded = stored.filter((t) => t && !t.builtin);
  return [...builtin, ...userAdded];
}

export function loadState() {
  state = hydrate(readStorage());
  ensureDeviceId();
  applyWavelengthPolicy();
  return state;
}

/** A random local id so calibration profiles can be keyed to this hardware. */
function ensureDeviceId() {
  if (state.deviceId) return;
  const bytes = new Uint8Array(8);
  (globalThis.crypto || {}).getRandomValues?.(bytes);
  state.deviceId = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    || `dev-${Math.floor(Math.random() * 1e12).toString(16)}`;
  writeStorage();
}

/**
 * ACCEPTANCE §11.3: selecting the IR body changes the working wavelength, and
 * selecting the visible body reverts it. That only holds while the user has
 * not pinned a wavelength of their own — `wavelengthAuto` records which.
 */
function applyWavelengthPolicy() {
  if (state.settings.wavelengthAuto) {
    state.settings.wavelengthNm = activeBody().defaultWavelengthNm;
  }
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

export function getState() { return state; }
export function getSettings() { return state.settings; }

export function activeBody() {
  return BODIES[state.settings.bodyId] || BODIES[DEFAULT_BODY];
}

export function activeLens() {
  if (!state.settings.lensId) return null;
  return state.lenses.find((l) => l.id === state.settings.lensId) || null;
}

/** Working wavelength in MILLIMETRES, which is what the optics module wants. */
export function workingWavelengthMm() {
  return state.settings.wavelengthNm / 1e6;
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) {
    try { fn(state); } catch (err) { console.error('state listener failed', err); }
  }
}

/** Apply a mutation, persist, and notify. The only write path. */
export function update(mutator) {
  mutator(state);
  applyWavelengthPolicy();
  writeStorage();
  notify();
  return state;
}

export function setSetting(key, value) {
  return update((s) => {
    s.settings[key] = value;
    // Choosing a wavelength by hand pins it; choosing a body while pinned
    // leaves it pinned, which is what a deliberate override should do.
    if (key === 'wavelengthNm') s.settings.wavelengthAuto = false;
    if (key === 'wavelengthAuto' && value === true) {
      s.settings.wavelengthNm = (BODIES[s.settings.bodyId] || BODIES[DEFAULT_BODY]).defaultWavelengthNm;
    }
  });
}

/* ---- gear ---- */

export const newId = (prefix) =>
  `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

export function addLens(lens) {
  const record = { id: newId('lens'), ...lens };
  update((s) => { s.lenses.push(record); });
  return record;
}

export function updateLens(id, patch) {
  return update((s) => {
    const i = s.lenses.findIndex((l) => l.id === id);
    if (i >= 0) s.lenses[i] = { ...s.lenses[i], ...patch };
  });
}

export function removeLens(id) {
  return update((s) => {
    s.lenses = s.lenses.filter((l) => l.id !== id);
    if (s.settings.lensId === id) s.settings.lensId = null;
    // Hotspot matrices are keyed by lens DISPLAY NAME (that is what the import
    // schema carries), so they are deliberately left alone here: deleting a
    // lens must not destroy measurement work that took hours to capture.
  });
}

export function addTube(tube) {
  const record = { id: newId('tube'), builtin: false, ...tube };
  update((s) => { s.tubes.push(record); });
  return record;
}

export function removeTube(id) {
  return update((s) => { s.tubes = s.tubes.filter((t) => t.id !== id || t.builtin); });
}

export function addTeleconverter(tc) {
  const record = { id: newId('tc'), ...tc };
  update((s) => { s.teleconverters.push(record); });
  return record;
}

export function removeTeleconverter(id) {
  return update((s) => { s.teleconverters = s.teleconverters.filter((t) => t.id !== id); });
}

/* ---- calibration (spec §6) ---- */

/**
 * Profiles are keyed by the tuple (device, camera facing, diffuser mode,
 * measurement path) — spec §6. All four matter: the same phone reads
 * differently front vs. back, and a dome is not a flat disc.
 */
export function calibrationKey({ facing, diffuser, path }) {
  return `${state.deviceId}|${facing}|${diffuser}|${path}`;
}

export function findCalibration(tuple) {
  const key = calibrationKey(tuple);
  return state.calibrations.find((c) => c.key === key) || null;
}

export function saveCalibration({ facing, diffuser, path, constant, deviceApertureN }) {
  const key = calibrationKey({ facing, diffuser, path });
  const record = {
    key,
    deviceId: state.deviceId,
    facing,
    diffuser,
    path,
    constant,
    deviceApertureN: deviceApertureN ?? null,
    calibratedAt: new Date().toISOString().slice(0, 10),
  };
  update((s) => {
    const i = s.calibrations.findIndex((c) => c.key === key);
    if (i >= 0) s.calibrations[i] = record; else s.calibrations.push(record);
  });
  return record;
}

export function removeCalibration(key) {
  return update((s) => { s.calibrations = s.calibrations.filter((c) => c.key !== key); });
}

/* ---- hotspot matrices (spec §7) ---- */

export function findHotspotMatrix(lensName, bodyId) {
  return state.hotspots.find((h) => h.lens === lensName && h.body === bodyId) || null;
}

export function saveHotspotMatrix(matrix) {
  return update((s) => {
    const i = s.hotspots.findIndex((h) => h.lens === matrix.lens && h.body === matrix.body);
    if (i >= 0) s.hotspots[i] = matrix; else s.hotspots.push(matrix);
  });
}

export function setHotspotCell(lensName, bodyId, wavelengthNm, cell) {
  return update((s) => {
    let m = s.hotspots.find((h) => h.lens === lensName && h.body === bodyId);
    if (!m) {
      m = { schema: 'hotspot-matrix-v1', lens: lensName, body: bodyId, wavelength_nm: wavelengthNm, cells: [] };
      s.hotspots.push(m);
    }
    const i = m.cells.findIndex((c) => c.focal_mm === cell.focal_mm && c.f_number === cell.f_number);
    if (i >= 0) m.cells[i] = cell; else m.cells.push(cell);
  });
}

export function clearHotspotCell(lensName, bodyId, focalMm, fNumber) {
  return update((s) => {
    const m = s.hotspots.find((h) => h.lens === lensName && h.body === bodyId);
    if (!m) return;
    m.cells = m.cells.filter((c) => !(c.focal_mm === focalMm && c.f_number === fNumber));
  });
}

export function removeHotspotMatrix(lensName, bodyId) {
  return update((s) => {
    s.hotspots = s.hotspots.filter((h) => !(h.lens === lensName && h.body === bodyId));
  });
}

/* ---- saved locations (spec §5.5) ---- */

export function addLocation(loc) {
  const record = { id: newId('loc'), ...loc };
  update((s) => { s.locations.push(record); });
  return record;
}

export function removeLocation(id) {
  return update((s) => { s.locations = s.locations.filter((l) => l.id !== id); });
}

export function setLastLocation(loc) {
  return update((s) => { s.lastLocation = loc; });
}

/* ---- wipe (used by Settings and by the export/import acceptance check) ---- */

export function replaceState(next) {
  state = hydrate(next);
  ensureDeviceId();
  applyWavelengthPolicy();
  writeStorage();
  notify();
  return state;
}

export function wipeAll() {
  const fresh = defaultState();
  // A wipe keeps the device identity, so restoring an export on the SAME
  // device still matches its calibration profiles to the hardware they were
  // measured on. Import overwrites it when the export carries one.
  fresh.deviceId = state.deviceId;
  fresh.deviceLabel = state.deviceLabel;
  state = fresh;
  writeStorage();
  notify();
  return state;
}
