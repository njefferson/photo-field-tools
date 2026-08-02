// dof.js — spec §5.1 Depth of field.
//
// "Inputs: lens, focal length, aperture, focus distance. Outputs: near limit,
// far limit, total DoF, hyperfocal distance, in-focus band rendered as a
// horizontal bar with the subject marked. Shows active CoC basis and, on the
// IR body, the wavelength in use."

import { el, div, h, p, card, readout, basisLine, caveat } from '../ui/dom.js';
import { focalControl, apertureControl, distanceControl, initialFocal, initialAperture } from '../ui/gearinputs.js';
import { COC_BASES } from '../core/constants.js';
import { depthOfField } from '../core/optics.js';
import { formatDistance, formatFine } from '../core/units.js';
import * as store from '../store/state.js';

export function renderDof() {
  const s = store.getSettings();
  let focalMm = initialFocal();
  let fNumber = initialAperture(focalMm);
  let focusMm = 3000;

  const wrap = div('');
  wrap.append(h(1, 'Depth of field'));

  const results = div('');
  const inputs = card('Setup', []);

  function rebuildInputs() {
    while (inputs.children.length > 1) inputs.removeChild(inputs.lastChild);
    inputs.append(focalControl({
      value: focalMm,
      onChange: (v) => { focalMm = v; rebuildInputs(); compute(); },
    }));
    inputs.append(apertureControl({
      value: fNumber, focalMm,
      onChange: (v) => { fNumber = v; compute(); },
    }));
    inputs.append(distanceControl({
      valueMm: focusMm,
      onChange: (mm) => { focusMm = mm; compute(); },
      hint: 'Measured from the sensor plane, as the lens scale reads it.',
    }));
  }

  function compute() {
    const settings = store.getSettings();
    const coc = COC_BASES[settings.cocBasis];
    const body = store.activeBody();
    const r = depthOfField({ focalMm, fNumber, cocMm: coc.mm, focusMm });

    while (results.firstChild) results.removeChild(results.firstChild);

    const ro = div('readout', [
      readout('Near limit', formatDistance(r.near, settings.units)),
      readout('Far limit', formatDistance(r.far, settings.units),
        r.infinite ? 'At or past the hyperfocal distance' : null),
      readout('Total depth', r.total === Infinity ? '∞' : formatDistance(r.total, settings.units)),
      // Spec §4: report hyperfocal alongside EVERY DoF result.
      readout('Hyperfocal', formatDistance(r.hyperfocal, settings.units), 'Focus here for ∞ at the back'),
    ]);

    const body_ = card('In focus', [ro, band(r, focusMm, settings.units)]);

    // ACCEPTANCE §11.2: which CoC basis, and which wavelength, produced this.
    //
    // Spec §5.1 asks for the wavelength "on the IR body"; acceptance §11.2 asks
    // for it on EVERY depth-of-field, diffraction and macro output. The
    // stricter one wins, so it is always shown — and showing it always also
    // means the line reads the same on both bodies, which is what makes a
    // screenshot from either one self-describing.
    body_.append(basisLine({
      cocBasis: coc,
      wavelength: store.workingWavelength(),
      model: r.model === 'macro' ? 'macro (m ≥ 0.1)' : 'general',
    }));

    if (r.model === 'macro') {
      body_.append(caveat('Macro model.',
        'At this magnification the general formula breaks down, so the total '
        + 'comes from the high-magnification model and the near/far split is '
        + 'symmetric about the subject.'));
    }
    results.append(body_);

    results.append(card('At a glance', [
      el('dl', { class: 'kv' }, [
        el('dt', { text: 'In front of the subject' }),
        el('dd', { text: formatFine(Math.max(0, focusMm - r.near), settings.units) }),
        el('dt', { text: 'Behind the subject' }),
        el('dd', { text: r.infinite ? '∞' : formatFine(r.far - focusMm, settings.units) }),
        el('dt', { text: 'Circle of confusion' }),
        el('dd', { text: `${(coc.mm * 1000).toFixed(3)} µm — ${coc.label}` }),
      ]),
      p('hint', COC_BASES[settings.cocBasis].note),
    ]));
  }

  rebuildInputs();
  wrap.append(inputs, results);
  compute();
  return wrap;
}

/**
 * The in-focus band. Spec §5.1 wants a horizontal bar with the subject marked.
 *
 * WCAG 1.4.11: the band is identified by real 3px edges against the track, not
 * by its fill tint alone. And it carries a text alternative — the numbers are
 * already in the readout above, so the bar is marked aria-hidden and the
 * scale labels beneath it are real text rather than a picture of text.
 */
function band(r, focusMm, units) {
  // A log scale, because a linear one puts a 2 m near limit and an infinite
  // far limit on the same pixel. Anchored a little inside the near limit and a
  // little past the far one so both edges are visible.
  const lo = Math.max(1, r.near * 0.6);
  const hi = r.infinite ? r.hyperfocal * 2.2 : r.far * 1.4;
  const pos = (v) => {
    const t = (Math.log(Math.max(lo, Math.min(hi, v))) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
    return Math.max(0, Math.min(100, t * 100));
  };

  const track = div('band');
  track.setAttribute('aria-hidden', 'true');   // the numbers above carry the meaning
  const fill = div('band-fill');
  const left = pos(r.near);
  const right = r.infinite ? 100 : pos(r.far);
  fill.style.left = `${left}%`;
  fill.style.width = `${Math.max(2, right - left)}%`;
  const marker = div('band-subject');
  marker.style.left = `${pos(focusMm)}%`;
  track.append(fill, marker);

  const scale = div('band-scale', [
    el('span', { text: formatDistance(lo, units) }),
    el('span', { text: r.infinite ? '∞' : formatDistance(hi, units) }),
  ]);

  const wrap = div('');
  wrap.append(track, scale);
  return wrap;
}
