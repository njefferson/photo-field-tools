// State invariants (Doctrine §16.8 — make it a gate, not an intention).
//
// THE RULE THIS PINS: the working wavelength is DERIVED, never chosen.
//
// The app shipped with a 550–950 nm number field on the body panel, which told
// the reader they pick a wavelength per shoot. They do not. What the sensor
// records is a property of the hardware — for the converted body, of whatever
// the conversion shop fitted, established once. Noah's own IR notes say it
// outright: "a fixed property of the camera, established once — never a
// per-shoot question."
//
// A comment saying so would rot. These tests fail if the dial comes back.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as store from '../src/store/state.js';
import { BODIES } from '../src/core/constants.js';

// state.js writes through localStorage, which does not exist under node. The
// write path catches that and records it in storageError rather than throwing,
// so every mutation below still applies to the in-memory state.
test.beforeEach(() => {
  store.setConversionCutoff(null);
  store.setSetting('bodyId', 'z50ii');
});

test('the wavelength cannot be set — the write is REFUSED, not ignored', () => {
  // Silently accepting the write and stamping over it later would look like a
  // bug at the call site. Refusing names the reason.
  assert.throws(() => store.setSetting('wavelengthNm', 850), /derived from the body profile/);
  assert.throws(() => store.setSetting('wavelengthAuto', true), /derived from the body profile/);
  // And the refusal changed nothing.
  assert.equal(store.getSettings().wavelengthNm, 550);
});

test('acceptance §11.3 — the wavelength follows the body, both ways', () => {
  assert.equal(store.getSettings().wavelengthNm, 550);
  store.setSetting('bodyId', 'z50-ir');
  assert.equal(store.getSettings().wavelengthNm, 720);
  store.setSetting('bodyId', 'z50ii');
  assert.equal(store.getSettings().wavelengthNm, 550, 'selecting the visible body reverts it');
});

test('a recorded conversion cutoff moves the IR body, and only the IR body', () => {
  store.setConversionCutoff(830);

  store.setSetting('bodyId', 'z50-ir');
  assert.equal(store.getSettings().wavelengthNm, 830, 'IR body uses the recorded cutoff');

  store.setSetting('bodyId', 'z50ii');
  assert.equal(store.getSettings().wavelengthNm, 550,
    'the visible body is unaffected — it has no conversion');
});

test('clearing the cutoff falls back to the body profile', () => {
  store.setConversionCutoff(830);
  store.setSetting('bodyId', 'z50-ir');
  assert.equal(store.getSettings().wavelengthNm, 830);

  store.setConversionCutoff(null);
  assert.equal(store.getSettings().wavelengthNm, BODIES['z50-ir'].defaultWavelengthNm);
});

test('a junk cutoff clears rather than poisoning the wavelength', () => {
  store.setSetting('bodyId', 'z50-ir');
  for (const junk of [NaN, Infinity, 'eight hundred', null, undefined]) {
    store.setConversionCutoff(junk);
    assert.equal(store.getState().conversionCutoffNm, null, `${String(junk)} must not be stored`);
    assert.equal(store.getSettings().wavelengthNm, 720, 'falls back to the profile default');
  }
});

test('the cutoff is camera identity, not a preference', () => {
  store.setConversionCutoff(830);
  // It lives beside the device identity, NOT in settings — so that nothing
  // iterating over preferences can present it as one, and no working screen
  // can reach it through setSetting.
  assert.equal(store.getState().conversionCutoffNm, 830);
  assert.equal('conversionCutoffNm' in store.getSettings(), false);
});
