// Unit tests for formatting (spec §4 "format long results as h/m/s", §9
// metric/imperial toggle applied everywhere distances appear).
//
// Formatting is where a correct calculation still reaches the user wrong, so
// the infinity and sub-millimetre cases get as much attention as the ordinary
// ones — those are exactly the values a depth-of-field screen produces.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatDistance, formatFine, formatShutter, formatDuration, formatClock,
  formatFNumber, formatStops, formatAngle, formatMagnification,
  parseDistanceToMm, distanceUnits, round,
} from '../src/core/units.js';

test('distance picks a readable scale in metric', () => {
  assert.equal(formatDistance(4.2), '4.2 mm');
  assert.equal(formatDistance(250), '250 mm');
  assert.equal(formatDistance(1500), '1.5 m');
  assert.equal(formatDistance(340000), '340 m');
  assert.equal(formatDistance(2500000), '2.5 km');
});

test('distance converts to imperial when asked', () => {
  assert.equal(formatDistance(25.4, 'imperial'), '1 in');
  assert.equal(formatDistance(304.8, 'imperial'), '1 ft');
  assert.equal(formatDistance(3048, 'imperial'), '10 ft');
});

test('infinity and non-numbers format honestly, never as a huge number', () => {
  // A far limit of Infinity is a real, common answer — it must read as ∞.
  assert.equal(formatDistance(Infinity), '∞');
  assert.equal(formatDistance(Infinity, 'imperial'), '∞');
  assert.equal(formatDistance(NaN), '—');
  assert.equal(formatFine(Infinity), '∞');
  assert.equal(formatFine(NaN), '—');
  assert.equal(formatShutter(NaN), '—');
  assert.equal(formatStops(NaN), '—');
  assert.equal(formatAngle(NaN), '—');
});

test('fine distances drop to microns — Airy disks and macro depth live there', () => {
  assert.equal(formatFine(0.0084), '8.4 µm');
  assert.equal(formatFine(0.64), '640 µm');
  assert.equal(formatFine(2.5), '2.5 mm');
});

test('shutter times read the way photographers write them', () => {
  assert.equal(formatShutter(1 / 125), '1/125 s');
  assert.equal(formatShutter(1 / 4000), '1/4000 s');
  assert.equal(formatShutter(0.5), '1/2 s');
  assert.equal(formatShutter(1), '1 s');
  assert.equal(formatShutter(8.192), '8.2 s');
  assert.equal(formatShutter(30), '30 s');
  // Past a minute it becomes a duration — spec §4.
  assert.equal(formatShutter(90), '1 m 30 s');
});

test('long exposures format as h/m/s (spec §4)', () => {
  assert.equal(formatDuration(45), '45 s');
  assert.equal(formatDuration(90), '1 m 30 s');
  assert.equal(formatDuration(3600), '1 h 0 m 0 s');
  assert.equal(formatDuration(3725), '1 h 2 m 5 s');
  assert.equal(formatDuration(0), '0 s');
});

test('the countdown clock zero-pads and never runs negative', () => {
  assert.equal(formatClock(65), '01:05');
  assert.equal(formatClock(3725), '1:02:05');
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(-5), '00:00', 'an overrun timer shows zero, not -00:05');
});

test('apertures, stops, angles and magnification', () => {
  assert.equal(formatFNumber(5.6), 'f/5.6');
  assert.equal(formatFNumber(11), 'f/11');
  // Stops are always signed: the sign is the entire message.
  assert.equal(formatStops(1.5), '+1.5 EV');
  assert.equal(formatStops(-1.5), '-1.5 EV');
  assert.equal(formatStops(0), '0 EV');
  assert.equal(formatAngle(Math.PI / 2), '90°');
  assert.equal(formatMagnification(1), '1×');
  assert.equal(formatMagnification(0.166), '0.166×');
});

test('distance parsing round-trips through every offered unit', () => {
  assert.equal(parseDistanceToMm(1, 'mm'), 1);
  assert.equal(parseDistanceToMm(1, 'cm'), 10);
  assert.equal(parseDistanceToMm(1, 'm'), 1000);
  assert.equal(parseDistanceToMm(1, 'in'), 25.4);
  assert.equal(parseDistanceToMm(1, 'ft'), 304.8);
  assert.equal(parseDistanceToMm('abc', 'm'), null, 'junk returns null, never NaN downstream');

  // Every unit the picker offers must be parseable — a unit in the list with
  // no parse branch would silently return the raw number.
  for (const system of ['metric', 'imperial']) {
    for (const u of distanceUnits(system)) {
      assert.ok(Number.isFinite(parseDistanceToMm(2, u.id)), `${u.id} must parse`);
    }
  }
});

test('round trims noise without lying about precision', () => {
  assert.equal(round(1 / 3, 3), 0.333);
  assert.equal(round(2.675, 1), 2.7);
  assert.equal(round(1.5, 0), 2);
  // Returns a NUMBER, so trailing zeros never reach the screen.
  assert.equal(round(1.5000001, 2), 1.5);
  assert.equal(round(Infinity), Infinity);
  assert.ok(Number.isNaN(round(NaN)));
});
