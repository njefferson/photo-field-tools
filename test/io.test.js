// Export / import tests (spec §8, acceptance §11.7).
//
// The headline assertion is the one the acceptance criteria name: export, then
// wipe, then import restores IDENTICAL state. Export is the only backup this
// app has, so a round trip that quietly drops a field is data loss with no
// error attached to it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultState } from '../src/store/state.js';
import {
  EXPORT_SCHEMA, buildExport, exportFilename, parseImport, planImport,
  applyImport, summariseImport,
} from '../src/store/io.js';

/** A state with something of every kind in it. */
function populatedState() {
  const s = defaultState();
  s.deviceId = 'abc123';
  s.deviceLabel = 'Noah’s phone';
  s.settings.bodyId = 'z50-ir';
  s.settings.units = 'imperial';
  s.settings.cocBasis = 'traditional';
  s.settings.overlap = 0.4;
  s.lenses = [
    { id: 'lens-1', name: '50mm f/1.8', kind: 'prime', focalMm: 50, apertureMax: 1.8, hasVR: false, notes: '' },
    { id: 'lens-2', name: '70-300 VR', kind: 'zoom', focalMin: 70, focalMax: 300, hasVR: true, vrStops: 4 },
  ];
  s.tubes.push({ id: 'tube-x', label: '36 mm', mm: 36, builtin: false });
  s.teleconverters = [{ id: 'tc-1', label: 'TC-14', factor: 1.4, lossStops: 1 }];
  s.calibrations = [{
    key: 'abc123|user|dome|B', deviceId: 'abc123', facing: 'user', diffuser: 'dome',
    path: 'B', constant: 12.4, deviceApertureN: null, calibratedAt: '2026-07-30',
  }];
  s.hotspots = [{
    schema: 'hotspot-matrix-v1', lens: '70-300 VR', body: 'z50-ir', wavelength_nm: 720,
    cells: [{ focal_mm: 70, f_number: 8, hsi_stops: 0.31, captured: '2026-07-11' }],
  }];
  s.locations = [{ id: 'loc-1', name: 'Home', lat: 42.1, lon: -71.2 }];
  s.lastLocation = { lat: 42.1, lon: -71.2 };
  return s;
}

/** What wipeAll() leaves behind: defaults, with the device identity kept. */
function wipedFrom(original) {
  const fresh = defaultState();
  fresh.deviceId = original.deviceId;
  fresh.deviceLabel = original.deviceLabel;
  return fresh;
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

test('export captures every kind of record', () => {
  const dump = buildExport(populatedState(), '2026-08-02T00:00:00.000Z');
  assert.equal(dump.schema, EXPORT_SCHEMA);
  assert.equal(dump.exported, '2026-08-02T00:00:00.000Z');
  assert.equal(dump.lenses.length, 2);
  assert.equal(dump.teleconverters.length, 1);
  assert.equal(dump.calibrations.length, 1);
  assert.equal(dump.hotspots.length, 1);
  assert.equal(dump.locations.length, 1);
  assert.equal(dump.settings.units, 'imperial');
});

test('export carries user-added tubes but not the built-in ones', () => {
  // Built-ins are re-seeded from constants on every load. Exporting them would
  // duplicate them on restore, or resurrect one removed in a later version.
  const dump = buildExport(populatedState());
  assert.equal(dump.tubes.length, 1);
  assert.equal(dump.tubes[0].id, 'tube-x');
  assert.ok(dump.tubes.every((t) => !t.builtin));
});

test('export is a deep copy — later mutation cannot reach into it', () => {
  const s = populatedState();
  const dump = buildExport(s);
  s.lenses[0].name = 'MUTATED';
  s.hotspots[0].cells[0].hsi_stops = 99;
  assert.equal(dump.lenses[0].name, '50mm f/1.8');
  assert.equal(dump.hotspots[0].cells[0].hsi_stops, 0.31);
});

test('the export filename is dated', () => {
  assert.equal(exportFilename(new Date('2026-08-02T12:00:00Z')), 'photo-field-tools-2026-08-02.json');
});

/* ------------------------------------------------------------------ *
 * ACCEPTANCE §11.7 — the round trip
 * ------------------------------------------------------------------ */

test('acceptance §11.7 — export, wipe, import restores IDENTICAL state', () => {
  const original = populatedState();
  const dump = JSON.parse(JSON.stringify(buildExport(original)));

  const wiped = wipedFrom(original);
  // Sanity: the wipe really did remove everything, or this test proves nothing.
  assert.equal(wiped.lenses.length, 0);
  assert.equal(wiped.hotspots.length, 0);
  assert.equal(wiped.settings.units, 'metric');

  const parsed = parseImport(JSON.stringify(dump));
  assert.equal(parsed.ok, true, parsed.errors.join('; '));

  const plan = planImport(wiped, parsed.value);
  // Nothing to argue about: every current value is a factory default, so no
  // user decision is being discarded.
  assert.equal(plan.conflicts.length, 0, 'a wiped app has nothing to conflict with');
  assert.equal(plan.settings.contested.length, 0, 'defaults are not user choices');

  const { state: restored } = applyImport(wiped, parsed.value, plan);

  assert.deepEqual(restored.lenses, original.lenses);
  assert.deepEqual(restored.tubes, original.tubes, 'built-ins re-seeded, user tube restored');
  assert.deepEqual(restored.teleconverters, original.teleconverters);
  assert.deepEqual(restored.calibrations, original.calibrations);
  assert.deepEqual(restored.hotspots, original.hotspots);
  assert.deepEqual(restored.locations, original.locations);
  assert.deepEqual(restored.settings, original.settings, 'every setting came back');
  assert.equal(restored.deviceId, original.deviceId);
});

/* ------------------------------------------------------------------ *
 * Non-destructive merge
 * ------------------------------------------------------------------ */

test('a colliding record is reported as a conflict and NOT applied by default', () => {
  const mine = defaultState();
  mine.lenses = [{ id: 'lens-1', name: 'MY NAME', kind: 'prime', focalMm: 50 }];

  const theirs = buildExport(populatedState());
  const plan = planImport(mine, theirs);

  const conflict = plan.conflicts.find((c) => c.id === 'lens-1');
  assert.ok(conflict, 'the collision is reported');
  assert.equal(conflict.label, 'Lens');
  assert.equal(conflict.name, '50mm f/1.8', 'names the incoming record');
  assert.equal(conflict.current.name, 'MY NAME', 'and what it would replace');

  const { state: merged, applied } = applyImport(mine, theirs, plan);
  assert.equal(merged.lenses.find((l) => l.id === 'lens-1').name, 'MY NAME', 'never silently overwritten');
  assert.equal(applied.kept, 1);
  // The non-colliding lens still arrives — a conflict blocks itself, not the import.
  assert.ok(merged.lenses.find((l) => l.id === 'lens-2'), 'lens-2 was added');
});

test('a conflict IS applied when the user explicitly chooses the incoming copy', () => {
  const mine = defaultState();
  mine.lenses = [{ id: 'lens-1', name: 'MY NAME', kind: 'prime', focalMm: 50 }];
  const theirs = buildExport(populatedState());
  const plan = planImport(mine, theirs);

  const { state: merged, applied } = applyImport(mine, theirs, plan, { takeConflicts: ['lens-1'] });
  assert.equal(merged.lenses.find((l) => l.id === 'lens-1').name, '50mm f/1.8');
  assert.equal(applied.replaced, 1);
  assert.equal(applied.kept, 0);
});

test('identical records are recognised, not re-added as duplicates', () => {
  const state = populatedState();
  const plan = planImport(state, buildExport(state));
  assert.equal(plan.added.length, 0, 'importing your own export adds nothing');
  assert.equal(plan.conflicts.length, 0, 'and conflicts with nothing');
  assert.ok(plan.identical.length >= 6, 'everything is recognised as already present');

  const { state: after } = applyImport(state, buildExport(state), plan);
  assert.equal(after.lenses.length, state.lenses.length, 'no duplicates');
  assert.equal(after.hotspots.length, state.hotspots.length);
});

test('a setting the user actually changed is contested; a default one is not', () => {
  const mine = defaultState();
  mine.settings.units = 'imperial';   // a real choice on this device
  // cocBasis stays at its default, so replacing it discards nothing.

  const theirs = buildExport(populatedState());   // units: imperial too, cocBasis: traditional
  theirs.settings.units = 'metric';               // now it genuinely disagrees

  const plan = planImport(mine, theirs);
  assert.ok(plan.settings.contested.includes('units'), 'a changed setting is contested');
  assert.ok(plan.settings.free.includes('cocBasis'), 'a default-valued setting is free');

  const { state: kept } = applyImport(mine, theirs, plan);
  assert.equal(kept.settings.units, 'imperial', 'the user’s own choice survives');
  assert.equal(kept.settings.cocBasis, 'traditional', 'the default was filled in');

  const { state: taken } = applyImport(mine, theirs, plan, { takeContestedSettings: true });
  assert.equal(taken.settings.units, 'metric', 'unless the user opts in');
});

test('hotspot matrices collide on lens+body, not on object identity', () => {
  const mine = defaultState();
  mine.hotspots = [{
    schema: 'hotspot-matrix-v1', lens: '70-300 VR', body: 'z50-ir', wavelength_nm: 720,
    cells: [{ focal_mm: 70, f_number: 8, hsi_stops: 0.99 }],
  }];
  const plan = planImport(mine, buildExport(populatedState()));
  const c = plan.conflicts.find((x) => x.collection === 'hotspots');
  assert.ok(c, 'same lens and body is the same matrix');
  assert.equal(c.id, '70-300 VR|z50-ir');
  // Measurement work is never destroyed without an explicit choice.
  const { state: merged } = applyImport(mine, buildExport(populatedState()), plan);
  assert.equal(merged.hotspots[0].cells[0].hsi_stops, 0.99);
});

/* ------------------------------------------------------------------ *
 * Bad input
 * ------------------------------------------------------------------ */

test('import validates before it touches anything', () => {
  assert.equal(parseImport('not json{').ok, false);
  assert.equal(parseImport('[]').ok, false);
  assert.equal(parseImport('null').ok, false);
  assert.equal(parseImport(JSON.stringify({ schema: 'something-else' })).ok, false);

  const wrongShape = parseImport(JSON.stringify({ schema: EXPORT_SCHEMA, lenses: 'nope' }));
  assert.equal(wrongShape.ok, false);
  assert.ok(wrongShape.errors.some((e) => e.includes('lenses')));
});

test('an export with missing collections imports as an empty merge, not a crash', () => {
  const minimal = { schema: EXPORT_SCHEMA };
  const parsed = parseImport(JSON.stringify(minimal));
  assert.equal(parsed.ok, true);
  const state = populatedState();
  const plan = planImport(state, parsed.value);
  assert.equal(plan.total, 0);
  const { state: after } = applyImport(state, parsed.value, plan);
  assert.deepEqual(after.lenses, state.lenses, 'nothing was lost');
});

test('the import summary names what actually happened', () => {
  const mine = defaultState();
  mine.lenses = [{ id: 'lens-1', name: 'MY NAME', kind: 'prime', focalMm: 50 }];
  const theirs = buildExport(populatedState());
  const plan = planImport(mine, theirs);
  const { applied } = applyImport(mine, theirs, plan);
  const line = summariseImport(applied, plan);
  assert.match(line, /added/);
  assert.match(line, /kept \(conflicts left as they were\)/);
});
