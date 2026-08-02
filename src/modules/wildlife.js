// wildlife.js — spec §5.7.
//
// "FoV at current focal length; distance-for-frame-fill solver; shutter floor;
// teleconverter effect on reach, aperture, and floor. Present as ONE SCREEN
// driven off the selected lens, not four separate calculators."
//
// So the focal length, the teleconverter and the lens are chosen once at the
// top, and everything below recomputes from them. The teleconverter's
// effective focal length feeds the field of view, the framing solver AND the
// shutter floor (spec §4: "Apply f_effective downstream").

import { el, div, h, p, card, readout, groupField, caveat, empty } from '../ui/dom.js';
import { chips } from '../ui/controls.js';
import { SHUTTER_STRICTNESS, SENSOR } from '../core/constants.js';
import { angleOfView, equivalentFocal, distanceForFrameFill, frameCoverage } from '../core/optics.js';
import { shutterFloor, shutterFloorVR, teleconverter } from '../core/exposure.js';
import { formatDistance, formatAngle, formatShutter, formatFNumber, round } from '../core/units.js';
import { focalControl, apertureControl, initialFocal, initialAperture, widestAperture } from '../ui/gearinputs.js';
import { navigate } from '../router.js';
import * as store from '../store/state.js';

export function renderWildlife() {
  let focalMm = initialFocal();
  let fNumber = initialAperture(focalMm);
  let tcId = null;
  let subjectMm = 300;          // a mid-sized bird, head to tail
  let fillFraction = 0.5;
  let orientation = 'horizontal';
  let k = store.getSettings().strictness;

  const wrap = div('');
  wrap.append(h(1, 'Wildlife'));

  const lens = store.activeLens();
  if (!lens) {
    wrap.append(card('No lens selected', [
      p('', 'This screen is driven off the selected lens — its focal range, its maximum '
          + 'aperture and its VR rating. You can still use it by entering a focal length by hand.'),
      el('button', { type: 'button', class: 'btn', text: 'Add or choose a lens', on: { click: () => navigate('/gear') } }),
    ]));
  }

  const setup = card('Setup', []);
  const out = div('');

  function rebuildSetup() {
    while (setup.children.length > 1) setup.removeChild(setup.lastChild);
    setup.append(focalControl({ value: focalMm, onChange: (v) => { focalMm = v; rebuildSetup(); compute(); } }));
    setup.append(apertureControl({ value: fNumber, focalMm, onChange: (v) => { fNumber = v; compute(); } }));

    const tcs = store.getState().teleconverters;
    const tcOptions = [{ value: null, label: 'None' },
      ...tcs.map((t) => ({ value: t.id, label: t.label || `${t.factor}×` }))];
    setup.append(groupField('Teleconverter', chips({
      label: 'Teleconverter',
      options: tcOptions,
      value: tcId,
      onSelect: (v) => { tcId = v; compute(); },
    }), tcs.length ? null : 'None added yet — add one under Gear.'));
  }

  function activeTc() {
    if (!tcId) return null;
    return store.getState().teleconverters.find((t) => t.id === tcId) || null;
  }

  function compute() {
    const settings = store.getSettings();
    const units = settings.units;
    const tc = activeTc();

    // Everything downstream uses the EFFECTIVE focal length and aperture.
    const eff = tc
      ? teleconverter(focalMm, fNumber, tc.factor)
      : { focalMm, fNumber, lightLossStops: 0, factor: 1 };

    while (out.firstChild) out.removeChild(out.firstChild);

    /* ---- reach ---- */
    const aov = angleOfView(eff.focalMm);
    const reach = card('Reach', [
      div('readout', [
        readout('Focal length', `${round(eff.focalMm, 0)} mm`,
          tc ? `${focalMm} mm × ${tc.factor}` : 'no teleconverter'),
        readout('35mm equivalent', `${round(equivalentFocal(eff.focalMm), 0)} mm`, '1.5× crop'),
        readout('Aperture', formatFNumber(eff.fNumber),
          tc ? `${formatFNumber(fNumber)} × ${tc.factor} — ${round(eff.lightLossStops, 2)} stops lost` : 'unchanged'),
      ]),
      div('readout', [
        readout('Horizontal', formatAngle(aov.horizontal), null, { small: true }),
        readout('Vertical', formatAngle(aov.vertical), null, { small: true }),
        readout('Diagonal', formatAngle(aov.diagonal), null, { small: true }),
      ]),
    ]);

    if (tc) {
      const lens_ = store.activeLens();
      const widest = lens_ ? widestAperture(lens_, focalMm) : null;
      if (widest != null && eff.fNumber > widest * tc.factor + 1e-9) {
        // Nothing to say; the arithmetic already matched.
      }
      reach.append(caveat('Teleconverter applied downstream.',
        `Field of view, framing distance and the shutter floor below all use `
        + `${round(eff.focalMm, 0)} mm, not ${focalMm} mm.`));
    }
    out.append(reach);

    /* ---- framing ---- */
    const fill = distanceForFrameFill(eff.focalMm, subjectMm, fillFraction, orientation);
    const cover = frameCoverage(eff.focalMm, fill.distanceMm);
    const framing = card('Framing', [
      div('readout', [
        readout('Stand at', formatDistance(fill.distanceMm, units),
          `for a ${formatDistance(subjectMm, units)} subject filling ${Math.round(fillFraction * 100)}% of the frame ${orientation === 'vertical' ? 'height' : 'width'}`),
        readout('Frame covers', `${formatDistance(cover.widthMm, units)} × ${formatDistance(cover.heightMm, units)}`,
          'at that distance', { small: true }),
      ]),
    ]);
    if (!fill.reliable) {
      framing.append(caveat('Too close for this formula.',
        'The framing solver assumes the subject distance is much greater than the '
        + 'focal length. At this distance you are in macro territory — use the Macro screen.'));
    }
    out.append(framing);

    /* ---- shutter floor ---- */
    const floor = shutterFloor(eff.focalMm, k);
    const lens_ = store.activeLens();
    const floorCard = card('Shutter floor', [
      div('readout', [
        readout('Hand-held floor', formatShutter(floor),
          `1 / (${round(eff.focalMm, 0)} × 1.5 × ${k})`),
      ]),
    ]);

    if (lens_ && lens_.hasVR && lens_.vrStops) {
      const vr = shutterFloorVR(floor, lens_.vrStops);
      floorCard.append(div('readout', [
        readout('With VR', formatShutter(vr.value), `${lens_.vrStops} stops claimed`, { small: true }),
      ]));
      // Spec §4: label the VR value as manufacturer-claimed, not measured.
      floorCard.append(caveat('Manufacturer-claimed.',
        `The ${lens_.vrStops}-stop VR figure is the manufacturer’s claim for this lens. `
        + 'It has not been measured on this body, and real-world benefit is usually less.'));
    } else if (lens_ && lens_.hasVR) {
      floorCard.append(p('hint', `${lens_.name} has VR but no claimed stops recorded. Add the figure under Gear to see the assisted floor.`));
    } else {
      floorCard.append(p('hint', 'Neither body has IBIS, so the only stabilisation available is lens VR.'));
    }

    floorCard.append(groupField('Strictness', chips({
      label: 'Shutter floor strictness',
      options: SHUTTER_STRICTNESS.map((s) => ({ value: s.k, label: s.label })),
      value: k,
      onSelect: (v) => { k = v; store.setSetting('strictness', v); compute(); },
    }), SHUTTER_STRICTNESS.find((s) => s.k === k)?.note));
    out.append(floorCard);
  }

  /* ---- subject controls ---- */
  const subjectCard = card('Subject', []);
  const subjInput = el('input', {
    type: 'number', inputMode: 'decimal', value: String(subjectMm),
    attrs: { min: '1', step: 'any', 'aria-label': 'Subject size in millimetres' },
    on: { change: (e) => { const v = Number(e.target.value); if (v > 0) { subjectMm = v; compute(); } } },
  });
  subjectCard.append(groupField('Subject size (mm)', div('', [subjInput]),
    'Across the dimension you are framing. A robin is roughly 140 mm; a great blue heron roughly 1200 mm.'));
  subjectCard.append(groupField('Fills the frame', chips({
    label: 'Frame fill fraction',
    options: [0.25, 0.33, 0.5, 0.66, 0.8, 1],
    value: fillFraction,
    format: (v) => `${Math.round(v * 100)}%`,
    onSelect: (v) => { fillFraction = v; compute(); },
  })));
  subjectCard.append(groupField('Measured across', chips({
    label: 'Orientation',
    options: [
      { value: 'horizontal', label: `Frame width (${SENSOR.width} mm)` },
      { value: 'vertical', label: `Frame height (${SENSOR.height} mm)` },
    ],
    value: orientation,
    onSelect: (v) => { orientation = v; compute(); },
  })));

  rebuildSetup();
  wrap.append(setup, subjectCard, out);
  compute();
  return wrap;
}
