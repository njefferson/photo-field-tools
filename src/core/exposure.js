// exposure.js — EV, the triangle solver, ND, shutter floor, teleconverters,
// and the incident-meter illuminance maths.
//
// PURE. No DOM, no storage. Unit-tested in test/exposure.test.js.
//
// UNITS: shutter times are SECONDS (so 1/125 is 0.008), ISO is the arithmetic
// speed, f-numbers are plain numbers.

import { F_NUMBERS, SHUTTER_TIMES, ISO_VALUES, CROP_FACTOR } from './constants.js';

/* ------------------------------------------------------------------ *
 * EV and the triangle
 * ------------------------------------------------------------------ */

/**
 * EV100 = log2(N²/t) − log2(S/100)      (spec §4)
 *
 * Sanity anchor used in the tests: sunny-16 is f/16, 1/125 s, ISO 100 → EV 15.
 */
export function ev100({ fNumber, shutterSec, iso }) {
  return Math.log2((fNumber * fNumber) / shutterSec) - Math.log2(iso / 100);
}

/** N = √( t · 2^EV · S/100 ) — the EV100 equation solved for aperture. */
export function solveAperture({ shutterSec, iso, ev }) {
  return Math.sqrt(shutterSec * Math.pow(2, ev) * (iso / 100));
}

/** t = N² / ( 2^EV · S/100 ) */
export function solveShutter({ fNumber, iso, ev }) {
  return (fNumber * fNumber) / (Math.pow(2, ev) * (iso / 100));
}

/** S = 100·N² / ( t · 2^EV ) */
export function solveIso({ fNumber, shutterSec, ev }) {
  return (100 * fNumber * fNumber) / (shutterSec * Math.pow(2, ev));
}

/**
 * The spec §5.2 triangle solver: lock any two of {aperture, shutter, ISO} plus
 * a target EV, solve the third.
 *
 * Returns BOTH the exact value and the 1/3-stop snap, because spec §4 requires
 * the snapped value to lead and the exact one to remain visible as secondary.
 * A solver that only returns the snap has silently changed the exposure.
 *
 * @param {'aperture'|'shutter'|'iso'} solveFor
 * @returns {{solveFor:string, exact:number, snapped:number, deltaStops:number}}
 */
export function solveTriangle({ solveFor, fNumber, shutterSec, iso, ev }) {
  let exact, snapped;
  switch (solveFor) {
    case 'aperture':
      exact = solveAperture({ shutterSec, iso, ev });
      snapped = snapTo(F_NUMBERS, exact);
      break;
    case 'shutter':
      exact = solveShutter({ fNumber, iso, ev });
      snapped = snapTo(SHUTTER_TIMES, exact);
      break;
    case 'iso':
      exact = solveIso({ fNumber, shutterSec, ev });
      snapped = snapTo(ISO_VALUES, exact);
      break;
    default:
      throw new Error(`solveTriangle: unknown target "${solveFor}"`);
  }
  // How far snapping moved the EXPOSURE, in stops, POSITIVE = more light.
  // Aperture runs the other way and is scaled: exposure goes as 1/N², so a
  // ratio in N costs −2·log2 of it. Shutter and ISO both add light as they
  // grow. Getting either the sign or the factor of two wrong here would put a
  // plausible-looking number next to every snapped answer in the app.
  const deltaStops = solveFor === 'aperture'
    ? -2 * Math.log2(snapped / exact)
    : Math.log2(snapped / exact);
  return { solveFor, exact, snapped, deltaStops, outOfRange: outOfRange(solveFor, exact) };
}

/** True when the exact answer falls outside the standard scale entirely. */
function outOfRange(solveFor, exact) {
  const scale = solveFor === 'aperture' ? F_NUMBERS
    : solveFor === 'shutter' ? SHUTTER_TIMES
    : ISO_VALUES;
  const lo = Math.min(...scale), hi = Math.max(...scale);
  return exact < lo || exact > hi;
}

/**
 * Nearest value on a standard scale, chosen in LOG space.
 *
 * Log space is the point: photographic scales are geometric, so the arithmetic
 * midpoint of 1/60 and 1/80 is not the perceptual midpoint. Snapping linearly
 * biases every result toward the longer/larger end of the scale.
 */
export function snapTo(scale, value) {
  if (!(value > 0)) return scale[0];
  let best = scale[0];
  let bestErr = Infinity;
  for (const s of scale) {
    const err = Math.abs(Math.log2(s / value));
    if (err < bestErr) { bestErr = err; best = s; }
  }
  return best;
}

/**
 * Stop difference between two arbitrary exposures. Spec §5.2.
 *
 * POSITIVE means `b` admits LESS light than `a` — b is the darker exposure, so
 * it suits a brighter scene. The sign convention is stated because a bare
 * number here is ambiguous and the UI must spell out which way it runs.
 */
export function stopDifference(a, b) {
  return ev100(b) - ev100(a);
}

/** Apply a stop offset to a shutter time — the primitive behind ND and IR offset. */
export function shiftShutter(shutterSec, stops) {
  return shutterSec * Math.pow(2, stops);
}

/* ------------------------------------------------------------------ *
 * ND and long exposure
 * ------------------------------------------------------------------ */

/** t_new = t_base · 2^stops  (spec §4) */
export function ndTime(baseShutterSec, stops) {
  return baseShutterSec * Math.pow(2, stops);
}

/** Stacked ND: sum the stops (spec §4). */
export function ndStackStops(filterStops) {
  return filterStops.reduce((sum, s) => sum + s, 0);
}

/* ------------------------------------------------------------------ *
 * Shutter floor
 * ------------------------------------------------------------------ */

/**
 * t_floor = 1 / (f × 1.5 × k)      (spec §4)
 *
 * Neither body has IBIS, so there is no body contribution here — the only
 * stabilisation available is lens VR, handled separately below.
 * @returns {number} seconds
 */
export function shutterFloor(focalMm, k) {
  return 1 / (focalMm * CROP_FACTOR * k);
}

/**
 * t_floor_VR = t_floor · 2^(VR_stops)      (spec §4)
 *
 * MANUFACTURER-CLAIMED, not measured. The flag carries that into the UI, where
 * spec §4 requires it to be said out loud.
 */
export function shutterFloorVR(floorSec, vrStops) {
  return {
    value: floorSec * Math.pow(2, vrStops),
    claimed: true,
    why: 'Manufacturer-claimed VR benefit, not measured on this body.',
  };
}

/* ------------------------------------------------------------------ *
 * Teleconverters
 * ------------------------------------------------------------------ */

/**
 * f_eff = f·TC,  N_eff = N·TC,  loss = 2·log2(TC)      (spec §4)
 *
 * The effective focal length is what downstream FoV, DoF and shutter-floor
 * calls must be given — spec §4 says to apply it downstream, and the wildlife
 * module does exactly that rather than computing reach in isolation.
 */
export function teleconverter(focalMm, fNumber, factor) {
  return {
    focalMm: focalMm * factor,
    fNumber: fNumber * factor,
    lightLossStops: 2 * Math.log2(factor),
    factor,
  };
}

/* ------------------------------------------------------------------ *
 * Incident meter
 * ------------------------------------------------------------------ */

/**
 * E_lux = (C · N²) / (t · S)      (spec §6, measurement path A)
 *
 * C is the diffuser's calibration constant — 250 flat disc, 340 dome.
 */
export function illuminance({ C, fNumber, shutterSec, iso }) {
  return (C * fNumber * fNumber) / (shutterSec * iso);
}

/** Illuminance from an EV100 reading and a diffuser constant: E = (C/100)·2^EV. */
export function illuminanceFromEv(C, ev) {
  return (C / 100) * Math.pow(2, ev);
}

/**
 * Solve for a device's PATH-A constant during calibration (spec §6).
 *
 * The reference illuminance is what a meter of this diffuser geometry would
 * report for the exposure the Z50 II actually metered — that is the textbook
 * meaning of C. We then solve the constant that makes THIS DEVICE's own track
 * readback agree with it.
 *
 * A device whose track readback is honest returns C ≈ the nominal constant;
 * how far it lands from 250/340 is a direct measure of how much the device is
 * lying to us.
 */
export function solvePathAConstant({ nominalC, camera, device }) {
  const referenceLux = illuminance({
    C: nominalC,
    fNumber: camera.fNumber,
    shutterSec: camera.shutterSec,
    iso: camera.iso,
  });
  return (referenceLux * device.shutterSec * device.iso) / (device.fNumber * device.fNumber);
}

/**
 * Solve for a device's PATH-B constant k (spec §6).
 *
 * Path B has only a mean relative luminance Y in [0,1], linearised out of sRGB.
 * k maps it onto EV100:   EV100 = log2(Y) + k
 *
 * This path reads a TONE-MAPPED, auto-white-balanced frame. The mapping to
 * scene luminance is nonlinear and device-specific; k is a single-point fit and
 * nothing more.
 */
export function solvePathBConstant({ cameraEv, meanLuminance }) {
  return cameraEv - Math.log2(meanLuminance);
}

/** EV100 from a path-B luminance reading and its calibrated k. */
export function evFromLuminance(meanLuminance, k) {
  return Math.log2(meanLuminance) + k;
}

/**
 * Rec. 709 relative luminance of an sRGB pixel, LINEARISED first (spec §6).
 *
 * Linearising before averaging is not optional: averaging gamma-encoded values
 * and calling the result luminance overstates dark frames badly.
 */
export function relativeLuminance(r8, g8, b8) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r8) + 0.7152 * lin(g8) + 0.0722 * lin(b8);
}

/**
 * Suggested triangle for a metered EV, given a locked ISO and aperture.
 * Returns the snapped shutter plus the exact value, same contract as the solver.
 */
export function suggestFromEv({ ev, iso, fNumber }) {
  const exact = solveShutter({ fNumber, iso, ev });
  return { exact, snapped: snapTo(SHUTTER_TIMES, exact), fNumber, iso, ev };
}
