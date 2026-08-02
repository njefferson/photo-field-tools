# ACCESSIBILITY.md — photo-field-tools

The append-only accessibility register (Doctrine §4, §12). **Never delete a
row.** A fixed finding keeps its row and gains a release number.

The shared statement every app's About screen links to lives in the hub:
<https://noahjefferson.pages.dev/accessibility>

No tables in this file — Doctrine §2.

---

## The gate

`node a11y-gate.mjs` — **exits non-zero** on any failure.

Coverage: 13 routes × 2 themes × 2 viewports (390×844 and 320×568), plus 7
dialogs × 2 themes. axe-core (wcag2a, wcag2aa, wcag21a, wcag21aa,
best-practice) on every one, plus the checks axe cannot make:

- Computed contrast over a registered selector list, worst-case against every
  gradient stop, refusing to guess when no opaque background can be determined.
- WCAG 1.4.11 non-text contrast on control boundaries, checking all four
  border edges and the fill, and taking the best available signal.
- Touch targets ≥ **48px** (spec §9 is stricter than Doctrine's 44px), with the
  WCAG 2.2 SC 2.5.8 inline-in-a-sentence exemption applied and **named**.
- Target spacing ≥ 8px (Doctrine §4 tremor: overshoot is the failure mode).
- Duplicate accessible names on one surface.
- SC 2.5.3 — visible words must appear in the accessible name.
- Horizontal page overflow.
- Every dialog: two dismisses, visible in the first frame, still reachable
  after scrolling to the very end, hit-testing to themselves, bounded in
  height, and genuinely GONE afterwards rather than flagged closed.

**Registries fail loudly.** A selector that stops matching FAILS the build; it
is never skipped. Renaming a class must not silently remove coverage.

**Made to fail before being trusted** (Doctrine §6): dimming `--txt-3` to
`#4a4a4a` and removing the chip `min-width` produced contrast failures at
1.28:1 and target failures across both themes. Reverted.

---

## Declared visual encodings and their non-hue channel

Doctrine §4: state the non-hue channel BEFORE writing code. Hue-only encoding
is a fail state.

**Hotspot severity (the matrix).** Four channels, colour last:
1. the numeric HSI value printed in the cell
2. a filled-segment bar, 0–3 segments
3. the cell fill (luminance-stepped, monotonic with severity)
4. the accessible name, which states the value and the band

**Hotspot UNTESTED.** Spec §7 calls this load-bearing in the field. Four
channels, colour last:
1. an em dash instead of a number
2. **no severity bar at all** — note this is *absence*, not an empty bar. A
   clean cell is severity step 0, so an untested cell drawn with three empty
   segments matched it exactly on this channel and the "signal" distinguished
   nothing. Caught by looking at a screenshot after the gate had passed.
3. a dashed 2px rail plus a diagonal hatch pattern
4. an accessible name containing the word UNTESTED

Under `forced-colors`, the fills vanish by design. Severity is then carried by
the printed number and the segment bar; untested by the dashed border and the
absence of both.

**Diffraction sweep, past the circle of confusion.** Three channels:
1. the words "· over c" in the row's text
2. a diagonal hatch on the bar
3. heavier text weight
The bar itself is `aria-hidden`; the value beside it is the content.

**Chip selection.** Two channels: `aria-pressed`, and an underline. Both states
carry the same 2px border width, so pressing a chip cannot reflow the row.

**Depth-of-field band.** The bar is `aria-hidden` — the near/far/total numbers
above it are the content. The in-focus region is bounded by real 3px edges, not
by its fill tint alone.

**Infrared mode.** A standing indicator in the header showing "IR 720 nm", plus
the wavelength printed on every affected result.

---

## Declared drag and gesture interactions

Doctrine §4: each app declares these alongside the non-drag control satisfying
each one. A declared interaction with no alternative FAILS.

**There are none.** This app has no drag, no multi-point gesture, no path
gesture, no press-and-hold and no timed interaction anywhere. Every control is
a tap or a keyboard press, and nothing commits on pointer-down.

The one place the spec asked for a timed gesture — "hold-to-freeze" in the
light meter — is a toggle instead. See NOTES.md, deliberate deviations.

---

## Status messages (SC 4.1.3) — declared, hand-checked

Doctrine §4 flags this as NOT machine-checkable, so it is a declaration and a
hand check, and saying so is the point.

Everything the app says without being asked goes through the polite live region
in `index.html` via `src/ui/live.js`. Declared uses:

- Saved / exported / imported, with counts, in Settings and Gear
- Calibration saved and calibration cleared, in the light meter
- Reading held and reading released
- Measurement path and calibration state when the diffuser changes
- Countdown started, stopped, and exposure finished
- Body, lens, wavelength, CoC basis, units and theme changes
- Offline transition
- Validation refusals ("give the place a name first")

Hand-checked in this build: the region is present at boot, is `role="status"`
`aria-live="polite"` `aria-atomic="true"`, is cleared before each message so a
repeated identical message announces again, and never receives focus.

**Not yet checked with a real screen reader on Noah's device.** That is his
hands, and it is listed in NOTES.md.

---

## Findings register

### A-01 · An unselected chip's boundary was a hairline — FIXED in 0.1.0
`.chip` used `--hairline` for its border, measured **1.54:1** in dark and
**1.69:1** in light. A chip's boundary is the only thing identifying it as a
control, so it is a rail and owes 3:1 (WCAG 1.4.11). Both states now use
`--rail`; selection is carried by fill tint and an underline instead.

### A-02 · Chips reading "1" or "2" were under the target floor — FIXED in 0.1.0
38.4 × 48px against a 48px floor. Added `min-width: var(--tap)`.

### A-03 · Three controls answered to the name "1/125" — FIXED in 0.1.0
The Exposure screen shows a triangle solver and two comparison exposures at
once, so three shutter chips shared every label. Chips now compose their
accessible name from their group's label, which also satisfies SC 2.5.3.

### A-04 · The stepper's own field had no accessible name — FIXED in 0.1.0
axe critical, "Form elements must have labels". The surrounding group label
does not name the input. Each stepper input now carries its own `aria-label`,
distinct from its two buttons.

### A-05 · The page scrolled horizontally at 320px — FIXED in 0.1.0
`body` is a grid, and a default `auto` column sizes to its widest descendant's
min-content — so the horizontally-scrolling hotspot matrix widened the entire
page, header included, to 345px in a 320px viewport. Fixed with
`grid-template-columns: minmax(0, 1fr)` plus `min-width: 0` on the wrapper.
A long identifier in the HSI formula did the same thing in a dialog; fixed with
`overflow-wrap: anywhere`.

### A-06 · Scrollable regions were not keyboard-operable — FIXED in 0.1.0
axe serious, "scrollable-region-focusable". `<main>` on a page whose content
holds no focusable element (the diffraction sweep), the hotspot grid's
horizontal scroller, and a dialog body of pure prose could none of them be
scrolled from a keyboard. All three are now focusable and named.

### A-07 · The hotspot grid declared `role="table"` with no rows or cells — FIXED in 0.1.0
axe critical, "aria-required-children". Every cell button already speaks its
focal length, f-number and severity, so a labelled group is both correct and
more useful than a half-built grid. Replaced with `role="group"`.

### A-08 · Dialog content sat flush against the footer's Close button — FIXED in 0.1.0
A finger overshooting downward from the last control would land on Close.
Added bottom padding inside the scrolling body so content never touches it.

### A-09b · An untested cell's "empty bar" distinguished nothing — FIXED in 0.1.0
A clean cell is severity step 0, so it also drew three empty segments. The bar
was listed here as one of four channels separating untested from clean, and on
that pair it carried no information at all. Untested cells now draw no bar; the
acceptance gate asserts absence-vs-presence rather than counting segments.
Found by looking at a rendered screenshot **after** the gate reported green —
Doctrine §6, verify at the scale the user sees.

### A-09 · Control spacing was 6.4px in four places — FIXED in 0.1.0
Chips, button rows, list rows and the stepper all used a 0.4–0.5rem gap against
an 8px floor. Doctrine §4: targets are spaced, not only sized, because what
tremor does is overshoot. All raised to 0.625rem (10px).

---

## Known limits, stated rather than implied

- **No Content-Security-Policy.** The pre-paint theme script is inline, so a
  strict CSP is a refactor rather than a header. The other security headers do
  ship. Doctrine §16.6.
- **The light meter's accuracy is about ±1 stop** on the luminance path, and
  the app says so where the reading appears rather than on a help page. With no
  calibration it refuses to show an absolute value at all.
- **No screen-reader pass on a real device yet.**
- **"Distinguishable at arm's length in bright sun"** (acceptance §11.6) is
  measured here as four differing channels and a 1.3:1 fill contrast. The field
  condition itself needs Noah's eyes.
