// main.js — boot.
//
// Order matters here:
//  1. state loads (so the header has something true to show)
//  2. theme applies
//  3. the build stamp is written, AT BOOT — Doctrine §7b is explicit that a
//     stamp written when a panel opens is useless in the unplanned screenshot
//     the rule exists for
//  4. routes register, router starts
//  5. the service worker registers LAST, and its failure cannot stop the app
//
// CAMERA AND GEOLOCATION ARE NOT TOUCHED HERE (spec §10). The camera is
// requested only when the meter module opens; geolocation only when the user
// chooses that path in sun & moon. Nothing is requested at startup.

import './styles.css';

import * as store from './store/state.js';
import { renderHeader, applyTheme } from './ui/header.js';
import { defineRoute, setNotFound, setOnNavigate, startRouter, navigate, currentPath } from './router.js';
import { announce } from './ui/live.js';

import { renderHome } from './modules/home.js';
import { renderDof } from './modules/dof.js';
import { renderExposure } from './modules/exposure.js';
import { renderNd } from './modules/nd.js';
import { renderDiffraction } from './modules/diffraction.js';
import { renderSunMoon } from './modules/sunmoon.js';
import { renderMeter } from './modules/meter.js';
import { renderWildlife } from './modules/wildlife.js';
import { renderMacro } from './modules/macro.js';
import { renderInfrared } from './modules/infrared.js';
import { renderGear } from './modules/gear.js';
import { renderSettings } from './modules/settings.js';

store.loadState();
applyTheme(store.getSettings().theme);

const appbar = document.getElementById('appbar');
renderHeader(appbar);
store.subscribe(() => renderHeader(appbar));

defineRoute('/', renderHome);
defineRoute('/dof', renderDof);
defineRoute('/exposure', renderExposure);
defineRoute('/nd', renderNd);
defineRoute('/diffraction', renderDiffraction);
defineRoute('/sunmoon', renderSunMoon);
defineRoute('/meter', renderMeter);
defineRoute('/wildlife', renderWildlife);
defineRoute('/macro', renderMacro);
defineRoute('/infrared', renderInfrared);
defineRoute('/gear', renderGear);
defineRoute('/settings', renderSettings);

setNotFound(() => {
  const box = document.createElement('div');
  box.className = 'card';
  const h = document.createElement('h1');
  h.textContent = 'No such tool';
  const p = document.createElement('p');
  p.className = 'lede';
  p.textContent = 'That address does not match any tool in this app.';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn primary';
  b.textContent = 'Back to all tools';
  b.addEventListener('click', () => navigate('/'));
  box.append(h, p, b);
  return box;
});

// Leaving a module must stop whatever it started — a camera stream, a timer, a
// wake lock. Modules register their teardown here rather than each inventing
// one, because a leaked camera light is the kind of thing nobody notices until
// it has been on for an hour.
const teardowns = new Set();
export function onLeave(fn) { teardowns.add(fn); }
setOnNavigate((base) => {
  for (const fn of teardowns) { try { fn(); } catch (e) { console.error(e); } }
  teardowns.clear();
  store.setSetting('lastModule', base);
});

startRouter();

// Offline transitions are announced rather than silent, so a reader knows why
// nothing changed. Spec §10: there are no runtime network fetches at all, so
// this is informational only — the app does not degrade offline.
window.addEventListener('offline', () => announce('Offline. Every tool here works without a network.'));

/* ------------------------------------------------------------------ *
 * Service worker
 * ------------------------------------------------------------------ */

// Registered LAST and guarded: a failed registration must never stop the app
// booting, and file:// has no service worker at all (the a11y gate runs there).
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('service worker registration failed', err);
    });
  });
}

// Kept for the acceptance harness: a stable place to read the running version
// and the current route without scraping the DOM.
import { VERSION } from './version.js';
window.__pft = { version: VERSION, currentPath, store };
