// macro.js — spec §5.8.
//
// "Tube configuration picker (11 / 18 / 29 mm stacked, plus user-added).
// Outputs magnification, approximate working distance, effective aperture,
// DoF via the macro model, focus step size, and frame count for a
// user-entered target depth."
//
// The dragonfly preset (150–200 mm at 29 mm of extension) is preloaded as a
// STARTING POINT, and is labelled as one — it is not a measurement.

import { el, div, h, p, card, readout, groupField, basisLine, caveat } from '../ui/dom.js';
import { chips, stepper } from '../ui/controls.js';
import {
  COC_BASES, DRAGONFLY_PRESET, OVERLAP_RANGE, MACRO_M_THRESHOLD,
} from '../core/constants.js';
import {
  magnificationFromExtension, effectiveAperture, workingDistance,
  depthOfField, stackPlan,
} from '../core/optics.js';
import { formatDistance, formatFine, formatFNumber, formatMagnification, round } from '../core/units.js';
import { focalControl, apertureControl, initialFocal, initialAperture } from '../ui/gearinputs.js';
import * as store from '../store/state.js';

export function renderMacro() {
  let focalMm = initialFocal();
  let fNumber = initialAperture(focalMm);
  /** Selected tube ids. Stacking sums their lengths. */
  const selected = new Set();
  let lensMagnification = 0;    // the lens's own m at its current focus setting
  let overlap = store.getSettings().overlap;
  let targetDepthMm = 10;

  const wrap = div('');
  wrap.append(h(1, 'Macro'));

  const out = div('');
  const setup = card('Lens', []);
  const tubeCard = card('Extension', []);
  const stackCard = card('Focus stacking', []);

  /* ---------------- preset ---------------- */

  wrap.append(card('Starting preset', [
    p('', DRAGONFLY_PRESET.note),
    el('button', {
      type: 'button', class: 'btn primary', text: `Load the ${DRAGONFLY_PRESET.label.toLowerCase()}`,
      attrs: { 'aria-label': `Load the ${DRAGONFLY_PRESET.label}: ${DRAGONFLY_PRESET.note}` },
      on: {
        click: () => {
          focalMm = DRAGONFLY_PRESET.focalMm;
          selected.clear();
          const t29 = store.getState().tubes.find((t) => t.mm === DRAGONFLY_PRESET.extensionMm);
          if (t29) selected.add(t29.id);
          rebuildSetup(); rebuildTubes(); compute();
        },
      },
    }),
    p('hint', 'A starting point, not a measurement. Everything below is computed from '
        + 'the numbers you set, and the working distance is an approximation until you '
        + 'measure this lens’s node offset.'),
  ]));

  /* ---------------- lens ---------------- */

  function rebuildSetup() {
    while (setup.children.length > 1) setup.removeChild(setup.lastChild);
    setup.append(focalControl({ value: focalMm, onChange: (v) => { focalMm = v; rebuildSetup(); compute(); } }));
    setup.append(apertureControl({ value: fNumber, focalMm, onChange: (v) => { fNumber = v; compute(); } }));
    setup.append(groupField('Lens’s own magnification', stepper({
      value: lensMagnification, min: 0, max: 2, step: 0.05, decimals: 2,
      label: 'lens magnification',
      onChange: (v) => { lensMagnification = v; compute(); },
    }), 'Its magnification at the focus setting you are using — 0 when focused at infinity. '
       + 'Adds to the extension’s contribution: m = m_lens + x/f.'));
  }

  /* ---------------- tubes ---------------- */

  function rebuildTubes() {
    while (tubeCard.children.length > 1) tubeCard.removeChild(tubeCard.lastChild);
    const tubes = store.getState().tubes;
    const row = div('chips');
    for (const t of tubes) {
      const on = selected.has(t.id);
      const b = el('button', {
        type: 'button', class: 'chip', text: t.label,
        attrs: { 'aria-pressed': String(on), 'aria-label': `${t.label} extension tube, ${on ? 'selected' : 'not selected'}` },
        on: {
          click: () => {
            if (selected.has(t.id)) selected.delete(t.id); else selected.add(t.id);
            rebuildTubes(); compute();
          },
        },
      });
      row.append(b);
    }
    tubeCard.append(groupField('Extension tubes', row,
      'Tap to combine. The 29 mm entry is the 11 and 18 stacked — do not also select those two.'));
    tubeCard.append(p('hint', `Total extension: ${totalExtension()} mm`));
  }

  function totalExtension() {
    const tubes = store.getState().tubes;
    return [...selected].reduce((sum, id) => sum + (tubes.find((t) => t.id === id)?.mm || 0), 0);
  }

  /* ---------------- stacking controls ---------------- */

  function rebuildStack() {
    while (stackCard.children.length > 1) stackCard.removeChild(stackCard.lastChild);
    stackCard.append(groupField('Overlap', chips({
      label: 'Focus step overlap',
      options: [0, 0.1, 0.2, 0.25, 0.33, 0.4, 0.5],
      value: overlap,
      format: (v) => `${Math.round(v * 100)}%`,
      onSelect: (v) => { overlap = v; store.setSetting('overlap', v); compute(); },
    }), `Adjustable ${Math.round(OVERLAP_RANGE.min * 100)}–${Math.round(OVERLAP_RANGE.max * 100)}%. 25% is the default.`));

    const depthInput = el('input', {
      type: 'number', inputMode: 'decimal', value: String(targetDepthMm),
      attrs: { min: '0.1', step: 'any', 'aria-label': 'Target depth in millimetres' },
      on: { change: (e) => { const v = Number(e.target.value); if (v > 0) { targetDepthMm = v; compute(); } } },
    });
    stackCard.append(groupField('Target depth (mm)', div('', [depthInput]),
      'Front to back of the part of the subject that must be sharp.'));
  }

  /* ---------------- compute ---------------- */

  function compute() {
    const settings = store.getSettings();
    const coc = COC_BASES[settings.cocBasis];
    const body = store.activeBody();
    const units = settings.units;
    const extension = totalExtension();
    const m = magnificationFromExtension(focalMm, extension, lensMagnification);

    while (out.firstChild) out.removeChild(out.firstChild);

    if (!(m > 0)) {
      out.append(card('Magnification', [
        p('', 'Add extension, or give the lens its own magnification, to compute a macro setup.'),
      ]));
      return;
    }

    const nEff = effectiveAperture(fNumber, m);
    const wd = workingDistance(focalMm, m, nodeOffset());
    // Depth of field uses the EFFECTIVE aperture: at these magnifications the
    // difference between f/8 set and f/16 effective is the whole answer.
    const subjectMm = wd.principalPlane;
    const dof = depthOfField({ focalMm, fNumber: nEff.value, cocMm: coc.mm, focusMm: subjectMm, magnification: m });
    const plan = stackPlan({ dofTotalMm: dof.total, overlap, targetDepthMm });

    const main = card('Result', [
      div('readout', [
        readout('Magnification', formatMagnification(m),
          extension ? `${extension} mm extension on ${focalMm} mm` : 'from the lens alone'),
        readout('Working distance', formatDistance(wd.value, units),
          wd.approximate ? 'approximate — see below' : 'front element to subject'),
        readout('Effective aperture', formatFNumber(nEff.value),
          `set ${formatFNumber(fNumber)} · ${round(2 * Math.log2(1 + m), 2)} stops lost`),
        readout('Depth of field', formatFine(dof.total, units),
          dof.model === 'macro' ? 'macro model' : 'general model'),
      ]),
    ]);

    // ACCEPTANCE §11.2 — basis AND wavelength on every macro output, on both
    // bodies. See the same note in dof.js: the acceptance criterion is
    // stricter than spec §5.8's silence and wins.
    main.append(basisLine({
      cocBasis: coc,
      wavelengthNm: settings.wavelengthNm,
      model: dof.model === 'macro' ? `macro (m ≥ ${MACRO_M_THRESHOLD})` : 'general',
    }));

    if (dof.model === 'general') {
      main.append(caveat('General model.',
        `At ${formatMagnification(m)} the magnification is below ${MACRO_M_THRESHOLD}, so the `
        + 'general depth-of-field formula still applies and is used here.'));
    }

    // Spec §4: label N_eff approximate.
    main.append(caveat('Effective aperture is approximate.', nEff.why));

    // Spec §4: label working distance APPROXIMATE whenever node offset is empty.
    if (wd.approximate) {
      main.append(caveat('Working distance is approximate.',
        `${wd.why} Measured from the front principal plane, this is `
        + `${formatDistance(wd.principalPlane, units)}; the real front-element-to-subject `
        + 'distance is shorter by an unknown, lens-specific amount.'));
    }
    out.append(main);

    out.append(card('Stack', [
      div('readout', [
        readout('Focus step', formatFine(plan.step, units), `${Math.round(overlap * 100)}% overlap`),
        readout('Frames', plan.frames === Infinity ? '—' : String(plan.frames),
          `to cover ${formatFine(targetDepthMm, units)}`),
      ]),
      p('hint', `step = depth of field × (1 − overlap) = ${formatFine(dof.total, units)} × ${round(1 - overlap, 2)}`),
    ]));
  }

  function nodeOffset() {
    const lens = store.activeLens();
    return lens && Number.isFinite(lens.nodeOffsetMm) ? lens.nodeOffsetMm : null;
  }

  rebuildSetup(); rebuildTubes(); rebuildStack();
  wrap.append(setup, tubeCard, out, stackCard);
  compute();
  return wrap;
}
