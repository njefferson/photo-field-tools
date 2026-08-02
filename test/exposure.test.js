// Unit tests for the exposure half of the math core (spec §4, §6; §11.8).
//
// The anchors here are photographic facts that hold independently of this
// code: sunny-16 is EV 15; f/1 at 1 s and ISO 100 is EV 0 by definition;
// doubling ISO is one stop; a 2× teleconverter costs exactly two stops.

import test from 'node:test';
import assert from 'node:assert/strict';

import { F_NUMBERS, SHUTTER_TIMES, ISO_VALUES, DIFFUSERS, CROP_FACTOR } from '../src/core/constants.js';
import * as exp from '../src/core/exposure.js';

const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

/* ------------------------------------------------------------------ *
 * EV100
 * ------------------------------------------------------------------ */

test('EV100 = log2(N²/t) − log2(S/100)', () => {
  // f/1 at 1 s, ISO 100 is EV 0 by the definition of the scale.
  assert.equal(exp.ev100({ fNumber: 1, shutterSec: 1, iso: 100 }), 0);
  // Sunny 16: f/16 at 1/125, ISO 100 → EV 15 (14.97 exactly).
  near(exp.ev100({ fNumber: 16, shutterSec: 1 / 125, iso: 100 }), 15, 0.04, 'sunny 16');
});

test('each control moves EV by exactly one stop', () => {
  const base = { fNumber: 8, shutterSec: 1 / 250, iso: 200 };
  const ev = exp.ev100(base);
  // Doubling ISO admits one more stop of light → EV falls by 1.
  near(exp.ev100({ ...base, iso: 400 }), ev - 1, 1e-12, 'ISO doubled');
  // Doubling the shutter time likewise.
  near(exp.ev100({ ...base, shutterSec: 1 / 125 }), ev - 1, 1e-12, 'shutter doubled');
  // Opening one stop divides the f-number by √2.
  near(exp.ev100({ ...base, fNumber: 8 / Math.SQRT2 }), ev - 1, 1e-12, 'one stop wider');
});

/* ------------------------------------------------------------------ *
 * Triangle solver
 * ------------------------------------------------------------------ */

test('each solver inverts EV100 exactly', () => {
  const ev = 12.5;
  const a = exp.solveAperture({ shutterSec: 1 / 60, iso: 400, ev });
  near(exp.ev100({ fNumber: a, shutterSec: 1 / 60, iso: 400 }), ev, 1e-12, 'aperture round trip');

  const t = exp.solveShutter({ fNumber: 5.6, iso: 400, ev });
  near(exp.ev100({ fNumber: 5.6, shutterSec: t, iso: 400 }), ev, 1e-12, 'shutter round trip');

  const s = exp.solveIso({ fNumber: 5.6, shutterSec: 1 / 60, ev });
  near(exp.ev100({ fNumber: 5.6, shutterSec: 1 / 60, iso: s }), ev, 1e-12, 'ISO round trip');
});

test('solveTriangle returns the snapped value AND the exact one', () => {
  const r = exp.solveTriangle({ solveFor: 'aperture', shutterSec: 1 / 125, iso: 100, ev: 15 });
  // The exact answer is ~16.1; the snap is the standard f/16.
  near(r.exact, 16, 0.2, 'exact aperture');
  assert.equal(r.snapped, 16);
  assert.ok(F_NUMBERS.includes(r.snapped), 'snapped onto the standard scale');
  // Spec §4: the exact unsnapped value stays visible, so it must be returned.
  assert.notEqual(r.exact, r.snapped);
  assert.equal(r.outOfRange, false);
});

test('the snap delta reports the EXPOSURE change, with aperture inverted', () => {
  // Snapping the aperture UP (smaller hole) must report NEGATIVE stops — less
  // light. Getting this sign or the factor of two wrong would put a wrong
  // number beside every snapped answer in the app.
  const up = exp.solveTriangle({ solveFor: 'aperture', shutterSec: 1 / 100, iso: 100, ev: 14.8 });
  near(up.deltaStops, -2 * Math.log2(up.snapped / up.exact), 1e-12, 'aperture delta');
  if (up.snapped > up.exact) assert.ok(up.deltaStops < 0, 'stopping down loses light');

  // Shutter and ISO run the other way: bigger means more light.
  const sh = exp.solveTriangle({ solveFor: 'shutter', fNumber: 5.6, iso: 100, ev: 9.3 });
  near(sh.deltaStops, Math.log2(sh.snapped / sh.exact), 1e-12, 'shutter delta');
  const is = exp.solveTriangle({ solveFor: 'iso', fNumber: 5.6, shutterSec: 1 / 60, ev: 7.1 });
  near(is.deltaStops, Math.log2(is.snapped / is.exact), 1e-12, 'ISO delta');
});

test('solveTriangle flags answers off the end of the standard scale', () => {
  // Absurdly dark scene at a fast shutter: the required ISO leaves the scale.
  const r = exp.solveTriangle({ solveFor: 'iso', fNumber: 22, shutterSec: 1 / 4000, ev: -4 });
  assert.equal(r.outOfRange, true, 'must not silently clamp to ISO 51200');
});

test('solveTriangle rejects an unknown target rather than guessing', () => {
  assert.throws(() => exp.solveTriangle({ solveFor: 'nonsense', ev: 10 }), /unknown target/);
});

/* ------------------------------------------------------------------ *
 * Snapping
 * ------------------------------------------------------------------ */

test('snapTo chooses the nearest value in LOG space', () => {
  assert.equal(exp.snapTo(F_NUMBERS, 5.6), 5.6);
  assert.equal(exp.snapTo(F_NUMBERS, 5.7), 5.6);
  // 6.0 sits between 5.6 and 6.3. Linearly 5.6 is nearer (0.4 vs 0.3 — no,
  // 6.3 is nearer linearly too), so use a case where the two disagree:
  // 2.65 is linearly nearer 2.5 (0.15) than 2.8 (0.15) — a near tie — while in
  // log space 2.8 wins. The photographic scale is geometric, so log is right.
  assert.equal(exp.snapTo(F_NUMBERS, 2.645), 2.5);
  // ISO 450 is an exact LINEAR tie between 400 and 500 (50 either way). The
  // geometric midpoint is √200000 = 447.2, so log space breaks the tie upward.
  // This case is the difference between the two rules, not an edge case.
  assert.equal(exp.snapTo(ISO_VALUES, 450), 500);
  assert.equal(exp.snapTo(ISO_VALUES, 445), 400);
  assert.equal(exp.snapTo(SHUTTER_TIMES, 1 / 110), 1 / 100);
  // Beyond either end it clamps to the nearest end rather than returning junk.
  assert.equal(exp.snapTo(F_NUMBERS, 0.1), 1.0);
  assert.equal(exp.snapTo(F_NUMBERS, 1000), 45);
});

test('log-space snapping is unbiased where linear snapping is not', () => {
  // The geometric midpoint of 8 and 9 is √72 = 8.485. Anything below it must
  // snap to 8, anything above to 9. A linear snap would put the boundary at
  // 8.5 and mis-assign the band between them.
  assert.equal(exp.snapTo(F_NUMBERS, 8.48), 8);
  assert.equal(exp.snapTo(F_NUMBERS, 8.49), 9);
});

/* ------------------------------------------------------------------ *
 * Stop difference
 * ------------------------------------------------------------------ */

test('stop difference between two exposures, positive = b admits less light', () => {
  const a = { fNumber: 4, shutterSec: 1 / 125, iso: 100 };
  const b = { fNumber: 8, shutterSec: 1 / 125, iso: 100 };
  near(exp.stopDifference(a, b), 2, 1e-12, 'two stops down');
  near(exp.stopDifference(b, a), -2, 1e-12, 'and back again');
  near(exp.stopDifference(a, a), 0, 1e-12, 'identical exposures differ by nothing');
});

/* ------------------------------------------------------------------ *
 * ND and long exposure
 * ------------------------------------------------------------------ */

test('ND: t_new = t_base · 2^stops', () => {
  near(exp.ndTime(1 / 125, 10), 1024 / 125, 1e-12, 'ten stops on 1/125');
  near(exp.ndTime(1 / 125, 10), 8.192, 1e-9, 'which is 8.192 s');
  near(exp.ndTime(2, 0), 2, 1e-12, 'no filter changes nothing');
});

test('stacked ND sums the stops', () => {
  assert.equal(exp.ndStackStops([3, 6]), 9);
  assert.equal(exp.ndStackStops([]), 0);
  // Stacking is equivalent to one filter of the summed density.
  near(exp.ndTime(1 / 60, exp.ndStackStops([6, 10])), exp.ndTime(1 / 60, 16), 1e-12);
});

test('shiftShutter is the shared primitive behind ND and the IR offset', () => {
  near(exp.shiftShutter(1 / 100, 1), 1 / 50, 1e-12);
  near(exp.shiftShutter(1 / 100, -1), 1 / 200, 1e-12);
});

/* ------------------------------------------------------------------ *
 * Shutter floor
 * ------------------------------------------------------------------ */

test('shutter floor = 1/(f × 1.5 × k)', () => {
  near(exp.shutterFloor(200, 1), 1 / 300, 1e-12, 'legacy rule at 200 mm');
  near(exp.shutterFloor(200, 2), 1 / 600, 1e-12, 'default 2× strictness');
  near(exp.shutterFloor(200, 4), 1 / 1200, 1e-12, 'critical');
  // It is the 35mm-equivalent focal length that drives the rule.
  near(exp.shutterFloor(200, 1), 1 / (200 * CROP_FACTOR), 1e-12);
});

test('VR floor = floor × 2^stops, labelled manufacturer-claimed', () => {
  const floor = exp.shutterFloor(200, 2);
  const vr = exp.shutterFloorVR(floor, 3);
  near(vr.value, 1 / 75, 1e-12, 'three claimed stops on 1/600');
  assert.equal(vr.claimed, true);
  assert.match(vr.why, /claimed/i);
  // Zero claimed stops must leave the floor untouched, not silently help.
  near(exp.shutterFloorVR(floor, 0).value, floor, 1e-12);
});

/* ------------------------------------------------------------------ *
 * Teleconverters
 * ------------------------------------------------------------------ */

test('teleconverter scales focal and aperture and costs 2·log2(factor) stops', () => {
  const tc2 = exp.teleconverter(300, 4, 2);
  assert.equal(tc2.focalMm, 600);
  assert.equal(tc2.fNumber, 8);
  near(tc2.lightLossStops, 2, 1e-12, 'a 2× costs exactly two stops');

  const tc14 = exp.teleconverter(300, 4, 1.4);
  near(tc14.focalMm, 420, 1e-12);
  near(tc14.fNumber, 5.6, 1e-12);
  near(tc14.lightLossStops, 0.9709, 0.0001, 'a 1.4× costs about one stop');

  // A 1× teleconverter is a no-op and must cost nothing.
  near(exp.teleconverter(300, 4, 1).lightLossStops, 0, 1e-12);
});

test('teleconverter feeds downstream reach and shutter floor', () => {
  // Spec §4: apply f_effective downstream into FoV, DoF and shutter floor.
  const tc = exp.teleconverter(300, 4, 1.4);
  near(exp.shutterFloor(tc.focalMm, 2), 1 / (420 * 1.5 * 2), 1e-12, 'floor uses effective focal');
});

/* ------------------------------------------------------------------ *
 * Incident meter (spec §6)
 * ------------------------------------------------------------------ */

test('E_lux = (C·N²)/(t·S)', () => {
  // Flat disc, sunny-16 exposure → ~80,000 lux, which is daylight order.
  near(exp.illuminance({ C: 250, fNumber: 16, shutterSec: 1 / 125, iso: 100 }), 80000, 1, 'flat disc');
  // The dome constant is higher, so the same exposure implies more illuminance.
  assert.ok(
    exp.illuminance({ C: 340, fNumber: 16, shutterSec: 1 / 125, iso: 100 })
    > exp.illuminance({ C: 250, fNumber: 16, shutterSec: 1 / 125, iso: 100 }),
  );
});

test('the two illuminance routes agree', () => {
  const s = { fNumber: 16, shutterSec: 1 / 125, iso: 100 };
  const ev = exp.ev100(s);
  near(exp.illuminanceFromEv(250, ev), exp.illuminance({ C: 250, ...s }), 1e-6, 'EV route matches direct');
});

test('diffuser constants are 250 flat and 340 dome, and carry their guidance', () => {
  assert.equal(DIFFUSERS.flat.C, 250);
  assert.equal(DIFFUSERS.dome.C, 340);
  // Spec §6: the selector must carry a one-line description of what each is for.
  for (const d of Object.values(DIFFUSERS)) {
    assert.ok(d.for && d.for.length > 10, `${d.id} needs a purpose line`);
    assert.ok(d.improvise && d.improvise.length > 10, `${d.id} needs an improvise note`);
  }
});

test('path-A calibration returns the nominal constant for an honest device', () => {
  const camera = { fNumber: 8, shutterSec: 1 / 250, iso: 200 };
  // A device reporting exactly what the camera metered must solve to 250.
  near(exp.solvePathAConstant({ nominalC: 250, camera, device: camera }), 250, 1e-9, 'honest device');

  // A device under-reporting by one stop must solve to a constant that differs
  // by one stop — the constant IS the measure of how far off the device is.
  const oneStopOff = { ...camera, shutterSec: 1 / 125 };
  near(
    exp.solvePathAConstant({ nominalC: 250, camera, device: oneStopOff }),
    500,
    1e-9,
    'one stop of device error shows up as 2× the constant',
  );
});

test('path-B calibration round-trips through evFromLuminance', () => {
  const cameraEv = 11.3;
  const Y = 0.184;
  const k = exp.solvePathBConstant({ cameraEv, meanLuminance: Y });
  near(exp.evFromLuminance(Y, k), cameraEv, 1e-12, 'k reproduces the calibration point');
  // One stop brighter in luminance must read one stop higher in EV.
  near(exp.evFromLuminance(Y * 2, k), cameraEv + 1, 1e-12, 'linear in log luminance');
});

test('relative luminance is Rec.709 over LINEARISED sRGB', () => {
  near(exp.relativeLuminance(255, 255, 255), 1, 1e-12, 'white is 1.0');
  assert.equal(exp.relativeLuminance(0, 0, 0), 0);
  // The coefficients must be Rec. 709, so pure green dominates pure blue.
  assert.ok(exp.relativeLuminance(0, 255, 0) > exp.relativeLuminance(0, 0, 255) * 9);
  // Linearisation is not optional: mid-grey 128 is ~0.216 linear, NOT 0.502.
  // Skipping it would overstate dark frames badly.
  near(exp.relativeLuminance(128, 128, 128), 0.2159, 0.001, 'sRGB 128 linearises to ~0.216');
});

test('suggestFromEv returns a snapped shutter and the exact one', () => {
  const s = exp.suggestFromEv({ ev: 15, iso: 100, fNumber: 16 });
  assert.ok(SHUTTER_TIMES.includes(s.snapped));
  near(exp.ev100({ fNumber: 16, shutterSec: s.exact, iso: 100 }), 15, 1e-12, 'exact hits the EV');
});
