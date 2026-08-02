// nd.js — spec §5.3 ND and long exposure.
//
// "Base exposure in, ND stops in, resulting time out, with a countdown timer
// for the computed duration that survives screen lock via a wake lock request."

import { el, div, h, p, card, readout, groupField } from '../ui/dom.js';
import { chips } from '../ui/controls.js';
import { SHUTTER_TIMES, ND_FILTERS } from '../core/constants.js';
import { ndTime, ndStackStops } from '../core/exposure.js';
import { formatShutter, formatDuration, formatClock, round } from '../core/units.js';
import { announce } from '../ui/live.js';
import { onLeave } from '../main.js';

export function renderNd() {
  let baseShutter = 1 / 125;
  /** Selected filters, by index into ND_FILTERS. Stacking sums the stops. */
  const stack = new Set();
  let extraStops = 0;

  const wrap = div('');
  wrap.append(h(1, 'ND & long exposure'));

  const out = div('');
  const timerBox = div('');

  const box = card('Base exposure', []);
  box.append(groupField('Metered shutter, no filter', chips({
    label: 'Base shutter',
    options: SHUTTER_TIMES.filter((t) => t <= 30),
    value: baseShutter,
    format: (v) => formatShutter(v).replace(' s', ''),
    onSelect: (v) => { baseShutter = v; compute(); },
  })));

  const filterBox = card('Filters', [
    p('lede', 'Stacked filters sum their stops. Tap to add or remove.'),
  ]);
  const filterRow = div('chips');
  ND_FILTERS.forEach((f, i) => {
    const b = el('button', {
      type: 'button', class: 'chip', text: f.label,
      attrs: { 'aria-pressed': 'false', 'aria-label': `${f.label}, ${stack.has(i) ? 'selected' : 'not selected'}` },
      on: {
        click: () => {
          if (stack.has(i)) stack.delete(i); else stack.add(i);
          b.setAttribute('aria-pressed', String(stack.has(i)));
          b.setAttribute('aria-label', `${f.label}, ${stack.has(i) ? 'selected' : 'not selected'}`);
          compute();
        },
      },
    });
    filterRow.append(b);
  });
  filterBox.append(groupField('ND filters', filterRow));

  const extraInput = el('input', {
    type: 'number', inputMode: 'decimal', value: '0',
    attrs: { step: '0.1', min: '0', max: '30', 'aria-label': 'Additional stops' },
    on: { change: (e) => { const v = Number(e.target.value); extraStops = Number.isFinite(v) ? v : 0; compute(); } },
  });
  filterBox.append(groupField('Additional stops', div('', [extraInput]),
    'For a filter not in the list, or a polariser’s loss.'));

  function totalStops() {
    return ndStackStops([...stack].map((i) => ND_FILTERS[i].stops)) + extraStops;
  }

  function compute() {
    const stops = totalStops();
    const t = ndTime(baseShutter, stops);
    while (out.firstChild) out.removeChild(out.firstChild);

    out.append(div('readout', [
      readout('Exposure', t >= 60 ? formatDuration(t) : formatShutter(t),
        stops ? `${round(stops, 2)} stops of filtration` : 'No filtration'),
      readout('Total ND', `${round(stops, 2)} stops`,
        stack.size ? `${stack.size} filter${stack.size === 1 ? '' : 's'} stacked` : null, { small: true }),
    ]));

    buildTimer(t);
  }

  /* ---------------- countdown ---------------- */

  let ticker = null;
  let wakeLock = null;
  let endsAt = null;

  // Leaving the module must stop the clock and release the lock — a leaked
  // wake lock keeps someone's screen on until they notice.
  onLeave(() => { stopTimer(); releaseWakeLock(); });

  function buildTimer(durationSec) {
    while (timerBox.firstChild) timerBox.removeChild(timerBox.firstChild);
    if (!(durationSec > 1)) {
      timerBox.append(card('Countdown', [
        p('hint', 'The countdown appears once the exposure is longer than a second.'),
      ]));
      return;
    }

    const display = div('count-big', [formatClock(durationSec)]);
    // The clock is a status, not a focus target: it updates through a live
    // region only at meaningful moments, not every tick, which would flood a
    // screen reader (SC 4.1.3 done badly is worse than not done).
    display.setAttribute('aria-hidden', 'true');

    const startBtn = el('button', {
      type: 'button', class: 'btn primary', text: 'Start',
      attrs: { 'aria-label': `Start the ${formatDuration(durationSec)} countdown` },
      on: { click: () => start(durationSec, display, startBtn, stopBtn) },
    });
    const stopBtn = el('button', {
      type: 'button', class: 'btn', text: 'Stop', disabled: true,
      attrs: { 'aria-label': 'Stop the countdown' },
      on: {
        click: () => {
          stopTimer(); releaseWakeLock();
          display.textContent = formatClock(durationSec);
          startBtn.disabled = false; stopBtn.disabled = true;
          announce('Countdown stopped.');
        },
      },
    });

    const c = card('Countdown', [
      display,
      p('hint', `Full length ${formatDuration(durationSec)}. The screen is kept awake while it runs, where the browser allows it.`),
      div('btnrow', [startBtn, stopBtn]),
    ]);
    timerBox.append(c);
  }

  function start(durationSec, display, startBtn, stopBtn) {
    stopTimer();
    endsAt = Date.now() + durationSec * 1000;
    startBtn.disabled = true; stopBtn.disabled = false;
    requestWakeLock();
    announce(`Countdown started, ${formatDuration(durationSec)}.`);
    const tick = () => {
      const left = (endsAt - Date.now()) / 1000;
      if (left <= 0) {
        display.textContent = '00:00';
        stopTimer(); releaseWakeLock();
        startBtn.disabled = false; stopBtn.disabled = true;
        announce('Exposure finished.');
        return;
      }
      display.textContent = formatClock(left);
    };
    tick();
    // Driven off wall-clock time, not an accumulated tick count, so a throttled
    // background tab cannot make a 4-minute exposure read as 6.
    ticker = setInterval(tick, 250);
  }

  function stopTimer() {
    if (ticker) { clearInterval(ticker); ticker = null; }
    endsAt = null;
  }

  async function requestWakeLock() {
    // Screen wake lock is unavailable on several browsers, notably older iOS.
    // Its absence must not break the timer, and it is never claimed to be
    // working when it is not — the hint below says "where the browser allows".
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) {
      wakeLock = null;
      console.info('wake lock unavailable', err && err.message);
    }
  }

  function releaseWakeLock() {
    if (wakeLock) { try { wakeLock.release(); } catch (e) { /* already gone */ } wakeLock = null; }
  }

  wrap.append(box, filterBox, out, timerBox);
  compute();
  return wrap;
}
