// a11y-gate.mjs — the accessibility gate Doctrine §4 requires.
//
// EXITS NON-ZERO on any failure. §4's standing lesson: a checker that prints
// "FAIL" and exits 0 is a reporter, and a documented gate that never existed
// was believed for months.
//
// It runs EVERY ROUTE in BOTH THEMES at more than one viewport including the
// narrow-phone case, computes contrast rather than eyeballing it, and FAILS
// LOUDLY when a registered selector goes missing — silently skipping a renamed
// class removes coverage with no signal.
//
// AND IT OPENS THE DIALOGS. PALETTES.md §9: "Most controls live inside
// dialogs; a resting-state-only sweep reports a clean bill of health it has
// not earned." Roughly half this app's controls are in dialogs.
//
//   node a11y-gate.mjs            check everything, exit non-zero on failure
//   node a11y-gate.mjs --verbose  also print every passing measurement

import { chromium } from 'playwright-core';
import { readFileSync, existsSync } from 'node:fs';
import { serve } from './serve.mjs';

const SANDBOX_CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const launchOpts = {
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
};
if (existsSync(SANDBOX_CHROMIUM)) launchOpts.executablePath = SANDBOX_CHROMIUM;

const VERBOSE = process.argv.includes('--verbose');
const axeSrc = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');

// Spec §9 sets 48px, stricter than Doctrine §4's 44px floor. Take the stricter.
const MIN_TARGET = 48;
// §4 tremor: overshoot is the failure mode, so size alone is not enough.
const MIN_SPACING = 8;

const THEMES = ['dark', 'light'];
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'phone-320', width: 320, height: 568 },
];

/**
 * `registry` — text vs background, computed, AA.
 * `nonText`  — WCAG 1.4.11: the visual information identifying a control needs
 *              3:1 against what is adjacent. Text passing says nothing about
 *              whether the control's own edge is visible.
 * Both follow the SAME loud-failure rule: a selector matching nothing FAILS.
 */
const ROUTES = [
  { hash: '/', name: 'home',
    registry: ['h1', '.lede', '.t-name', '.t-sub', '.stamp', '.global-btn .k', '.global-btn .v'],
    nonText: ['.tile', '.homebtn', '.global-btn'] },
  { hash: '/dof', name: 'depth of field',
    registry: ['h1', '.ro .k', '.ro .v', '.basis', '.band-scale span', '.field-label', '.hint', 'dl.kv dt', 'dl.kv dd'],
    nonText: ['.card', '.chip', '.step-btn', '.band'] },
  { hash: '/exposure', name: 'exposure',
    registry: ['h1', '.lede', '.ro .k', '.ro .v', '.ro .n', '.field-label'],
    nonText: ['.card', '.chip'] },
  // ND1000 makes the exposure long enough for the countdown (and its buttons)
  // to exist at all — without it half this screen is never measured.
  { hash: '/nd', name: 'nd', prepare: 'ND1000',
    registry: ['h1', '.ro .k', '.ro .v', '.hint', '.field-label'],
    nonText: ['.card', '.chip', '.btn'] },
  { hash: '/diffraction', name: 'diffraction',
    registry: ['h1', '.lede', '.ro .k', '.ro .v', '.basis', '.sweep-f', '.sweep-v'],
    // The MARK is the filled bar, not the track. The track is aria-hidden
    // decoration whose value is printed beside it; the fill is the graphical
    // object carrying magnitude, so that is what 1.4.11 governs here.
    nonText: ['.card', '.sweep-bar i'] },
  { hash: '/diffraction', name: 'diffraction (IR)', body: 'z50-ir',
    // The unverified-derivation caveat only exists on the IR body, so it is
    // registered on the route where it actually renders rather than being
    // silently skipped on the one where it does not.
    registry: ['h1', '.ro .k', '.ro .v', '.basis', '.caveat', '.sweep-f', '.sweep-v'],
    nonText: ['.card', '.sweep-bar i'] },
  { hash: '/sunmoon', name: 'sun & moon',
    // No .empty: the seed carries a saved place, so that state cannot render.
    registry: ['h1', '.lede', '.field-label', '.hint', '.rname', '.rsub'],
    nonText: ['.card', '.btn', '.row'] },
  { hash: '/meter', name: 'meter', prepare: 'Start meter',
    registry: ['h1', '.field-label', '.hint', '.caveat', 'dl.kv dt', 'dl.kv dd'],
    nonText: ['.card', '.chip', '.btn'] },
  { hash: '/wildlife', name: 'wildlife',
    registry: ['h1', '.ro .k', '.ro .v', '.field-label', '.hint'],
    nonText: ['.card', '.chip'] },
  { hash: '/macro', name: 'macro', prepare: 'Load the dragonfly',
    registry: ['h1', '.ro .k', '.ro .v', '.basis', '.caveat', '.hint', '.field-label'],
    nonText: ['.card', '.chip', '.step-btn'] },
  { hash: '/infrared', name: 'infrared', body: 'z50-ir',
    registry: ['h1', '.lede', '.ro .k', '.ro .v', '.basis', '.caveat',
      '.mx-head', '.mx-rowhead', '.mx-cell', '.legend .lg'],
    // The severity fills are real backgrounds text lands on, and untested
    // must be identifiable as a control in its own right.
    nonText: ['.card', '.mx-cell[data-band="0"]', '.mx-cell[data-band="2"]',
      '.mx-cell[data-untested="true"]'] },
  { hash: '/gear', name: 'gear',
    registry: ['h1', '.rname', '.rsub', '.field-label', '.hint'],
    nonText: ['.card', '.row', '.btn'] },
  { hash: '/settings', name: 'settings',
    registry: ['h1', '.lede', 'dl.kv dt', 'dl.kv dd', '.rname', '.rsub', '.field-label'],
    nonText: ['.card', '.btn', '.row'] },
];

/**
 * Dialogs. Each names a route, a way in, and what to check inside.
 * Doctrine §4 requires every interrupting surface to be closeable, so each one
 * is also checked for its two dismisses and for actually GOING AWAY.
 */
const DIALOGS = [
  { route: '/', name: 'body & optics', open: 'button[aria-label^="Body"]',
    // No .field-label here: this panel uses h3 headings above chip groups that
    // carry their own aria-label, rather than groupField.
    registry: ['.dlg-head h2', '.hint', 'h3'], nonText: ['.chip', '.btn'] },
  { route: '/', name: 'lens picker', open: 'button[aria-label^="Lens:"]',
    // Seeded state has a lens, so .empty does not render here — registering it
    // would be a selector that can never match.
    registry: ['.dlg-head h2', '.rname', '.rsub'], nonText: ['.btn', '.row'] },
  { route: '/gear', name: 'lens editor', openText: 'Add a lens',
    registry: ['.dlg-head h2', '.field-label', '.hint', 'label'], nonText: ['.chip', '.btn'] },
  { route: '/meter', name: 'improvise diffuser', openText: 'How to improvise one',
    registry: ['.dlg-head h2', 'h3', '.hint'], nonText: ['.btn', '.card'] },
  { route: '/infrared', name: 'hotspot metric help', openText: 'What is this index?', body: 'z50-ir',
    registry: ['.dlg-head h2', 'h3', '.hint'], nonText: ['.btn'] },
  { route: '/infrared', name: 'hotspot cell editor', openText: 'Add or edit a cell', body: 'z50-ir',
    registry: ['.dlg-head h2', '.field-label', '.hint'], nonText: ['.chip', '.btn'] },
  { route: '/settings', name: 'import backup', openText: 'Import a backup',
    registry: ['.dlg-head h2', '.field-label'], nonText: ['.btn'] },
];

const failures = [];
const notes = [];
const exemptions = new Set();
const fail = (where, msg) => failures.push(`${where}: ${msg}`);

const seed = (bodyId) => ({
  version: 1, deviceId: 'gate-device', deviceLabel: 'Gate device',
  settings: {
    bodyId, lensId: 'lens-1', cocBasis: 'pixel',
    wavelengthNm: bodyId === 'z50-ir' ? 720 : 550, wavelengthAuto: true,
    units: 'metric', theme: 'dark', strictness: 2, overlap: 0.25,
    diffuser: 'flat', meterAverageFrames: 8, lastModule: null,
  },
  lenses: [{
    id: 'lens-1', name: 'Gate 18-140 VR', kind: 'zoom', focalMin: 18, focalMax: 140,
    apertureWide: 3.5, apertureTele: 5.6, hasVR: true, vrStops: 4,
    nodeOffsetMm: null, irFocusShift: null, irExposureOffset: {}, notes: '',
  }],
  tubes: [], teleconverters: [{ id: 'tc-1', label: 'TC-14', factor: 1.4, lossStops: 0.97 }],
  calibrations: [],
  hotspots: [{
    schema: 'hotspot-matrix-v1', lens: 'Gate 18-140 VR', body: 'z50-ir', wavelength_nm: 720,
    cells: [
      { focal_mm: 18, f_number: 5.6, hsi_stops: 0.02, captured: '2026-07-11' },
      { focal_mm: 18, f_number: 8, hsi_stops: 0.55, captured: '2026-07-11' },
      { focal_mm: 35, f_number: 5.6, hsi_stops: 0.95, captured: '2026-07-11' },
    ],
  }],
  locations: [{ id: 'loc-1', name: 'Gate place', lat: 42.36, lon: -71.06 }],
  lastLocation: { lat: 42.36, lon: -71.06 },
});

const server = await serve('dist');
const browser = await chromium.launch(launchOpts);

try {
  for (const theme of THEMES) {
    for (const route of ROUTES) {
      const bodyId = route.body || 'z50ii';
      const st = seed(bodyId);
      st.settings.theme = theme;

      const context = await browser.newContext({
        viewport: VIEWPORTS[0], deviceScaleFactor: 2, colorScheme: theme,
        permissions: ['camera', 'geolocation'],
      });
      await context.addInitScript((s) => {
        localStorage.setItem('photo-field-tools/v1', JSON.stringify(s));
      }, st);

      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e)));
      const where = `${route.name} [${theme}]`;

      await page.goto(`${server.url}/#${route.hash}`, { waitUntil: 'load' });
      await page.waitForFunction(() => !!window.__pft, null, { timeout: 10000 });
      await page.evaluate((h) => { location.hash = h; }, route.hash);
      await page.waitForTimeout(250);
      if (route.prepare) {
        const did = await page.evaluate((t) => {
          const b = [...document.querySelectorAll('button')]
            .find((x) => x.textContent.toLowerCase().includes(t.toLowerCase()));
          if (!b) return false;
          b.click(); return true;
        }, route.prepare);
        // Same loud-failure rule: a prepare step that stops working silently
        // removes coverage of everything it was setting up.
        if (!did) fail(where, `prepare step "${route.prepare}" found no matching control`);
        await page.waitForTimeout(200);
      }

      await runAxe(page, where);
      await runContrast(page, where, route.registry, route.nonText);
      await runStructural(page, where, route.hash);

      if (pageErrors.length) fail(where, `page errors: ${pageErrors.join(' | ')}`);
      await context.close();
    }

    /* ---------------- dialogs ---------------- */
    for (const dlg of DIALOGS) {
      const st = seed(dlg.body || 'z50ii');
      st.settings.theme = theme;
      const context = await browser.newContext({
        viewport: VIEWPORTS[0], deviceScaleFactor: 2, colorScheme: theme,
        permissions: ['camera'],
      });
      await context.addInitScript((s) => {
        localStorage.setItem('photo-field-tools/v1', JSON.stringify(s));
      }, st);
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e)));
      const where = `dialog "${dlg.name}" [${theme}]`;

      await page.goto(`${server.url}/#${dlg.route}`, { waitUntil: 'load' });
      await page.waitForFunction(() => !!window.__pft, null, { timeout: 10000 });
      await page.evaluate((h) => { location.hash = h; }, dlg.route);
      await page.waitForTimeout(250);

      const opened = await page.evaluate(({ sel, text }) => {
        let btn = null;
        if (text) {
          btn = [...document.querySelectorAll('button')]
            .find((b) => b.textContent.trim().toLowerCase().includes(text.toLowerCase()));
        }
        if (!btn && sel) btn = document.querySelector(sel);
        if (!btn) return false;
        btn.click();
        return true;
      }, { sel: dlg.open, text: dlg.openText });
      await page.waitForTimeout(300);

      const isOpen = await page.evaluate(() => !!document.querySelector('dialog[open]'));
      if (!opened || !isOpen) {
        // A dialog the gate cannot open is coverage silently lost — the same
        // loud-failure rule as a missing selector.
        fail(where, 'could not open this dialog — restore the opener or remove it from DIALOGS');
        await context.close();
        continue;
      }

      await runAxe(page, where);
      await runContrast(page, where, dlg.registry, dlg.nonText, 'dialog[open] ');
      await runStructural(page, where, dlg.route);
      await runDialogEscape(page, where);

      if (pageErrors.length) fail(where, `page errors: ${pageErrors.join(' | ')}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}

/* ------------------------------------------------------------------ *
 * checks
 * ------------------------------------------------------------------ */

async function runAxe(page, where) {
  await page.addScriptTag({ content: axeSrc });
  const result = await page.evaluate(async () => await axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  }));
  for (const v of result.violations) {
    fail(where, `axe [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`);
    for (const n of v.nodes.slice(0, 4)) notes.push(`      ${n.target.join(' ')}`);
  }
  if (VERBOSE) {
    console.log(`  ${where} axe: ${result.violations.length} violations, ${result.passes.length} passes`);
  }
}

async function runContrast(page, where, registry, nonText, prefix = '') {
  const out = await page.evaluate(({ sels, ntSels, pre }) => {
    const lum = (c) => {
      const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (fg, bg) => {
      const L1 = lum(fg), L2 = lum(bg);
      return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    };
    const parse = (s) => {
      const m = s.match(/[\d.]+/g);
      if (!m) return null;
      const n = m.map(Number);
      return { rgb: n.slice(0, 3), a: n.length > 3 ? n[3] : 1 };
    };
    // Never guess a background. Collect every opaque candidate the element
    // could sit on — including gradient stops — and take the WORST case.
    // Translucent layers are walked THROUGH, not measured against: a number
    // taken off a see-through layer is wrong in a direction nobody notices.
    const bgCandidates = (el) => {
      const out2 = [];
      let e = el;
      while (e) {
        const cs = getComputedStyle(e);
        const img = cs.backgroundImage;
        if (img && img !== 'none') {
          for (const m of img.matchAll(/rgba?\(([\d.,\s]+)\)/g)) {
            const q = parse(m[0]);
            if (q && q.a > 0.95) out2.push(q.rgb);
          }
        }
        const q = parse(cs.backgroundColor);
        if (q && q.a === 1) { out2.push(q.rgb); break; }
        e = e.parentElement;
      }
      return out2;
    };

    const text = {};
    for (const s of sels) {
      const el = document.querySelector(pre + s);
      if (!el) { text[s] = { missing: true }; continue; }
      const cs = getComputedStyle(el);
      const cands = bgCandidates(el);
      const fg = parse(cs.color);
      if (!cands.length || !fg) { text[s] = { undetermined: true }; continue; }
      const px = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const isLarge = px >= 24 || (px >= 18.66 && weight >= 700);
      text[s] = {
        ratio: +Math.min(...cands.map((bg) => ratio(fg.rgb, bg))).toFixed(2),
        required: isLarge ? 3 : 4.5,
        size: cs.fontSize, weight,
      };
    }

    const nt = {};
    for (const s of ntSels) {
      const el = document.querySelector(pre + s);
      if (!el) { nt[s] = { missing: true }; continue; }
      const cs = getComputedStyle(el);
      const outside = bgCandidates(el.parentElement || el);
      if (!outside.length) { nt[s] = { undetermined: true }; continue; }
      const worst = (rgb) => Math.min(...outside.map((bg) => ratio(rgb, bg)));
      const signals = {};
      // 1.4.11 asks whether the COMPONENT is identifiable, not whether one
      // property passes. Check ALL FOUR edges — a bar bounded only on its right
      // is still bounded — and take the best boundary signal available.
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        const bw = parseFloat(cs[`border${side}Width`]) || 0;
        const edge = parse(cs[`border${side}Color`]);
        if (bw > 0 && cs[`border${side}Style`] !== 'none' && edge) {
          const resolved = edge.a === 1 ? edge.rgb
            : edge.rgb.map((c, i) => c * edge.a + outside[0][i] * (1 - edge.a));
          const v = worst(resolved);
          if (signals.border === undefined || v > signals.border) signals.border = v;
        }
      }
      const fill = parse(cs.backgroundColor);
      if (fill && fill.a === 1) signals.fill = worst(fill.rgb);
      if (!Object.keys(signals).length) { nt[s] = { undetermined: true }; continue; }
      const best = Object.entries(signals).sort((a, b) => b[1] - a[1])[0];
      nt[s] = {
        ratio: +best[1].toFixed(2), via: best[0], required: 3,
        all: Object.fromEntries(Object.entries(signals).map(([k, v]) => [k, +v.toFixed(2)])),
      };
    }
    return { text, nonText: nt };
  }, { sels: registry, ntSels: nonText, pre: prefix });

  for (const [sel, r] of Object.entries(out.text)) {
    if (r.missing) {
      fail(where, `registry selector "${sel}" matched nothing — restore it or remove it from a11y-gate.mjs`);
    } else if (r.undetermined) {
      fail(where, `could not determine an opaque background for "${sel}" — refusing to guess`);
    } else if (r.ratio < r.required) {
      fail(where, `contrast ${sel} ${r.ratio}:1 (needs ${r.required}:1 at ${r.size}/${r.weight})`);
    } else if (VERBOSE) {
      console.log(`  ${where} ${sel.padEnd(24)} ${String(r.ratio).padStart(6)}:1 needs ${r.required} PASS`);
    }
  }
  for (const [sel, r] of Object.entries(out.nonText)) {
    if (r.missing) {
      fail(where, `non-text selector "${sel}" matched nothing — restore it or remove it from a11y-gate.mjs`);
    } else if (r.undetermined) {
      fail(where, `could not determine a boundary for "${sel}" — refusing to guess`);
    } else if (r.ratio < r.required) {
      fail(where, `non-text contrast ${sel} ${r.ratio}:1 via ${r.via} (needs 3:1 — WCAG 1.4.11; ${JSON.stringify(r.all)})`);
    } else if (VERBOSE) {
      console.log(`  ${where} non-text ${sel} ${r.ratio}:1 via ${r.via} ok`);
    }
  }
}

async function runStructural(page, where, hash) {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(80);
    const custom = await page.evaluate(({ minTarget, minSpacing }) => {
      // SCOPE TO THE MODAL WHEN ONE IS OPEN. showModal() makes everything
      // behind the dialog INERT — unreachable by pointer, keyboard or AT — so
      // measuring it produces false failures: every chip in the page behind
      // "collides" with every control in the dialog at 0px, and duplicate
      // names appear across two surfaces that can never both be live.
      // (Suspect the instrument first — PALETTES.md §7.)
      const scope = document.querySelector('dialog[open]') || document;
      const inter = [...scope.querySelectorAll('a[href],button,[role="button"],input,select,textarea')];
      // A control inside a scroll container has a rect that extends BEYOND the
      // container when the content overflows — so an off-screen chip appears to
      // sit 0px from the footer's Close button, which the user can never touch
      // it from. Intersect with every clipping ancestor and the viewport, and
      // measure THAT. An element clipped to nothing is not on screen at all.
      const clippedRect = (el) => {
        let r = el.getBoundingClientRect();
        let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        for (let e = el.parentElement; e; e = e.parentElement) {
          const cs = getComputedStyle(e);
          if (cs.overflow === 'visible' && cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
          const q = e.getBoundingClientRect();
          box = {
            left: Math.max(box.left, q.left), top: Math.max(box.top, q.top),
            right: Math.min(box.right, q.right), bottom: Math.min(box.bottom, q.bottom),
          };
        }
        box = {
          left: Math.max(box.left, 0), top: Math.max(box.top, 0),
          right: Math.min(box.right, window.innerWidth),
          bottom: Math.min(box.bottom, window.innerHeight),
        };
        return { ...box, width: Math.max(0, box.right - box.left), height: Math.max(0, box.bottom - box.top) };
      };
      const visible = (el) => {
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') return false;
        const c = clippedRect(el);
        // Partly-scrolled controls still count; only fully clipped ones do not.
        return c.width > 1 && c.height > 1;
      };
      // WCAG 2.2 SC 2.5.8 inline exception: a target inside a sentence, whose
      // height the surrounding line constrains. Forcing 48px mid-paragraph
      // breaks the text flow and makes the page worse. REPORTED, never silent.
      const isInlineInText = (el) => {
        if (getComputedStyle(el).display !== 'inline') return false;
        const adj = (node) => {
          while (node) {
            if (node.nodeType === 3) { if (node.textContent.trim()) return true; }
            else return false;
            node = node.previousSibling;
          }
          return false;
        };
        const adjN = (node) => {
          while (node) {
            if (node.nodeType === 3) { if (node.textContent.trim()) return true; }
            else return false;
            node = node.nextSibling;
          }
          return false;
        };
        return adj(el.previousSibling) || adjN(el.nextSibling);
      };
      const measured = inter.filter(visible).map((el) => {
        // SIZE is judged on the real rect — a 30px button is 30px whether or
        // not it is scrolled. SPACING is judged on the CLIPPED rect, because
        // that is the area a finger can actually reach.
        const r = el.getBoundingClientRect();
        const c = clippedRect(el);
        return {
          t: (el.textContent.trim() || el.getAttribute('aria-label') || el.tagName).slice(0, 32),
          w: +r.width.toFixed(1), h: +r.height.toFixed(1),
          r: { left: c.left, top: c.top, right: c.right, bottom: c.bottom },
          tooSmall: r.width < minTarget || r.height < minTarget,
          inline: isInlineInText(el),
        };
      });
      const gapBetween = (a, b) => {
        const dx = Math.max(0, a.left - b.right, b.left - a.right);
        const dy = Math.max(0, a.top - b.bottom, b.top - a.bottom);
        return Math.hypot(dx, dy);
      };
      const spaceable = measured.filter((m) => !m.inline);
      const tight = [];
      for (let i = 0; i < spaceable.length; i++) {
        for (let j = i + 1; j < spaceable.length; j++) {
          const gap = gapBetween(spaceable[i].r, spaceable[j].r);
          if (gap < minSpacing) tight.push({ a: spaceable[i].t, b: spaceable[j].t, gap: +gap.toFixed(1) });
        }
      }
      const imgsNoAlt = [...scope.querySelectorAll('img')]
        .filter((i) => !i.hasAttribute('alt')).map((i) => i.getAttribute('src') || '(no src)');
      const canvasNoAlt = [...scope.querySelectorAll('canvas')]
        .filter((c) => !c.getAttribute('aria-label') && !c.getAttribute('aria-labelledby')
          && !c.getAttribute('title') && !c.textContent.trim())
        .map((c) => c.outerHTML.slice(0, 60));
      const noName = inter.filter(visible).filter((el) => {
        if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
          return !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')
            && !el.labels?.length && !el.getAttribute('title');
        }
        return !el.textContent.trim() && !el.getAttribute('aria-label') && !el.getAttribute('title');
      }).map((el) => el.outerHTML.slice(0, 70));

      // Doctrine §4: NO TWO CONTROLS ANSWER TO THE SAME NAME on one surface.
      const names = new Map();
      for (const el of inter.filter(visible)) {
        const n = (el.getAttribute('aria-label') || el.textContent.trim()).toLowerCase();
        if (!n) continue;
        names.set(n, (names.get(n) || 0) + 1);
      }
      const dupes = [...names.entries()].filter(([, c]) => c > 1).map(([n, c]) => `${n} ×${c}`);

      // SC 2.5.3: a control showing words AND carrying an aria-label must have
      // the visible words inside that label.
      //
      // Checked WORD BY WORD, not as one substring. A control built from two
      // spans has a textContent of "BodyZ50 II" with no separator, and a tile
      // with a title and a subtitle runs them together — neither can ever be a
      // substring of a well-written label, so a substring test flags correct
      // markup and teaches people to ignore the gate. The criterion is about
      // the visible WORDS being sayable, which is what this measures.
      const words = (s) => (s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’.\-/]*/gu) || [])
        .map((w) => w.replace(/[.\-/]+$/, ''))     // "vr." and "it." are "vr" and "it"
        .filter(Boolean);
      const labelMismatch = inter.filter(visible).filter((el) => {
        const al = el.getAttribute('aria-label');
        if (!al) return false;
        // A <select>'s textContent is every option, which is not a visible
        // label — the closed control shows one value, chosen by the user.
        if (el.tagName === 'SELECT') return false;
        // innerText, not textContent: textContent runs adjacent spans together
        // ("Body" + "Z50 II" -> "BodyZ50 II"), producing a token that can never
        // appear in any sensible label. innerText respects rendering.
        const vis = words((el.innerText || el.textContent).trim());
        if (!vis.length) return false;
        const inLabel = new Set(words(al));
        return !vis.every((w) => inLabel.has(w));
      }).map((el) => {
        const al = el.getAttribute('aria-label');
        const vis = (el.innerText || el.textContent).trim();
        const missing = words(vis).filter((w) => !new Set(words(al)).has(w));
        return `"${vis.replace(/\s+/g, ' ').slice(0, 28)}" — words missing from aria-label: ${missing.join(', ')}`;
      });

      return {
        small: measured.filter((m) => m.tooSmall && !m.inline),
        exempt: measured.filter((m) => m.tooSmall && m.inline),
        tight, imgsNoAlt, canvasNoAlt, noName, dupes, labelMismatch,
        lang: document.documentElement.lang,
        h1: document.querySelectorAll('h1').length,
        bodyScrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    }, { minTarget: MIN_TARGET, minSpacing: MIN_SPACING });

    const at = `${where} @${vp.name}`;
    for (const t of custom.small) fail(at, `touch target "${t.t}" is ${t.w}x${t.h}px — needs >= ${MIN_TARGET}px`);
    for (const t of custom.tight) fail(at, `targets "${t.a}" and "${t.b}" are ${t.gap}px apart — tremor rule requires >= ${MIN_SPACING}px`);
    for (const t of custom.exempt) exemptions.add(`${t.t} (${t.w}x${t.h}px, inline in a sentence — WCAG 2.2 SC 2.5.8)`);
    for (const s of custom.imgsNoAlt) fail(at, `<img> has no alt attribute: ${s}`);
    for (const c of custom.canvasNoAlt) fail(at, `<canvas> has no text alternative (WCAG 1.1.1): ${c}`);
    for (const l of custom.noName) fail(at, `control has no accessible name: ${l}`);
    for (const d of custom.dupes) fail(at, `two controls answer to the same name: ${d}`);
    for (const m of custom.labelMismatch) fail(at, `SC 2.5.3 — visible text not in aria-label: ${m}`);
    if (!custom.lang) fail(at, 'document has no lang attribute');
    if (custom.h1 !== 1) fail(at, `expected exactly one <h1>, found ${custom.h1}`);
    if (custom.bodyScrollX) fail(at, 'the page scrolls horizontally');
    if (VERBOSE) console.log(`  ${at} targets ok, h1=${custom.h1}`);
  }
  await page.setViewportSize(VIEWPORTS[0]);
}

/**
 * Doctrine §4's interrupting-surface rules, tested as PROPERTIES rather than
 * techniques (§14: "Test the property, not the technique"):
 *   · a dismiss on screen in the first frame
 *   · a dismiss still on screen after scrolling to the very end
 *   · hit-testing its centre returns the dismiss itself, nothing on top
 *   · the surface is genuinely GONE afterwards, not merely flagged closed
 *   · the panel is under a stated height
 */
async function runDialogEscape(page, where) {
  const r = await page.evaluate(() => {
    const dlg = document.querySelector('dialog[open]');
    if (!dlg) return { noDialog: true };
    const body = dlg.querySelector('.dlg-body');
    const closers = [...dlg.querySelectorAll('button')].filter((b) =>
      /close|cancel/i.test(b.getAttribute('aria-label') || b.textContent));
    const onScreen = (el) => {
      const q = el.getBoundingClientRect();
      return q.top >= 0 && q.bottom <= window.innerHeight && q.width > 0 && q.height > 0;
    };
    const first = closers[0] ? onScreen(closers[0]) : false;

    if (body) body.scrollTop = body.scrollHeight;      // scroll to the very end
    const afterScroll = closers[0] ? onScreen(closers[0]) : false;

    let hitTestOk = false;
    if (closers[0]) {
      const q = closers[0].getBoundingClientRect();
      const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      hitTestOk = hit === closers[0] || closers[0].contains(hit);
    }
    const dr = dlg.getBoundingClientRect();
    return {
      count: closers.length,
      first,
      afterScroll,
      hitTestOk,
      heightRatio: +(dr.height / window.innerHeight).toFixed(2),
      // Two dismisses must not answer to the same name (Doctrine §4).
      names: closers.map((b) => (b.getAttribute('aria-label') || b.textContent).trim()),
    };
  });

  if (r.noDialog) { fail(where, 'dialog vanished before the escape checks'); return; }
  if (r.count < 2) fail(where, `only ${r.count} dismiss control(s) — §4 requires one at the top AND one at the bottom`);
  if (!r.first) fail(where, 'the dismiss is not visible in the first frame without scrolling');
  if (!r.afterScroll) fail(where, 'the dismiss is not reachable after scrolling to the end of the panel');
  if (!r.hitTestOk) fail(where, 'hit-testing the dismiss centre does not return the dismiss — something is on top of it');
  if (r.heightRatio > 0.9) fail(where, `the panel is ${Math.round(r.heightRatio * 100)}% of the viewport — §4 requires it bounded`);
  if (new Set(r.names.map((n) => n.toLowerCase())).size !== r.names.length) {
    fail(where, `the two dismisses share a name: ${r.names.join(' / ')}`);
  }

  // And it must actually GO AWAY — not merely be flagged closed.
  const gone = await page.evaluate(() => {
    const dlg = document.querySelector('dialog[open]');
    const btn = [...dlg.querySelectorAll('button')].find((b) =>
      /close|cancel/i.test(b.getAttribute('aria-label') || b.textContent));
    btn.click();
    return new Promise((resolve) => setTimeout(() => resolve({
      stillOpen: !!document.querySelector('dialog[open]'),
      stillInDom: !!document.querySelector('dialog'),
      focusReal: document.activeElement && document.activeElement !== document.body,
    }), 120));
  });
  if (gone.stillOpen) fail(where, 'the dialog is still open after pressing its dismiss');
  if (gone.stillInDom) fail(where, 'the dialog element is still in the DOM after closing — flagged closed, not gone');
}

/* ------------------------------------------------------------------ */

console.log('=== a11y gate ===');
console.log(`routes: ${ROUTES.length} × themes: ${THEMES.length} × viewports: ${VIEWPORTS.length}`
  + `  ·  dialogs: ${DIALOGS.length} × themes: ${THEMES.length}`);
console.log(`targets >= ${MIN_TARGET}px (spec §9), spacing >= ${MIN_SPACING}px (Doctrine §4 tremor)`);
if (exemptions.size) {
  console.log(`\nEXEMPTED (${exemptions.size}) — reported, never silent:`);
  for (const e of exemptions) console.log(`  · ${e}`);
}
if (failures.length) {
  console.log(`\nFAILURES (${failures.length}):`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  if (notes.length) { console.log('\n  detail:'); for (const n of notes) console.log(n); }
  console.log('\nDoctrine §4: accessibility is a hard gate. This exits non-zero.');
  process.exit(1);
}
console.log('\nPASS — no axe violations, every registered pair meets AA, every non-inline '
  + `target >= ${MIN_TARGET}px and >= ${MIN_SPACING}px apart, every dialog escapable.`);
