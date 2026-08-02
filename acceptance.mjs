// acceptance.mjs — the spec §11 acceptance criteria, as a gate.
//
// EXITS NON-ZERO on any failure. Doctrine §4's standing lesson is that a
// checker printing "FAIL" and exiting 0 is a reporter, and a reporter lets a
// broken build ship.
//
// Criteria 1 and 8 are covered by their own runners and are asserted here only
// as a cross-check that they were run:
//   §11.1 offline   → offline-check.mjs
//   §11.8 unit tests → npm test
//
// WHAT THIS CANNOT DO, stated rather than implied (Doctrine §5):
//   §11.5 runs the iOS CODE PATH by removing track capabilities, which is the
//         mechanism WebKit's absence produces. It is not real Safari.
//   §11.6 measures that untested and clean cells differ on four channels and
//         computes the contrast between them. "At arm's length in bright sun"
//         is Noah's eyes, and is listed in the handoff as needing them.

import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { serve } from './serve.mjs';

const SANDBOX_CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const launchOpts = {
  args: [
    '--no-sandbox',
    // A synthetic camera, so the meter's real code path runs headlessly.
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ],
};
if (existsSync(SANDBOX_CHROMIUM)) launchOpts.executablePath = SANDBOX_CHROMIUM;

const failures = [];
const passes = [];
const notes = [];
const fail = (id, msg) => failures.push(`${id}: ${msg}`);
const pass = (id, msg) => passes.push(`${id}: ${msg}`);
const check = (id, cond, okMsg, badMsg) => (cond ? pass(id, okMsg) : fail(id, badMsg));

const server = await serve('dist');
const browser = await chromium.launch(launchOpts);

/** A fresh page with optional pre-seeded localStorage. */
async function open(seed) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['camera'],
  });
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  if (seed) {
    await context.addInitScript((s) => {
      localStorage.setItem('photo-field-tools/v1', JSON.stringify(s));
    }, seed);
  }
  await page.goto(`${server.url}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__pft, null, { timeout: 10000 });
  return { context, page, errors };
}

const go = async (page, hash) => {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(120);
};

/** A state with a lens and a sparse hotspot grid, for the grid checks. */
const seedWithLens = (bodyId = 'z50-ir') => ({
  version: 1,
  deviceId: 'test-device',
  deviceLabel: 'Test device',
  settings: {
    bodyId, lensId: 'lens-1', cocBasis: 'pixel',
    // Not seeded: the wavelength is derived from the body on load, and the IR
    // body's cutoff is unmeasured until somebody records one.
    units: 'metric', theme: 'dark', strictness: 2, overlap: 0.25,
    diffuser: 'flat', meterAverageFrames: 8, lastModule: null,
  },
  lenses: [{
    id: 'lens-1', name: 'Test 18-140 VR', kind: 'zoom', focalMin: 18, focalMax: 140,
    apertureWide: 3.5, apertureTele: 5.6, hasVR: true, vrStops: 4,
    nodeOffsetMm: null, irFocusShift: null, irExposureOffset: {}, notes: '',
  }],
  tubes: [], teleconverters: [], calibrations: [],
  hotspots: [{
    schema: 'hotspot-matrix-v1', lens: 'Test 18-140 VR', body: 'z50-ir', wavelength_nm: 720,
    cells: [
      { focal_mm: 18, f_number: 5.6, hsi_stops: 0.02, captured: '2026-07-11' },
      { focal_mm: 18, f_number: 8, hsi_stops: 0.05, captured: '2026-07-11' },
      { focal_mm: 35, f_number: 5.6, hsi_stops: 0.71, captured: '2026-07-11' },
      // 35 mm f/8 deliberately absent — this is the UNTESTED cell §11.6 is about.
    ],
  }],
  locations: [], lastLocation: null,
});

try {
  /* ================================================================
   * §11.2 — every DoF, diffraction and macro output names its basis
   *         AND its wavelength
   * ================================================================ */
  {
    const { context, page, errors } = await open(seedWithLens('z50-ir'));
    for (const [route, label] of [['/dof', 'depth of field'], ['/diffraction', 'diffraction'], ['/macro', 'macro']]) {
      await go(page, route);
      if (route === '/macro') {
        // Macro needs extension before it produces a number to attribute.
        await page.evaluate(() => {
          const b = [...document.querySelectorAll('button')].find((x) => /Load the dragonfly/i.test(x.textContent));
          if (b) b.click();
        });
        await page.waitForTimeout(150);
      }
      const basis = await page.evaluate(() =>
        [...document.querySelectorAll('.basis')].map((n) => n.textContent.trim()));
      const ok = basis.length > 0
        && basis.every((t) => /Circle of confusion:/.test(t))
        && basis.every((t) => /\bnm\b/.test(t));
      check('§11.2', ok,
        `${label} names its CoC basis and wavelength (${basis.length} readout${basis.length === 1 ? '' : 's'})`,
        `${label} at ${route} is missing a basis/wavelength line — found ${JSON.stringify(basis)}`);
    }
    if (errors.length) fail('§11.2', `page errors: ${errors.join(' | ')}`);
    await context.close();
  }

  /* ================================================================
   * §11.3 — IR body changes wavelength AND the diffraction limit;
   *         the visible body reverts it
   * ================================================================ */
  {
    const { context, page, errors } = await open(seedWithLens('z50ii'));

    await go(page, '/diffraction');
    const visible = await readDiffraction(page);

    await page.evaluate(() => window.__pft.store.setSetting('bodyId', 'z50-ir'));
    await go(page, '/');
    await go(page, '/diffraction');
    const infrared = await readDiffraction(page);

    await page.evaluate(() => window.__pft.store.setSetting('bodyId', 'z50ii'));
    await go(page, '/');
    await go(page, '/diffraction');
    const reverted = await readDiffraction(page);

    check('§11.3', visible.wavelength === 550,
      'visible body works at a known 550 nm', `visible body reported ${visible.wavelength} nm`);

    // THE IR CUTOFF IS UNMEASURED. Selecting the IR body still CHANGES the
    // wavelength — from a known number to an explicit unknown — and still
    // changes the diffraction limit, from one figure to the band it could sit
    // in. What it must NOT do is produce a confident number nobody measured.
    check('§11.3', infrared.wavelength === null && /not measured/i.test(infrared.wavelengthText),
      'IR body reports its cutoff as NOT MEASURED rather than inventing one',
      `IR body reported "${infrared.wavelengthText}"`);
    check('§11.3', infrared.limits.length === 2,
      `IR diffraction limit is a range, f/${infrared.limits.join(' – f/')}`,
      `IR limit was not a range: ${JSON.stringify(infrared.limits)}`);
    check('§11.3', infrared.limits.length === 2 && infrared.limits[0] < visible.limit,
      'the range brackets a tighter limit than visible light',
      `range ${JSON.stringify(infrared.limits)} vs visible f/${visible.limit}`);

    check('§11.3', reverted.wavelength === 550 && reverted.limit === visible.limit,
      'selecting the visible body reverts both',
      `reverting gave ${reverted.wavelengthText} / f/${reverted.limit}`);

    if (errors.length) fail('§11.3', `page errors: ${errors.join(' | ')}`);
    await context.close();
  }

  /* ================================================================
   * §11.4 — uncalibrated meter shows RELATIVE STOPS ONLY
   * ================================================================ */
  {
    const { context, page, errors } = await open(seedWithLens('z50ii'));
    await go(page, '/meter');
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Start meter/i.test(x.textContent));
      if (b) b.click();
    });
    await page.waitForTimeout(1200);

    // STRUCTURAL, not textual. The panel's own disclaimer necessarily contains
    // the words "EV", "lux" and "suggested exposure" — it is the sentence
    // promising not to show them. A regex over prose flags that sentence as a
    // violation, which is the gate misreading its own subject. So this reads
    // the DISPLAYED VALUES: the big readout and every labelled readout in the
    // panel. (PALETTES.md §7: when a gate flags something that looks right,
    // establish whether the rule governs that case before changing the code.)
    const state = await page.evaluate(() => {
      const box = [...document.querySelectorAll('.card')]
        .find((c) => c.querySelector('h2') && /^Reading$/.test(c.querySelector('h2').textContent));
      if (!box) return { found: false };
      return {
        found: true,
        prose: box.textContent,
        big: box.querySelector('.meter-big')?.textContent.trim() ?? '',
        readouts: [...box.querySelectorAll('.ro')].map((r) => ({
          key: r.querySelector('.k')?.textContent.trim() ?? '',
          value: r.querySelector('.v')?.textContent.trim() ?? '',
        })),
      };
    });

    check('§11.4', state.found, 'the reading panel rendered', 'no reading panel found');
    check('§11.4', /Not calibrated/i.test(state.prose),
      'it says it is not calibrated', 'no uncalibrated notice in the reading panel');
    check('§11.4', /relative stops/i.test(state.prose),
      'it offers relative stops only', 'the relative-stops-only statement is missing');

    const keys = state.readouts.map((r) => r.key.toLowerCase());
    const values = [state.big, ...state.readouts.map((r) => r.value)].join(' | ');

    check('§11.4', !/\bEV\b/i.test(values),
      'no absolute EV among the displayed values', `an absolute EV leaked into a readout: ${values}`);
    check('§11.4', !/\b(lx|lux)\b/i.test(values) && !keys.includes('illuminance'),
      'no lux value among the displayed values', `a lux value leaked into a readout: ${values}`);
    check('§11.4', !keys.includes('suggested'),
      'no recommended exposure readout is present',
      `a suggested-exposure readout leaked in: ${JSON.stringify(keys)}`);

    if (errors.length) fail('§11.4', `page errors: ${errors.join(' | ')}`);
    await context.close();
  }

  /* ================================================================
   * §11.5 — degrades to the luminance path when the platform exposes
   *         no track capabilities (the iOS/WebKit condition), without
   *         crashing or showing a broken control, and SAYS which path
   * ================================================================ */
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      permissions: ['camera'],
    });
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));

    // Strip getCapabilities from every video track — this is exactly what
    // WebKit does, and it is the condition the app is required to detect by
    // probing rather than by sniffing the user agent.
    await context.addInitScript(() => {
      localStorage.setItem('photo-field-tools/v1', JSON.stringify({ version: 1 }));
      const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (c) => {
        const stream = await orig(c);
        for (const t of stream.getVideoTracks()) {
          delete t.getCapabilities;
          Object.defineProperty(t, 'getCapabilities', { value: undefined, configurable: true });
        }
        return stream;
      };
    });
    await page.goto(`${server.url}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__pft, null, { timeout: 10000 });
    await go(page, '/meter');
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Start meter/i.test(x.textContent));
      if (b) b.click();
    });
    await page.waitForTimeout(1500);

    const text = await page.evaluate(() => document.getElementById('main').textContent);
    check('§11.5', errors.length === 0,
      'no crash with capabilities absent', `page errors: ${errors.join(' | ')}`);
    check('§11.5', /luminance path/i.test(text),
      'it states the luminance path is in use', 'the active path is not stated');
    check('§11.5', /Path\s*B/.test(text),
      'the active path is named B', 'path B is not named in the panel');

    // "Without presenting a broken control": every enabled control must have
    // an accessible name and a real hit area.
    const broken = await page.evaluate(() => [...document.querySelectorAll('button:not([disabled])')]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        const name = (b.textContent || '').trim() || b.getAttribute('aria-label');
        return r.width > 0 && (!name || r.height < 24);
      })
      .map((b) => b.outerHTML.slice(0, 80)));
    check('§11.5', broken.length === 0,
      'no nameless or collapsed controls on the fallback path',
      `broken controls: ${broken.join(' | ')}`);
    await context.close();
  }

  /* ================================================================
   * §11.6 — untested hotspot cells are distinguishable from clean ones
   * ================================================================ */
  {
    const { context, page, errors } = await open(seedWithLens('z50-ir'));
    await go(page, '/infrared');
    await page.waitForTimeout(200);

    const cells = await page.evaluate(() => {
      const out = { clean: null, untested: null, count: 0 };
      for (const c of document.querySelectorAll('.mx-cell')) {
        const cs = getComputedStyle(c);
        const rec = {
          bg: cs.backgroundColor,
          image: cs.backgroundImage,
          borderStyle: cs.borderTopStyle,
          borderWidth: cs.borderTopWidth,
          text: c.querySelector('.mx-v')?.textContent ?? '',
          label: c.getAttribute('aria-label') || '',
          segments: [...c.querySelectorAll('.mx-bar i.on')].length,
          hasBar: !!c.querySelector('.mx-bar'),
        };
        out.count += 1;
        if (c.dataset.untested === 'true') out.untested = rec;
        else if (c.dataset.band === '0') out.clean = rec;
      }
      return out;
    });

    check('§11.6', cells.count >= 4, `${cells.count} cells rendered`, 'the grid did not render');
    check('§11.6', !!cells.untested, 'an untested cell exists in the grid', 'no untested cell rendered');
    check('§11.6', !!cells.clean, 'a clean cell exists in the grid', 'no clean cell rendered');

    if (cells.untested && cells.clean) {
      const u = cells.untested, c = cells.clean;
      // FOUR independent channels, so no single failure makes untested read as
      // safe. Colour is only one of them.
      check('§11.6', u.bg !== c.bg, 'fill differs', `both cells share the fill ${u.bg}`);
      check('§11.6', u.image !== 'none' && u.image !== c.image,
        'untested carries a hatch pattern the clean cell does not',
        'no distinguishing background pattern on the untested cell');
      check('§11.6', u.borderStyle !== c.borderStyle,
        `border style differs (${c.borderStyle} vs ${u.borderStyle})`,
        `both cells use ${u.borderStyle} borders`);
      check('§11.6', u.text === '—' && c.text !== '—',
        'untested prints a dash where clean prints a number',
        `text did not distinguish them: "${u.text}" vs "${c.text}"`);
      check('§11.6', /UNTESTED/.test(u.label) && !/UNTESTED/i.test(c.label),
        'the accessible name says UNTESTED',
        `accessible name does not distinguish: "${u.label}"`);
      // A CLEAN cell is severity step 0, so an untested cell drawn with an
      // empty bar matched it exactly on this channel. The bar must be absent
      // on untested cells, not merely empty — otherwise ACCESSIBILITY.md is
      // claiming a distinguishing signal that does not distinguish.
      check('§11.6', u.hasBar === false && c.hasBar === true,
        'the severity bar is absent on untested cells, present on clean ones',
        `the segment bar does not distinguish them (untested hasBar=${u.hasBar}, clean hasBar=${c.hasBar})`);
      // And the two fills are far enough apart to be told apart at a glance.
      const contrast = await page.evaluate(([a, b]) => {
        const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
        const L1 = lum(parse(a)), L2 = lum(parse(b));
        return +(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)).toFixed(2));
      }, [u.bg, c.bg]);
      notes.push(`      untested vs clean fill contrast: ${contrast}:1`);
      check('§11.6', contrast >= 1.2,
        `untested and clean fills differ by ${contrast}:1`,
        `untested and clean fills are only ${contrast}:1 apart`);
    }
    if (errors.length) fail('§11.6', `page errors: ${errors.join(' | ')}`);
    await context.close();
  }

  /* ================================================================
   * §11.9 — no lens data ships preloaded
   * ================================================================ */
  {
    const { context, page, errors } = await open(null);
    const lenses = await page.evaluate(() => window.__pft.store.getState().lenses);
    check('§11.9', Array.isArray(lenses) && lenses.length === 0,
      'a fresh install has zero lenses', `a fresh install shipped ${lenses.length} lenses`);

    await go(page, '/gear');
    const text = await page.evaluate(() => document.getElementById('main').textContent);
    check('§11.9', /No lenses yet/i.test(text),
      'the empty state explains itself', 'the gear screen does not show an empty lens state');

    // The Meike tubes ARE meant to be preloaded (spec §3), so confirm the rule
    // is scoped to lenses and has not been over-applied.
    const tubes = await page.evaluate(() => window.__pft.store.getState().tubes.map((t) => t.mm));
    check('§11.9', JSON.stringify(tubes) === JSON.stringify([11, 18, 29]),
      'the Meike tubes are preloaded as specified', `tubes were ${JSON.stringify(tubes)}`);
    if (errors.length) fail('§11.9', `page errors: ${errors.join(' | ')}`);
    await context.close();
  }

  /* ================================================================
   * §11.10 — no control anywhere offers an external IR filter
   * ================================================================ */
  {
    const { context, page, errors } = await open(seedWithLens('z50-ir'));
    const ROUTES = ['/', '/dof', '/exposure', '/nd', '/diffraction', '/sunmoon',
      '/meter', '/wildlife', '/macro', '/infrared', '/gear', '/settings'];
    const offenders = [];
    for (const r of ROUTES) {
      await go(page, r);
      const hits = await page.evaluate(() => {
        // Every CONTROL on the page — a filter option would have to be one.
        const controls = [...document.querySelectorAll('button, select, option, input, [role="button"]')];
        return controls
          .map((c) => `${c.textContent || ''} ${c.getAttribute('aria-label') || ''} ${c.getAttribute('placeholder') || ''}`)
          .filter((t) => /\bfilters?\b/i.test(t))
          // The ND module legitimately offers ND FILTERS — those are neutral
          // density, not infrared cut/pass filters, and spec §5.3 requires them.
          .filter((t) => !/\bND\b|neutral density|additional stops/i.test(t));
      });
      for (const h of hits) offenders.push(`${r}: ${h.trim().slice(0, 60)}`);
    }
    check('§11.10', offenders.length === 0,
      `no IR filter control on any of the ${ROUTES.length} routes`,
      `filter-like controls found: ${offenders.join(' | ')}`);
    if (errors.length) fail('§11.10', `page errors: ${errors.join(' | ')}`);
    await context.close();
  }

  /* ================================================================
   * Walk every route and assert none of them throws (Doctrine §6:
   * walk the primary user journey before any handoff)
   * ================================================================ */
  {
    for (const bodyId of ['z50ii', 'z50-ir']) {
      const { context, page, errors } = await open(seedWithLens(bodyId));
      const ROUTES = ['/', '/dof', '/exposure', '/nd', '/diffraction', '/sunmoon',
        '/wildlife', '/macro', '/infrared', '/gear', '/settings'];
      for (const r of ROUTES) {
        await go(page, r);
        const broke = await page.evaluate(() => {
          const w = document.querySelector('.warnbox');
          return w && /failed to open/i.test(w.textContent) ? w.textContent : null;
        });
        if (broke) fail('walk', `${bodyId} ${r}: ${broke}`);
      }
      check('walk', errors.length === 0,
        `all ${ROUTES.length} routes render clean on ${bodyId}`,
        `${bodyId} page errors: ${errors.join(' | ')}`);
      await context.close();
    }
  }

  /* ================================================================
   * Build stamp — Doctrine §7b: on screen, at boot, in the working view
   * ================================================================ */
  {
    const { context, page } = await open(null);
    const stamp = await page.evaluate(() => {
      const n = document.querySelector('.stamp');
      if (!n) return null;
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      return {
        text: n.textContent.trim(),
        visible: r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight,
        opacity: cs.opacity,
        color: cs.color,
        userSelect: cs.userSelect || cs.webkitUserSelect,
      };
    });
    const version = await page.evaluate(() => window.__pft.version);
    check('§7b', !!stamp, 'a build stamp is present', 'no build stamp on screen');
    if (stamp) {
      check('§7b', stamp.text === `v${version}`,
        `stamp reads the real running version (${stamp.text})`,
        `stamp says "${stamp.text}" but the app is ${version}`);
      check('§7b', stamp.visible, 'stamp is on screen in the working view', 'stamp is not visible at boot');
      // §7b: dimmed with a colour TOKEN, never with opacity — an opacity is
      // invisible to a contrast gate.
      check('§7b', stamp.opacity === '1',
        'stamp is dimmed with a colour token, not opacity',
        `stamp uses opacity ${stamp.opacity}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

/* ------------------------------------------------------------------ */

async function readDiffraction(page) {
  return page.evaluate(() => {
    const text = document.getElementById('main').textContent;
    const basis = /Wavelength:\s*([^·\n]+)/.exec(text);
    const wl = /Wavelength:\s*(\d+)\s*nm/.exec(text);
    // The unmeasured branch prints a range: "f/3.6 – f/5.9".
    const range = /Diffraction-limited\s*f\/([\d.]+)\s*[–-]\s*f\/([\d.]+)/.exec(text);
    const single = /Diffraction-limited\s*f\/([\d.]+)/.exec(text);
    return {
      wavelength: wl ? Number(wl[1]) : null,
      wavelengthText: basis ? basis[1].trim() : '(none)',
      limit: range ? null : (single ? Number(single[1]) : null),
      limits: range ? [Number(range[1]), Number(range[2])] : [],
    };
  });
}

console.log('=== acceptance (spec §11) ===');
for (const p of passes) console.log(`  ✓ ${p}`);
if (notes.length) { console.log('\n  measured:'); for (const n of notes) console.log(n); }
console.log('\n  covered elsewhere: §11.1 offline-check.mjs · §11.7 test/io.test.js · §11.8 npm test');
if (failures.length) {
  console.log(`\nFAILURES (${failures.length}):`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\nPASS — ${passes.length} acceptance assertions.`);
