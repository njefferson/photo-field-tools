// infrared.js — spec §5.9. Active ONLY when the IR body profile is selected.

import { el, div, h, p, card, readout, groupField, basisLine, caveat, empty } from '../ui/dom.js';
import { chips, openDialog, confirmDialog } from '../ui/controls.js';
import { COC_BASES, REFERENCE_WAVELENGTH_NM, F_NUMBERS } from '../core/constants.js';
import { depthOfField, diffractionLimit, diffractionShift } from '../core/optics.js';
import {
  HSI_DEFINITION, SEVERITY_BANDS, severityBand, parseMatrix, buildGrid, summarise, SCHEMA_ID,
} from '../core/hotspot.js';
import { formatDistance, formatFNumber, round } from '../core/units.js';
import { focalControl, apertureControl, initialFocal, initialAperture } from '../ui/gearinputs.js';
import { navigate } from '../router.js';
import { announce } from '../ui/live.js';
import * as store from '../store/state.js';

export function renderInfrared() {
  const body = store.activeBody();

  // Spec §5.9: active only on the IR body. Says why, and offers the way out.
  if (!body.infrared) {
    const wrap = div('');
    wrap.append(h(1, 'Infrared'));
    wrap.append(card('Not the active body', [
      p('', `This screen applies to the IR-converted body. The active profile is ${body.label}.`),
      el('button', {
        type: 'button', class: 'btn primary', text: 'Back to all tools',
        on: { click: () => navigate('/') },
      }),
      p('hint', 'Change the body from the header at the top of any screen.'),
    ]));
    return wrap;
  }

  const wrap = div('');
  wrap.append(h(1, 'Infrared'));
  wrap.append(p('lede', `${body.note}. No external filter is used, and none is offered anywhere in this app.`));

  wrap.append(comparisonCard());
  wrap.append(focusShiftCard());
  wrap.append(exposureOffsetCard());
  wrap.append(hotspotCard());
  return wrap;
}

/* ------------------------------------------------------------------ *
 * DoF and diffraction, working wavelength vs 550 nm
 * ------------------------------------------------------------------ */

function comparisonCard() {
  let focalMm = initialFocal();
  let fNumber = initialAperture(focalMm);
  let focusMm = 3000;

  const box = card('Against visible light', []);
  const out = div('');
  const setup = div('');

  function rebuild() {
    while (setup.firstChild) setup.removeChild(setup.firstChild);
    setup.append(focalControl({ value: focalMm, onChange: (v) => { focalMm = v; rebuild(); compute(); } }));
    setup.append(apertureControl({ value: fNumber, focalMm, onChange: (v) => { fNumber = v; compute(); } }));
  }

  function compute() {
    const settings = store.getSettings();
    const coc = COC_BASES[settings.cocBasis];
    const workingNm = settings.wavelengthNm;
    const workingMm = workingNm / 1e6;
    const refMm = REFERENCE_WAVELENGTH_NM / 1e6;

    const dof = depthOfField({ focalMm, fNumber, cocMm: coc.mm, focusMm });
    const limitIr = diffractionLimit(coc.mm, workingMm);
    const limitVis = diffractionLimit(coc.mm, refMm);
    const shift = diffractionShift(refMm, workingMm);

    // The DoF achievable AT each wavelength's own diffraction limit — this is
    // the number that actually differs, and it is the useful comparison.
    const dofIr = depthOfField({ focalMm, fNumber: limitIr, cocMm: coc.mm, focusMm });
    const dofVis = depthOfField({ focalMm, fNumber: limitVis, cocMm: coc.mm, focusMm });

    while (out.firstChild) out.removeChild(out.firstChild);

    out.append(el('h3', { text: 'Diffraction limit' }));
    out.append(div('readout', [
      readout(`${workingNm} nm`, formatFNumber(round(limitIr, 1)), 'this body'),
      readout(`${REFERENCE_WAVELENGTH_NM} nm`, formatFNumber(round(limitVis, 1)), 'visible reference'),
      readout('Difference', `${round(shift.ratio, 3)}×`,
        `${round(Math.abs(shift.stopsEarlier), 2)} stops earlier`, { small: true }),
    ]));
    out.append(caveat('Derived, not measured.', shift.why));

    out.append(el('h3', { text: 'Depth of field', style: { marginTop: '1rem' } }));
    out.append(div('readout', [
      readout(`At ${formatFNumber(fNumber)}`,
        dof.total === Infinity ? '∞' : formatDistance(dof.total, settings.units),
        'identical at both wavelengths'),
    ]));
    // Stated plainly rather than shown as two identical columns implying a
    // difference that does not exist. Both CoC bases are wavelength-independent,
    // so the DoF formula returns the same answer at 720 nm as at 550 nm; what
    // actually changes is how far you can stop down before diffraction takes
    // the sharpness back.
    out.append(caveat('Depth of field does not change with wavelength.',
      'Both circle-of-confusion bases are defined by the sensor, not by the light, '
      + 'so the depth-of-field formula returns the same answer at either wavelength. '
      + 'What changes is the useful aperture range — the comparison below is the '
      + 'one that carries a real difference.'));

    out.append(div('readout', [
      readout(`Depth at f/${round(limitIr, 1)}`,
        dofIr.total === Infinity ? '∞' : formatDistance(dofIr.total, settings.units),
        `most you can get at ${workingNm} nm before diffraction dominates`),
      readout(`Depth at f/${round(limitVis, 1)}`,
        dofVis.total === Infinity ? '∞' : formatDistance(dofVis.total, settings.units),
        `the same lens in visible light`),
    ]));

    out.append(basisLine({ cocBasis: coc, wavelengthNm: workingNm, model: dof.model }));
  }

  rebuild();
  box.append(setup, out);
  compute();
  return box;
}

/* ------------------------------------------------------------------ *
 * Focus shift — NEVER computed (spec §4)
 * ------------------------------------------------------------------ */

function focusShiftCard() {
  const lens = store.activeLens();
  const box = card('Focus shift', []);

  if (!lens) {
    box.append(empty('Select a lens to record or see its measured focus shift.'));
    return box;
  }

  const shift = lens.irFocusShift || null;
  if (shift && Number.isFinite(shift.value)) {
    box.append(div('readout', [
      readout('Measured shift', shift.mode === 'percent' ? `${shift.value}%` : `${shift.value} mm`,
        shift.mode === 'percent' ? 'of focus distance' : 'fixed offset'),
    ]));
    box.append(p('', `${lens.name}: apply this after focusing, in the direction you measured.`));
  } else {
    // Spec §4: "When empty, display 'not measured for this lens.'"
    box.append(div('readout', [readout('Measured shift', 'not measured for this lens')]));
  }

  box.append(caveat('Never computed.',
    'Infrared focus shift is lens-specific and cannot be derived from wavelength '
    + 'alone. This field holds only what you have measured yourself.'));
  box.append(el('button', {
    type: 'button', class: 'btn', text: 'Edit in Gear',
    attrs: { 'aria-label': `Edit ${lens.name} focus shift in Gear` },
    on: { click: () => navigate('/gear') },
  }));
  return box;
}

/* ------------------------------------------------------------------ *
 * Exposure offset — per lens, per body, user-entered (spec §5.9)
 * ------------------------------------------------------------------ */

function exposureOffsetCard() {
  const lens = store.activeLens();
  const body = store.activeBody();
  const box = card('Exposure offset from visible baseline', []);

  if (!lens) {
    box.append(empty('Select a lens to record its infrared exposure offset.'));
    return box;
  }

  const offsets = lens.irExposureOffset || {};
  const current = Number.isFinite(offsets[body.id]) ? offsets[body.id] : null;

  const input = el('input', {
    type: 'number', inputMode: 'decimal',
    value: current == null ? '' : String(current),
    attrs: { step: '0.1', min: '-10', max: '15', placeholder: 'stops', 'aria-label': `Infrared exposure offset for ${lens.name} on ${body.label}, in stops` },
    on: {
      change: (e) => {
        const raw = e.target.value.trim();
        const next = { ...offsets };
        if (raw === '') delete next[body.id];
        else {
          const v = Number(raw);
          if (!Number.isFinite(v)) return;
          next[body.id] = v;
        }
        store.updateLens(lens.id, { irExposureOffset: next });
        announce(raw === '' ? 'Exposure offset cleared.' : `Exposure offset ${raw} stops saved.`);
      },
    },
  });

  box.append(div('readout', [
    readout('Offset', current == null ? 'not measured' : `${current > 0 ? '+' : ''}${current} EV`,
      `${lens.name} on ${body.label}`),
  ]));
  box.append(groupField('Measured offset (stops)', div('', [input]),
    'Positive means infrared needs more exposure than the visible baseline. Leave blank until you have measured it.'));
  box.append(caveat('Not computed.',
    'This depends on the conversion cutoff and on the lens’s own infrared '
    + 'transmission. Nothing here can derive it — it is measured per lens and per body.'));
  return box;
}

/* ------------------------------------------------------------------ *
 * Hotspot matrix (spec §7)
 * ------------------------------------------------------------------ */

function hotspotCard() {
  const lens = store.activeLens();
  const body = store.activeBody();
  const box = card('Hotspot matrix', []);

  box.append(p('lede', HSI_DEFINITION.relative));

  if (!lens) {
    box.append(empty('Select a lens to see or record its hotspot grid.'));
    box.append(importButton(null, body, () => navigate('/infrared')));
    return box;
  }

  const grid = div('');
  const rebuild = () => {
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    const matrix = store.findHotspotMatrix(lens.name, body.id);
    if (!matrix || !matrix.cells.length) {
      grid.append(empty(`No hotspot data for ${lens.name} on ${body.label}. `
        + 'Nothing is assumed — an untested lens is not a clean lens.'));
    } else {
      const g = buildGrid(matrix);
      const line = summarise(g);
      if (line) {
        grid.append(p('', line));
      } else {
        grid.append(p('hint', 'Too few measurements to summarise yet.'));
      }
      grid.append(renderGrid(g, lens, body, rebuild));
      grid.append(legend());
      grid.append(p('hint', `${g.tested} of ${g.total} combinations measured at ${g.wavelength_nm} nm.`));
    }
    grid.append(div('btnrow', [
      el('button', {
        type: 'button', class: 'btn', text: 'Add or edit a cell',
        attrs: { 'aria-label': `Add or edit a hotspot cell for ${lens.name}` },
        on: { click: () => openCellEditor(lens, body, null, rebuild) },
      }),
      importButton(lens, body, rebuild),
      el('button', {
        type: 'button', class: 'btn', text: 'What is this index?',
        on: { click: openMetricHelp },
      }),
    ]));
  };
  rebuild();
  box.append(grid);
  return box;
}

/**
 * The grid. Spec §7's load-bearing rule is that an UNTESTED cell must never
 * read as clean, so each cell carries FOUR independent signals of its state:
 * its printed value (a dash when untested), a filled-segment bar, a dashed
 * rail plus diagonal hatch, and its accessible name. Colour is the last of
 * them, never the only one.
 */
function renderGrid(g, lens, body, onChange) {
  const scroll = div('matrix-scroll');
  // The grid scrolls sideways on a phone, so it must be keyboard-scrollable
  // (axe: scrollable-region-focusable) and must say what it is when focused.
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'group');
  scroll.setAttribute('aria-label', `Hotspot grid for ${lens.name}, scrolls sideways`);
  const table = div('matrix');
  table.style.gridTemplateColumns = `auto repeat(${g.fNumbers.length}, minmax(3.2rem, 1fr))`;
  // NOT role="table": a table role requires row and cell children, and every
  // cell button here already speaks its own focal length, f-number and
  // severity. A labelled group is correct and reads better than a broken grid.
  table.setAttribute('role', 'group');
  table.setAttribute('aria-label', `Hotspot severity for ${lens.name} on ${body.label}, focal length by f-number`);

  // header row
  table.append(div('mx-head', ['mm \\ f']));
  for (const f of g.fNumbers) table.append(div('mx-head', [`f/${f}`]));

  for (const row of g.rows) {
    table.append(div('mx-rowhead', [`${row.focal_mm} mm`]));
    for (const cell of row.cells) {
      const tested = cell.tested;
      const band = tested ? cell.band : null;
      const value = tested ? cell.hsi_stops.toFixed(2) : '—';

      // The segment bar exists ONLY on tested cells. A "clean" cell is step 0,
      // so an untested cell drawn with an empty bar looked exactly like a
      // clean one on this channel — the bar was decoration claiming to be a
      // distinguishing signal. Absent-vs-present is a real difference; three
      // empty boxes next to three empty boxes is not.
      const bar = tested ? div('mx-bar') : null;
      if (bar) {
        bar.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < 3; i++) bar.append(el('i', { class: band.step > i ? 'on' : '' }));
      }

      const label = tested
        ? `${row.focal_mm} mm at f/${cell.f_number}: ${cell.hsi_stops.toFixed(2)} stops, ${band.label}`
          + `${cell.captured ? `, measured ${cell.captured}` : ''}. Edit.`
        : `${row.focal_mm} mm at f/${cell.f_number}: UNTESTED — no measurement exists. Add one.`;

      table.append(el('button', {
        type: 'button', class: 'mx-cell',
        dataset: tested ? { band: String(band.step) } : { untested: 'true' },
        attrs: { 'aria-label': label },
        on: { click: () => openCellEditor(lens, body, cell, onChange) },
      }, [div('mx-v', [value]), bar].filter(Boolean)));
    }
  }
  scroll.append(table);
  return scroll;
}

function legend() {
  const l = div('legend');
  for (const b of SEVERITY_BANDS) {
    l.append(div('lg', [
      el('span', { class: 'sw', dataset: { band: String(b.step) }, attrs: { 'aria-hidden': 'true' } }),
      `${b.label} — ${b.hint}`,
    ]));
  }
  l.append(div('lg', [
    el('span', { class: 'sw', dataset: { untested: 'true' }, attrs: { 'aria-hidden': 'true' } }),
    'Untested — no measurement exists',
  ]));
  return l;
}

function openCellEditor(lens, body, cell, onChange) {
  openDialog({
    title: cell ? `Cell at ${cell.focal_mm} mm f/${cell.f_number}` : 'Add a measurement',
    build: ({ close }) => {
      const wrap = div('');
      let focal = cell ? cell.focal_mm : (lens.kind === 'prime' ? lens.focalMm : lens.focalMin);
      let fNum = cell ? cell.f_number : 5.6;
      let hsi = cell && cell.tested ? cell.hsi_stops : 0;
      let captured = (cell && cell.captured) || new Date().toISOString().slice(0, 10);

      const focalInput = el('input', {
        type: 'number', value: String(focal), inputMode: 'numeric',
        attrs: { min: '1', step: '1', 'aria-label': 'Focal length in millimetres' },
        on: { change: (e) => { focal = Number(e.target.value); } },
      });
      wrap.append(groupField('Focal length (mm)', div('', [focalInput])));

      wrap.append(groupField('f-number', chips({
        label: 'f-number', options: F_NUMBERS.filter((f) => f <= 32), value: fNum,
        format: (v) => `f/${v}`, onSelect: (v) => { fNum = v; },
      })));

      const hsiInput = el('input', {
        type: 'number', value: String(hsi), inputMode: 'decimal',
        attrs: { step: '0.01', 'aria-label': 'Hotspot severity index in stops' },
        on: { change: (e) => { hsi = Number(e.target.value); } },
      });
      wrap.append(groupField('HSI (stops)', div('', [hsiInput]),
        'Derived in jefferson-photo-studio from the source frames. This app never computes it.'));

      const dateInput = el('input', {
        type: 'date', value: captured,
        attrs: { 'aria-label': 'Date captured' },
        on: { change: (e) => { captured = e.target.value; } },
      });
      wrap.append(groupField('Captured', div('', [dateInput])));

      const save = el('button', {
        type: 'button', class: 'btn primary', text: 'Save cell',
        on: {
          click: () => {
            if (!Number.isFinite(focal) || focal <= 0 || !Number.isFinite(hsi)) {
              announce('Enter a focal length and an HSI value first.');
              return;
            }
            store.setHotspotCell(lens.name, body.id, store.getSettings().wavelengthNm, {
              focal_mm: focal, f_number: fNum, hsi_stops: hsi, captured: captured || null,
            });
            announce(`Saved ${hsi.toFixed(2)} stops at ${focal} mm f/${fNum}.`);
            close(); onChange();
          },
        },
      });

      const row = div('btnrow', [save]);
      if (cell && cell.tested) {
        row.append(el('div', { class: 'spacer-lg' }));
        row.append(el('button', {
          type: 'button', class: 'btn danger', text: 'Clear this cell',
          attrs: { 'aria-label': `Clear the measurement at ${cell.focal_mm} mm f/${cell.f_number}` },
          on: {
            click: async () => {
              if (await confirmDialog({
                title: 'Clear this measurement',
                message: 'The cell goes back to UNTESTED. It will not read as clean.',
                confirmLabel: 'Clear',
              })) {
                store.clearHotspotCell(lens.name, body.id, cell.focal_mm, cell.f_number);
                announce('Cell cleared — now untested.');
                close(); onChange();
              }
            },
          },
        }));
      }
      wrap.append(row);
      return wrap;
    },
  });
}

/**
 * JSON import. Spec §7: "Both paths always available; the import does not
 * depend on the editing app's exporter existing yet." So this accepts pasted
 * text as well as a file — there is nothing to wait for.
 */
function importButton(lens, body, onChange) {
  return el('button', {
    type: 'button', class: 'btn', text: 'Import JSON',
    attrs: { 'aria-label': 'Import a hotspot matrix from JSON' },
    on: {
      click: () => openDialog({
        title: 'Import hotspot matrix',
        build: ({ close }) => {
          const wrap = div('');
          wrap.append(p('', `Paste a ${SCHEMA_ID} document, or choose a file.`));

          const area = el('textarea', {
            attrs: { placeholder: '{ "schema": "hotspot-matrix-v1", … }', 'aria-label': 'Hotspot matrix JSON' },
          });
          wrap.append(area);

          const file = el('input', {
            type: 'file', attrs: { accept: 'application/json,.json', 'aria-label': 'Hotspot matrix JSON file' },
            on: {
              change: async (e) => {
                const f = e.target.files && e.target.files[0];
                if (f) area.value = await f.text();
              },
            },
          });
          wrap.append(groupField('Or choose a file', div('', [file])));

          const report = div('');
          wrap.append(report);

          wrap.append(div('btnrow', [
            el('button', {
              type: 'button', class: 'btn primary', text: 'Import',
              on: {
                click: () => {
                  while (report.firstChild) report.removeChild(report.firstChild);
                  let raw;
                  try { raw = JSON.parse(area.value); } catch (err) {
                    report.append(div('warnbox', [`Not valid JSON: ${err.message}`]));
                    return;
                  }
                  const parsed = parseMatrix(raw);
                  if (!parsed.ok) {
                    // Every problem at once, not the first one.
                    report.append(div('warnbox', [`This file was not imported. ${parsed.errors.length} problem${parsed.errors.length === 1 ? '' : 's'}:`]));
                    report.append(el('ul', {}, parsed.errors.map((e) => el('li', { text: e }))));
                    return;
                  }
                  store.saveHotspotMatrix(parsed.value);
                  announce(`Imported ${parsed.value.cells.length} cells for ${parsed.value.lens}.`);
                  close(); onChange();
                },
              },
            }),
          ]));
          return wrap;
        },
      }),
    },
  });
}

function openMetricHelp() {
  openDialog({
    title: 'Hotspot Severity Index',
    build: () => div('', [
      el('p', { text: HSI_DEFINITION.formula }),
      el('ul', {}, [
        el('li', { text: HSI_DEFINITION.centre }),
        el('li', { text: HSI_DEFINITION.annulus }),
        el('li', { text: HSI_DEFINITION.linearised }),
        el('li', { text: HSI_DEFINITION.zero }),
      ]),
      el('h3', { text: 'It is a relative scale' }),
      el('p', { text: HSI_DEFINITION.relative }),
      el('h3', { text: 'Source frames must be' }),
      el('ul', {}, HSI_DEFINITION.requirements.map((r) => el('li', { text: r }))),
      el('p', {
        class: 'hint',
        text: `Derived by ${HSI_DEFINITION.derivedBy} This app holds only the numbers — `
            + 'it never re-derives them and never accepts image uploads.',
      }),
    ]),
  });
}
