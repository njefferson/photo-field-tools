// offline-check.mjs — acceptance §11.1 and spec §10.
//
//   "App installs and runs fully offline with no network after first load."
//   "No runtime network fetches. suncalc is bundled, not CDN-loaded."
//
// EXITS NON-ZERO on failure.
//
// The test that matters is the SECOND load with the network genuinely cut, not
// a first load that happens to work. Playwright's setOffline makes every
// request fail the way a real dead connection does, so a service worker that
// only half-populated its cache fails here rather than in the field.

import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { serve } from './serve.mjs';

const SANDBOX_CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const launchOpts = { args: ['--no-sandbox'] };
if (existsSync(SANDBOX_CHROMIUM)) launchOpts.executablePath = SANDBOX_CHROMIUM;

const failures = [];
const passes = [];
const check = (cond, ok, bad) => (cond ? passes.push(ok) : failures.push(bad));

const server = await serve('dist');
const browser = await chromium.launch(launchOpts);

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  const errors = [];
  const external = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => {
    const u = new URL(r.url());
    // Spec §10: nothing is fetched from anywhere but this origin. A CDN import
    // that crept in would show up here and nowhere else.
    if (u.origin !== server.url && u.protocol !== 'data:' && u.protocol !== 'blob:') {
      external.push(r.url());
    }
  });

  /* ---- first load, online ---- */
  await page.goto(`${server.url}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__pft, null, { timeout: 10000 });

  const registered = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!(reg && reg.active);
  }).catch(() => false);
  check(registered, 'service worker registered and activated', 'the service worker never activated');

  // Wait for the precache to finish before pulling the plug — install is async
  // and cutting the network mid-addAll would test the wrong thing.
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    if (!names.length) return null;
    const cache = await caches.open(names[0]);
    const keys = await cache.keys();
    return { name: names[0], count: keys.length, urls: keys.map((k) => new URL(k.url).pathname) };
  });
  check(cached && cached.count > 0,
    `precached ${cached ? cached.count : 0} files into "${cached ? cached.name : 'nothing'}"`,
    'nothing was precached');
  if (cached) {
    for (const needed of ['/index.html']) {
      check(cached.urls.includes(needed), `precache holds ${needed}`, `precache is missing ${needed}`);
    }
    check(cached.urls.some((u) => u.endsWith('.js')), 'precache holds the JS bundle', 'no JS in the precache');
    check(cached.urls.some((u) => u.endsWith('.css')), 'precache holds the stylesheet', 'no CSS in the precache');
    check(cached.name.includes('0.1.0') || /v\d+\.\d+\.\d+/.test(cached.name),
      `cache name carries the version (${cached.name})`,
      `cache name has no version in it: ${cached.name}`);
  }

  /* ---- SECOND LOAD, GENUINELY OFFLINE ---- */
  await context.setOffline(true);

  const offlineErrors = [];
  page.on('pageerror', (e) => offlineErrors.push(String(e)));

  let reloadFailed = null;
  try {
    await page.reload({ waitUntil: 'load', timeout: 20000 });
  } catch (err) {
    reloadFailed = err.message;
  }
  check(!reloadFailed, 'the app reloads with the network cut', `offline reload failed: ${reloadFailed}`);

  const booted = await page.evaluate(() => !!window.__pft).catch(() => false);
  check(booted, 'the app boots offline', 'the app did not boot offline');

  const home = await page.evaluate(() => {
    const main = document.getElementById('main');
    return {
      tiles: document.querySelectorAll('.tile').length,
      stamp: document.querySelector('.stamp')?.textContent.trim() ?? null,
      text: main ? main.textContent.slice(0, 120) : '',
    };
  }).catch(() => ({ tiles: 0, stamp: null, text: '' }));
  check(home.tiles >= 9, `${home.tiles} module tiles render offline`, `only ${home.tiles} tiles rendered offline`);
  check(!!home.stamp, `build stamp still shows offline (${home.stamp})`, 'no build stamp offline');

  /* ---- every module, offline ---- */
  const ROUTES = ['/dof', '/exposure', '/nd', '/diffraction', '/sunmoon', '/wildlife', '/macro', '/gear', '/settings'];
  for (const r of ROUTES) {
    await page.evaluate((h) => { location.hash = h; }, r);
    await page.waitForTimeout(100);
    const ok = await page.evaluate(() => {
      const w = document.querySelector('.warnbox');
      const main = document.getElementById('main');
      return !(w && /failed to open/i.test(w.textContent)) && main.textContent.length > 40;
    });
    check(ok, `${r} works offline`, `${r} failed offline`);
  }

  // suncalc is the one bundled dependency; sun & moon proves it is genuinely
  // in the bundle rather than reached over a network that is now gone.
  await page.evaluate((h) => { location.hash = h; }, '/sunmoon');
  await page.waitForTimeout(120);
  const sun = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input[type="number"]')];
    if (inputs.length < 2) return null;
    inputs[0].value = '42.36'; inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
    inputs[1].value = '-71.06'; inputs[1].dispatchEvent(new Event('change', { bubbles: true }));
    return document.getElementById('main').textContent;
  });
  check(sun && /Sunrise/.test(sun) && /Moon/.test(sun),
    'suncalc computes sun and moon times offline — it is bundled, not fetched',
    'sun & moon produced no times offline');

  check(offlineErrors.length === 0, 'no page errors while offline', `offline page errors: ${offlineErrors.join(' | ')}`);
  check(external.length === 0,
    'no request to any external origin, online or off',
    `external requests found: ${[...new Set(external)].join(', ')}`);

  await context.close();
} finally {
  await browser.close();
  await server.close();
}

console.log('=== offline (acceptance §11.1, spec §10) ===');
for (const p of passes) console.log(`  ✓ ${p}`);
if (failures.length) {
  console.log(`\nFAILURES (${failures.length}):`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\nPASS — ${passes.length} offline assertions.`);
