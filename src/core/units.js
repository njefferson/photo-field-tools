// units.js — formatting for the field. Pure; unit-tested.
//
// Everything internal is millimetres and seconds. This module is the ONLY
// place that turns those into words, so the metric/imperial toggle (spec §9)
// has exactly one implementation to change.

const MM_PER_INCH = 25.4;
const MM_PER_FOOT = 304.8;

/**
 * Distance, chosen scale, respecting the global unit system.
 * Picks a sensible unit for the magnitude — 40 mm, 1.2 m, 340 m — because in
 * the field "0.04 m" is a number you have to decode.
 */
export function formatDistance(mm, system = 'metric', digits = null) {
  if (mm === Infinity) return '∞';
  if (!Number.isFinite(mm)) return '—';
  if (mm < 0) return '—';

  if (system === 'imperial') {
    const inches = mm / MM_PER_INCH;
    if (inches < 12) return `${round(inches, digits ?? (inches < 1 ? 2 : 1))} in`;
    const feet = mm / MM_PER_FOOT;
    if (feet < 1000) return `${round(feet, digits ?? (feet < 10 ? 1 : 0))} ft`;
    return `${round(feet / 5280, digits ?? 2)} mi`;
  }
  if (mm < 10) return `${round(mm, digits ?? 2)} mm`;
  if (mm < 1000) return `${round(mm, digits ?? (mm < 100 ? 1 : 0))} mm`;
  const m = mm / 1000;
  if (m < 1000) return `${round(m, digits ?? (m < 10 ? 2 : m < 100 ? 1 : 0))} m`;
  return `${round(m / 1000, digits ?? 2)} km`;
}

/** Small distances — DoF bands, focus steps, Airy disks. Microns when tiny. */
export function formatFine(mm, system = 'metric') {
  if (!Number.isFinite(mm)) return mm === Infinity ? '∞' : '—';
  if (system === 'imperial') {
    const inches = mm / MM_PER_INCH;
    if (Math.abs(inches) < 0.1) return `${round(inches * 1000, 0)} thou`;
    return `${round(inches, 2)} in`;
  }
  if (Math.abs(mm) < 1) return `${round(mm * 1000, 1)} µm`;
  return `${round(mm, 2)} mm`;
}

/**
 * Shutter time. Photographers read 1/125, not 0.008 — and long exposures are
 * read as durations, which is what spec §4 means by "format long results as
 * h/m/s".
 */
export function formatShutter(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  if (sec >= 60) return formatDuration(sec);
  if (sec >= 1) return `${round(sec, sec < 10 ? 1 : 0)} s`;
  const denom = 1 / sec;
  // Snap the denominator to a whole number when it is within rounding noise of
  // one, so 0.008 prints as 1/125 rather than 1/125.0000001.
  const rounded = denom < 10 ? round(denom, 1) : Math.round(denom);
  return `1/${rounded} s`;
}

/** h/m/s for long exposures and the countdown timer (spec §4, §5.3). */
export function formatDuration(sec) {
  if (!Number.isFinite(sec)) return '—';
  if (sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [];
  if (h) parts.push(`${h} h`);
  if (h || m) parts.push(`${m} m`);
  parts.push(`${round(s, h || m ? 0 : s < 10 ? 1 : 0)} s`);
  return parts.join(' ');
}

/** Clock-style countdown, for the running timer. */
export function formatClock(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const total = Math.ceil(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** f-number: f/5.6, f/11 — no trailing zero on whole stops. */
export function formatFNumber(n) {
  if (!Number.isFinite(n)) return '—';
  return `f/${n < 10 ? round(n, 1) : round(n, 0)}`;
}

/** Stops, always signed, because the sign is the whole message. */
export function formatStops(stops, digits = 2) {
  if (!Number.isFinite(stops)) return '—';
  const v = round(stops, digits);
  return `${v > 0 ? '+' : v < 0 ? '' : ''}${v} EV`;
}

/** Degrees from radians. */
export function formatAngle(rad, digits = 1) {
  if (!Number.isFinite(rad)) return '—';
  return `${round((rad * 180) / Math.PI, digits)}°`;
}

/** Magnification, the way macro shooters write it. */
export function formatMagnification(m) {
  if (!Number.isFinite(m)) return '—';
  if (m >= 1) return `${round(m, 2)}×`;
  return `${round(m, 3)}×`;
}

export function formatIso(iso) {
  if (!Number.isFinite(iso)) return '—';
  return `ISO ${Math.round(iso)}`;
}

/** Local clock time from a Date, or a dash when the event does not occur. */
export function formatTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Round to a fixed number of places, returning a NUMBER so trailing zeros
 * disappear (1.50 prints as 1.5).
 *
 * Binary floating point means exact decimal halves are not always representable
 * — 1.005 is stored slightly below it and rounds down. That is inherent, not a
 * bug to paper over, and it never moves a displayed field value by anything a
 * reader could see.
 */
export function round(v, digits = 2) {
  if (!Number.isFinite(v)) return v;
  const f = Math.pow(10, Math.max(0, digits));
  return Math.round(v * f) / f;
}

/** Parse a user-entered distance in the active system back into millimetres. */
export function parseDistanceToMm(value, unit) {
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  switch (unit) {
    case 'mm': return v;
    case 'cm': return v * 10;
    case 'm': return v * 1000;
    case 'in': return v * MM_PER_INCH;
    case 'ft': return v * MM_PER_FOOT;
    default: return v;
  }
}

/** The distance units offered, per system — used by every distance input. */
export function distanceUnits(system) {
  return system === 'imperial'
    ? [{ id: 'in', label: 'in' }, { id: 'ft', label: 'ft' }]
    : [{ id: 'mm', label: 'mm' }, { id: 'cm', label: 'cm' }, { id: 'm', label: 'm' }];
}
