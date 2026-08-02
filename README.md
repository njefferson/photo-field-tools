# Photo Field Tools

**Capture-time calculators for the field.** Depth of field, exposure, ND and
long exposure, diffraction, sun and moon, an incident light meter, wildlife
framing, macro, and infrared — for a Nikon Z50-class APS-C pair, one visible
and one internally converted to infrared at 720 nm.

**<https://photo-field-tools.pages.dev>**

Free · installs as an app · works with no network at all · no account · nothing
leaves your device · no analytics.

---

## The nine tools

**Depth of field** — near and far limits, total depth, hyperfocal distance, and
the in-focus band drawn against the subject.

**Exposure** — lock any two of aperture, shutter and ISO, set a target EV, get
the third. Snapped to a third of a stop with the exact value underneath. Plus a
stop-difference calculator between any two exposures.

**ND & long exposure** — stack filters, get the resulting time, and run a
countdown that keeps the screen awake where the browser allows it.

**Diffraction** — where the Airy disk outgrows your circle of confusion, swept
across the apertures you actually use. On the infrared body it shows 720 nm and
550 nm side by side.

**Sun & moon** — sunrise, sunset, all three twilights, golden hour, blue hour,
moon phase, moonrise, moonset and illumination. Type coordinates, pick a saved
place, or ask the browser — all three are equal paths, and any date works.

**Light meter** — an incident meter using the phone's camera. Flat-disc and
dome diffuser modes. **With no calibration it shows relative stops only** and
refuses to invent an EV or a lux value.

**Wildlife** — reach, field of view, how far back to stand for a given framing,
the hand-holding shutter floor, and what a teleconverter does to all of them.

**Macro** — extension tubes, magnification, working distance, effective
aperture, depth of field on the high-magnification model, and the focus step
and frame count for a stack.

**Infrared** — diffraction against the visible baseline, your measured focus
shift and exposure offset per lens, and the hotspot matrix.

---

## What it will not do

It stops at the shutter. Editing, stacking, channel swapping, grading and
culling live in a separate app.

It will not guess. Where a number is an approximation, it says so on the screen
the number is on. Where it has no measurement — an uncalibrated meter, an
untested lens, an unmeasured focus shift — it says that, instead of showing you
a plausible default.

Your lens list starts empty. No gear is invented for you.

---

## Your data

Everything lives in your browser on your device. There is no server, no
account, and nothing is sent anywhere — the app makes no network requests at
all once it has loaded.

**Export is the only backup.** It is the first thing in Settings, not buried.
Importing never overwrites anything silently: collisions are listed and left
alone unless you say otherwise.

---

## Accessibility

Accessibility is a hard gate here, not an aspiration — the build fails if it
regresses. See [`ACCESSIBILITY.md`](ACCESSIBILITY.md) for the register, the
declared visual encodings and their non-colour channels, and the known limits.

The shared statement for all of these apps:
<https://noahjefferson.pages.dev/accessibility>

---

## Building it

```
npm ci
npm run dev        # local dev server
npm run build      # dist/, including a generated service worker
npm run check      # tests + build + accessibility + acceptance + offline gates
```

Every gate exits non-zero on failure. See [`CLAUDE.md`](CLAUDE.md) for how the
repo is organised and [`NOTES.md`](NOTES.md) for what is settled, what deviates
from the original build spec and why, and what still needs a human's hands.

---

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE.md) — use it, change it, share it, but
not commercially. Bundled third-party material is declared in
[`NOTICE.md`](NOTICE.md).

Part of [noahjefferson.pages.dev](https://noahjefferson.pages.dev).
