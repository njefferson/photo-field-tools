// constants.js — hardware facts and standard scales.
//
// Pure data. No DOM, no storage, no imports from anywhere but here.
//
// SPEC §2: both bodies are Nikon Z50 class, APS-C. Neither has IBIS —
// stabilisation is lens-based (Nikon VR) only, which is why the shutter-floor
// module treats VR as a per-lens property and never a body one.

/** Active sensor area, millimetres. Spec §2. */
export const SENSOR = {
  width: 23.5,
  height: 15.7,
  // DERIVED, not typed twice. Spec §4 quotes 28.26 for the diagonal; this
  // computes 28.2620, which is that number to the precision it was quoted at.
  get diagonal() {
    return Math.hypot(this.width, this.height);
  },
};

/** Recorded pixel dimensions. Spec §2. */
export const RESOLUTION = { width: 5568, height: 3712 };

// DERIVED from the sensor width, exactly as spec §2 says to derive it
// ("4.221 um (derived: 23.5 / 5568)"). 23.5 / 5568 = 4.22055 um.
//
// Worth stating because it produces a visible 0.01% difference: the spec then
// doubles its OWN ROUNDED value to reach "c = 8.442 um", where deriving all the
// way through gives 8.4411 um. We derive, so the number never disagrees with
// the sensor dimensions it comes from. Neither value changes any displayed
// result at the precision this app shows.
export const PIXEL_PITCH_MM = SENSOR.width / RESOLUTION.width;

/** Crop factor vs. 35mm. Spec §2 — used by the shutter floor and by reach. */
export const CROP_FACTOR = 1.5;

/**
 * Circle-of-confusion bases. Spec §4: two bases, user-toggleable, default
 * pixel-pitch. THE ACTIVE BASIS IS DISPLAYED WHEREVER A NUMBER DERIVED FROM IT
 * IS — the two produce materially different answers (0.0084 mm vs 0.020 mm is
 * a factor of 2.4) and a number without its basis is not an answer.
 */
export const COC_BASES = {
  pixel: {
    id: 'pixel',
    label: 'pixel-pitch',
    short: '2px',
    mm: 2 * PIXEL_PITCH_MM,
    note: '2 × pixel pitch — what this sensor can actually resolve',
  },
  traditional: {
    id: 'traditional',
    label: 'traditional APS-C',
    short: '0.020',
    mm: 0.020,
    note: '0.020 mm — the print-viewing convention, more permissive',
  },
};
export const DEFAULT_COC_BASIS = 'pixel';

/**
 * Body profiles. Spec §2: they differ ONLY in label and IR flag.
 *
 * NOTE THE ABSENCE: there is no filter field, and there must never be one.
 * The IR body is internally converted at 720 nm and no external filter is ever
 * used (spec §2, acceptance criterion 10).
 */
export const BODIES = {
  'z50ii': {
    id: 'z50ii',
    label: 'Z50 II',
    infrared: false,
    defaultWavelengthNm: 550,
    note: 'Visible light',
  },
  'z50-ir': {
    id: 'z50-ir',
    label: 'Z50 (IR converted)',
    infrared: true,
    defaultWavelengthNm: 720,
    note: 'Internal 720 nm conversion — no external filter',
  },
};
export const DEFAULT_BODY = 'z50ii';

/** Working wavelength is settable so other conversion cutoffs can be modelled. */
export const WAVELENGTH_RANGE = { min: 550, max: 950 };
/** The visible-light reference every IR comparison is shown against. */
export const REFERENCE_WAVELENGTH_NM = 550;

/**
 * Extension tubes. Spec §3: preload the Meike set as available ELEMENTS —
 * 11 mm, 18 mm, and the 29 mm stacked combination. These are hardware Noah
 * owns, so they are not "invented gear" in the sense the lens list is.
 */
export const MEIKE_TUBES = [
  { id: 'meike-11', label: '11 mm', mm: 11, builtin: true },
  { id: 'meike-18', label: '18 mm', mm: 18, builtin: true },
  { id: 'meike-29', label: '29 mm (11 + 18 stacked)', mm: 29, builtin: true },
];

/**
 * Spec §5.8: preload ONE macro configuration as a starting preset.
 * This is a starting point, not a measurement.
 */
export const DRAGONFLY_PRESET = {
  id: 'dragonfly',
  label: 'Dragonfly configuration',
  focalMm: 175,          // the 150–200 mm range, mid-point
  focalRange: [150, 200],
  extensionMm: 29,
  note: '150–200 mm at 29 mm of extension',
};

/** Diffusers. Spec §6 — explicitly selected, NEVER auto-detected. */
export const DIFFUSERS = {
  flat: {
    id: 'flat',
    label: 'Flat disc',
    C: 250,
    for: 'Lighting ratios, flat subjects, comparing one source against another.',
    reads: 'Reads illuminance on a plane.',
    improvise: 'A disc of printer paper or translucent plastic laid flat over the lens.',
  },
  dome: {
    id: 'dome',
    label: 'Dome',
    C: 340,
    for: 'Three-dimensional subjects such as a face.',
    reads: 'Integrates the hemisphere.',
    improvise: 'Half a ping-pong ball, or a translucent bottle cap, sat over the lens.',
  },
};
export const DEFAULT_DIFFUSER = 'flat';

/** Focus-stacking overlap. Spec §4: default 25%, adjustable 0–0.5. */
export const DEFAULT_OVERLAP = 0.25;
export const OVERLAP_RANGE = { min: 0, max: 0.5 };

/** Magnification at or above which the macro DoF model takes over. Spec §4. */
export const MACRO_M_THRESHOLD = 0.1;

/** Shutter-floor strictness. Spec §4 — k multiplies the 1/(f × 1.5) rule. */
export const SHUTTER_STRICTNESS = [
  { k: 1, label: '1×', note: 'Legacy 1/focal rule' },
  { k: 2, label: '2×', note: 'Default — suits this pixel density' },
  { k: 4, label: '4×', note: 'Critical' },
];
export const DEFAULT_STRICTNESS = 2;

/* ---------- standard 1/3-stop scales (spec §4: snap, show exact secondary) ---------- */

export const F_NUMBERS = [
  1.0, 1.1, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.5, 2.8, 3.2, 3.5, 4.0, 4.5, 5.0,
  5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22, 25, 29, 32, 36, 40, 45,
];

/** Shutter times in SECONDS, longest first. */
export const SHUTTER_TIMES = [
  30, 25, 20, 15, 13, 10, 8, 6, 5, 4, 3.2, 2.5, 2, 1.6, 1.3, 1,
  0.8, 0.6, 0.5, 0.4, 0.3, 1 / 4, 1 / 5, 1 / 6, 1 / 8, 1 / 10, 1 / 13, 1 / 15,
  1 / 20, 1 / 25, 1 / 30, 1 / 40, 1 / 50, 1 / 60, 1 / 80, 1 / 100, 1 / 125,
  1 / 160, 1 / 200, 1 / 250, 1 / 320, 1 / 400, 1 / 500, 1 / 640, 1 / 800,
  1 / 1000, 1 / 1250, 1 / 1600, 1 / 2000, 1 / 2500, 1 / 3200, 1 / 4000,
];

export const ISO_VALUES = [
  100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000,
  2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800, 16000, 20000, 25600, 51200,
];

/** Common ND densities, in stops. Spec §5.3 supports stacking (sum the stops). */
export const ND_FILTERS = [
  { label: 'ND2 (1 stop)', stops: 1 },
  { label: 'ND4 (2 stops)', stops: 2 },
  { label: 'ND8 (3 stops)', stops: 3 },
  { label: 'ND16 (4 stops)', stops: 4 },
  { label: 'ND64 (6 stops)', stops: 6 },
  { label: 'ND400 (8.6 stops)', stops: 8.6 },
  { label: 'ND1000 (10 stops)', stops: 10 },
  { label: 'ND100000 (16.6 stops)', stops: 16.6 },
];
