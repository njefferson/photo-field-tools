// exposure.js — spec §5.2 Exposure.
//
// "Triangle solver per section 4. Includes a stop-difference calculator
// between two arbitrary exposures."

import { el, div, h, p, card, readout, groupField } from '../ui/dom.js';
import { chips } from '../ui/controls.js';
import { F_NUMBERS, SHUTTER_TIMES, ISO_VALUES } from '../core/constants.js';
import { ev100, solveTriangle, stopDifference } from '../core/exposure.js';
import { formatShutter, formatFNumber, formatIso, round } from '../core/units.js';

export function renderExposure() {
  const wrap = div('');
  wrap.append(h(1, 'Exposure'));
  wrap.append(triangle());
  wrap.append(difference());
  return wrap;
}

/* ------------------------------------------------------------------ *
 * Triangle solver
 * ------------------------------------------------------------------ */

function triangle() {
  // Lock two, solve the third. `solveFor` names the one being solved.
  let solveFor = 'shutter';
  let fNumber = 8;
  let shutterSec = 1 / 250;
  let iso = 400;
  let ev = 12;

  const out = div('');
  const controls = div('');
  const box = card('Triangle solver', [
    p('lede', 'Lock any two, set a target EV, and the third is solved. '
      + 'Results snap to the nearest 1/3 stop; the exact value stays underneath.'),
  ]);

  const targetChips = chips({
    label: 'Solve for',
    options: [
      { value: 'aperture', label: 'Aperture' },
      { value: 'shutter', label: 'Shutter' },
      { value: 'iso', label: 'ISO' },
    ],
    value: solveFor,
    onSelect: (v) => { solveFor = v; rebuild(); },
  });

  function rebuild() {
    while (controls.firstChild) controls.removeChild(controls.firstChild);

    if (solveFor !== 'aperture') {
      controls.append(groupField('Aperture (locked)', chips({
        label: 'Aperture', options: F_NUMBERS.filter((f) => f <= 32), value: fNumber,
        format: (v) => `f/${v}`, onSelect: (v) => { fNumber = v; compute(); },
      })));
    }
    if (solveFor !== 'shutter') {
      controls.append(groupField('Shutter (locked)', chips({
        label: 'Shutter', options: SHUTTER_TIMES.filter((t) => t <= 30), value: shutterSec,
        format: (v) => formatShutter(v).replace(' s', ''), onSelect: (v) => { shutterSec = v; compute(); },
      })));
    }
    if (solveFor !== 'iso') {
      controls.append(groupField('ISO (locked)', chips({
        label: 'ISO', options: ISO_VALUES.filter((i) => i <= 25600), value: iso,
        format: (v) => String(v), onSelect: (v) => { iso = v; compute(); },
      })));
    }

    const evInput = el('input', {
      type: 'number', inputMode: 'decimal', value: String(ev),
      attrs: { step: '0.3', min: '-6', max: '20', 'aria-label': 'Target EV at ISO 100' },
      on: { change: (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) { ev = v; compute(); } } },
    });
    controls.append(groupField('Target EV100', div('', [evInput]),
      'EV 15 is full sun; EV 0 is roughly a dim room at night.'));

    compute();
  }

  function compute() {
    const r = solveTriangle({ solveFor, fNumber, shutterSec, iso, ev });
    while (out.firstChild) out.removeChild(out.firstChild);

    const label = solveFor === 'aperture' ? 'Aperture' : solveFor === 'shutter' ? 'Shutter' : 'ISO';
    const snapText = solveFor === 'aperture' ? formatFNumber(r.snapped)
      : solveFor === 'shutter' ? formatShutter(r.snapped)
      : formatIso(r.snapped);
    const exactText = solveFor === 'aperture' ? `exact f/${round(r.exact, 2)}`
      : solveFor === 'shutter' ? `exact ${formatShutter(r.exact)}`
      : `exact ISO ${round(r.exact, 0)}`;

    const delta = Math.abs(r.deltaStops) < 0.005
      ? 'exactly on a standard value'
      : `${r.deltaStops > 0 ? '+' : ''}${round(r.deltaStops, 2)} EV from snapping`;

    out.append(div('readout', [
      readout(label, snapText, `${exactText} · ${delta}`),
    ]));

    if (r.outOfRange) {
      out.append(div('warnbox', [
        `The exact answer (${exactText.replace('exact ', '')}) is outside the standard `
        + `${label.toLowerCase()} scale. The snapped value shown is the nearest end of the `
        + 'scale, not a value that achieves this EV.',
      ]));
    }

    // The whole resulting exposure, so it can be read off at a glance.
    const finalN = solveFor === 'aperture' ? r.snapped : fNumber;
    const finalT = solveFor === 'shutter' ? r.snapped : shutterSec;
    const finalS = solveFor === 'iso' ? r.snapped : iso;
    out.append(p('hint',
      `Resulting exposure: ${formatFNumber(finalN)} · ${formatShutter(finalT)} · ${formatIso(finalS)}`
      + ` = EV ${round(ev100({ fNumber: finalN, shutterSec: finalT, iso: finalS }), 2)}`));
  }

  box.append(groupField('Solve for', targetChips), controls, out);
  rebuild();
  return box;
}

/* ------------------------------------------------------------------ *
 * Stop difference
 * ------------------------------------------------------------------ */

function difference() {
  const a = { fNumber: 5.6, shutterSec: 1 / 125, iso: 100 };
  const b = { fNumber: 11, shutterSec: 1 / 60, iso: 400 };
  const out = div('');

  const box = card('Stop difference', [
    p('lede', 'How far apart are two exposures?'),
  ]);

  function exposureFields(name, obj) {
    const g = div('card', [], { style: { background: 'var(--surface-2)' } });
    g.append(el('h3', { text: name }));
    g.append(groupField(`${name} aperture`, chips({
      label: `${name} aperture`, options: F_NUMBERS.filter((f) => f <= 32), value: obj.fNumber,
      format: (v) => `f/${v}`, onSelect: (v) => { obj.fNumber = v; compute(); },
    })));
    g.append(groupField(`${name} shutter`, chips({
      label: `${name} shutter`, options: SHUTTER_TIMES.filter((t) => t <= 30), value: obj.shutterSec,
      format: (v) => formatShutter(v).replace(' s', ''), onSelect: (v) => { obj.shutterSec = v; compute(); },
    })));
    g.append(groupField(`${name} ISO`, chips({
      label: `${name} ISO`, options: ISO_VALUES.filter((i) => i <= 25600), value: obj.iso,
      format: (v) => String(v), onSelect: (v) => { obj.iso = v; compute(); },
    })));
    return g;
  }

  function compute() {
    const d = stopDifference(a, b);
    while (out.firstChild) out.removeChild(out.firstChild);
    const mag = Math.abs(round(d, 2));
    // The sign is the entire message, so it is spelled out in words rather
    // than left to a leading minus the reader has to interpret.
    const sense = Math.abs(d) < 0.005
      ? 'Identical exposure.'
      : d > 0
        ? `B admits ${mag} stops LESS light than A — B suits a brighter scene.`
        : `B admits ${mag} stops MORE light than A — B suits a darker scene.`;
    out.append(div('readout', [
      readout('Difference', `${d > 0 ? '+' : ''}${round(d, 2)} EV`, sense),
      readout('A', `EV ${round(ev100(a), 2)}`, null, { small: true }),
      readout('B', `EV ${round(ev100(b), 2)}`, null, { small: true }),
    ]));
  }

  box.append(exposureFields('A', a), exposureFields('B', b), out);
  compute();
  return box;
}
