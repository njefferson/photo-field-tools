// Unit tests for the optics half of the math core (spec §4, acceptance §11.8).
//
// Anchors are chosen to be checkable AGAINST SOMETHING OTHER THAN THE CODE:
// textbook photographic facts (1:1 macro sits two focal lengths out; a lens as
// long as the sensor is wide sees 53.13°), the spec's own quoted results
// (f/6.3 at 550 nm, f/4.8 at 720 nm), and algebraic identities the
// implementation cannot satisfy by accident. A test that only re-runs the
// formula it is testing proves the formula was typed twice, not that it works.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SENSOR, RESOLUTION, PIXEL_PITCH_MM, COC_BASES, CROP_FACTOR,
  BODIES, MEIKE_TUBES, MACRO_M_THRESHOLD, REFERENCE_WAVELENGTH_NM,
} from '../src/core/constants.js';
import * as optics from '../src/core/optics.js';

const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

/* ------------------------------------------------------------------ *
 * Hardware constants and the circle of confusion
 * ------------------------------------------------------------------ */

test('sensor constants match spec §2', () => {
  assert.equal(SENSOR.width, 23.5);
  assert.equal(SENSOR.height, 15.7);
  assert.equal(RESOLUTION.width, 5568);
  assert.equal(RESOLUTION.height, 3712);
  assert.equal(CROP_FACTOR, 1.5);
  // Spec §4 quotes the diagonal as 28.26 for the AoV formula.
  near(SENSOR.diagonal, 28.26, 0.005, 'sensor diagonal');
});

test('pixel pitch is DERIVED from sensor width, per spec §2', () => {
  assert.equal(PIXEL_PITCH_MM, SENSOR.width / RESOLUTION.width);
  near(PIXEL_PITCH_MM * 1000, 4.221, 0.001, 'pixel pitch in µm');
});

test('circle of confusion has both bases and defaults to pixel-pitch', () => {
  // Spec §4: c = 2 × pixel pitch ≈ 8.442 µm, and the traditional APS-C 0.020 mm.
  near(COC_BASES.pixel.mm * 1000, 8.442, 0.002, 'pixel-pitch CoC in µm');
  assert.equal(COC_BASES.traditional.mm, 0.020);
  // The two bases must differ materially — that is WHY the app has to display
  // which one produced a number (acceptance criterion 2).
  assert.ok(COC_BASES.traditional.mm / COC_BASES.pixel.mm > 2, 'bases differ by more than 2×');
});

test('the visible body has a wavelength; the IR body has an UNMEASURED cutoff', () => {
  assert.equal(BODIES['z50ii'].infrared, false);
  assert.equal(BODIES['z50ii'].defaultWavelengthNm, 550);
  assert.equal(BODIES['z50-ir'].infrared, true);
  // The conversion's cutoff was never recorded. The spec asserted 720 nm and
  // the app printed it under every result as measured fact; it was not.
  // Noah, 2026-08-02: "I don't know what they put in it… there's no fucking
  // wavelength assigned." null means unmeasured, and nothing may substitute.
  assert.equal(BODIES['z50-ir'].defaultWavelengthNm, null);
});

test('acceptance §11.10 — no body profile offers an external IR filter', () => {
  for (const body of Object.values(BODIES)) {
    const keys = Object.keys(body).join(' ').toLowerCase();
    assert.ok(!keys.includes('filter'), `${body.id} must not carry a filter field`);
  }
});

test('Meike tubes are preloaded as 11, 18 and the 29 stacked combination', () => {
  assert.deepEqual(MEIKE_TUBES.map((t) => t.mm), [11, 18, 29]);
});

/* ------------------------------------------------------------------ *
 * Depth of field — general case
 * ------------------------------------------------------------------ */

test('hyperfocal H = f²/(N·c) + f', () => {
  // 50 mm at f/8 on the traditional 0.020 mm basis.
  // 2500/(8 × 0.020) + 50 = 15625 + 50 = 15675 mm
  near(optics.hyperfocal(50, 8, 0.020), 15675, 1e-9, 'hyperfocal');
});

test('general DoF matches the spec §4 formulas exactly', () => {
  const f = 50, N = 8, c = 0.020, s = 3000;
  const H = optics.hyperfocal(f, N, c);
  const r = optics.dofGeneral(f, N, c, s);
  near(r.near, (s * (H - f)) / (H + s - 2 * f), 1e-9, 'near limit');
  near(r.far, (s * (H - f)) / (H - s), 1e-9, 'far limit');
  near(r.total, r.far - r.near, 1e-9, 'total');
  assert.equal(r.model, 'general');
  // Independent check on the SHAPE of the answer: the far limit is always
  // further from the subject than the near limit for a finite focus.
  assert.ok(s - r.near < r.far - s, 'rear depth exceeds front depth');
});

test('at the hyperfocal distance the far limit goes to infinity', () => {
  const f = 50, N = 8, c = 0.020;
  const H = optics.hyperfocal(f, N, c);
  const at = optics.dofGeneral(f, N, c, H);
  assert.equal(at.far, Infinity);
  assert.equal(at.total, Infinity);
  assert.equal(at.infinite, true);
  // The classic result: focused at H, the near limit sits at H/2.
  near(at.near, H / 2, 1, 'near limit at hyperfocal is H/2');

  // Just inside it, the far limit must be finite and very large.
  const inside = optics.dofGeneral(f, N, c, H * 0.999);
  assert.ok(Number.isFinite(inside.far) && inside.far > H * 100, 'finite but huge just inside H');
});

test('stopping down deepens depth of field; a wider CoC deepens it too', () => {
  const base = optics.dofGeneral(50, 4, 0.020, 3000).total;
  const stopped = optics.dofGeneral(50, 11, 0.020, 3000).total;
  assert.ok(stopped > base, 'f/11 is deeper than f/4');
  const tighter = optics.dofGeneral(50, 4, COC_BASES.pixel.mm, 3000).total;
  assert.ok(tighter < base, 'the stricter pixel-pitch CoC gives a shallower answer');
});

/* ------------------------------------------------------------------ *
 * Depth of field — macro model and the switch at m = 0.1
 * ------------------------------------------------------------------ */

test('macro DoF = 2·N·c·(1+m)/m²', () => {
  const N = 8, c = 0.020, m = 0.5;
  near(optics.dofMacro(N, c, m), (2 * N * c * (1 + m)) / (m * m), 1e-12, 'macro DoF');
  // At 1:1, f/8, c = 0.020: 2 × 8 × 0.020 × 2 / 1 = 0.64 mm. Sub-millimetre
  // depth at 1:1 is the number every macro shooter already knows.
  near(optics.dofMacro(8, 0.020, 1), 0.64, 1e-12, '1:1 at f/8');
});

test('acceptance §11.8 — the model switches at exactly m = 0.1', () => {
  const p = { focalMm: 100, fNumber: 8, cocMm: 0.020, focusMm: 1100 };
  assert.equal(MACRO_M_THRESHOLD, 0.1);

  // Below the threshold: general.
  assert.equal(optics.depthOfField({ ...p, magnification: 0.0999 }).model, 'general');
  // AT the threshold: macro. The spec says "when magnification m >= 0.1", so
  // the boundary itself belongs to the macro model — an off-by-one here would
  // be invisible in every other test.
  assert.equal(optics.depthOfField({ ...p, magnification: 0.1 }).model, 'macro');
  assert.equal(optics.depthOfField({ ...p, magnification: 0.1001 }).model, 'macro');
  // No magnification at all: general, and it says so.
  assert.equal(optics.depthOfField(p).model, 'general');
});

test('the macro branch returns the macro total and reports its model', () => {
  const r = optics.depthOfField({
    focalMm: 100, fNumber: 8, cocMm: 0.020, focusMm: 1100, magnification: 0.5,
  });
  assert.equal(r.model, 'macro');
  near(r.total, optics.dofMacro(8, 0.020, 0.5), 1e-12, 'uses the macro formula');
  assert.equal(r.symmetric, true);
  near(r.far - r.near, r.total, 1e-9, 'near/far span the total');
  // Hyperfocal is still reported alongside, per spec §4.
  assert.ok(Number.isFinite(r.hyperfocal));
});

/* ------------------------------------------------------------------ *
 * Magnification, effective aperture, working distance
 * ------------------------------------------------------------------ */

test('magnification from extension: m = m_lens + x/f', () => {
  near(optics.magnificationFromExtension(100, 25), 0.25, 1e-12, 'infinity-focused lens');
  near(optics.magnificationFromExtension(100, 25, 0.2), 0.45, 1e-12, 'lens already at 0.2×');
  // The dragonfly configuration: 29 mm of extension on a 175 mm lens.
  near(optics.magnificationFromExtension(175, 29), 29 / 175, 1e-12, 'dragonfly preset');
});

test('effective aperture N_eff = N(1+m), flagged approximate', () => {
  const r = optics.effectiveAperture(8, 1);
  assert.equal(r.value, 16);            // at 1:1 you lose two stops
  assert.equal(r.approximate, true);     // pupil magnification assumed 1
  assert.match(r.why, /pupil magnification/i);
  assert.equal(optics.effectiveAperture(5.6, 0).value, 5.6); // m=0 changes nothing
});

test('working distance WD ≈ f(1 + 1/m), approximate until a node offset exists', () => {
  // Textbook: at 1:1 the subject sits two focal lengths from the principal plane.
  const r = optics.workingDistance(100, 1);
  near(r.principalPlane, 200, 1e-12, '1:1 working distance');
  assert.equal(r.approximate, true, 'approximate with no node offset');
  assert.match(r.why, /principal plane/i);

  // With a measured offset the answer shortens by exactly that offset and
  // stops being flagged approximate.
  const corrected = optics.workingDistance(100, 1, 35);
  near(corrected.value, 165, 1e-12, 'node offset subtracted');
  assert.equal(corrected.approximate, false);
});

/* ------------------------------------------------------------------ *
 * Focus stacking
 * ------------------------------------------------------------------ */

test('focus step = DoF_total × (1 − overlap), default overlap 25%', () => {
  near(optics.focusStep(1.0, 0.25), 0.75, 1e-12, '25% overlap');
  near(optics.focusStep(1.0, 0), 1.0, 1e-12, 'no overlap');
  near(optics.focusStep(1.0, 0.5), 0.5, 1e-12, 'maximum overlap');
});

test('frames = ceil(target_depth / step), and a plan reports both', () => {
  assert.equal(optics.frameCount(10, 0.75), 14);   // 13.33 → 14
  assert.equal(optics.frameCount(10, 10), 1);      // exact fit is one frame
  assert.equal(optics.frameCount(10, 0), Infinity); // a zero step never converges
  const plan = optics.stackPlan({ dofTotalMm: 1.0, overlap: 0.25, targetDepthMm: 10 });
  near(plan.step, 0.75, 1e-12);
  assert.equal(plan.frames, 14);
});

/* ------------------------------------------------------------------ *
 * Diffraction
 * ------------------------------------------------------------------ */

test('Airy disk d = 2.44·λ·N', () => {
  near(optics.airyDiameter(0.00055, 8), 2.44 * 0.00055 * 8, 1e-15);
  // Doubling the f-number doubles the disk — linear in N.
  near(optics.airyDiameter(0.00055, 16), 2 * optics.airyDiameter(0.00055, 8), 1e-15);
});

test('diffraction limit reproduces the spec §4 quoted values', () => {
  const c = COC_BASES.pixel.mm;
  // Spec: "approximately f/6.3 at 550 nm and f/4.8 at 720 nm".
  near(optics.diffractionLimit(c, 0.00055), 6.3, 0.05, 'limit at 550 nm');
  near(optics.diffractionLimit(c, 0.00072), 4.8, 0.05, 'limit at 720 nm');
});

test('the IR diffraction shift is DERIVED and labelled unverified', () => {
  const s = optics.diffractionShift(0.00055, 0.00072);
  // Spec §4: "roughly 0.76x the visible-light f-number".
  near(s.ratio, 0.764, 0.002, 'f-number ratio');
  assert.equal(s.verified, false, 'must never claim verification against measurement');

  // Stops in APERTURE go as √2, so the difference is 2·log2(ratio) — the factor
  // of two is the easy thing to get wrong, and this pins it.
  near(s.stopsEarlier, 2 * Math.log2(0.00072 / 0.00055), 1e-12, 'stop difference');
  near(s.stopsEarlier, 0.777, 0.002, 'about three-quarters of a stop');

  // Consistency with the limit function itself: the ratio must be exactly the
  // ratio of the two limits, whatever CoC is in play.
  const c = COC_BASES.pixel.mm;
  near(
    s.ratio,
    optics.diffractionLimit(c, 0.00072) / optics.diffractionLimit(c, 0.00055),
    1e-12,
    'ratio agrees with the limit function',
  );
});

test('diffraction sweep flags where the Airy disk overruns the CoC', () => {
  const c = COC_BASES.pixel.mm;
  const sweep = optics.diffractionSweep([4, 5.6, 8, 11], 0.00055, c);
  assert.equal(sweep.length, 4);
  assert.equal(sweep[0].overCoc, false, 'f/4 is inside the limit at 550 nm');
  assert.equal(sweep[3].overCoc, true, 'f/11 is past it');
  near(sweep[0].limit, optics.diffractionLimit(c, 0.00055), 1e-12);
});

/* ------------------------------------------------------------------ *
 * Field of view and framing
 * ------------------------------------------------------------------ */

test('angles of view use the real sensor dimensions', () => {
  const a = optics.angleOfView(50);
  near(a.horizontal, 2 * Math.atan(23.5 / 100), 1e-12, 'horizontal');
  near(a.vertical, 2 * Math.atan(15.7 / 100), 1e-12, 'vertical');
  near(a.diagonal, 2 * Math.atan(SENSOR.diagonal / 100), 1e-12, 'diagonal');
  assert.ok(a.diagonal > a.horizontal && a.horizontal > a.vertical, 'ordered');

  // Independent anchor: a lens as long as the sensor is wide sees 2·atan(0.5).
  const square = optics.angleOfView(23.5);
  near((square.horizontal * 180) / Math.PI, 53.13, 0.01, '53.13° at f = sensor width');
});

test('equivalent focal length applies the 1.5× crop', () => {
  assert.equal(optics.equivalentFocal(200), 300);
});

test('distance for target frame fill: d = f·S/(p·sensor_dim)', () => {
  // A 300 mm bird filling half the frame width with a 500 mm lens:
  // 500 × 300 / (0.5 × 23.5) = 12765.96 mm ≈ 12.8 m
  const r = optics.distanceForFrameFill(500, 300, 0.5, 'horizontal');
  near(r.distanceMm, (500 * 300) / (0.5 * 23.5), 1e-9, 'horizontal fill');
  assert.equal(r.sensorDim, 23.5);
  assert.equal(r.reliable, true, 'well beyond 10× the focal length');

  // Vertical orientation uses the SHORT sensor dimension, which covers less
  // real-world height at any given distance — so the same subject already
  // fills more of the vertical frame, and you must back FURTHER away to hold
  // it to the same fraction. (This assertion was written backwards first; the
  // formula was right and the intuition was wrong.)
  const v = optics.distanceForFrameFill(500, 300, 0.5, 'vertical');
  assert.equal(v.sensorDim, 15.7);
  assert.ok(v.distanceMm > r.distanceMm, 'vertical fill needs more distance');
  near(v.distanceMm / r.distanceMm, 23.5 / 15.7, 1e-12, 'ratio is the aspect ratio');

  // The thin-lens assumption is flagged when it stops holding.
  assert.equal(optics.distanceForFrameFill(100, 20, 0.9, 'horizontal').reliable, false);
});

test('frame coverage inverts the frame-fill solve', () => {
  const d = optics.distanceForFrameFill(200, 500, 1, 'horizontal').distanceMm;
  const cover = optics.frameCoverage(200, d);
  near(cover.widthMm, 500, 1e-6, 'round trip returns the subject size');
});

/* ------------------------------------------------------------------ *
 * What must NOT exist
 * ------------------------------------------------------------------ */

test('spec §4 — IR focus shift is never computed', () => {
  // "Do NOT compute this. Infrared focus shift is lens-specific and cannot be
  // derived from wavelength alone." A future session adding a plausible-looking
  // focusShift() would break this test, which is the entire point of it.
  const names = Object.keys(optics).join(' ').toLowerCase();
  assert.ok(!names.includes('focusshift'), 'optics must expose no focus-shift function');
  assert.ok(!names.includes('irshift'), 'optics must expose no IR shift function');
  assert.ok(REFERENCE_WAVELENGTH_NM === 550, 'the visible reference stays 550 nm');
});
