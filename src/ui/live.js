// live.js — status messages that reach assistive tech WITHOUT stealing focus.
//
// WCAG 2.2 SC 4.1.3. Doctrine §4 flags this one specially: it is NOT
// machine-checkable, so it is a declaration and a hand check per app, and
// saying so is the point — a gate that always passes reads as coverage it has
// not earned.
//
// DECLARED USES in this app (each is announced, none steals focus):
//   · "Saved", "Exported", "Imported — N added" in Settings and Gear
//   · calibration saved / cleared in the Light Meter
//   · "Reading held" / "Reading released" on hold-to-freeze
//   · countdown finished in ND & Long Exposure
//   · import conflict counts
//   · offline/online transitions
// A hand check for each of these is recorded in ACCESSIBILITY.md.

let node = null;
let clearTimer = null;

function region() {
  if (!node) node = document.getElementById('live');
  return node;
}

/**
 * Announce a transient status.
 *
 * The text is cleared after a delay so the same message announced twice in a
 * row is heard twice — a live region whose content does not change emits
 * nothing, which silently drops the second "Saved".
 */
export function announce(message) {
  const r = region();
  if (!r) return;
  clearTimeout(clearTimer);
  // Clearing first then setting on the next frame is what makes a repeat of an
  // identical message actually announce.
  r.textContent = '';
  requestAnimationFrame(() => {
    r.textContent = message;
    clearTimer = setTimeout(() => { r.textContent = ''; }, 6000);
  });
}
