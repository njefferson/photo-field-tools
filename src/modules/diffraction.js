// diffraction.js — spec §5.4 Diffraction.
//
// "Sweep of f-numbers for the current body and lens showing Airy disk diameter
// against the active CoC, with the limit f-number called out. Renders both
// 550 nm and the body's working wavelength side by side when the IR body is
// active."

import { el, div, h, p, card, readout, basisLine, caveat } from '../ui/dom.js';
import { COC_BASES, F_NUMBERS, REFERENCE_WAVELENGTH_NM } from '../core/constants.js';
import { diffractionSweep, diffractionLimit, airyDiameter, diffractionShift } from '../core/optics.js';
import { formatFine, round } from '../core/units.js';
import * as store from '../store/state.js';

const SWEEP_F = F_NUMBERS.filter((f) => f >= 2.8 && f <= 22 && Number.isInteger(f * 10) )
  .filter((f) => [2.8, 4, 5.6, 8, 11, 16, 22].includes(f));

export function renderDiffraction() {
  const settings = store.getSettings();
  const body = store.activeBody();
  const coc = COC_BASES[settings.cocBasis];
  const workingNm = settings.wavelengthNm;
  const workingMm = workingNm / 1e6;
  const refMm = REFERENCE_WAVELENGTH_NM / 1e6;

  const wrap = div('');
  wrap.append(h(1, 'Diffraction'));
  wrap.append(p('lede',
    'Where the Airy disk grows past the circle of confusion, stopping down '
    + 'costs more sharpness than the extra depth of field returns.'));

  const limitWorking = diffractionLimit(coc.mm, workingMm);

  const summary = card('Limit', [
    div('readout', [
      readout('Diffraction-limited', `f/${round(limitWorking, 1)}`,
        `at ${workingNm} nm on the ${coc.label} basis`),
      readout('Airy disk there', formatFine(airyDiameter(workingMm, limitWorking)),
        `equals c = ${(coc.mm * 1000).toFixed(3)} µm`, { small: true }),
    ]),
  ]);
  summary.append(basisLine({ cocBasis: coc, wavelengthNm: workingNm }));
  wrap.append(summary);

  // Spec §5.4: BOTH wavelengths side by side when the IR body is active.
  if (body.infrared) {
    const limitRef = diffractionLimit(coc.mm, refMm);
    const shift = diffractionShift(refMm, workingMm);
    const cmp = card('Against visible light', [
      div('readout', [
        readout(`${REFERENCE_WAVELENGTH_NM} nm`, `f/${round(limitRef, 1)}`, 'visible reference'),
        readout(`${workingNm} nm`, `f/${round(limitWorking, 1)}`, 'this body'),
        readout('Ratio', `${round(shift.ratio, 3)}×`,
          `${round(Math.abs(shift.stopsEarlier), 2)} stops earlier`, { small: true }),
      ]),
    ]);
    // Spec §4 requires this to be labelled as derived and unverified. The
    // number is computed live rather than quoted, so it can never drift from
    // the wavelengths actually in use.
    cmp.append(caveat('Derived, not measured.',
      `The ratio is ${REFERENCE_WAVELENGTH_NM}/${workingNm} = ${round(shift.ratio, 3)}, `
      + 'derived from the wavelength scaling alone. It has NOT been verified '
      + 'against measurement on this equipment.'));
    wrap.append(cmp);
  }

  wrap.append(sweepCard(`Sweep at ${workingNm} nm`, workingMm, coc, limitWorking));
  if (body.infrared) {
    wrap.append(sweepCard(`Sweep at ${REFERENCE_WAVELENGTH_NM} nm (visible reference)`,
      refMm, coc, diffractionLimit(coc.mm, refMm)));
  }

  wrap.append(card('What this measures', [
    p('', `The Airy disk diameter is 2.44 × λ × N. Once it exceeds the circle of `
      + `confusion — here ${(coc.mm * 1000).toFixed(3)} µm on the ${coc.label} basis — `
      + 'the lens is resolving less than the sensor can record.'),
    p('hint', COC_BASES[settings.cocBasis].note
      + ' Switching basis in the body panel changes every number on this screen.'),
  ]));

  return wrap;
}

function sweepCard(title, wavelengthMm, coc, limit) {
  const rows = diffractionSweep(SWEEP_F, wavelengthMm, coc.mm);
  const worst = Math.max(...rows.map((r) => r.airyMm));
  const list = div('sweep');

  for (const r of rows) {
    const row = div(`sweep-row${r.overCoc ? ' over' : ''}`);
    row.append(el('span', { class: 'sweep-f', text: `f/${r.fNumber}` }));

    const bar = div('sweep-bar');
    const fillEl = el('i');
    fillEl.style.width = `${Math.max(3, (r.airyMm / worst) * 100)}%`;
    bar.append(fillEl);
    bar.setAttribute('aria-hidden', 'true');   // the value beside it is the content
    row.append(bar);

    // The state is carried by TEXT ("over c"), by a hatch, and by weight — not
    // by colour alone (Doctrine §4).
    row.append(el('span', {
      class: 'sweep-v',
      text: `${(r.airyMm * 1000).toFixed(1)} µm${r.overCoc ? ' · over c' : ''}`,
    }));
    row.setAttribute('role', 'listitem');
    row.setAttribute('aria-label',
      `f/${r.fNumber}: Airy disk ${(r.airyMm * 1000).toFixed(1)} microns, `
      + `${r.overCoc ? 'larger than' : 'within'} the circle of confusion`);
    list.append(row);
  }
  list.setAttribute('role', 'list');

  const c = card(title, [
    list,
    p('hint', `Limit f/${round(limit, 1)} — the largest f-number whose Airy disk still fits inside c.`),
  ]);
  return c;
}
