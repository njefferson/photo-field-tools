// sunmoon.js — spec §5.5 Sun and moon.
//
// suncalc is BUNDLED (spec §10) — imported here, built into the app bundle by
// vite, never fetched from a CDN. It is the app's only runtime dependency.
//
// LOCATION IS TWO EQUAL PATHS, and that is the point of this module's layout.
// Spec §5.5: "geolocation permission is OPTIONAL. Manual latitude/longitude
// entry is a first-class equal path, not a fallback buried in settings." So
// manual entry is rendered FIRST, always visible, never behind a denial — and
// geolocation is offered beside it as one option among several, not as the
// route the app expects you to take.
//
// Geolocation is requested ONLY when the user presses that button (spec §10).

import SunCalc from 'suncalc';
import { el, div, h, p, card, readout, groupField, empty } from '../ui/dom.js';
import { confirmDialog } from '../ui/controls.js';
import { formatTime, round } from '../core/units.js';
import { announce } from '../ui/live.js';
import * as store from '../store/state.js';

// Blue hour: the sun between −4° and −6°. suncalc gives −6° as dawn/dusk, so
// only the −4° crossing needs adding.
SunCalc.addTime(-4, 'blueHourMorningEnd', 'blueHourEveningStart');

export function renderSunMoon() {
  const saved = store.getState().lastLocation;
  let lat = saved ? saved.lat : null;
  let lon = saved ? saved.lon : null;
  let date = new Date();

  const wrap = div('');
  wrap.append(h(1, 'Sun & moon'));

  const results = div('');

  /* ---------------- location ---------------- */

  const latInput = el('input', {
    type: 'number', inputMode: 'decimal',
    value: lat != null ? String(lat) : '',
    attrs: { step: 'any', min: '-90', max: '90', placeholder: 'e.g. 42.36', 'aria-label': 'Latitude in decimal degrees' },
    on: { change: readManual },
  });
  const lonInput = el('input', {
    type: 'number', inputMode: 'decimal',
    value: lon != null ? String(lon) : '',
    attrs: { step: 'any', min: '-180', max: '180', placeholder: 'e.g. -71.06', 'aria-label': 'Longitude in decimal degrees' },
    on: { change: readManual },
  });

  function readManual() {
    const la = Number(latInput.value), lo = Number(lonInput.value);
    if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
      setLocation(la, lo, false);
    }
  }

  function setLocation(la, lo, announceIt = true) {
    lat = la; lon = lo;
    latInput.value = String(round(la, 5));
    lonInput.value = String(round(lo, 5));
    store.setLastLocation({ lat: la, lon: lo });
    if (announceIt) announce(`Location set to ${round(la, 3)}, ${round(lo, 3)}.`);
    compute();
  }

  const geoStatus = p('hint', '');
  const geoBtn = el('button', {
    type: 'button', class: 'btn', text: 'Use my location',
    attrs: { 'aria-label': 'Use my location — asks the browser for permission' },
    on: { click: askGeolocation },
  });

  function askGeolocation() {
    if (!('geolocation' in navigator)) {
      geoStatus.textContent = 'This browser offers no geolocation. Type the coordinates above instead.';
      return;
    }
    geoStatus.textContent = 'Asking the browser…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        geoStatus.textContent = `Located to about ${Math.round(pos.coords.accuracy)} m.`;
        setLocation(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        // A denial is not an error state for this module — the manual path is
        // equal and already on screen. Say what happened and move on.
        geoStatus.textContent = err.code === err.PERMISSION_DENIED
          ? 'Permission declined. The coordinates above work just as well.'
          : `Location unavailable (${err.message}). Type the coordinates above instead.`;
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
    );
  }

  const locCard = card('Location', [
    p('lede', 'Type coordinates, pick a saved place, or ask the browser. All three are equal.'),
    groupField('Latitude', div('', [latInput]), '−90 to 90. South is negative.'),
    groupField('Longitude', div('', [lonInput]), '−180 to 180. West is negative.'),
    div('btnrow', [geoBtn]),
    geoStatus,
  ]);

  /* ---------------- saved places ---------------- */

  const savedBox = card('Saved places', []);
  function rebuildSaved() {
    while (savedBox.children.length > 1) savedBox.removeChild(savedBox.lastChild);
    const list = store.getState().locations;
    if (!list.length) {
      savedBox.append(empty('No saved places yet.'));
    } else {
      const rows = div('rows');
      for (const l of list) {
        const use = el('button', {
          type: 'button', class: 'row', style: { cursor: 'pointer', textAlign: 'left', flex: '1 1 auto' },
          attrs: { 'aria-label': `Use saved place ${l.name} — ${round(l.lat, 4)}, ${round(l.lon, 4)}` },
          on: { click: () => setLocation(l.lat, l.lon) },
        }, [div('rtxt', [div('rname', [l.name]), div('rsub', [`${round(l.lat, 4)}, ${round(l.lon, 4)}`])])]);

        const del = el('button', {
          type: 'button', class: 'btn danger', text: 'Delete',
          attrs: { 'aria-label': `Delete saved place ${l.name}` },
          on: {
            click: async () => {
              if (await confirmDialog({
                title: `Delete ${l.name}`,
                message: 'This removes the saved place. Nothing else is affected.',
              })) {
                store.removeLocation(l.id);
                announce(`${l.name} deleted.`);
                rebuildSaved();
              }
            },
          },
        });
        // Doctrine §4 tremor: a destructive control never sits flush against a
        // routine one.
        const row = div('', [use, del], { style: { display: 'flex', gap: '0.75rem', alignItems: 'stretch' } });
        rows.append(row);
      }
      savedBox.append(rows);
    }

    const nameInput = el('input', {
      type: 'text', attrs: { placeholder: 'Name this place', 'aria-label': 'Name for the current coordinates' },
    });
    const saveBtn = el('button', {
      type: 'button', class: 'btn', text: 'Save current coordinates',
      on: {
        click: () => {
          const name = nameInput.value.trim();
          if (!name) { announce('Give the place a name first.'); nameInput.focus(); return; }
          if (lat == null || lon == null) { announce('Set coordinates first.'); return; }
          store.addLocation({ name, lat, lon });
          nameInput.value = '';
          announce(`${name} saved.`);
          rebuildSaved();
        },
      },
    });
    savedBox.append(groupField('Save this place', div('', [nameInput]), null));
    savedBox.append(div('btnrow', [saveBtn]));
  }

  /* ---------------- date ---------------- */

  const dateInput = el('input', {
    type: 'date',
    value: toDateValue(date),
    attrs: { 'aria-label': 'Date' },
    on: {
      change: (e) => {
        const d = fromDateValue(e.target.value);
        if (d) { date = d; compute(); }
      },
    },
  });
  const dateCard = card('Date', [
    groupField('Date', div('', [dateInput]), 'Not locked to today — plan ahead.'),
    div('btnrow', [
      el('button', {
        type: 'button', class: 'btn', text: 'Today',
        on: { click: () => { date = new Date(); dateInput.value = toDateValue(date); compute(); } },
      }),
      el('button', {
        type: 'button', class: 'btn', text: '− 1 day',
        attrs: { 'aria-label': 'Go back 1 day' },
        on: { click: () => { date = shiftDays(date, -1); dateInput.value = toDateValue(date); compute(); } },
      }),
      el('button', {
        type: 'button', class: 'btn', text: '+ 1 day',
        attrs: { 'aria-label': 'Go forward 1 day' },
        on: { click: () => { date = shiftDays(date, 1); dateInput.value = toDateValue(date); compute(); } },
      }),
    ]),
  ]);

  /* ---------------- compute ---------------- */

  function compute() {
    while (results.firstChild) results.removeChild(results.firstChild);
    if (lat == null || lon == null) {
      results.append(empty('Set a location above to see sun and moon times.'));
      return;
    }

    // suncalc works in local time on the device, which is what a photographer
    // standing at the location wants. Said plainly rather than assumed.
    const t = SunCalc.getTimes(date, lat, lon);
    const moon = SunCalc.getMoonIllumination(date);
    const moonTimes = SunCalc.getMoonTimes(date, lat, lon);

    results.append(card('Sun', [
      el('dl', { class: 'kv' }, [
        row('Astronomical dawn', t.nightEnd),
        row('Nautical dawn', t.nauticalDawn),
        row('Civil dawn', t.dawn),
        row('Blue hour (morning)', t.dawn, t.blueHourMorningEnd),
        row('Sunrise', t.sunrise),
        row('Golden hour (morning)', t.sunrise, t.goldenHourEnd),
        row('Solar noon', t.solarNoon),
        row('Golden hour (evening)', t.goldenHour, t.sunset),
        row('Sunset', t.sunset),
        row('Blue hour (evening)', t.blueHourEveningStart, t.dusk),
        row('Civil dusk', t.dusk),
        row('Nautical dusk', t.nauticalDusk),
        row('Astronomical dusk', t.night),
      ].flat()),
      p('hint', 'Times are in this device’s local time zone. Blue hour is the sun between −4° and −6°; '
        + 'golden hour is below +6°.'),
    ]));

    const phase = moonPhaseName(moon.phase);
    results.append(card('Moon', [
      div('readout', [
        readout('Illuminated', `${Math.round(moon.fraction * 100)}%`, phase),
        readout('Moonrise', formatTime(moonTimes.rise), null, { small: true }),
        readout('Moonset', formatTime(moonTimes.set), null, { small: true }),
      ]),
      moonTimes.alwaysUp ? p('hint', 'The moon does not set at this location today.') : null,
      moonTimes.alwaysDown ? p('hint', 'The moon does not rise at this location today.') : null,
      p('hint', `Phase value ${round(moon.phase, 3)} — 0 is new, 0.5 is full.`),
    ]));
  }

  function row(label, a, b) {
    const value = b === undefined ? formatTime(a) : `${formatTime(a)} – ${formatTime(b)}`;
    return [el('dt', { text: label }), el('dd', { text: value })];
  }

  wrap.append(locCard, dateCard, results, savedBox);
  rebuildSaved();
  compute();
  return wrap;
}

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function moonPhaseName(phase) {
  const p = ((phase % 1) + 1) % 1;
  const near = (target, tol = 0.02) => Math.abs(p - target) < tol || Math.abs(p - target - 1) < tol;
  if (near(0)) return 'New moon';
  if (near(0.25)) return 'First quarter';
  if (near(0.5)) return 'Full moon';
  if (near(0.75)) return 'Last quarter';
  if (p < 0.25) return 'Waxing crescent';
  if (p < 0.5) return 'Waxing gibbous';
  if (p < 0.75) return 'Waning gibbous';
  return 'Waning crescent';
}

function toDateValue(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateValue(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  // Constructed in LOCAL time deliberately: `new Date("2026-08-02")` parses as
  // UTC and lands on the previous evening west of Greenwich, which would shift
  // every sunset by a day.
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function shiftDays(d, n) {
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + n);
  return out;
}
