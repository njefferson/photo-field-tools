// Unit tests for the hotspot matrix (spec §7).
//
// The behaviour under the most scrutiny here is the one spec §7 calls
// load-bearing in the field: an UNTESTED cell must never be indistinguishable
// from a clean one. That is enforced in the MODEL — untested is a real state,
// not an absent key — so a view cannot forget to handle it.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HSI_DEFINITION, SEVERITY_BANDS, SCHEMA_ID,
  severityBand, parseMatrix, serialiseMatrix, buildGrid, summarise,
} from '../src/core/hotspot.js';
import * as hotspot from '../src/core/hotspot.js';

const validMatrix = {
  schema: 'hotspot-matrix-v1',
  lens: 'Test 18-140mm',
  body: 'z50-ir',
  wavelength_nm: 720,
  cells: [
    { focal_mm: 18, f_number: 5.6, hsi_stops: 0.02, captured: '2026-07-11' },
    { focal_mm: 18, f_number: 8, hsi_stops: 0.05, captured: '2026-07-11' },
    { focal_mm: 35, f_number: 5.6, hsi_stops: 0.08, captured: '2026-07-11' },
    { focal_mm: 35, f_number: 8, hsi_stops: 0.62, captured: '2026-07-11' },
  ],
};

/* ------------------------------------------------------------------ *
 * The metric is documented but NEVER derived here
 * ------------------------------------------------------------------ */

test('spec §7 — this app consumes HSI and never derives it', () => {
  // There must be no image decoding, canvas work or upload path in this module.
  const names = Object.keys(hotspot).join(' ').toLowerCase();
  for (const forbidden of ['computehsi', 'derive', 'fromimage', 'upload', 'decode']) {
    assert.ok(!names.includes(forbidden), `hotspot must expose no "${forbidden}" entry point`);
  }
  assert.match(HSI_DEFINITION.derivedBy, /jefferson-photo-studio/);
});

test('the HSI definition carries its geometry and its relative-scale caveat', () => {
  assert.match(HSI_DEFINITION.formula, /log2/);
  assert.match(HSI_DEFINITION.centre, /10%/);
  assert.match(HSI_DEFINITION.centre, /width/i);
  assert.match(HSI_DEFINITION.annulus, /40%/);
  assert.match(HSI_DEFINITION.annulus, /60%/);
  assert.match(HSI_DEFINITION.annulus, /half-diagonal/i);
  assert.match(HSI_DEFINITION.linearised, /linearised/i);
  // Spec §7 requires the vignetting caveat to be stated, not implied.
  assert.match(HSI_DEFINITION.relative, /RELATIVE/);
  assert.match(HSI_DEFINITION.relative, /vignetting/i);
  assert.equal(HSI_DEFINITION.requirements.length, 3);
});

/* ------------------------------------------------------------------ *
 * Severity banding
 * ------------------------------------------------------------------ */

test('severity bands are ordered and carry a non-hue channel', () => {
  // Doctrine §4: hue-only encoding is a fail state. Every band declares a
  // monotonic luminance step, so severity survives a grayscale render.
  const steps = SEVERITY_BANDS.map((b) => b.step);
  assert.deepEqual(steps, [...steps].sort((a, b) => a - b), 'steps are monotonic');
  assert.equal(new Set(steps).size, steps.length, 'every band has a distinct step');
});

test('severityBand maps values to the right band', () => {
  assert.equal(severityBand(0).id, 'clean');
  assert.equal(severityBand(0.149).id, 'clean');
  assert.equal(severityBand(0.15).id, 'slight');
  assert.equal(severityBand(0.39).id, 'slight');
  assert.equal(severityBand(0.4).id, 'moderate');
  assert.equal(severityBand(0.79).id, 'moderate');
  assert.equal(severityBand(0.8).id, 'strong');
  assert.equal(severityBand(99).id, 'strong');
  // A negative HSI means the centre is DARKER than the annulus — a real thing
  // a vignette-heavy lens does, and not a hotspot.
  assert.equal(severityBand(-0.3).id, 'clean');
  assert.equal(severityBand(NaN), null);
});

/* ------------------------------------------------------------------ *
 * Import schema
 * ------------------------------------------------------------------ */

test('a valid matrix parses and normalises', () => {
  const r = parseMatrix(validMatrix);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.value.lens, 'Test 18-140mm');
  assert.equal(r.value.wavelength_nm, 720);
  assert.equal(r.value.cells.length, 4);
  assert.equal(r.value.schema, SCHEMA_ID);
});

test('import collects EVERY error rather than throwing on the first', () => {
  const r = parseMatrix({
    schema: 'wrong-schema',
    cells: [
      { focal_mm: 'x', f_number: 8, hsi_stops: 0.1 },
      { focal_mm: 18, f_number: -1, hsi_stops: 0.1 },
      { focal_mm: 18, f_number: 8, hsi_stops: 'nope' },
      { focal_mm: 18, f_number: 8, hsi_stops: 0.1, captured: '11/07/2026' },
    ],
  });
  assert.equal(r.ok, false);
  // schema + lens + body + wavelength + four cell errors
  assert.ok(r.errors.length >= 8, `expected every problem at once, got ${r.errors.length}`);
  assert.ok(r.errors.some((e) => e.includes('hotspot-matrix-v1')));
  assert.ok(r.errors.some((e) => e.includes('cells[3]')), 'date format is checked');
});

test('import rejects non-objects without throwing', () => {
  for (const junk of [null, undefined, 42, 'a string']) {
    const r = parseMatrix(junk);
    assert.equal(r.ok, false);
    assert.ok(r.errors.length > 0);
  }
  const noCells = parseMatrix({ schema: SCHEMA_ID, lens: 'L', body: 'b', wavelength_nm: 720 });
  assert.equal(noCells.ok, false);
  assert.ok(noCells.errors.some((e) => /cells/.test(e)));
});

test('export is symmetric with import', () => {
  const parsed = parseMatrix(validMatrix).value;
  const round = parseMatrix(serialiseMatrix(parsed));
  assert.equal(round.ok, true);
  assert.deepEqual(round.value, parsed, 'a matrix survives a round trip unchanged');
});

/* ------------------------------------------------------------------ *
 * Grid model — the untested-vs-clean rule
 * ------------------------------------------------------------------ */

test('the grid fills every intersection, marking gaps UNTESTED', () => {
  // Three cells over a 2×2 focal/f-number space leaves exactly one gap.
  const sparse = { ...validMatrix, cells: validMatrix.cells.slice(0, 3) };
  const grid = buildGrid(parseMatrix(sparse).value);
  assert.deepEqual(grid.focals, [18, 35]);
  assert.deepEqual(grid.fNumbers, [5.6, 8]);
  assert.equal(grid.total, 4);
  assert.equal(grid.tested, 3);
  assert.equal(grid.untested, 1);

  const flat = grid.rows.flatMap((r) => r.cells);
  assert.equal(flat.length, 4, 'every intersection is present in the model');

  const gap = flat.find((c) => !c.tested);
  assert.equal(gap.focal_mm, 35);
  assert.equal(gap.f_number, 8);
  // THE LOAD-BEARING ASSERTION (spec §7): an untested cell must carry no
  // severity at all, so nothing downstream can render it as clean.
  assert.equal(gap.hsi_stops, undefined, 'untested cells carry no value');
  assert.equal(gap.band, undefined, 'untested cells carry no severity band');
  assert.notEqual(gap.tested, true);

  // And a genuinely clean cell IS distinguishable from it in the model.
  const clean = flat.find((c) => c.tested && c.band.id === 'clean');
  assert.equal(clean.tested, true);
  assert.equal(clean.band.id, 'clean');
});

test('grid rows are sorted and severity bands attached', () => {
  const grid = buildGrid(parseMatrix({
    ...validMatrix,
    cells: [
      { focal_mm: 140, f_number: 11, hsi_stops: 0.9 },
      { focal_mm: 18, f_number: 4, hsi_stops: 0.01 },
    ],
  }).value);
  assert.deepEqual(grid.focals, [18, 140], 'focal rows ascend');
  assert.deepEqual(grid.fNumbers, [4, 11], 'f-number columns ascend');
  const worst = grid.rows[1].cells[1];
  assert.equal(worst.band.id, 'strong');
});

/* ------------------------------------------------------------------ *
 * Plain-language summary
 * ------------------------------------------------------------------ */

test('summarise refuses to invent a claim from too little data', () => {
  const thin = buildGrid(parseMatrix({
    ...validMatrix,
    cells: [{ focal_mm: 18, f_number: 5.6, hsi_stops: 0.02 }],
  }).value);
  assert.equal(summarise(thin), null, 'one cell supports no summary');
});

test('summarise names the clean range, the worst cell, and what is untested', () => {
  const grid = buildGrid(parseMatrix(validMatrix).value);
  const line = summarise(grid);
  assert.ok(line, 'four cells support a summary');
  assert.match(line, /clean below f\/8/, 'states the clean threshold');
  assert.match(line, /worst 0\.62 stops at 35 mm f\/8/, 'names the worst cell');
});

test('summarise always discloses untested coverage', () => {
  const sparse = buildGrid(parseMatrix({
    ...validMatrix,
    cells: [
      { focal_mm: 18, f_number: 5.6, hsi_stops: 0.01 },
      { focal_mm: 18, f_number: 8, hsi_stops: 0.02 },
      { focal_mm: 35, f_number: 5.6, hsi_stops: 0.03 },
    ],
  }).value);
  const line = summarise(sparse);
  // A summary that mentioned only the clean cells would read as coverage this
  // grid does not have — spec §7's whole concern.
  assert.match(line, /1 of 4 combinations untested/);
});

test('summarise handles an all-dirty grid without claiming anything clean', () => {
  const grid = buildGrid(parseMatrix({
    ...validMatrix,
    cells: [
      { focal_mm: 18, f_number: 5.6, hsi_stops: 0.5 },
      { focal_mm: 18, f_number: 8, hsi_stops: 0.7 },
      { focal_mm: 35, f_number: 5.6, hsi_stops: 0.9 },
      { focal_mm: 35, f_number: 8, hsi_stops: 1.2 },
    ],
  }).value);
  const line = summarise(grid);
  assert.doesNotMatch(line, /\bclean\b/, 'must not describe a dirty grid as clean anywhere');
  assert.match(line, /every tested combination/);
});
