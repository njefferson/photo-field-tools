# CLAUDE.md — photo-field-tools

> **Inherits the Universal App Doctrine** — the canonical copy lives in the hub
> repo at [`noahjefferson/DOCTRINE.md`](https://github.com/njefferson/noahjefferson/blob/main/DOCTRINE.md).
> It is the single source of truth for the rules shared across all of Noah's
> apps: product values, taste, accessibility, honesty, verification, release
> discipline & taxonomy, licensing (PolyForm Noncommercial), privacy, the
> permanent **AskUserQuestion ban** (§0), and the **repo-metadata confirm rule**
> (§10). **Where anything below overlaps the Doctrine, the Doctrine wins.**
> This file keeps only what is specific to this repo.
>
> Also canonical in the hub and never forked here:
> [`LESSONS.md`](https://github.com/njefferson/noahjefferson/blob/main/LESSONS.md)
> and [`PALETTES.md`](https://github.com/njefferson/noahjefferson/blob/main/PALETTES.md).
> **Start a session on this repo with the hub selected too**, or those rules are
> not in reach.

## What this repo is
**Capture-time** calculators for the field, at **photo-field-tools.pages.dev**.
Depth of field, exposure, ND, diffraction, sun & moon, an incident light meter,
wildlife framing, macro, and infrared — for a Nikon Z50-class APS-C pair, one
visible and one internally converted to infrared at 720 nm.

Installable PWA, offline-first, **zero network calls at runtime**.

## The boundary with jefferson-photo-studio
**This app stops at the shutter.** The studio app owns everything post-capture
and owns the hotspot JPEGs. Do not import from it, do not link into its
codebase, and do not add: stacking, channel swapping, grading, culling, file
management, or image upload of any kind.

**Hotspot data flows ONE WAY.** The studio derives the Hotspot Severity Index
from the source frames; this app only *consumes* the numbers. Never re-derive
HSI here and never accept an image. `src/core/hotspot.js` has a test asserting
no such entry point exists.

## Hardware facts are hard-coded, and derived where derivable
`src/core/constants.js`. Sensor 23.5 × 15.7 mm, 5568 × 3712, crop 1.5, no IBIS
on either body. Pixel pitch and the sensor diagonal are **derived** from those,
never typed twice.

**There is no filter control anywhere, and there must never be one.** The IR
body is internally converted; no external filter is ever used. Acceptance
criterion 10, enforced by `acceptance.mjs` across every route.

## Stack
Vite + vanilla ES modules, no framework, no CSS framework. **suncalc is the only
runtime dependency** and it is bundled, never CDN-loaded. Everything else in
`package.json` is build/test/gate tooling.

The service worker is **generated** by `build-sw.mjs` from what vite actually
emitted — a hand-written precache list drifts the first time a chunk name
changes.

## Gates — all four exit non-zero
```
npm run check          # everything below, in order
npm test               # 94 unit tests over the math core, storage, I/O and state
npm run gate:a11y      # 13 routes × 2 themes × 2 viewports, PLUS 7 dialogs
npm run gate:acceptance# the spec §11 acceptance criteria
npm run gate:offline   # installs, cuts the network, reloads, walks every module
```
Plus the hub's gates, canonical there and NEVER forked here. They take
`--repo`, so this repo is measured by the same code every sibling is:
```
cd ../noahjefferson
node palette-check.mjs ../photo-field-tools/palettes/photo-field-tools.json
node pin-check.mjs     --repo ../photo-field-tools   # nothing floats on a tag
node handoff-check.mjs --repo ../photo-field-tools   # BEFORE handing over
node lessons-check.mjs --checklist                   # the steps no script can do
```
`npm run gate:hub` runs the two that take `--repo`. **Run `handoff-check.mjs`
and `lessons-check.mjs --checklist` before writing any status message** — the
handoff is a deliverable and LESSONS §14 is what happens without them.

**The a11y gate opens the dialogs.** Roughly half this app's controls live in
them; a resting-state sweep reports a clean bill of health it has not earned
(PALETTES.md §9). If you add a dialog, add it to `DIALOGS` in `a11y-gate.mjs`
in the same commit — a dialog the gate cannot open FAILS rather than being
skipped.

**Registries fail loudly.** A selector in `a11y-gate.mjs` that stops matching
fails the build. Renaming a class must not silently remove coverage.

## Branches & releases
`staging` and `main` (Doctrine §13.5). Staging is a hard gate: land there, hand
Noah the preview URL, wait for his on-device pass, promote only on his explicit
say-so. The web-task harness keeps designating a `claude/*` branch — per
Doctrine §11 that is not the release branch.

Version lives in **one** place, `src/version.js`. The build stamp, the
service-worker cache name and the changelog all read it. Bump it, the cache
name and the changelog together, in one commit.

## What needs Noah's hands
Nothing headless can settle these, and no session should claim them:
- The incident meter against a real grey card and the Z50 II — every constant
  in it is a single-point fit until he does that.
- Path A on a real Android device (this sandbox only ever reaches path B).
- Real iOS Safari. The gate reproduces the WebKit *condition* (no track
  capabilities) but is not Safari.
- Whether an untested hotspot cell reads as untested **at arm's length in
  bright sun**. The gate proves four channels differ; it cannot prove that.

## Repo metadata (manual, confirm — see Doctrine §10)
Description / website / topics / social-preview are GitHub-UI steps the session
token cannot perform. List the exact values and ask Noah to confirm each; never
report this repo "set up" while any is unconfirmed.
