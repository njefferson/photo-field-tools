// render-icons.mjs — rasterise public/icon.svg into the PNG sizes the
// manifest declares. Run manually when the icon changes:  npm run render:icons
//
// Maskable variants get a full-bleed background and the mark scaled to sit
// inside the 80% safe zone, because a maskable icon is cropped to whatever
// shape the platform likes and an unpadded mark loses its edges.

import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SANDBOX_CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const launchOpts = { args: ['--no-sandbox'] };
if (existsSync(SANDBOX_CHROMIUM)) launchOpts.executablePath = SANDBOX_CHROMIUM;

const svg = readFileSync('public/icon.svg', 'utf8');

const TARGETS = [
  { file: 'public/icon-192.png', size: 192, scale: 1 },
  { file: 'public/icon-512.png', size: 512, scale: 1 },
  { file: 'public/apple-touch-icon.png', size: 180, scale: 1 },
  { file: 'public/favicon-32.png', size: 32, scale: 1 },
  // 0.8 keeps the whole mark inside the maskable safe circle.
  { file: 'public/icon-maskable-192.png', size: 192, scale: 0.8 },
  { file: 'public/icon-maskable-512.png', size: 512, scale: 0.8 },
];

const browser = await chromium.launch(launchOpts);
try {
  for (const { file, size, scale } of TARGETS) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<!doctype html><html><head><style>
      html,body{margin:0;padding:0;width:${size}px;height:${size}px;background:#1a1a1a;overflow:hidden}
      .m{position:absolute;inset:0;display:grid;place-items:center}
      svg{width:${Math.round(size * scale)}px;height:${Math.round(size * scale)}px;display:block}
    </style></head><body><div class="m">${svg}</div></body></html>`);
    const buf = await page.screenshot({ omitBackground: false });
    writeFileSync(file, buf);
    console.log(`rendered ${file} (${size}px, mark at ${Math.round(scale * 100)}%)`);
    await page.close();
  }
} finally {
  await browser.close();
}
