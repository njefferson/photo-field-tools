// meter.js — spec §6 Light meter. The only module that touches the camera.
//
// THE HARD RULE (spec §6, acceptance §11.4): with no matching calibration
// profile, this meter shows RELATIVE STOPS ONLY. It must not display an
// absolute EV, lux, or a recommended exposure, and a missing calibration is
// NEVER silently substituted with a default constant. That rule is enforced in
// ONE place — `canShowAbsolute()` — and every absolute readout is built inside
// that branch, so there is no second path where it could leak out.
//
// DEVIATION FROM THE SPEC, recorded rather than done quietly: spec §6 asks for
// "hold-to-freeze". Doctrine §4 forbids timed gestures and press-and-hold
// outright (WCAG 2.2 SC 2.2.1, and SC 2.5.2 on pointer-down), and the Doctrine
// wins where the two overlap. Freeze is therefore a TOGGLE — one tap to hold,
// one tap to release. Same capability, no timed gesture. Noted in NOTES.md.

import { el, div, h, p, card, readout, groupField, caveat, empty } from '../ui/dom.js';
import { chips, stepper, openDialog } from '../ui/controls.js';
import { DIFFUSERS, F_NUMBERS, ISO_VALUES, SHUTTER_TIMES } from '../core/constants.js';
import {
  ev100, illuminanceFromEv, solvePathAConstant, solvePathBConstant,
  evFromLuminance, relativeLuminance, suggestFromEv, snapTo, illuminance,
} from '../core/exposure.js';
import { formatShutter, formatFNumber, formatIso, round } from '../core/units.js';
import { announce } from '../ui/live.js';
import * as store from '../store/state.js';
import { onLeave } from '../main.js';

const SAMPLE = 64;             // canvas size the frame is drawn down to
const CENTRAL = 0.5;           // fraction of the frame treated as "central"

export function renderMeter() {
  let facing = 'user';         // spec §6: default to the FRONT camera
  let diffuser = store.getSettings().diffuser;
  let stream = null;
  let path = null;             // 'A' | 'B' — decided by probing, never by UA
  let capabilities = null;
  let frozen = false;
  let reference = null;        // relative-mode zero point
  let raf = null;
  const history = [];

  const video = el('video', { class: 'meter-video', muted: true, playsInline: true, attrs: { 'aria-hidden': 'true' } });
  video.muted = true;
  video.setAttribute('playsinline', '');
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE; canvas.height = SAMPLE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const wrap = div('');
  wrap.append(h(1, 'Light meter'));

  /* ---------------- geometry instruction (spec §6) ---------------- */

  wrap.append(card('How to hold it', [
    p('', 'This is an INCIDENT meter. Hold the device at the SUBJECT’s position '
        + 'with the lens facing AWAY from the subject, pointing toward the light.'),
    p('hint', 'The front camera is the default because it keeps the screen readable '
        + 'while the lens points away from you.'),
  ]));

  /* ---------------- diffuser (explicit, never auto-detected) ---------------- */

  const diffuserNote = p('hint', '');
  const diffuserCard = card('Diffuser', [
    groupField('Diffuser mode', chips({
      label: 'Diffuser mode',
      options: Object.values(DIFFUSERS).map((d) => ({ value: d.id, label: d.label })),
      value: diffuser,
      onSelect: (id) => {
        diffuser = id;
        store.setSetting('diffuser', id);
        updateDiffuserNote();
        // The profile tuple includes the diffuser, so changing it changes
        // which calibration applies — possibly from "calibrated" to not.
        render();
        announce(`${DIFFUSERS[id].label} diffuser. ${calibrationState().calibrated ? 'Calibrated.' : 'Not calibrated — relative stops only.'}`);
      },
    })),
    diffuserNote,
    el('button', {
      type: 'button', class: 'btn', text: 'How to improvise one',
      on: { click: openImproviseHelp },
    }),
  ]);

  function updateDiffuserNote() {
    const d = DIFFUSERS[diffuser];
    diffuserNote.textContent = `${d.reads} ${d.for}`;
  }
  updateDiffuserNote();
  wrap.append(diffuserCard);

  /* ---------------- camera ---------------- */

  const camStatus = p('hint', 'The camera is not running. Nothing is requested until you start it.');
  const startBtn = el('button', {
    type: 'button', class: 'btn primary', text: 'Start meter',
    attrs: { 'aria-label': 'Start the meter and request camera access' },
    on: { click: start },
  });
  const stopBtn = el('button', {
    type: 'button', class: 'btn', text: 'Stop', disabled: true,
    attrs: { 'aria-label': 'Stop the meter and release the camera' },
    on: { click: () => { stop(); announce('Meter stopped, camera released.'); } },
  });
  const switchBtn = el('button', {
    type: 'button', class: 'btn', text: 'Switch camera', disabled: true,
    attrs: { 'aria-label': 'Switch between front and rear camera' },
    on: {
      click: async () => {
        facing = facing === 'user' ? 'environment' : 'user';
        await start();
        announce(`${facing === 'user' ? 'Front' : 'Rear'} camera.`);
      },
    },
  });

  wrap.append(card('Camera', [
    div('btnrow', [startBtn, stopBtn, switchBtn]),
    camStatus,
    video,
  ]));

  /* ---------------- reading ---------------- */

  const readingBox = card('Reading', []);
  wrap.append(readingBox);

  const settingsBox = card('Averaging', [
    groupField('Frames averaged', stepper({
      value: store.getSettings().meterAverageFrames,
      min: 1, max: 60, step: 1, label: 'frames averaged',
      onChange: (v) => { store.setSetting('meterAverageFrames', v); history.length = 0; },
    }), 'A rolling average suppresses flicker from mains lighting. More frames is steadier and slower to respond.'),
  ]);
  wrap.append(settingsBox);

  /* ---------------- calibration ---------------- */

  const calBox = card('Calibration', []);
  wrap.append(calBox);

  onLeave(stop);

  /* ------------------------------------------------------------------ *
   * camera lifecycle
   * ------------------------------------------------------------------ */

  async function start() {
    stopStreamOnly();
    camStatus.textContent = 'Asking for camera access…';
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
    } catch (err) {
      // Doctrine §5: every failure explains itself and offers a way forward.
      camStatus.textContent = err && err.name === 'NotAllowedError'
        ? 'Camera permission declined. The meter needs the camera; nothing else in this app does.'
        : `Camera unavailable: ${err && err.message ? err.message : 'unknown error'}.`;
      startBtn.disabled = false; stopBtn.disabled = true; switchBtn.disabled = true;
      render();
      return;
    }

    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* autoplay policies; frames still arrive */ }

    const track = stream.getVideoTracks()[0];
    // SPEC §6: probe getCapabilities() at module load rather than sniffing the
    // user agent. WebKit exposes no track capabilities at all, so this returns
    // nothing on every iOS browser and path B is selected — which is exactly
    // acceptance §11.5, reached by measurement rather than by assumption.
    capabilities = null;
    try {
      capabilities = typeof track.getCapabilities === 'function' ? track.getCapabilities() : null;
    } catch (e) { capabilities = null; }

    const hasReadback = !!(capabilities
      && ('exposureTime' in capabilities || 'iso' in capabilities)
      && readTrackSettings(track).usable);
    path = hasReadback ? 'A' : 'B';

    // Path B asks the platform to lock exposure. Most will refuse; that is
    // fine and is reported rather than assumed either way.
    let locked = false;
    if (path === 'B') {
      try {
        await track.applyConstraints({ advanced: [{ exposureMode: 'manual' }] });
        const s = track.getSettings ? track.getSettings() : {};
        locked = s.exposureMode === 'manual';
      } catch (e) { locked = false; }
    }

    camStatus.textContent = path === 'A'
      ? 'Running. This camera reports its own exposure settings.'
      : `Running. This camera does not report exposure settings, so the luminance path is in use.${locked ? ' Exposure is locked.' : ' Exposure could not be locked.'}`;

    startBtn.disabled = true; stopBtn.disabled = false; switchBtn.disabled = false;
    history.length = 0;
    render();
    loop();
  }

  function stopStreamOnly() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    if (stream) {
      for (const t of stream.getTracks()) t.stop();
      stream = null;
    }
    video.srcObject = null;
  }

  function stop() {
    stopStreamOnly();
    path = null; capabilities = null; frozen = false;
    startBtn.disabled = false; stopBtn.disabled = true; switchBtn.disabled = true;
    camStatus.textContent = 'The camera is not running. Nothing is requested until you start it.';
    render();
  }

  /* ------------------------------------------------------------------ *
   * sampling
   * ------------------------------------------------------------------ */

  function readTrackSettings(track) {
    let s = {};
    try { s = track.getSettings ? track.getSettings() : {}; } catch (e) { s = {}; }
    // exposureTime is reported in 100 µs units by the Media Capture spec.
    const shutterSec = typeof s.exposureTime === 'number' && s.exposureTime > 0
      ? (s.exposureTime * 100) / 1e6
      : null;
    const iso = typeof s.iso === 'number' && s.iso > 0 ? s.iso : null;
    return { shutterSec, iso, usable: shutterSec != null && iso != null };
  }

  /** Mean linear luminance over the central region (spec §6, path B). */
  function sampleLuminance() {
    if (!video.videoWidth) return null;
    ctx.drawImage(video, 0, 0, SAMPLE, SAMPLE);
    const inset = Math.floor((SAMPLE * (1 - CENTRAL)) / 2);
    const size = SAMPLE - inset * 2;
    let data;
    try { data = ctx.getImageData(inset, inset, size, size).data; } catch (e) { return null; }
    let sum = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      sum += relativeLuminance(data[i], data[i + 1], data[i + 2]);
    }
    // Clamped away from zero: log2(0) is −Infinity and would poison the average.
    return Math.max(1e-6, sum / n);
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (frozen || !stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    let sample = null;
    if (path === 'A') {
      const s = readTrackSettings(track);
      if (s.usable) {
        const N = deviceAperture();
        sample = { kind: 'A', deviceEv: ev100({ fNumber: N, shutterSec: s.shutterSec, iso: s.iso }), raw: s };
      }
    }
    if (!sample) {
      const Y = sampleLuminance();
      if (Y == null) return;
      sample = { kind: 'B', logY: Math.log2(Y), Y };
    }

    history.push(sample);
    const keep = store.getSettings().meterAverageFrames;
    while (history.length > keep) history.shift();
    render();
  }

  /** The averaged reading, in whichever quantity the active path produces. */
  function averaged() {
    if (!history.length) return null;
    if (history[0].kind === 'A') {
      const mean = history.reduce((a, s) => a + s.deviceEv, 0) / history.length;
      return { kind: 'A', deviceEv: mean, frames: history.length };
    }
    // Averaged in LOG space: averaging luminance then taking the log is a
    // different (and flicker-biased) number.
    const mean = history.reduce((a, s) => a + s.logY, 0) / history.length;
    return { kind: 'B', logY: mean, Y: Math.pow(2, mean), frames: history.length };
  }

  /* ------------------------------------------------------------------ *
   * calibration state — THE gate for absolute values
   * ------------------------------------------------------------------ */

  function deviceAperture() {
    const prof = store.findCalibration({ facing, diffuser, path: 'A' });
    return prof && prof.deviceApertureN ? prof.deviceApertureN : 2.0;
  }

  function calibrationState() {
    if (!path) return { calibrated: false, profile: null };
    const profile = store.findCalibration({ facing, diffuser, path });
    return { calibrated: !!profile, profile };
  }

  /**
   * THE HARD RULE, in one place. Absolute EV and lux exist only when a profile
   * matching this exact tuple exists. No default constant is ever substituted.
   */
  function canShowAbsolute() {
    return calibrationState().calibrated;
  }

  /* ------------------------------------------------------------------ *
   * rendering
   * ------------------------------------------------------------------ */

  function render() {
    renderReading();
    renderCalibration();
  }

  function renderReading() {
    while (readingBox.children.length > 1) readingBox.removeChild(readingBox.lastChild);
    const avg = averaged();

    if (!stream) {
      readingBox.append(empty('Start the meter to take a reading.'));
      return;
    }
    if (!avg) {
      readingBox.append(empty('Waiting for the first frames…'));
      return;
    }

    // THE single gate for absolute values. Routed through canShowAbsolute()
    // rather than re-reading calibrationState() here, so there is genuinely
    // one enforcement point rather than a comment claiming there is one — an
    // earlier revision of this file had exactly that gap, and mutating the
    // guard changed nothing because nobody called it.
    const { profile } = calibrationState();
    if (!canShowAbsolute()) {
      // -------- RELATIVE STOPS ONLY (spec §6, acceptance §11.4) --------
      const rel = reference == null ? null : relativeStops(avg, reference);
      const big = div('meter-big meter-rel', [
        rel == null ? '—' : `${rel > 0 ? '+' : ''}${round(rel, 2)}`,
      ]);
      big.setAttribute('aria-hidden', 'true');
      readingBox.append(big);
      readingBox.append(p('', rel == null
        ? 'Set a reference to start comparing.'
        : `${round(Math.abs(rel), 2)} stops ${rel >= 0 ? 'brighter' : 'darker'} than the reference.`));

      readingBox.append(div('meter-state', [
        el('span', {}, ['Path ', el('b', { text: path })]),
        el('span', {}, ['Frames ', el('b', { text: String(avg.frames) })]),
        el('span', {}, ['Diffuser ', el('b', { text: DIFFUSERS[diffuser].label })]),
      ]));

      // Stated where the reading appears, not on a help page — spec §6.
      readingBox.append(caveat('Not calibrated for this combination.',
        'Relative stops only. This meter will not show an EV, a lux value or a '
        + 'suggested exposure until you calibrate it for this device, camera, '
        + 'diffuser and measurement path — a default constant would be a guess '
        + 'wearing a number’s clothes.'));

      readingBox.append(div('btnrow', [
        el('button', {
          type: 'button', class: 'btn primary', text: reference == null ? 'Set reference' : 'Reset reference',
          attrs: { 'aria-label': 'Set the current reading as the zero reference' },
          on: {
            click: () => {
              reference = averaged();
              announce('Reference set. Readings now show stops relative to it.');
              render();
            },
          },
        }),
        freezeButton(),
      ]));
      return;
    }

    // -------- CALIBRATED: absolute values are allowed --------
    const evValue = absoluteEv(avg, profile);
    const lux = illuminanceFromEv(DIFFUSERS[diffuser].C, evValue);
    const iso = 100;
    const suggested = suggestFromEv({ ev: evValue, iso, fNumber: 5.6 });

    const big = div('meter-big', [`EV ${round(evValue, 2)}`]);
    big.setAttribute('aria-hidden', 'true');
    readingBox.append(big);
    readingBox.append(p('', `EV ${round(evValue, 2)} at ISO 100 — about ${Math.round(lux)} lux.`));

    readingBox.append(div('readout', [
      readout('Illuminance', `${Math.round(lux)} lx`, `C = ${DIFFUSERS[diffuser].C} (${DIFFUSERS[diffuser].label})`, { small: true }),
      readout('Suggested', `${formatFNumber(5.6)} · ${formatShutter(suggested.snapped)}`, formatIso(iso), { small: true }),
    ]));

    readingBox.append(div('meter-state', [
      el('span', {}, ['Path ', el('b', { text: path })]),
      el('span', {}, ['Frames ', el('b', { text: String(avg.frames) })]),
      el('span', {}, ['Calibrated ', el('b', { text: profile.calibratedAt })]),
    ]));

    if (path === 'B') {
      // Spec §6 requires this exact caveat where the reading appears.
      readingBox.append(caveat('About ±1 stop.',
        'This path reads a tone-mapped, auto-white-balanced frame. The mapping '
        + 'to scene luminance is nonlinear and device-specific: realistic '
        + 'accuracy is about ±1 stop in mid-range light after calibration, and '
        + 'worse at both ends.'));
    }

    readingBox.append(div('btnrow', [freezeButton()]));
  }

  function freezeButton() {
    return el('button', {
      type: 'button', class: 'btn', text: frozen ? 'Release' : 'Freeze',
      // A toggle, not a press-and-hold: Doctrine §4 forbids timed gestures.
      attrs: { 'aria-pressed': String(frozen), 'aria-label': frozen ? 'Release the held reading' : 'Freeze the reading' },
      on: {
        click: () => {
          frozen = !frozen;
          announce(frozen ? 'Reading held.' : 'Reading released.');
          render();
        },
      },
    });
  }

  function relativeStops(avg, ref) {
    if (avg.kind !== ref.kind) return null;
    // Path A: EV falls as light rises, so the sign is flipped to make
    // "brighter" positive. Path B: log luminance rises with light directly.
    return avg.kind === 'A' ? ref.deviceEv - avg.deviceEv : avg.logY - ref.logY;
  }

  function absoluteEv(avg, profile) {
    if (avg.kind === 'A') {
      // The stored constant is the device's own C. Recover the scene EV from
      // it and the nominal constant for this diffuser geometry.
      const nominal = DIFFUSERS[diffuser].C;
      return avg.deviceEv + Math.log2(profile.constant / nominal);
    }
    return evFromLuminance(avg.Y, profile.constant);
  }

  /* ------------------------------------------------------------------ *
   * calibration UI
   * ------------------------------------------------------------------ */

  function renderCalibration() {
    while (calBox.children.length > 1) calBox.removeChild(calBox.lastChild);
    const { calibrated, profile } = calibrationState();

    if (!path) {
      calBox.append(p('hint', 'Start the meter to see which measurement path this camera supports.'));
      return;
    }

    calBox.append(el('dl', { class: 'kv' }, [
      el('dt', { text: 'Device' }), el('dd', { text: store.getState().deviceLabel }),
      el('dt', { text: 'Camera' }), el('dd', { text: facing === 'user' ? 'Front' : 'Rear' }),
      el('dt', { text: 'Diffuser' }), el('dd', { text: DIFFUSERS[diffuser].label }),
      el('dt', { text: 'Path' }), el('dd', { text: path === 'A' ? 'A — track settings readback' : 'B — luminance' }),
      el('dt', { text: 'Status' }),
      el('dd', { text: calibrated ? `Calibrated ${profile.calibratedAt}` : 'Not calibrated' }),
    ]));

    if (path === 'B') {
      calBox.append(p('hint',
        'This camera reports no exposure settings, so the luminance path is in use. '
        + 'Every iOS browser lands here — WebKit exposes no track capabilities at all.'));
    }

    calBox.append(div('btnrow', [
      el('button', {
        type: 'button', class: 'btn primary', text: calibrated ? 'Re-calibrate' : 'Calibrate',
        attrs: { 'aria-label': `${calibrated ? 'Re-calibrate' : 'Calibrate'} this device, camera, diffuser and path` },
        on: { click: openCalibration },
      }),
      calibrated ? el('button', {
        type: 'button', class: 'btn danger', text: 'Clear profile',
        attrs: { 'aria-label': 'Clear this calibration profile' },
        on: {
          click: () => {
            store.removeCalibration(profile.key);
            announce('Calibration cleared. Relative stops only.');
            render();
          },
        },
      }) : null,
    ]));
  }

  function openCalibration() {
    if (!stream) { announce('Start the meter before calibrating.'); return; }

    openDialog({
      title: 'Calibrate this meter',
      build: ({ close }) => {
        const wrapC = div('');
        wrapC.append(el('ol', {}, [
          el('li', { text: 'Put a grey card under even light.' }),
          el('li', { text: 'Meter it with the Z50 II and note the aperture, shutter and ISO it chose.' }),
          el('li', { text: 'Hold this device where the card is, lens facing the light, diffuser on.' }),
          el('li', { text: 'Enter the camera’s settings below and save.' }),
        ]));

        let camN = 5.6, camT = 1 / 125, camIso = 100, devN = deviceAperture();

        wrapC.append(groupField('Camera aperture', chips({
          label: 'Camera aperture', options: F_NUMBERS.filter((f) => f <= 32), value: camN,
          format: (v) => `f/${v}`, onSelect: (v) => { camN = v; },
        })));
        wrapC.append(groupField('Camera shutter', chips({
          label: 'Camera shutter', options: SHUTTER_TIMES.filter((t) => t <= 30), value: camT,
          format: (v) => formatShutter(v).replace(' s', ''), onSelect: (v) => { camT = v; },
        })));
        wrapC.append(groupField('Camera ISO', chips({
          label: 'Camera ISO', options: ISO_VALUES.filter((i) => i <= 6400), value: camIso,
          format: (v) => String(v), onSelect: (v) => { camIso = v; },
        })));

        if (path === 'A') {
          const nInput = el('input', {
            type: 'number', inputMode: 'decimal', value: String(devN),
            attrs: { step: '0.1', min: '0.8', max: '16', 'aria-label': 'This device’s fixed lens aperture' },
            on: { change: (e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) devN = v; } },
          });
          wrapC.append(groupField('This device’s lens aperture', div('', [nInput]),
            'A phone camera has a fixed aperture — look it up once for this device. '
            + 'Path A needs it because the track reports only shutter and ISO.'));
        }

        const result = p('hint', '');
        wrapC.append(result);

        const saveBtn = el('button', {
          type: 'button', class: 'btn primary', text: 'Take reading and save',
          attrs: { 'aria-label': 'Take a reading now and save the calibration profile' },
          on: {
            click: () => {
              const avg = averaged();
              if (!avg) { result.textContent = 'No reading yet — wait a moment and try again.'; return; }
              const nominal = DIFFUSERS[diffuser].C;
              const cameraEv = ev100({ fNumber: camN, shutterSec: camT, iso: camIso });

              let constant;
              if (path === 'A') {
                const s = history[history.length - 1].raw;
                constant = solvePathAConstant({
                  nominalC: nominal,
                  camera: { fNumber: camN, shutterSec: camT, iso: camIso },
                  device: { fNumber: devN, shutterSec: s.shutterSec, iso: s.iso },
                });
              } else {
                constant = solvePathBConstant({ cameraEv, meanLuminance: avg.Y });
              }

              if (!Number.isFinite(constant)) {
                result.textContent = 'That reading did not produce a usable constant. Try again under steadier light.';
                return;
              }
              store.saveCalibration({
                facing, diffuser, path, constant,
                deviceApertureN: path === 'A' ? devN : null,
              });
              announce('Calibration saved. Absolute readings are now available for this combination.');
              close();
              render();
            },
          },
        });
        wrapC.append(div('btnrow', [saveBtn]));
        wrapC.append(p('hint',
          'The profile is saved against this device, this camera, this diffuser and this '
          + 'measurement path. Changing any one of them needs its own calibration.'));
        return wrapC;
      },
    });
  }

  function openImproviseHelp() {
    openDialog({
      title: 'Improvising a diffuser',
      build: () => div('', Object.values(DIFFUSERS).map((d) => div('card', [
        el('h3', { text: d.label }),
        el('p', { text: d.improvise }),
        el('p', { class: 'hint', text: `${d.reads} ${d.for}` }),
      ]))),
    });
  }

  render();
  return wrap;
}
