// hotspot.js — the hotspot matrix: schema, grid model, severity banding.
//
// PURE. No DOM, no storage. Unit-tested in test/hotspot.test.js.
//
// THIS APP CONSUMES NUMBERS AND NEVER DERIVES THEM. Spec §7 is explicit:
// jefferson-photo-studio owns the JPEGs and derives the index; this app holds
// only the derived values. There is exactly one source of truth. So there is
// deliberately NO image decoding here, NO canvas, and no upload path — adding
// one would create a second source of truth that disagrees with the first
// somewhere nobody is looking.
//
// The region geometry below is documentation of the metric this app DISPLAYS,
// so the app can explain what a number means. It is not an implementation of
// it, and it must not become one.

/**
 * Hotspot Severity Index, for reference and for the in-app explanation.
 *
 *   HSI = log2( mean_luminance_center / mean_luminance_annulus )
 *
 * measured on a featureless evenly lit surface with constant exposure and
 * white balance across the grid, and with in-camera AND post vignette
 * correction OFF — otherwise the number measures the correction, not the lens.
 */
export const HSI_DEFINITION = {
  formula: 'HSI = log2(mean_luminance_center / mean_luminance_annulus)',
  centre: 'Circular, radius 10% of frame WIDTH, centred on the frame.',
  annulus: 'Between 40% and 60% of the half-diagonal, centred on the frame.',
  linearised: 'Luminance is linearised out of sRGB before averaging.',
  zero: '0 means no hotspot. Positive values are severity, in stops.',
  // Said everywhere the grid appears. The index cannot separate a hotspot from
  // vignetting, so it ranks a lens against itself and nothing else.
  relative:
    'This index also captures vignetting, so it is a RELATIVE severity scale '
    + 'within a single lens’s own grid — not an absolute physical measurement.',
  requirements: [
    'Featureless, evenly lit surface',
    'Constant exposure and white balance across the whole grid',
    'In-camera AND post vignette correction OFF',
  ],
  derivedBy: 'jefferson-photo-studio (owns the source frames). Never re-derived here.',
};

/**
 * Severity bands.
 *
 * A DISPLAY CONVENTION, not a physical standard — nothing in spec §7 fixes
 * these boundaries, and they are stated here rather than scattered through the
 * UI so they can be changed in one place once real grids exist to calibrate
 * them against.
 *
 * ACCESSIBILITY (Doctrine §4): severity is NEVER carried by hue alone. Each
 * band declares a `step` (monotonic luminance), and every cell additionally
 * prints its own numeric value. Hue is the third channel, not the only one.
 */
export const SEVERITY_BANDS = [
  { id: 'clean',    max: 0.15,     label: 'Clean',    step: 0, hint: 'No usable hotspot' },
  { id: 'slight',   max: 0.40,     label: 'Slight',   step: 1, hint: 'Visible on flat subjects' },
  { id: 'moderate', max: 0.80,     label: 'Moderate', step: 2, hint: 'Needs correction' },
  { id: 'strong',   max: Infinity, label: 'Strong',   step: 3, hint: 'Avoid this combination' },
];

/** The band a measured HSI value falls in. */
export function severityBand(hsiStops) {
  if (!Number.isFinite(hsiStops)) return null;
  // Negative HSI means the centre is DARKER than the annulus — not a hotspot.
  // It reads as clean rather than as an error, because it is a real thing a
  // vignette-heavy lens does.
  const v = Math.max(0, hsiStops);
  return SEVERITY_BANDS.find((b) => v < b.max) ?? SEVERITY_BANDS[SEVERITY_BANDS.length - 1];
}

export const SCHEMA_ID = 'hotspot-matrix-v1';

/**
 * Validate and normalise an imported matrix (spec §7 import schema).
 *
 * Returns `{ ok, value, errors }` rather than throwing: an import is a bulk
 * operation and the user needs every problem at once, not the first one.
 */
export function parseMatrix(raw) {
  const errors = [];
  const bad = (m) => { errors.push(m); return null; };

  if (raw == null || typeof raw !== 'object') {
    return { ok: false, value: null, errors: ['Not a JSON object.'] };
  }
  if (raw.schema !== SCHEMA_ID) {
    errors.push(`Expected "schema": "${SCHEMA_ID}", found ${JSON.stringify(raw.schema ?? null)}.`);
  }
  if (typeof raw.lens !== 'string' || !raw.lens.trim()) errors.push('Missing "lens" display name.');
  if (typeof raw.body !== 'string' || !raw.body.trim()) errors.push('Missing "body" profile id.');

  const wavelength = Number(raw.wavelength_nm);
  if (!Number.isFinite(wavelength)) errors.push('Missing or non-numeric "wavelength_nm".');

  if (!Array.isArray(raw.cells)) {
    errors.push('Missing "cells" array.');
    return { ok: false, value: null, errors };
  }

  const cells = [];
  raw.cells.forEach((c, i) => {
    const at = `cells[${i}]`;
    const focal = Number(c?.focal_mm);
    const fNumber = Number(c?.f_number);
    const hsi = Number(c?.hsi_stops);
    if (!Number.isFinite(focal) || focal <= 0) return bad(`${at}: "focal_mm" must be a positive number.`);
    if (!Number.isFinite(fNumber) || fNumber <= 0) return bad(`${at}: "f_number" must be a positive number.`);
    if (!Number.isFinite(hsi)) return bad(`${at}: "hsi_stops" must be a number.`);
    const captured = typeof c.captured === 'string' ? c.captured : null;
    if (captured && !/^\d{4}-\d{2}-\d{2}$/.test(captured)) {
      return bad(`${at}: "captured" must be YYYY-MM-DD.`);
    }
    cells.push({ focal_mm: focal, f_number: fNumber, hsi_stops: hsi, captured });
    return null;
  });

  if (errors.length) return { ok: false, value: null, errors };
  return {
    ok: true,
    errors: [],
    value: {
      schema: SCHEMA_ID,
      lens: raw.lens.trim(),
      body: raw.body.trim(),
      wavelength_nm: wavelength,
      cells,
    },
  };
}

/** Serialise a stored matrix back out in the import schema — export is symmetric. */
export function serialiseMatrix(matrix) {
  return {
    schema: SCHEMA_ID,
    lens: matrix.lens,
    body: matrix.body,
    wavelength_nm: matrix.wavelength_nm,
    cells: matrix.cells.map((c) => ({
      focal_mm: c.focal_mm,
      f_number: c.f_number,
      hsi_stops: c.hsi_stops,
      ...(c.captured ? { captured: c.captured } : {}),
    })),
  };
}

const cellKey = (focal, f) => `${focal}|${f}`;

/**
 * Build the display grid: focal-length ROWS against f-number COLUMNS.
 *
 * Every intersection is present in the output. A cell with no measurement is
 * `{ tested: false }` — spec §7 requires untested to render distinctly and
 * NEVER as clean, and the way that survives refactoring is for "untested" to
 * be a real state in the model rather than an absent key the view has to
 * remember to handle.
 */
export function buildGrid(matrix) {
  const focals = [...new Set(matrix.cells.map((c) => c.focal_mm))].sort((a, b) => a - b);
  const fNumbers = [...new Set(matrix.cells.map((c) => c.f_number))].sort((a, b) => a - b);
  const byKey = new Map(matrix.cells.map((c) => [cellKey(c.focal_mm, c.f_number), c]));

  const rows = focals.map((focal) => ({
    focal_mm: focal,
    cells: fNumbers.map((f) => {
      const hit = byKey.get(cellKey(focal, f));
      if (!hit) return { focal_mm: focal, f_number: f, tested: false };
      return {
        focal_mm: focal,
        f_number: f,
        tested: true,
        hsi_stops: hit.hsi_stops,
        captured: hit.captured,
        band: severityBand(hit.hsi_stops),
      };
    }),
  }));

  const total = focals.length * fNumbers.length;
  return {
    lens: matrix.lens,
    body: matrix.body,
    wavelength_nm: matrix.wavelength_nm,
    focals,
    fNumbers,
    rows,
    tested: matrix.cells.length,
    total,
    untested: total - matrix.cells.length,
  };
}

/**
 * A plain-language summary line, "where the data supports one" (spec §7).
 *
 * The qualifier is load-bearing. This returns null rather than inventing a
 * confident sentence from two data points — a summary is a claim, and a claim
 * with no evidence behind it is exactly what Doctrine §5 forbids. It also
 * always names what is UNTESTED, because a summary that mentions only what was
 * measured reads as coverage the grid does not have.
 */
export function summarise(grid) {
  const tested = grid.rows.flatMap((r) => r.cells).filter((c) => c.tested);
  if (tested.length < 3) return null;

  const clean = tested.filter((c) => c.band.id === 'clean');
  const dirty = tested.filter((c) => c.band.id !== 'clean');
  const parts = [];

  if (clean.length && !dirty.length) {
    const fMax = Math.max(...clean.map((c) => c.f_number));
    const focals = clean.map((c) => c.focal_mm);
    parts.push(`clean through f/${fMax} at ${focalRange(focals)}`);
  } else if (clean.length && dirty.length) {
    // The largest f-number below which EVERY tested cell is clean. Stated as a
    // threshold only when one genuinely exists.
    const worstCleanF = Math.min(...dirty.map((c) => c.f_number));
    const cleanBelow = tested.filter((c) => c.f_number < worstCleanF);
    if (cleanBelow.length && cleanBelow.every((c) => c.band.id === 'clean')) {
      parts.push(`clean below f/${worstCleanF} at ${focalRange(cleanBelow.map((c) => c.focal_mm))}`);
    }
    const worst = dirty.reduce((a, b) => (b.hsi_stops > a.hsi_stops ? b : a));
    parts.push(`worst ${worst.hsi_stops.toFixed(2)} stops at ${worst.focal_mm} mm f/${worst.f_number}`);
  } else {
    const worst = dirty.reduce((a, b) => (b.hsi_stops > a.hsi_stops ? b : a));
    parts.push(`hotspot on every tested combination, worst ${worst.hsi_stops.toFixed(2)} stops at ${worst.focal_mm} mm f/${worst.f_number}`);
  }

  if (grid.untested > 0) {
    parts.push(`${grid.untested} of ${grid.total} combinations untested`);
  }
  return parts.join(', ');
}

function focalRange(focals) {
  const lo = Math.min(...focals), hi = Math.max(...focals);
  return lo === hi ? `${lo} mm` : `${lo}–${hi} mm`;
}
