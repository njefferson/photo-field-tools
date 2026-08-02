// render-social.mjs — renders public/og.png AND measures its contrast.
//
// Doctrine §10: "Measure the contrast; do not look at it. Text over a picture
// has no single background colour — the 'background' of a letter is whatever
// pixel is under it. Render the tile once with the text hidden, sample the real
// backdrop inside each LINE's tight rect (not the element box, which is as wide
// as its container and covers backdrop no glyph is ever drawn over), take the
// lightest pixel found, and compute the real ratio against the real text
// colour. Gate it, like any other contrast claim."
//
// So this EXITS NON-ZERO if any line of the card fails. The card is dark with
// light text, so the WORST case is the lightest backdrop pixel under a line.
//
//   node render-social.mjs

import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { writeFileSync, existsSync } from 'node:fs';

const SANDBOX_CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const launchOpts = { args: ['--no-sandbox'] };
if (existsSync(SANDBOX_CHROMIUM)) launchOpts.executablePath = SANDBOX_CHROMIUM;

const W = 1200, H = 630;
const FLOOR = 4.5;                 // AA for the small lines; large text needs 3

const browser = await chromium.launch(launchOpts);
const failures = [];

try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL('social-card.html').href, { waitUntil: 'networkidle' });

  // TIGHT rects, per line — a Range over the text node, not the element box.
  // The element box spans the whole column and covers backdrop no glyph is
  // ever drawn over, which is exactly how this measurement lies.
  const lines = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.measure')) {
      const color = el.dataset.color;
      const cs = getComputedStyle(el);
      const px = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const large = px >= 24 || (px >= 18.66 && weight >= 700);
      for (const node of el.childNodes) {
        if (node.nodeType !== 3 || !node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          if (r.width < 2 || r.height < 2) continue;
          out.push({
            text: node.textContent.trim().slice(0, 40),
            color, large,
            x: r.left, y: r.top, w: r.width, h: r.height,
          });
        }
      }
    }
    return out;
  });

  // 1. the backdrop, with every glyph hidden
  await page.evaluate(() => document.body.classList.add('measuring'));
  const backdrop = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });

  // 2. the real card
  await page.evaluate(() => document.body.classList.remove('measuring'));
  const card = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
  writeFileSync('public/og.png', card);

  // 3. sample the backdrop under each line, take the LIGHTEST pixel
  const reader = await browser.newPage({ viewport: { width: W, height: H } });
  const results = await reader.evaluate(async ({ dataUrl, lines: ls, width, height }) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, width, height);

    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const ratio = (a, b) => {
      const L1 = lum(a), L2 = lum(b);
      return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    };
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

    return ls.map((l) => {
      const x0 = Math.max(0, Math.floor(l.x)), y0 = Math.max(0, Math.floor(l.y));
      const w = Math.min(width - x0, Math.ceil(l.w)), h = Math.min(height - y0, Math.ceil(l.h));
      const d = ctx.getImageData(x0, y0, Math.max(1, w), Math.max(1, h)).data;
      let lightest = [0, 0, 0], best = -1;
      for (let i = 0; i < d.length; i += 4) {
        const p = [d[i], d[i + 1], d[i + 2]];
        const L = lum(p);
        if (L > best) { best = L; lightest = p; }
      }
      return {
        text: l.text, large: l.large, color: l.color,
        backdrop: `rgb(${lightest.join(',')})`,
        ratio: +ratio(hex(l.color), lightest).toFixed(2),
        required: l.large ? 3 : 4.5,
      };
    });
  }, { dataUrl: `data:image/png;base64,${backdrop.toString('base64')}`, lines, width: W, height: H });

  console.log('=== social preview card ===');
  console.log(`public/og.png written, ${W}x${H} @2x`);
  console.log('\ncontrast, measured against the LIGHTEST real backdrop pixel under each line:');
  for (const r of results) {
    const ok = r.ratio >= r.required;
    console.log(`  ${ok ? '✓' : '✗'} ${r.ratio.toString().padStart(6)}:1  needs ${r.required}  `
      + `${r.color} on ${r.backdrop}  "${r.text}"`);
    if (!ok) {
      failures.push(`"${r.text}" measures ${r.ratio}:1 against ${r.backdrop}, needs ${r.required}:1`);
    }
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.log(`\nFAILURES (${failures.length}):`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log('\nDoctrine §10: buy the contrast without destroying the picture — move or');
  console.log('narrow the words before deepening a scrim. This exits non-zero.');
  process.exit(1);
}
console.log('\nPASS — every line of the card clears its floor against the real backdrop.');
