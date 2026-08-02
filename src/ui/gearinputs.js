// gearinputs.js — the inputs several modules share.
//
// Focal length, aperture and distance appear in five modules. Building them
// once means the lens constraints (a prime has one focal length; a zoom has a
// range; a variable-aperture zoom has a different maximum at each end) are
// enforced in ONE place rather than re-derived slightly differently each time.

import { el, div, groupField, field } from './dom.js';
import { stepper, chips, select } from './controls.js';
import { F_NUMBERS } from '../core/constants.js';
import { distanceUnits, parseDistanceToMm } from '../core/units.js';
import * as store from '../store/state.js';

/** The focal range the active lens allows, or a sane open range with none. */
export function focalRange(lens) {
  if (!lens) return { min: 8, max: 800, fixed: null };
  if (lens.kind === 'prime') return { min: lens.focalMm, max: lens.focalMm, fixed: lens.focalMm };
  return { min: lens.focalMin, max: lens.focalMax, fixed: null };
}

/**
 * Widest available aperture at a given focal length.
 *
 * A variable-aperture zoom is interpolated in LOG space across the zoom range,
 * which is how these lenses actually behave — a linear interpolation between
 * f/3.5 and f/6.3 is wrong in the middle by a visible amount.
 */
export function widestAperture(lens, focalMm) {
  if (!lens) return null;
  if (lens.kind === 'prime') return lens.apertureMax ?? null;
  const wide = lens.apertureWide, tele = lens.apertureTele;
  if (wide == null) return null;
  if (tele == null || tele === wide) return wide;
  const { min, max } = focalRange(lens);
  if (!(max > min)) return wide;
  const t = Math.min(1, Math.max(0, (Math.log(focalMm) - Math.log(min)) / (Math.log(max) - Math.log(min))));
  return Math.exp(Math.log(wide) + t * (Math.log(tele) - Math.log(wide)));
}

/**
 * Focal length control. A prime shows its single value as static text rather
 * than a stepper that cannot move — a control that looks operable and is not
 * is worse than no control.
 */
export function focalControl({ value, onChange }) {
  const lens = store.activeLens();
  const range = focalRange(lens);

  if (range.fixed != null) {
    const box = div('row', [
      div('rtxt', [
        div('rname', [`${range.fixed} mm`]),
        div('rsub', [`Fixed — ${lens.name} is a prime`]),
      ]),
    ]);
    return groupField('Focal length', box);
  }

  const s = stepper({
    value, min: range.min, max: range.max, step: focalStep(value),
    label: 'focal length', suffix: 'mm',
    onChange: (v) => { s.input.step = focalStep(v); onChange(v); },
  });

  const presets = presetFocals(range);
  const group = div('', [s]);
  if (presets.length > 1) {
    group.append(el('div', { style: { height: '0.5rem' } }));
    group.append(chips({
      label: 'Focal length presets',
      options: presets,
      value,
      format: (v) => `${v}`,
      onSelect: (v) => { s.setValue(v); onChange(v); },
    }));
  }
  return groupField('Focal length', group,
    lens ? `${lens.name}: ${range.min}–${range.max} mm` : 'No lens selected — enter any focal length');
}

const focalStep = (v) => (v < 50 ? 1 : v < 200 ? 5 : 10);

function presetFocals(range) {
  const candidates = [10, 14, 16, 18, 24, 35, 50, 70, 85, 105, 135, 150, 200, 250, 300, 400, 500, 600];
  const inside = candidates.filter((c) => c >= range.min && c <= range.max);
  const out = [range.min, ...inside, range.max];
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Aperture control: chips on the standard scale, clamped to the lens. */
export function apertureControl({ value, focalMm, onChange, label = 'Aperture' }) {
  const lens = store.activeLens();
  const widest = widestAperture(lens, focalMm);
  const options = F_NUMBERS.filter((f) => (widest == null || f >= widest - 1e-9) && f <= 32);

  const row = chips({
    label,
    options,
    value,
    format: (v) => `f/${v}`,
    onSelect: onChange,
  });
  const hint = widest != null
    ? `${lens.name} opens to f/${round2(widest)} at ${Math.round(focalMm)} mm`
    : 'Standard 1/3-stop scale';
  return groupField(label, row, hint);
}

const round2 = (v) => Math.round(v * 10) / 10;

/**
 * A distance input with a unit picker, honouring the global metric/imperial
 * setting (spec §9). Returns millimetres through onChange, always.
 */
export function distanceControl({ valueMm, onChange, label = 'Focus distance', hint }) {
  const system = store.getSettings().units;
  const units = distanceUnits(system);
  // Pick a unit that makes the current value readable rather than always
  // defaulting to the smallest.
  let unit = units[units.length - 1].id;
  if (system === 'metric' && valueMm < 1000) unit = valueMm < 100 ? 'mm' : 'cm';
  if (system === 'imperial' && valueMm < 305) unit = 'in';

  const toDisplay = (mm, u) => {
    const perUnit = parseDistanceToMm(1, u);
    return Math.round((mm / perUnit) * 100) / 100;
  };

  const input = el('input', {
    type: 'number', inputMode: 'decimal',
    value: String(toDisplay(valueMm, unit)),
    attrs: { min: 0, step: 'any', 'aria-label': `${label}, value` },
    on: {
      change: () => {
        const mm = parseDistanceToMm(input.value, unit);
        if (mm != null && mm > 0) onChange(mm);
      },
    },
  });

  const picker = select({
    label: `${label}, unit`,
    options: units.map((u) => ({ value: u.id, label: u.label })),
    value: unit,
    onChange: (u) => {
      // Changing the unit must not change the DISTANCE — convert the number so
      // the physical value stays where it was.
      const currentMm = parseDistanceToMm(input.value, unit);
      unit = u;
      input.value = String(toDisplay(currentMm ?? valueMm, unit));
    },
  });
  picker.style.flex = '0 0 5.5rem';

  const row = div('', [], { style: { display: 'flex', gap: '0.5rem' } });
  input.style.flex = '1 1 auto';
  row.append(input, picker);
  return groupField(label, row, hint);
}

/** Read the focal length a module should start with, given the active lens. */
export function initialFocal() {
  const lens = store.activeLens();
  const r = focalRange(lens);
  if (r.fixed != null) return r.fixed;
  if (!lens) return 50;
  return Math.round((r.min + r.max) / 2);
}

/** Read a sensible starting aperture, given the active lens. */
export function initialAperture(focalMm) {
  const lens = store.activeLens();
  const widest = widestAperture(lens, focalMm);
  if (widest == null) return 8;
  return F_NUMBERS.find((f) => f >= widest * 2) ?? 8;
}
