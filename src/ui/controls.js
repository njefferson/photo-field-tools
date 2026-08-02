// controls.js — steppers, chips, dialogs.
//
// Spec §9: "Numeric inputs use steppers and preset chips for standard values
// rather than raw keyboards where possible." Gloves, one hand, bright sun.
//
// Doctrine §4 tremor rules are implemented here rather than remembered per
// module: nothing commits on pointer-down, no timed gestures, no drag without
// a non-drag path, and a control never changes size when it is used.

import { el, div, span } from './dom.js';

/* ------------------------------------------------------------------ *
 * Stepper
 * ------------------------------------------------------------------ */

/**
 * A numeric field with − and + buttons either side.
 *
 * The buttons act on CLICK (pointer-up), never pointer-down: tremor produces
 * spurious downs, and a down-triggered control fires every one of them
 * (SC 2.5.2). There is no press-and-hold repeat for the same reason —
 * SC 2.2.1 forbids an action on a timer.
 *
 * @param {object} o
 * @param {number} o.value
 * @param {number} [o.min] @param {number} [o.max] @param {number} [o.step]
 * @param {(v:number)=>void} o.onChange
 * @param {string} o.label used to name the two buttons distinctly — Doctrine
 *        §4 forbids two controls answering to the same name on one surface.
 */
export function stepper({ value, min = -Infinity, max = Infinity, step = 1, decimals = 0, onChange, label, suffix }) {
  const input = el('input', {
    type: 'number',
    value: fmt(value, decimals),
    inputMode: decimals > 0 ? 'decimal' : 'numeric',
    attrs: {
      min: Number.isFinite(min) ? min : null,
      max: Number.isFinite(max) ? max : null,
      step,
      // The stepper's own field is a form control and needs its own name — the
      // group label around it does NOT name it (axe: "Form elements must have
      // labels", critical). Distinct from the two buttons' names, so no two
      // controls here answer to the same thing.
      'aria-label': label,
    },
  });

  const clampSet = (v) => {
    const n = Math.min(max, Math.max(min, v));
    const rounded = Number(n.toFixed(decimals));
    input.value = fmt(rounded, decimals);
    onChange(rounded);
    sync();
  };

  const minus = el('button', {
    type: 'button', class: 'step-btn', text: '−',
    // Each button names WHAT it steps, so no two controls on the screen share
    // an accessible name.
    attrs: { 'aria-label': `Decrease ${label}` },
    on: { click: () => clampSet(readValue() - step) },
  });
  const plus = el('button', {
    type: 'button', class: 'step-btn', text: '+',
    attrs: { 'aria-label': `Increase ${label}` },
    on: { click: () => clampSet(readValue() + step) },
  });

  const readValue = () => {
    const n = Number(input.value);
    return Number.isFinite(n) ? n : value;
  };

  input.addEventListener('change', () => clampSet(readValue()));
  // A blank field must not silently become 0 while the user is mid-edit; it is
  // only normalised on change/blur, above.
  input.addEventListener('blur', () => { if (input.value === '') clampSet(value); });

  function sync() {
    const v = readValue();
    minus.disabled = v <= min;
    plus.disabled = v >= max;
  }

  const wrap = div('stepper', [minus, input, plus]);
  if (suffix) wrap.append(span('hint', suffix));
  wrap.setValue = (v) => { input.value = fmt(v, decimals); sync(); };
  wrap.input = input;
  sync();
  return wrap;
}

const fmt = (v, d) => (d > 0 ? Number(v).toFixed(d) : String(Math.round(v)));

/* ------------------------------------------------------------------ *
 * Chips
 * ------------------------------------------------------------------ */

/**
 * A row of preset chips. Exactly one selected at a time.
 *
 * DOCTRINE §4, "a control must not move when it is used": the selected state
 * changes colour and adds an underline, both of which are width-neutral. The
 * 2px border is present in BOTH states (transparent when unselected), so
 * pressing a chip cannot reflow the row under a finger already moving toward
 * where the next chip used to be.
 *
 * Selection is carried by aria-pressed AND an underline, never by colour
 * alone.
 */
export function chips({ options, value, onSelect, label, format }) {
  const row = div('chips');
  row.setAttribute('role', 'group');
  if (label) row.setAttribute('aria-label', label);

  const buttons = options.map((opt) => {
    const val = opt && typeof opt === 'object' ? opt.value : opt;
    const text = format ? format(val, opt) : (opt && typeof opt === 'object' ? opt.label : String(opt));
    const b = el('button', {
      type: 'button', class: 'chip', text,
      attrs: {
        'aria-pressed': String(sameValue(val, value)),
        // NO TWO CONTROLS ANSWER TO THE SAME NAME on one surface (Doctrine §4).
        // Exposure shows three shutter rows at once, so three buttons would
        // otherwise all be called "1/125" and "activate 1/125" would be a
        // three-way coin toss. Prefixing the group's name makes each unique,
        // and keeps the visible text inside the accessible name (SC 2.5.3).
        'aria-label': label ? `${label} ${text}` : null,
      },
      on: { click: () => { select(val); onSelect(val, opt); } },
    });
    b._value = val;
    return b;
  });

  function select(val) {
    for (const b of buttons) b.setAttribute('aria-pressed', String(sameValue(b._value, val)));
  }

  row.append(...buttons);
  row.select = select;
  return row;
}

const sameValue = (a, b) =>
  (typeof a === 'number' && typeof b === 'number') ? Math.abs(a - b) < 1e-9 : a === b;

/** A native select — always keyboard-operable, always the right width. */
export function select({ options, value, onChange, label }) {
  const s = el('select', {
    attrs: label ? { 'aria-label': label } : {},
    on: { change: (e) => onChange(e.target.value) },
  });
  for (const o of options) {
    const opt = el('option', { text: o.label, value: o.value });
    if (String(o.value) === String(value)) opt.selected = true;
    s.append(opt);
  }
  return s;
}

/** A labelled checkbox with a 48px hit area. */
export function toggle({ label, checked, onChange }) {
  const input = el('input', {
    type: 'checkbox', checked: !!checked,
    on: { change: (e) => onChange(e.target.checked) },
  });
  Object.assign(input.style, { width: '1.35rem', height: '1.35rem', minHeight: '0', flex: '0 0 auto' });
  const wrap = el('label', {
    class: 'row',
    style: { cursor: 'pointer' },
  }, [input, span('rtxt', label)]);
  wrap.input = input;
  return wrap;
}

/* ------------------------------------------------------------------ *
 * Dialogs
 * ------------------------------------------------------------------ */

/**
 * A modal that CANNOT trap the user (Doctrine §4, §14).
 *
 * THE WAY OUT IS WIRED FIRST — before the title, before the body, before
 * anything a caller passes in can throw. A panel whose close depends on its
 * content is a trap the moment the content fails, and §14 records a real one
 * whose close was attached ~490 lines into setup.
 *
 * Every requirement in §4's list is met here so no caller has to remember it:
 *  · a dismiss visible in the first frame, above the fold
 *  · a second dismiss at the bottom, where a reader who scrolled expects it
 *  · both reachable from anywhere, because the body scrolls between two
 *    non-scrolling bars rather than the whole panel scrolling
 *  · never conditional on finishing, agreeing or choosing anything
 *  · bounded in length by max-height in CSS, measured against the viewport
 *    the dialog actually opens into
 */
export function openDialog({ title, build, onClose, closeLabel = 'Close' }) {
  const dlg = el('dialog');
  const shell = div('dlg');

  // ---- the way out, first ------------------------------------------------
  const close = () => {
    if (dlg.open) dlg.close();
  };
  const headClose = el('button', {
    type: 'button', class: 'btn dlg-close', text: '✕',
    attrs: { 'aria-label': `${closeLabel} ${title}` },
    on: { click: close },
  });
  const footClose = el('button', {
    type: 'button', class: 'btn', text: closeLabel,
    // Two dismisses on one surface must not answer to the same name
    // (Doctrine §4). SC 2.5.3 also requires the visible word to appear in the
    // label, which "Close" does.
    attrs: { 'aria-label': `${closeLabel} ${title} (bottom of panel)` },
    on: { click: close },
  });
  dlg.addEventListener('cancel', close);           // Esc
  dlg.addEventListener('close', () => {
    dlg.remove();                                   // genuinely GONE, not just flagged
    if (onClose) { try { onClose(); } catch (e) { console.error(e); } }
  });

  const head = div('dlg-head', [el('h2', { text: title }), headClose]);
  const body = div('dlg-body');
  // A scrollable region must be keyboard-operable (axe: scrollable-region-
  // focusable, serious). A help panel of pure prose has nothing focusable in
  // it, so without this a keyboard user cannot scroll it at all.
  body.tabIndex = 0;
  body.setAttribute('role', 'group');
  body.setAttribute('aria-label', `${title} — panel content`);
  const foot = div('dlg-foot', [footClose]);
  shell.append(head, body, foot);
  dlg.append(shell);
  document.body.append(dlg);
  dlg.showModal();
  // Focus lands somewhere real and predictable.
  headClose.focus();

  // ---- content, only now, and failure here cannot trap anyone ------------
  try {
    const content = build({ close, footer: foot });
    if (content) body.append(...[content].flat().filter(Boolean));
  } catch (err) {
    console.error('dialog content failed', err);
    body.append(div('warnbox', [`This panel could not load: ${err.message}`]));
  }

  return { dialog: dlg, close, body, footer: foot };
}

/**
 * A confirm step for anything destructive (Doctrine §16.5: friction in
 * proportion to damage). Returns a promise resolving true/false.
 */
export function confirmDialog({ title, message, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    let answered = false;
    const { close, footer } = openDialog({
      title,
      closeLabel: 'Cancel',
      build: () => div('', [el('p', { text: message })]),
      onClose: () => { if (!answered) resolve(false); },
    });
    const go = el('button', {
      type: 'button', class: `btn ${danger ? 'danger' : 'primary'}`, text: confirmLabel,
      attrs: { 'aria-label': `${confirmLabel} — ${title}` },
      on: { click: () => { answered = true; resolve(true); close(); } },
    });
    // Doctrine §4 tremor: a destructive control never sits flush against a
    // routine one. The gate checks spacing, so this gap is load-bearing.
    footer.prepend(go);
    footer.style.gap = '1rem';
  });
}
