# NOTES.md — photo-field-tools

The repo's source of truth. Read it first, every session (Doctrine §12).
No tables anywhere in this file — Doctrine §2.

---

## Thesis

Nine capture-time calculators for a Nikon Z50-class APS-C pair, one visible and
one internally converted to infrared at 720 nm. It answers questions you have
while standing in a field with cold hands: how deep is this, how long can I
hold it, when does the light go, how many frames does this stack need.

**It stops at the shutter.** jefferson-photo-studio owns everything after.

Free, on-device, offline-first, no account, no server, no analytics. Opening
the URL gets you all of that with nothing to configure.

---

## Current state

Version **0.1.0** — first build. Every module in the spec is implemented and
every acceptance criterion has a gate behind it.

**The VERSION slot is Noah's call** (Doctrine §7). It stays at 0 until he says
otherwise. Nothing in this build should be read as a claim that it is 1.0.0.

What runs green, headless, in this sandbox:

- `npm test` — 88 unit tests over the math core, storage and import/export
- `npm run gate:a11y` — 13 routes × 2 themes × 2 viewports, plus 7 dialogs
- `npm run gate:acceptance` — 36 assertions over the spec §11 criteria
- `npm run gate:offline` — 22 assertions; installs, cuts the network, reloads,
  walks every module, and confirms zero external requests ever
- hub `palette-check.mjs` — both themes clear every hard floor

Each gate was made to FAIL once before being trusted (Doctrine §6). What that
caught is recorded under "What the gates found" below.

---

## Settled decisions

### The math core is pure and separately tested
`src/core/` has no DOM access, no storage, no globals. Every formula in spec §4
is implemented exactly as written and pinned by a test with an anchor that does
not come from this code — textbook photographic facts, the spec's own quoted
results, or algebraic identities the implementation cannot satisfy by accident.

### Approximations carry their label in the return value, not in a comment
`effectiveAperture`, `workingDistance` and `diffractionShift` each return a
flag (`approximate`, `verified: false`) alongside the number. A caller cannot
display the value without the caveat being available, and no module has to
remember. An approximation that has lost its label is a wrong number with
confidence attached.

### localStorage, not IndexedDB
Spec §8 permits IndexedDB "if any store exceeds practical localStorage limits".
Nothing here can — the largest object is a hotspot matrix, a few hundred
numbers. Rather than carry an untested IndexedDB layer on the path that holds
the only copy of Noah's calibration work, this uses localStorage and **fails
loudly** on quota, surfacing the error in Settings. A write that did not happen
is never mistaken for one that did.

### Import is a plan, not an action
`planImport` works out what an import *would* do and returns it; `applyImport`
executes a plan the user has answered. Nothing a user chose is replaced without
them ticking a box. A setting still at its factory default is **not** a user
choice, so filling it in overwrites nothing and is not a conflict — that is
what makes export → wipe → import an exact restore while a merge into a
configured app still asks.

### The uncalibrated meter rule is enforced in one function
`canShowAbsolute()` in `src/modules/meter.js`. Every absolute readout is built
inside that branch. An earlier revision had the function present but never
called — the comment claimed one enforcement point while the branch read the
state directly — and mutating the guard changed nothing. Caught by deliberately
breaking it (see below). If you touch that module, re-run that mutation.

### Severity band boundaries are a display convention
`SEVERITY_BANDS` in `src/core/hotspot.js` cuts clean/slight/moderate/strong at
0.15 / 0.40 / 0.80 stops. **Nothing in the spec fixes these.** They are stated
in one place so they can be recalibrated once real grids exist. Say "display
convention" if anyone asks what they mean.

### Hotspot matrices survive their lens
Deleting a lens does not delete its hotspot grid. That measurement took hours
and is keyed by display name, which is what the import schema carries.

---

## Deliberate deviations from the build spec

Each is a place the spec and the Doctrine disagreed, or the spec disagreed with
itself. Recorded rather than done quietly.

### Hold-to-freeze is a toggle
Spec §6 asks for "hold-to-freeze". Doctrine §4 forbids timed gestures and
press-and-hold outright (WCAG 2.2 SC 2.2.1, and SC 2.5.2 on pointer-down), and
the Doctrine wins where the two overlap. Freeze is one tap; release is one tap.
Same capability, no timed gesture. **If Noah wants the hold gesture back it
would have to be an accelerator on top of the toggle, never instead of it.**

### Wavelength is shown on every DoF, diffraction and macro output
Spec §5.1 asks for the wavelength "on the IR body". Acceptance criterion §11.2
asks for it on *every* such output. The stricter one wins, so it is always
shown — which also means the provenance line reads the same on both bodies and
a screenshot from either is self-describing.

### The spec's "two-thirds of a stop" is nearer three-quarters
Spec §4 says the IR body reaches its diffraction limit at "roughly 0.76x the
visible-light f-number, i.e. about two-thirds of a stop earlier."

**The 0.76× is right.** 550/720 = 0.764.

**The stop conversion is not.** Aperture stops go as √2, so the difference is
2 × log2(720/550) = **0.78 stops** — about three-quarters, not two-thirds. The
factor of two is the easy thing to drop here.

The app **computes** this live from the wavelengths actually in use rather than
quoting either figure, so it cannot drift, and it is labelled derived-and-not-
verified exactly as spec §4 requires. `test/optics.test.js` pins both the ratio
and the stop difference. **Worth Noah's eye** — if he wants the prose figure in
the spec corrected, this is the number.

### Depth of field does not change with wavelength, and the app says so
Spec §5.9 asks for "DoF and diffraction at the working wavelength, shown
against the 550 nm equivalent." Diffraction genuinely differs. Depth of field
does **not**: both circle-of-confusion bases are defined by the sensor, not by
the light, so the formula returns the same answer at 720 nm as at 550 nm.

Showing two identical columns would imply a difference that is not there. The
Infrared module states this plainly and then shows the comparison that *does*
carry a real difference: the depth achievable at each wavelength's own
diffraction limit, which differs because the usable aperture range differs.

### Pixel pitch is derived, not transcribed
Spec §2 gives 4.221 µm and then doubles its own rounded value to reach
c = 8.442 µm. Deriving all the way through from 23.5/5568 gives 8.4411 µm. The
app derives, so the number can never disagree with the sensor dimensions it
comes from. The difference is 0.01% and changes no displayed result.

---

## What the gates found

Recorded because a green tree is where defects hide (LESSONS.md 7d), and
because each of these was found by making a check fail on purpose.

- **The uncalibrated-meter guard was dead code.** `canShowAbsolute()` existed,
  was documented as the single enforcement point, and was never called. Setting
  it to `return true` changed nothing. Now wired; re-mutating it produces four
  failures including crashes.
- **Two test expectations were wrong, not the code.** Vertical frame-fill needs
  *more* distance, not less (the short sensor dimension covers less real-world
  height). ISO 450 snaps *up* to 500, because the geometric midpoint of 400 and
  500 is 447.2 — the case that distinguishes log snapping from linear.
- **An unselected chip's border was a hairline, measured 1.54:1.** A control's
  boundary is a rail and owes 3:1 (WCAG 1.4.11).
- **The whole page was 345px wide in a 320px viewport.** `body` is a grid, and
  a default `auto` column sizes to its widest descendant's min-content — so the
  horizontally-scrolling hotspot matrix widened the header too. Fixed with
  `grid-template-columns: minmax(0, 1fr)`.
- **Chips reading "1" or "2" were 38.4px wide** against a 48px floor.
- **Three shutter chip rows meant three buttons named "1/125"** on one screen.
- **A long identifier in the HSI formula pushed the 320px layout sideways.**
- **`role="table"` without row/cell children** was an axe critical.
- **Two gate bugs, both of which flagged correct code**: it measured controls
  behind a modal (which `showModal` makes inert), and its SC 2.5.3 check
  compared a concatenated `textContent` as one substring, so "BodyZ50 II" could
  never match any sensible label. Both fixed in the instrument, not the app —
  PALETTES.md §7, suspect the instrument first.

---

## What needs Noah's hands

Nothing headless settles these. No session should claim them.

- **The light meter against a real grey card and the Z50 II.** Every constant
  in it is a single-point fit until he runs the calibration flow for real. The
  app refuses to show an absolute EV or lux until he does.
- **Path A on a real Android device.** This sandbox's fake camera exposes no
  track capabilities, so only path B has ever run here.
- **Real iOS Safari.** The acceptance gate reproduces the WebKit *condition* —
  `getCapabilities` absent — and proves the app degrades to path B and says so.
  That is the mechanism, not the browser.
- **Whether an untested hotspot cell reads as untested at arm's length in
  bright sun.** The gate proves four channels differ (fill, hatch, dashed rail,
  a dash instead of a number) and measures 1.3:1 between the two fills. It
  cannot prove the field condition.
- **Install and the standalone launch on his actual iPad and phone.**
- **The countdown surviving screen lock.** Wake lock is requested where the
  browser offers it and the UI says "where the browser allows it" rather than
  promising it.

---

## Open work

- **No Content-Security-Policy.** `index.html` carries an inline script that
  reads the saved theme before first paint, so a strict CSP is a refactor
  (nonce or hash through the build), not a header. Doctrine §16.6 asks for this
  to be stated rather than implied. The other security headers ship in
  `public/_headers`.
- **Palette picker.** Only the Instrument family ships. PALETTES.md §6 suggests
  offering several as options once a settings surface exists — this one has
  one, so it is cheap to add later.
- **Hotspot import from the studio's exporter.** The schema is implemented and
  both entry paths (manual per-cell, JSON import) work today; the studio's
  exporter does not have to exist first.
- **A changelog**, once there is a second release to put in it.
- **Repo metadata** — description, website, topics and the social-preview
  image are GitHub-UI steps the session token cannot perform (Doctrine §10).
  The tile itself is built and measured: `npm run render:social` writes
  `public/og.png` and exits non-zero if any line of text fails against the real
  backdrop under it. The exact values to paste are in the session handoff.

---

## Project facts a later session needs

- Version lives ONLY in `src/version.js`. The build stamp, the service-worker
  cache name and any changelog entry read it.
- `build-sw.mjs` generates the precache list from what vite emitted. Never
  hand-write it.
- `serve.mjs` is shared by all three headless gates. They need HTTP, not
  `file://` — service workers do not register on `file://`.
- The sandbox Chromium is `/opt/pw-browsers/chromium` and playwright-core is
  pinned to the matching revision. A mismatch connects and then hangs with no
  error.
- The a11y gate's `DIALOGS` list must grow with every new dialog. A dialog it
  cannot open FAILS.
- Adding a new fg/bg pair? Register it in `a11y-gate.mjs` in the SAME commit
  (Doctrine §4).
- `render-social.mjs` both renders the preview card AND gates its contrast,
  sampling the lightest real backdrop pixel inside each LINE's tight rect
  rather than the element box. Re-run it after any change to `social-card.html`.
- `og.png` is deliberately EXCLUDED from the service-worker precache: ~270 KB
  that only link-preview crawlers fetch and the running app never displays.
