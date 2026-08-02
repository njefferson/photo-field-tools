// optics.js — depth of field, magnification, diffraction, field of view.
//
// PURE. No DOM, no storage, no globals. Every function here is unit-tested in
// test/optics.test.js, which is what spec §11.8 asks for.
//
// UNITS: every length is MILLIMETRES unless a name says otherwise, and every
// angle is RADIANS. Mixing units is the classic way these formulas go quietly
// wrong, so callers convert at the edge and never in the middle.
//
// The formulas are spec §4, implemented exactly as written. Where a formula is
// an approximation, the function returns a flag saying so rather than leaving
// the caller to remember — an approximation that has lost its label is just a
// wrong number with confidence.

import {
  SENSOR,
  MACRO_M_THRESHOLD,
  CROP_FACTOR,
} from './constants.js';

/* ------------------------------------------------------------------ *
 * Depth of field
 * ------------------------------------------------------------------ */

/**
 * Hyperfocal distance.  H = f²/(N·c) + f
 * @returns {number} mm from the front principal plane
 */
export function hyperfocal(focalMm, fNumber, cocMm) {
  return (focalMm * focalMm) / (fNumber * cocMm) + focalMm;
}

/**
 * General-case depth of field. Spec §4.
 *   near = s(H − f) / (H + s − 2f)
 *   far  = s(H − f) / (H − s)        → Infinity when s >= H
 *
 * @param {number} focusMm subject distance, mm
 * @returns {{model:'general', hyperfocal:number, near:number, far:number,
 *            total:number, infinite:boolean}}
 */
export function dofGeneral(focalMm, fNumber, cocMm, focusMm) {
  const H = hyperfocal(focalMm, fNumber, cocMm);
  const near = (focusMm * (H - focalMm)) / (H + focusMm - 2 * focalMm);
  const infinite = focusMm >= H;
  const far = infinite ? Infinity : (focusMm * (H - focalMm)) / (H - focusMm);
  return {
    model: 'general',
    hyperfocal: H,
    near,
    far,
    total: infinite ? Infinity : far - near,
    infinite,
  };
}

/**
 * Macro / high-magnification depth of field. Spec §4.
 *   DoF_total = 2·N·c·(1 + m) / m²
 * @returns {number} total depth, mm
 */
export function dofMacro(fNumber, cocMm, magnification) {
  return (2 * fNumber * cocMm * (1 + magnification)) / (magnification * magnification);
}

/**
 * Depth of field with the spec §4 MODEL SWITCH applied at m = 0.1.
 *
 * The switch is automatic and the result always says which model produced it
 * (`model: 'general' | 'macro'`) — spec §4 requires the label, and acceptance
 * criterion 2 requires it on screen.
 *
 * The macro branch reports near/far as symmetric about the subject. At m >= 0.1
 * the asymmetry of the general model has essentially collapsed, which is why
 * the spec gives only a total for this regime; `symmetric: true` marks that the
 * split is the model's assumption rather than a separate computation.
 *
 * @param {object} p
 * @param {number} p.focalMm
 * @param {number} p.fNumber        the SET f-number (not the effective one —
 *                                  see effectiveAperture; the caller decides,
 *                                  because which one is correct depends on
 *                                  whether the lens reports it already)
 * @param {number} p.cocMm
 * @param {number} p.focusMm
 * @param {number} [p.magnification] when supplied and >= 0.1, selects macro
 */
export function depthOfField({ focalMm, fNumber, cocMm, focusMm, magnification }) {
  const m = magnification;
  if (m != null && Number.isFinite(m) && m >= MACRO_M_THRESHOLD) {
    const total = dofMacro(fNumber, cocMm, m);
    return {
      model: 'macro',
      magnification: m,
      hyperfocal: hyperfocal(focalMm, fNumber, cocMm),
      near: focusMm - total / 2,
      far: focusMm + total / 2,
      total,
      infinite: false,
      symmetric: true,
    };
  }
  return { ...dofGeneral(focalMm, fNumber, cocMm, focusMm), magnification: m ?? null };
}

/* ------------------------------------------------------------------ *
 * Magnification, aperture, working distance
 * ------------------------------------------------------------------ */

/**
 * Effective aperture at magnification.  N_eff = N(1 + m)
 *
 * APPROXIMATE — assumes pupil magnification of 1. True value varies by optical
 * design (a telephoto and a retrofocus wide of the same focal length differ).
 * The `approximate` flag exists so no caller can display this as exact.
 */
export function effectiveAperture(fNumber, magnification) {
  return {
    value: fNumber * (1 + magnification),
    approximate: true,
    why: 'Assumes pupil magnification of 1; true value varies by optical design.',
  };
}

/**
 * Magnification from extension.  m = m_lens + x/f
 * @param {number} extensionMm total extension
 * @param {number} [lensMagnification] the lens's own magnification at its
 *        current focus setting — 0 when focused at infinity
 */
export function magnificationFromExtension(focalMm, extensionMm, lensMagnification = 0) {
  return lensMagnification + extensionMm / focalMm;
}

/**
 * Working distance.  WD ≈ f(1 + 1/m)
 *
 * THIN-LENS APPROXIMATION, measured from the FRONT PRINCIPAL PLANE — not from
 * the front element. The real front-element-to-subject distance is shorter by a
 * lens-specific offset nobody can derive from the numbers here.
 *
 * @param {number|null} nodeOffsetMm per-lens user-measured offset, subtracted
 *        when present. When absent the result is flagged `approximate` and the
 *        UI is required to say so (spec §4).
 * @returns {{principalPlane:number, value:number, approximate:boolean}}
 */
export function workingDistance(focalMm, magnification, nodeOffsetMm = null) {
  const fromPrincipalPlane = focalMm * (1 + 1 / magnification);
  const hasOffset = nodeOffsetMm != null && Number.isFinite(nodeOffsetMm);
  return {
    principalPlane: fromPrincipalPlane,
    value: hasOffset ? fromPrincipalPlane - nodeOffsetMm : fromPrincipalPlane,
    approximate: !hasOffset,
    why: hasOffset
      ? 'Front-element distance, using this lens’s measured node offset.'
      : 'From the front principal plane, not the front element. Measure this lens’s node offset to correct it.',
  };
}

/* ------------------------------------------------------------------ *
 * Focus stacking
 * ------------------------------------------------------------------ */

/** Focus step for stacking.  step = DoF_total × (1 − overlap) */
export function focusStep(dofTotalMm, overlap) {
  return dofTotalMm * (1 - overlap);
}

/** frames = ceil(target_depth / step) — reported alongside the step, per spec §4. */
export function frameCount(targetDepthMm, stepMm) {
  if (!(stepMm > 0)) return Infinity;
  return Math.ceil(targetDepthMm / stepMm);
}

/** Both halves of the spec §4 stacking answer in one call. */
export function stackPlan({ dofTotalMm, overlap, targetDepthMm }) {
  const step = focusStep(dofTotalMm, overlap);
  return { step, frames: frameCount(targetDepthMm, step), overlap };
}

/* ------------------------------------------------------------------ *
 * Diffraction
 * ------------------------------------------------------------------ */

/** Airy disk diameter.  d = 2.44·λ·N   (λ in mm → d in mm) */
export function airyDiameter(wavelengthMm, fNumber) {
  return 2.44 * wavelengthMm * fNumber;
}

/** Diffraction-limited f-number.  N_limit = c / (2.44·λ) */
export function diffractionLimit(cocMm, wavelengthMm) {
  return cocMm / (2.44 * wavelengthMm);
}

/**
 * How much earlier a longer wavelength hits its diffraction limit.
 *
 * DERIVED from the wavelength scaling above and NOT verified against
 * measurement on this equipment — spec §4 says to label it that way, and the
 * `verified: false` flag is how that label survives into the UI.
 *
 * Since N_limit ∝ 1/λ, the f-number ratio is simply λ_ref/λ. Aperture stops go
 * as √2, so the stop difference is 2·log2(ratio) — NOT log2(ratio). Getting
 * that factor of two wrong is the easy mistake here.
 *
 * @returns {{ratio:number, stopsEarlier:number, verified:false}}
 */
export function diffractionShift(referenceWavelengthMm, workingWavelengthMm) {
  const ratio = referenceWavelengthMm / workingWavelengthMm;
  return {
    ratio,
    stopsEarlier: -2 * Math.log2(ratio),
    verified: false,
    why: 'Derived from wavelength scaling. Not verified against measurement on this equipment.',
  };
}

/** A sweep of f-numbers against the active CoC, for the diffraction module. */
export function diffractionSweep(fNumbers, wavelengthMm, cocMm) {
  const limit = diffractionLimit(cocMm, wavelengthMm);
  return fNumbers.map((N) => {
    const airy = airyDiameter(wavelengthMm, N);
    return { fNumber: N, airyMm: airy, cocMm, overCoc: airy > cocMm, ratio: airy / cocMm };
  }).map((row) => ({ ...row, limit }));
}

/* ------------------------------------------------------------------ *
 * Field of view and framing
 * ------------------------------------------------------------------ */

/**
 * Angles of view, RADIANS.  AoV = 2·atan(dimension / 2f)
 * Uses the real sensor dimensions, so these are already the cropped angles —
 * do not also apply the crop factor to them.
 */
export function angleOfView(focalMm) {
  return {
    horizontal: 2 * Math.atan(SENSOR.width / (2 * focalMm)),
    vertical: 2 * Math.atan(SENSOR.height / (2 * focalMm)),
    diagonal: 2 * Math.atan(SENSOR.diagonal / (2 * focalMm)),
  };
}

/** Full-frame equivalent focal length, for talking to people about reach. */
export function equivalentFocal(focalMm) {
  return focalMm * CROP_FACTOR;
}

/**
 * Distance at which a subject fills a chosen fraction of the frame.
 *   d = f · S_subject / (p · sensor_dimension)
 *
 * VALID FOR d >> f. The returned `reliable` flag is false when the answer is
 * within 10× the focal length, where the thin-lens assumption stops holding —
 * that is exactly the macro regime, and the macro module is the right tool
 * there.
 *
 * @param {'horizontal'|'vertical'} orientation which sensor dimension the
 *        subject is measured across
 */
export function distanceForFrameFill(focalMm, subjectSizeMm, fraction, orientation = 'horizontal') {
  const sensorDim = orientation === 'vertical' ? SENSOR.height : SENSOR.width;
  const d = (focalMm * subjectSizeMm) / (fraction * sensorDim);
  return { distanceMm: d, sensorDim, reliable: d > 10 * focalMm };
}

/** Subject size spanned by the full frame at a given distance — the inverse. */
export function frameCoverage(focalMm, distanceMm) {
  const a = angleOfView(focalMm);
  return {
    widthMm: 2 * distanceMm * Math.tan(a.horizontal / 2),
    heightMm: 2 * distanceMm * Math.tan(a.vertical / 2),
  };
}
