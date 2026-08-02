// header.js — the global app bar (spec §9).
//
// "Global header showing active body profile and active lens, tappable to
// change, visible in every module."
//
// It also carries the build stamp (Doctrine §7b), which must be written at
// BOOT and present in the app's normal working view — not behind a tap, not
// only in an About panel. Noah reports from his device with a screenshot; the
// stamp is what makes that screenshot answerable.

import { el, div, span, mount, empty } from './dom.js';
import { openDialog, select as selectControl, chips } from './controls.js';
import { BODIES, COC_BASES } from '../core/constants.js';
import * as store from '../store/state.js';
import { BUILD_STAMP } from '../version.js';
import { announce } from './live.js';
import { navigate } from '../router.js';

export function renderHeader(root) {
  const s = store.getSettings();
  const body = store.activeBody();
  const lens = store.activeLens();

  const home = el('button', {
    type: 'button', class: 'homebtn',
    attrs: { 'aria-label': 'Home — all tools' },
    text: '☰',
    on: { click: () => navigate('/') },
  });

  const bodyBtn = el('button', {
    type: 'button', class: 'global-btn',
    attrs: { 'aria-label': `Body: ${body.label}. Change body and circle of confusion.` },
    on: { click: openBodyPanel },
  }, [span('k', 'Body'), span('v', body.label)]);

  const lensBtn = el('button', {
    type: 'button', class: 'global-btn',
    attrs: {
      'aria-label': lens
        ? `Lens: ${lens.name}. Change lens.`
        : 'No lens selected. Choose or add a lens.',
    },
    on: { click: openLensPanel },
  }, [span('k', 'Lens'), span('v', lens ? lens.name : 'None — add one')]);

  const inner = div('appbar-inner', [home, div('globals', [bodyBtn, lensBtn])]);

  // The IR flag is a standing indicator: §3 requires a mode to announce itself
  // rather than silently changing what the numbers mean.
  if (body.infrared) {
    inner.append(el('span', {
      class: 'ir-flag', text: `IR ${s.wavelengthNm} nm`,
      attrs: { 'aria-label': `Infrared body active, working wavelength ${s.wavelengthNm} nanometres` },
    }));
  }

  // Doctrine §7b: the REAL running value, read from the one constant the
  // release process bumps, written at boot — not when a panel opens.
  inner.append(el('span', { class: 'stamp', text: BUILD_STAMP, attrs: { 'aria-label': `App version ${BUILD_STAMP}` } }));

  mount(root, inner);
}

/* ------------------------------------------------------------------ *
 * Body / wavelength / CoC panel
 * ------------------------------------------------------------------ */

function openBodyPanel() {
  openDialog({
    title: 'Body and optics basis',
    build: ({ close }) => {
      const wrap = div('');

      // --- body profile ---
      wrap.append(el('h3', { text: 'Body profile' }));
      const bodyChips = chips({
        label: 'Body profile',
        options: Object.values(BODIES).map((b) => ({ value: b.id, label: b.label })),
        value: store.getSettings().bodyId,
        onSelect: (id) => {
          store.setSetting('bodyId', id);
          // Acceptance §11.3: the wavelength is re-derived from the body here.
          refresh();
          announce(`${BODIES[id].label} selected. Working wavelength ${store.getSettings().wavelengthNm} nanometres.`);
        },
      });
      wrap.append(bodyChips);
      const bodyNote = el('p', { class: 'hint', text: '' });
      wrap.append(bodyNote);

      // --- wavelength: SHOWN, NEVER SET ---
      //
      // This used to be a number field with a 550–950 nm range, which told the
      // reader they choose a wavelength per shoot. They do not. What the sensor
      // records is a fixed property of the body — for the converted one, of the
      // conversion the shop performed, established once and never touched again.
      // It is displayed here because acceptance §11.2 requires every result to
      // name the wavelength that produced it, and provenance is not a control.
      //
      // If the conversion's cutoff ever needs correcting it is a one-time entry
      // under Settings → This camera, not a dial on the working surface.
      wrap.append(el('h3', { text: 'Wavelength', style: { marginTop: '1rem' } }));
      const wlValue = el('p', { class: 'ro-inline', text: '' });
      wrap.append(wlValue);
      const wlNote = el('p', { class: 'hint', text: '' });
      wrap.append(wlNote);

      // --- circle of confusion ---
      wrap.append(el('h3', { text: 'Circle of confusion', style: { marginTop: '1rem' } }));
      const cocChips = chips({
        label: 'Circle of confusion basis',
        options: Object.values(COC_BASES).map((c) => ({ value: c.id, label: c.label })),
        value: store.getSettings().cocBasis,
        onSelect: (id) => {
          store.setSetting('cocBasis', id);
          refresh();
          announce(`Circle of confusion: ${COC_BASES[id].label}.`);
        },
      });
      wrap.append(cocChips);
      const cocNote = el('p', { class: 'hint', text: '' });
      wrap.append(cocNote);
      wrap.append(el('p', {
        class: 'hint',
        text: 'The two bases give materially different answers. Whichever is '
            + 'active is printed under every depth-of-field, diffraction and macro result.',
      }));

      // --- units and theme, since this is the global panel ---
      wrap.append(el('h3', { text: 'Units', style: { marginTop: '1rem' } }));
      wrap.append(chips({
        label: 'Units',
        options: [{ value: 'metric', label: 'Metric' }, { value: 'imperial', label: 'Imperial' }],
        value: store.getSettings().units,
        onSelect: (u) => { store.setSetting('units', u); announce(`${u === 'metric' ? 'Metric' : 'Imperial'} units.`); },
      }));

      wrap.append(el('h3', { text: 'Theme', style: { marginTop: '1rem' } }));
      wrap.append(chips({
        label: 'Theme',
        options: [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }],
        value: store.getSettings().theme,
        onSelect: (t) => { store.setSetting('theme', t); applyTheme(t); announce(`${t} theme.`); },
      }));

      function refresh() {
        const st = store.getSettings();
        const b = store.activeBody();
        bodyNote.textContent = b.infrared
          ? `${b.note}. No external filter is used, and none is offered.`
          : `${b.note}.`;
        wlValue.textContent = `${st.wavelengthNm} nm`;
        wlNote.textContent = b.infrared
          ? 'Fixed by the conversion, not chosen per shoot. Shown because every '
            + 'depth-of-field, diffraction and macro result names the wavelength behind it.'
          : 'Fixed for this body. Shown because every depth-of-field, diffraction '
            + 'and macro result names the wavelength behind it.';
        const c = COC_BASES[st.cocBasis];
        cocNote.textContent = `${c.note} — c = ${(c.mm * 1000).toFixed(3)} µm.`;
      }
      refresh();
      return wrap;
    },
  });
}

/* ------------------------------------------------------------------ *
 * Lens panel
 * ------------------------------------------------------------------ */

function openLensPanel() {
  openDialog({
    title: 'Active lens',
    build: ({ close }) => {
      const wrap = div('');
      const lenses = store.getState().lenses;

      if (!lenses.length) {
        // ACCEPTANCE §11.9: no lens data ships preloaded, so this is the
        // honest first-run state — not an error, and not a hint that
        // something failed to load.
        wrap.append(empty('No lenses yet. Your lens list starts empty on purpose — nothing is invented for you.'));
        wrap.append(el('button', {
          type: 'button', class: 'btn primary', text: 'Add a lens',
          style: { marginTop: '0.75rem' },
          on: { click: () => { close(); navigate('/gear'); } },
        }));
        return wrap;
      }

      const rows = div('rows');
      const none = el('button', {
        type: 'button', class: 'row', style: { cursor: 'pointer', textAlign: 'left' },
        attrs: { 'aria-label': 'Use No lens — enter focal length by hand' },
        on: { click: () => { store.setSetting('lensId', null); close(); } },
      }, [div('rtxt', [div('rname', ['No lens']), div('rsub', ['Enter focal length by hand'])])]);
      rows.append(none);

      for (const l of lenses) {
        rows.append(el('button', {
          type: 'button', class: 'row', style: { cursor: 'pointer', textAlign: 'left' },
          // SC 2.5.3: the row shows the name AND the summary, so both must be
          // in the name a voice user can say.
          attrs: { 'aria-label': `Use ${l.name} — ${lensSummary(l)}` },
          on: {
            click: () => {
              store.setSetting('lensId', l.id);
              announce(`${l.name} selected.`);
              close();
            },
          },
        }, [div('rtxt', [div('rname', [l.name]), div('rsub', [lensSummary(l)])])]));
      }
      wrap.append(rows);
      wrap.append(el('button', {
        type: 'button', class: 'btn', text: 'Manage gear',
        style: { marginTop: '0.75rem' },
        on: { click: () => { close(); navigate('/gear'); } },
      }));
      return wrap;
    },
  });
}

export function lensSummary(l) {
  const bits = [];
  if (l.kind === 'zoom') bits.push(`${l.focalMin}–${l.focalMax} mm`);
  else bits.push(`${l.focalMm} mm`);
  if (l.kind === 'zoom' && l.apertureWide != null) {
    bits.push(l.apertureTele != null && l.apertureTele !== l.apertureWide
      ? `f/${l.apertureWide}–${l.apertureTele}`
      : `f/${l.apertureWide}`);
  } else if (l.apertureMax != null) {
    bits.push(`f/${l.apertureMax}`);
  }
  if (l.hasVR) bits.push(l.vrStops ? `VR ${l.vrStops} stops claimed` : 'VR');
  return bits.join(' · ');
}

/** Apply the theme attribute and keep theme-color honest (PALETTES.md §6). */
export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#c4bcab' : '#1a1a1a');
}
