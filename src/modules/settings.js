// settings.js — spec §8 backup, and the About surface.
//
// "Full JSON export and import of everything. Export is the only backup.
// SURFACE IT IN SETTINGS, NOT BURIED." So export and import are the first
// thing on this screen, above preferences and about.

import { el, div, h, p, card, groupField, empty } from '../ui/dom.js';
import { chips, confirmDialog, openDialog } from '../ui/controls.js';
import { CONVERSION_CUTOFF_RANGE, CONVERSION_BAND } from '../core/constants.js';
import { buildExport, exportFilename, parseImport, planImport, applyImport, summariseImport } from '../store/io.js';
import { applyTheme } from '../ui/header.js';
import { announce } from '../ui/live.js';
import { VERSION } from '../version.js';
import * as store from '../store/state.js';

const HUB = 'https://noahjefferson.pages.dev';

export function renderSettings() {
  const wrap = div('');
  wrap.append(h(1, 'Settings'));

  wrap.append(backupCard());
  wrap.append(preferencesCard());
  wrap.append(convertedBodyCard());
  wrap.append(deviceCard());
  wrap.append(aboutCard());
  wrap.append(dangerCard());
  return wrap;
}

/* ------------------------------------------------------------------ *
 * Backup
 * ------------------------------------------------------------------ */

function backupCard() {
  const box = card('Backup', [
    p('lede', 'Everything you have entered — gear, calibration profiles, hotspot '
      + 'matrices, saved places and settings — in one file. There is no cloud sync, '
      + 'so this is the only backup.'),
  ]);

  box.append(div('btnrow', [
    el('button', {
      type: 'button', class: 'btn primary', text: 'Export everything',
      // SC 2.5.3: the visible words must appear in the accessible name.
      attrs: { 'aria-label': 'Export everything to a JSON backup file' },
      on: { click: doExport },
    }),
    el('button', {
      type: 'button', class: 'btn', text: 'Import a backup',
      attrs: { 'aria-label': 'Import a backup file' },
      on: { click: openImport },
    }),
  ]));

  const state = store.getState();
  box.append(el('dl', { class: 'kv' }, [
    el('dt', { text: 'Lenses' }), el('dd', { text: String(state.lenses.length) }),
    el('dt', { text: 'Teleconverters' }), el('dd', { text: String(state.teleconverters.length) }),
    el('dt', { text: 'Calibration profiles' }), el('dd', { text: String(state.calibrations.length) }),
    el('dt', { text: 'Hotspot matrices' }), el('dd', { text: String(state.hotspots.length) }),
    el('dt', { text: 'Saved places' }), el('dd', { text: String(state.locations.length) }),
  ]));

  if (store.storageError) {
    // A failed write is never swallowed — see store/state.js.
    box.append(div('warnbox', [store.storageError]));
  }
  return box;
}

function doExport() {
  const dump = buildExport(store.getState());
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFilename();
  document.body.append(a);
  a.click();
  a.remove();
  // Revoked on the next tick rather than immediately: some browsers have not
  // finished reading the blob when click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  announce(`Exported ${exportFilename()}.`);
}

function openImport() {
  openDialog({
    title: 'Import a backup',
    build: ({ close }) => {
      const wrap = div('');
      wrap.append(p('', 'Importing NEVER overwrites anything silently. Anything that '
        + 'collides with what is already here is listed, and left alone unless you say otherwise.'));

      const file = el('input', {
        type: 'file', attrs: { accept: 'application/json,.json', 'aria-label': 'Backup file' },
        on: { change: async (e) => { const f = e.target.files?.[0]; if (f) load(await f.text()); } },
      });
      wrap.append(groupField('Backup file', div('', [file])));

      const area = el('textarea', { attrs: { placeholder: '…or paste the file contents', 'aria-label': 'Backup JSON' } });
      wrap.append(groupField('Or paste it', div('', [area])));
      wrap.append(div('btnrow', [
        el('button', { type: 'button', class: 'btn', text: 'Read pasted text', on: { click: () => load(area.value) } }),
      ]));

      const report = div('');
      wrap.append(report);

      function load(text) {
        while (report.firstChild) report.removeChild(report.firstChild);
        const parsed = parseImport(text);
        if (!parsed.ok) {
          report.append(div('warnbox', ['This file was not imported:']));
          report.append(el('ul', {}, parsed.errors.map((e) => el('li', { text: e }))));
          return;
        }
        const current = store.getState();
        const plan = planImport(current, parsed.value);
        const take = new Set();

        report.append(el('h3', { text: 'What this would do' }));
        report.append(el('dl', { class: 'kv' }, [
          el('dt', { text: 'New records' }), el('dd', { text: String(plan.added.length) }),
          el('dt', { text: 'Already identical' }), el('dd', { text: String(plan.identical.length) }),
          el('dt', { text: 'Conflicts' }), el('dd', { text: String(plan.conflicts.length) }),
        ]));

        if (plan.conflicts.length) {
          report.append(p('', 'These already exist here with different contents. '
            + 'Tick any you want REPLACED by the backup; anything left unticked stays as it is.'));
          const list = div('rows');
          for (const c of plan.conflicts) {
            const cb = el('input', {
              type: 'checkbox',
              attrs: { 'aria-label': `Replace ${c.label} ${c.name} with the version in the backup` },
              on: { change: (e) => { if (e.target.checked) take.add(c.id); else take.delete(c.id); } },
            });
            Object.assign(cb.style, { width: '1.35rem', height: '1.35rem', minHeight: '0', flex: '0 0 auto' });
            list.append(el('label', { class: 'row', style: { cursor: 'pointer' } }, [
              cb,
              div('rtxt', [div('rname', [`${c.label}: ${c.name}`]), div('rsub', ['keep mine unless ticked'])]),
            ]));
          }
          report.append(list);
        }

        let takeSettings = false;
        if (plan.settings && plan.settings.contested.length) {
          const cb = el('input', {
            type: 'checkbox',
            attrs: { 'aria-label': 'Also restore settings you have changed on this device' },
            on: { change: (e) => { takeSettings = e.target.checked; } },
          });
          Object.assign(cb.style, { width: '1.35rem', height: '1.35rem', minHeight: '0', flex: '0 0 auto' });
          report.append(el('label', { class: 'row', style: { cursor: 'pointer' } }, [
            cb,
            div('rtxt', [
              div('rname', ['Also restore changed settings']),
              div('rsub', [plan.settings.contested.join(', ')]),
            ]),
          ]));
        }

        report.append(div('btnrow', [
          el('button', {
            type: 'button', class: 'btn primary', text: 'Import',
            on: {
              click: () => {
                const { state: next, applied } = applyImport(
                  store.getState(), parsed.value, plan,
                  { takeConflicts: [...take], takeContestedSettings: takeSettings },
                );
                store.replaceState(next);
                applyTheme(store.getSettings().theme);
                const line = summariseImport(applied, plan);
                announce(`Imported: ${line}.`);
                close();
              },
            },
          }),
        ]));
      }
      return wrap;
    },
  });
}

/* ------------------------------------------------------------------ *
 * Preferences
 * ------------------------------------------------------------------ */

function preferencesCard() {
  const s = store.getSettings();
  const box = card('Preferences', []);

  box.append(groupField('Units', chips({
    label: 'Units',
    options: [{ value: 'metric', label: 'Metric' }, { value: 'imperial', label: 'Imperial' }],
    value: s.units,
    onSelect: (v) => { store.setSetting('units', v); announce(`${v} units.`); },
  }), 'Applied everywhere a distance appears.'));

  box.append(groupField('Theme', chips({
    label: 'Theme',
    options: [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }],
    value: s.theme,
    onSelect: (v) => { store.setSetting('theme', v); applyTheme(v); announce(`${v} theme.`); },
  }), 'Dark is the default — it suits a dark sky better. Light reads better in direct sun.'));

  return box;
}

/* ------------------------------------------------------------------ *
 * The converted body — a fact about the camera, set once
 * ------------------------------------------------------------------ */

/**
 * What the conversion actually installed.
 *
 * This lives HERE, in settings, and deliberately NOT on any working screen.
 * It is not a wavelength anybody selects per shoot — it is a property of the
 * camera, established once when the conversion was done. The app used to put
 * a 550–950 nm number field in the body panel, which implied the opposite and
 * was simply wrong about the hardware.
 */
function convertedBodyCard() {
  const current = store.getState().conversionCutoffNm;
  const box = card('The converted body', [
    p('lede', 'A fact about the camera, entered once. Nothing on a working screen '
      + 'can change it, because it is not a per-shoot decision.'),
  ]);

  box.append(el('dl', { class: 'kv' }, [
    el('dt', { text: 'Cutoff' }),
    el('dd', {
      text: current == null
        ? `not measured — results show the ${CONVERSION_BAND.min}–${CONVERSION_BAND.max} nm band`
        : `${current} nm (recorded)`,
    }),
  ]));

  const input = el('input', {
    type: 'number', inputMode: 'numeric',
    value: current == null ? '' : String(current),
    attrs: {
      min: String(CONVERSION_CUTOFF_RANGE.min), max: String(CONVERSION_CUTOFF_RANGE.max), step: '5',
      placeholder: 'not measured',
      'aria-label': 'Conversion cutoff in nanometres, blank to use the profile default',
    },
    on: {
      change: (e) => {
        const raw = e.target.value.trim();
        if (raw === '') {
          store.setConversionCutoff(null);
          announce('Cleared. Results will show the unmeasured band again.');
          return;
        }
        const v = Number(raw);
        if (!Number.isFinite(v) || v < CONVERSION_CUTOFF_RANGE.min || v > CONVERSION_CUTOFF_RANGE.max) {
          announce(`Enter a value between ${CONVERSION_CUTOFF_RANGE.min} and ${CONVERSION_CUTOFF_RANGE.max} nanometres, or leave it blank.`);
          return;
        }
        store.setConversionCutoff(v);
        announce(`Conversion recorded at ${v} nanometres.`);
      },
    },
  });
  box.append(groupField('Cutoff installed by the conversion (nm)', div('', [input]),
    'Leave blank and the app says "not measured" everywhere rather than inventing '
    + 'a figure. This is what the shop fitted when the IR-cut filter came out — '
    + 'not something to change between shots.'));

  box.append(p('hint',
    'The camera shoots a bright red frame, so an IR-pass filter is in there; a true '
    + 'full-spectrum sensor would not. What nobody has recorded is where it cuts. '
    + 'Ask the converter, or measure it against a known filter, and every diffraction '
    + 'number in the app stops being a range.'));
  return box;
}

/* ------------------------------------------------------------------ *
 * Device
 * ------------------------------------------------------------------ */

function deviceCard() {
  const box = card('This device', [
    p('lede', 'Calibration profiles are keyed to the device they were measured on. '
      + 'The name is only for you — it is stored here and sent nowhere.'),
  ]);
  const input = el('input', {
    type: 'text', value: store.getState().deviceLabel,
    attrs: { 'aria-label': 'Name for this device' },
    on: {
      change: (e) => {
        const v = e.target.value.trim() || 'This device';
        store.update((st) => { st.deviceLabel = v; });
        announce(`Device renamed to ${v}.`);
      },
    },
  });
  box.append(groupField('Device name', div('', [input])));

  const cals = store.getState().calibrations;
  if (!cals.length) {
    box.append(empty('No calibration profiles yet.'));
  } else {
    const rows = div('rows');
    for (const c of cals) {
      rows.append(div('row', [div('rtxt', [
        div('rname', [`${c.facing === 'user' ? 'Front' : 'Rear'} · ${c.diffuser} · path ${c.path}`]),
        div('rsub', [`constant ${Math.round(c.constant * 100) / 100}, calibrated ${c.calibratedAt}`]),
      ])]));
    }
    box.append(rows);
  }
  return box;
}

/* ------------------------------------------------------------------ *
 * About
 * ------------------------------------------------------------------ */

function aboutCard() {
  const box = card('About', []);
  box.append(el('dl', { class: 'kv' }, [
    el('dt', { text: 'Version' }), el('dd', { text: VERSION }),
    el('dt', { text: 'Data' }), el('dd', { text: 'On this device only' }),
    el('dt', { text: 'Network' }), el('dd', { text: 'None at runtime' }),
  ]));
  box.append(p('', 'Capture-time calculators for a Nikon Z50-class pair, one visible '
    + 'and one internally converted to infrared at 720 nm. Everything is computed on '
    + 'this device. There is no account, no server holding your work, and no analytics.'));
  box.append(p('hint', 'Post-capture editing lives in a separate app. This one stops at the shutter.'));

  const links = div('rows');
  links.append(linkRow(`${HUB}/accessibility`, 'Accessibility statement',
    'The shared statement for all of these apps'));
  links.append(linkRow(HUB, 'noahjefferson.pages.dev', 'The rest of the apps'));
  box.append(links);
  return box;
}

function linkRow(href, name, sub) {
  return el('a', {
    class: 'row', href, attrs: { rel: 'noopener', target: '_blank' },
    style: { textDecoration: 'none', color: 'var(--txt)' },
  }, [div('rtxt', [div('rname', [name]), div('rsub', [sub])])]);
}

/* ------------------------------------------------------------------ *
 * Wipe
 * ------------------------------------------------------------------ */

function dangerCard() {
  const box = card('Erase everything', [
    p('', 'Removes every lens, calibration profile, hotspot matrix and saved place '
      + 'from this device. Export first — this cannot be undone.'),
  ]);
  box.append(div('btnrow', [
    el('button', {
      type: 'button', class: 'btn danger', text: 'Erase all data',
      attrs: { 'aria-label': 'Erase all data on this device' },
      on: {
        click: async () => {
          // Doctrine §16.5: friction in proportion to damage. Two steps, and
          // the export button sits right above.
          const first = await confirmDialog({
            title: 'Erase all data',
            message: 'Every lens, calibration profile, hotspot matrix and saved place will be '
                   + 'removed from this device. If you have not exported a backup, close this and do that first.',
            confirmLabel: 'Continue',
          });
          if (!first) return;
          const second = await confirmDialog({
            title: 'Really erase everything?',
            message: 'This cannot be undone. The only way back is importing a backup file.',
            confirmLabel: 'Erase everything',
          });
          if (!second) return;
          store.wipeAll();
          applyTheme(store.getSettings().theme);
          announce('All data erased.');
        },
      },
    }),
  ]));
  return box;
}
