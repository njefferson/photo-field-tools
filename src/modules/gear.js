// gear.js — spec §3 Gear inventory.
//
// "User-editable, persisted, seeded EMPTY for lenses. Do not invent or preload
// a lens list." Acceptance §11.9 checks it. The empty state below explains WHY
// it is empty, so it reads as a decision rather than a failure to load.

import { el, div, h, p, card, groupField, empty, field } from '../ui/dom.js';
import { chips, confirmDialog, openDialog } from '../ui/controls.js';
import { MEIKE_TUBES } from '../core/constants.js';
import { round } from '../core/units.js';
import { lensSummary } from '../ui/header.js';
import { announce } from '../ui/live.js';
import * as store from '../store/state.js';

export function renderGear() {
  const wrap = div('');
  wrap.append(h(1, 'Gear'));

  const lensBox = card('Lenses', []);
  const tubeBox = card('Extension tubes', []);
  const tcBox = card('Teleconverters', []);

  /* ---------------- lenses ---------------- */

  function rebuildLenses() {
    while (lensBox.children.length > 1) lensBox.removeChild(lensBox.lastChild);
    const lenses = store.getState().lenses;

    if (!lenses.length) {
      lensBox.append(empty(
        'No lenses yet. This list ships empty on purpose — no gear is invented for you, '
        + 'so everything here is something you entered.'));
    } else {
      const rows = div('rows');
      for (const l of lenses) {
        const edit = el('button', {
          type: 'button', class: 'row', style: { cursor: 'pointer', textAlign: 'left', flex: '1 1 auto' },
          attrs: { 'aria-label': `Edit ${l.name} — ${lensSummary(l)}` },
          on: { click: () => openLensEditor(l, rebuildLenses) },
        }, [div('rtxt', [
          div('rname', [l.name]),
          div('rsub', [lensSummary(l)]),
        ])]);

        const del = el('button', {
          type: 'button', class: 'btn danger', text: 'Delete',
          attrs: { 'aria-label': `Delete ${l.name}` },
          on: {
            click: async () => {
              if (await confirmDialog({
                title: `Delete ${l.name}`,
                message: 'The lens is removed. Any hotspot matrix measured for it is KEPT — '
                       + 'that work took hours and is not thrown away with the record.',
              })) {
                store.removeLens(l.id);
                announce(`${l.name} deleted.`);
                rebuildLenses();
              }
            },
          },
        });
        rows.append(div('', [edit, del], { style: { display: 'flex', gap: '0.75rem', alignItems: 'stretch' } }));
      }
      lensBox.append(rows);
    }

    lensBox.append(div('btnrow', [
      el('button', {
        type: 'button', class: 'btn primary', text: 'Add a lens',
        on: { click: () => openLensEditor(null, rebuildLenses) },
      }),
    ]));
  }

  /* ---------------- tubes ---------------- */

  function rebuildTubes() {
    while (tubeBox.children.length > 1) tubeBox.removeChild(tubeBox.lastChild);
    const tubes = store.getState().tubes;
    const rows = div('rows');
    for (const t of tubes) {
      const row = div('row', [div('rtxt', [
        div('rname', [t.label]),
        div('rsub', [t.builtin ? 'Meike set — preloaded' : 'Added by you']),
      ])]);
      if (!t.builtin) {
        row.append(el('button', {
          type: 'button', class: 'btn danger', text: 'Delete',
          attrs: { 'aria-label': `Delete the ${t.label} tube` },
          on: {
            click: async () => {
              if (await confirmDialog({ title: `Delete ${t.label}`, message: 'This removes the tube from the macro picker.' })) {
                store.removeTube(t.id); announce(`${t.label} deleted.`); rebuildTubes();
              }
            },
          },
        }));
        row.style.gap = '0.75rem';
      }
      rows.append(row);
    }
    tubeBox.append(rows);

    const mmInput = el('input', {
      type: 'number', inputMode: 'numeric',
      attrs: { min: '1', step: '1', placeholder: 'mm', 'aria-label': 'New tube length in millimetres' },
    });
    tubeBox.append(groupField('Add a tube (mm)', div('', [mmInput])));
    tubeBox.append(div('btnrow', [
      el('button', {
        type: 'button', class: 'btn', text: 'Add tube',
        on: {
          click: () => {
            const mm = Number(mmInput.value);
            if (!Number.isFinite(mm) || mm <= 0) { announce('Enter a length in millimetres.'); return; }
            store.addTube({ label: `${mm} mm`, mm });
            mmInput.value = '';
            announce(`${mm} mm tube added.`);
            rebuildTubes();
          },
        },
      }),
    ]));
    tubeBox.append(p('hint', `The Meike set (${MEIKE_TUBES.map((t) => t.mm).join(', ')} mm) is preloaded and cannot be removed.`));
  }

  /* ---------------- teleconverters ---------------- */

  function rebuildTcs() {
    while (tcBox.children.length > 1) tcBox.removeChild(tcBox.lastChild);
    const tcs = store.getState().teleconverters;
    if (!tcs.length) {
      tcBox.append(empty('No teleconverters yet.'));
    } else {
      const rows = div('rows');
      for (const t of tcs) {
        const row = div('row', [div('rtxt', [
          div('rname', [t.label || `${t.factor}×`]),
          div('rsub', [`${t.factor}× · ${round(t.lossStops, 2)} stops`]),
        ])]);
        row.style.gap = '0.75rem';
        row.append(el('button', {
          type: 'button', class: 'btn danger', text: 'Delete',
          attrs: { 'aria-label': `Delete ${t.label || `${t.factor}× teleconverter`}` },
          on: {
            click: async () => {
              if (await confirmDialog({ title: 'Delete teleconverter', message: `Remove ${t.label || `${t.factor}×`}?` })) {
                store.removeTeleconverter(t.id); announce('Teleconverter deleted.'); rebuildTcs();
              }
            },
          },
        }));
        rows.append(row);
      }
      tcBox.append(rows);
    }

    const nameInput = el('input', { type: 'text', attrs: { placeholder: 'e.g. TC-14E III', 'aria-label': 'Teleconverter name' } });
    const factorInput = el('input', {
      type: 'number', inputMode: 'decimal', value: '1.4',
      attrs: { step: '0.1', min: '1', max: '3', 'aria-label': 'Magnification factor' },
    });
    const lossInput = el('input', {
      type: 'number', inputMode: 'decimal',
      attrs: { step: '0.1', min: '0', max: '5', placeholder: 'auto', 'aria-label': 'Light loss in stops, leave blank to compute' },
    });
    tcBox.append(groupField('Name', div('', [nameInput])));
    tcBox.append(groupField('Magnification factor', div('', [factorInput])));
    tcBox.append(groupField('Light loss (stops)', div('', [lossInput]),
      'Leave blank to use the derived value, 2 × log₂(factor).'));
    tcBox.append(div('btnrow', [
      el('button', {
        type: 'button', class: 'btn', text: 'Add teleconverter',
        on: {
          click: () => {
            const factor = Number(factorInput.value);
            if (!Number.isFinite(factor) || factor <= 1) { announce('Enter a factor greater than 1.'); return; }
            const typed = Number(lossInput.value);
            const lossStops = lossInput.value.trim() && Number.isFinite(typed) ? typed : 2 * Math.log2(factor);
            store.addTeleconverter({ label: nameInput.value.trim() || `${factor}×`, factor, lossStops });
            nameInput.value = ''; lossInput.value = '';
            announce('Teleconverter added.');
            rebuildTcs();
          },
        },
      }),
    ]));
  }

  rebuildLenses(); rebuildTubes(); rebuildTcs();
  wrap.append(lensBox, tubeBox, tcBox);
  return wrap;
}

/* ------------------------------------------------------------------ *
 * Lens editor
 * ------------------------------------------------------------------ */

function openLensEditor(existing, onSaved) {
  openDialog({
    title: existing ? `Edit ${existing.name}` : 'Add a lens',
    build: ({ close }) => {
      const wrap = div('');
      const draft = {
        name: '', kind: 'prime', focalMm: 50, focalMin: 18, focalMax: 55,
        apertureMax: 1.8, apertureWide: 3.5, apertureTele: 5.6,
        hasVR: false, vrStops: null, nodeOffsetMm: null,
        lensMagnification: null, notes: '',
        irFocusShift: null, irExposureOffset: {},
        ...(existing || {}),
      };

      const nameInput = el('input', {
        type: 'text', value: draft.name,
        attrs: { placeholder: 'e.g. NIKKOR Z DX 50-250mm VR', 'aria-label': 'Lens name' },
        on: { input: (e) => { draft.name = e.target.value; } },
      });
      wrap.append(field('Display name', nameInput));

      const kindWrap = div('');
      wrap.append(groupField('Type', chips({
        label: 'Lens type',
        options: [{ value: 'prime', label: 'Prime' }, { value: 'zoom', label: 'Zoom' }],
        value: draft.kind,
        onSelect: (v) => { draft.kind = v; rebuildKind(); },
      })));
      wrap.append(kindWrap);

      function rebuildKind() {
        while (kindWrap.firstChild) kindWrap.removeChild(kindWrap.lastChild);
        if (draft.kind === 'prime') {
          kindWrap.append(field('Focal length (mm)', numberInput(draft.focalMm, 1, 2000, 1,
            (v) => { draft.focalMm = v; }, 'Focal length in millimetres')));
          kindWrap.append(field('Maximum aperture', numberInput(draft.apertureMax, 0.7, 32, 0.1,
            (v) => { draft.apertureMax = v; }, 'Maximum aperture f-number')));
        } else {
          kindWrap.append(field('Shortest focal length (mm)', numberInput(draft.focalMin, 1, 2000, 1,
            (v) => { draft.focalMin = v; }, 'Shortest focal length')));
          kindWrap.append(field('Longest focal length (mm)', numberInput(draft.focalMax, 1, 2000, 1,
            (v) => { draft.focalMax = v; }, 'Longest focal length')));
          kindWrap.append(field('Maximum aperture, wide end', numberInput(draft.apertureWide, 0.7, 32, 0.1,
            (v) => { draft.apertureWide = v; }, 'Maximum aperture at the wide end')));
          kindWrap.append(field('Maximum aperture, long end', numberInput(draft.apertureTele, 0.7, 32, 0.1,
            (v) => { draft.apertureTele = v; }, 'Maximum aperture at the long end')));
        }
      }
      rebuildKind();

      // --- VR ---
      const vrWrap = div('');
      wrap.append(groupField('Stabilisation', chips({
        label: 'Has VR',
        options: [{ value: false, label: 'No VR' }, { value: true, label: 'Has VR' }],
        value: draft.hasVR,
        onSelect: (v) => { draft.hasVR = v; rebuildVr(); },
      }), 'Neither body has IBIS, so this is the only stabilisation available.'));
      wrap.append(vrWrap);

      function rebuildVr() {
        while (vrWrap.firstChild) vrWrap.removeChild(vrWrap.lastChild);
        if (!draft.hasVR) return;
        vrWrap.append(field('Claimed stops (optional)', numberInput(draft.vrStops ?? '', 0, 8, 0.5,
          (v) => { draft.vrStops = v; }, 'Manufacturer-claimed VR stops', true)));
        vrWrap.append(p('hint', 'The manufacturer’s claim, used only to show a second, clearly-labelled shutter floor. Never treated as measured.'));
      }
      rebuildVr();

      // --- node offset (spec §4 working distance) ---
      wrap.append(field('Node offset (mm, optional)', numberInput(draft.nodeOffsetMm ?? '', 0, 500, 1,
        (v) => { draft.nodeOffsetMm = v; }, 'Node offset in millimetres', true)));
      wrap.append(p('hint',
        'Distance from the front principal plane to the front element. Leave blank and '
        + 'working distance stays labelled APPROXIMATE. Measure it once and macro '
        + 'working distances become real numbers.'));

      // --- IR focus shift (spec §4: never computed) ---
      wrap.append(el('h3', { text: 'Infrared', style: { marginTop: '1rem' } }));
      const shiftMode = (draft.irFocusShift && draft.irFocusShift.mode) || 'percent';
      const shiftValue = draft.irFocusShift && Number.isFinite(draft.irFocusShift.value)
        ? draft.irFocusShift.value : '';
      let mode = shiftMode;
      wrap.append(groupField('Focus shift, measured as', chips({
        label: 'Focus shift mode',
        options: [{ value: 'percent', label: '% of distance' }, { value: 'fixed', label: 'Fixed mm' }],
        value: mode,
        onSelect: (v) => { mode = v; syncShift(); },
      })));
      const shiftInput = numberInput(shiftValue, -50, 50, 0.1, () => syncShift(), 'Measured focus shift', true);
      wrap.append(field('Measured focus shift', shiftInput));
      wrap.append(p('hint',
        'Infrared focus shift is lens-specific and cannot be derived from wavelength. '
        + 'This holds only what you measured. Leave it blank and the Infrared screen '
        + 'says "not measured for this lens".'));

      function syncShift() {
        const raw = shiftInput.value.trim();
        if (raw === '') { draft.irFocusShift = null; return; }
        const v = Number(raw);
        draft.irFocusShift = Number.isFinite(v) ? { mode, value: v } : null;
      }

      // --- notes ---
      const notes = el('textarea', {
        value: draft.notes || '',
        attrs: { 'aria-label': 'Notes' },
        on: { input: (e) => { draft.notes = e.target.value; } },
      });
      wrap.append(field('Notes', notes));

      const errBox = div('');
      wrap.append(errBox);

      wrap.append(div('btnrow', [
        el('button', {
          type: 'button', class: 'btn primary', text: existing ? 'Save changes' : 'Add lens',
          on: {
            click: () => {
              while (errBox.firstChild) errBox.removeChild(errBox.firstChild);
              syncShift();
              const problems = validate(draft);
              if (problems.length) {
                errBox.append(div('warnbox', [problems.join(' ')]));
                return;
              }
              const record = normalise(draft);
              if (existing) {
                store.updateLens(existing.id, record);
                announce(`${record.name} saved.`);
              } else {
                const added = store.addLens(record);
                // A first lens becomes the active one — otherwise the header
                // still says "None" straight after adding one, which reads as
                // the add having failed.
                if (!store.getSettings().lensId) store.setSetting('lensId', added.id);
                announce(`${record.name} added.`);
              }
              close(); onSaved();
            },
          },
        }),
      ]));
      return wrap;
    },
  });
}

function numberInput(value, min, max, step, onChange, label, allowBlank = false) {
  const input = el('input', {
    type: 'number', inputMode: 'decimal', value: value === null || value === undefined ? '' : String(value),
    attrs: { min, max, step, 'aria-label': label, placeholder: allowBlank ? 'not measured' : null },
    on: {
      change: (e) => {
        const raw = e.target.value.trim();
        if (raw === '' && allowBlank) { onChange(null); return; }
        const v = Number(raw);
        if (Number.isFinite(v)) onChange(v);
      },
    },
  });
  return input;
}

function validate(d) {
  const out = [];
  if (!d.name || !d.name.trim()) out.push('Give the lens a name.');
  if (d.kind === 'prime') {
    if (!(d.focalMm > 0)) out.push('Focal length must be greater than zero.');
  } else {
    if (!(d.focalMin > 0) || !(d.focalMax > 0)) out.push('Both focal lengths must be greater than zero.');
    else if (d.focalMax < d.focalMin) out.push('The longest focal length must be at least the shortest.');
  }
  return out;
}

function normalise(d) {
  const base = {
    name: d.name.trim(),
    kind: d.kind,
    hasVR: !!d.hasVR,
    vrStops: d.hasVR && Number.isFinite(d.vrStops) ? d.vrStops : null,
    nodeOffsetMm: Number.isFinite(d.nodeOffsetMm) ? d.nodeOffsetMm : null,
    irFocusShift: d.irFocusShift || null,
    irExposureOffset: d.irExposureOffset || {},
    notes: d.notes || '',
  };
  if (d.kind === 'prime') {
    return { ...base, focalMm: d.focalMm, apertureMax: d.apertureMax ?? null };
  }
  return {
    ...base,
    focalMin: d.focalMin,
    focalMax: d.focalMax,
    apertureWide: d.apertureWide ?? null,
    apertureTele: d.apertureTele ?? null,
  };
}
