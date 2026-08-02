// dom.js — element builders.
//
// DOCTRINE §16.7: never build HTML by concatenation where textContent will do.
// Interpolating into innerHTML is safe only while every input is a literal you
// wrote, and that condition expires quietly — the first `&` or `<` in a lens
// name mis-renders, and the first value from anywhere else is an injection.
// Every text value in this app goes through textContent. innerHTML is used in
// exactly one place, icon(), for inert SVG constants we authored.

/**
 * Build an element.
 * @param {string} tag
 * @param {object} [props] className, text, attrs, on, style, and any direct
 *        property assignment (value, checked, type…)
 * @param {Array<Node|string|null|undefined>} [children]
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class' || k === 'className') node.className = v;
    else if (k === 'text') node.textContent = v;            // never innerHTML
    else if (k === 'attrs') for (const [a, av] of Object.entries(v)) {
      if (av != null && av !== false) node.setAttribute(a, av === true ? '' : String(av));
    }
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else if (k === 'style') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node[k] = v;
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(typeof c === 'string' || typeof c === 'number' ? String(c) : c);
  }
  return node;
}

export const div = (cls, children = [], props = {}) => el('div', { class: cls, ...props }, children);
export const span = (cls, text) => el('span', { class: cls, text });
export const p = (cls, text) => el('p', { class: cls, text });
export const h = (level, text, props = {}) => el(`h${level}`, { text, ...props });

/**
 * Inert SVG we authored — the ONE sanctioned innerHTML in the app.
 * Never accepts anything derived from user data.
 */
export function icon(markup, label) {
  const s = document.createElement('span');
  s.className = 'ico';
  if (label) s.setAttribute('aria-label', label);
  else s.setAttribute('aria-hidden', 'true');
  s.innerHTML = markup;
  return s;
}

/** Replace a node's children in one shot. */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(node, ...children) {
  clear(node);
  for (const c of children.flat()) if (c) node.append(c);
  return node;
}

/**
 * A labelled readout. `note` carries the secondary line the spec keeps asking
 * for — the exact value behind a snapped one, the approximation warning, the
 * model that produced a number.
 */
export function readout(key, value, note, opts = {}) {
  return div('ro', [
    span('k', key),
    el('span', { class: opts.small ? 'v sm' : 'v', text: value }),
    note ? span('n', note) : null,
  ]);
}

/**
 * The provenance line required by acceptance §11.2 — which CoC basis and which
 * wavelength produced the numbers above it.
 *
 * It is a FUNCTION rather than a copied string so it cannot drift between
 * modules, and so a module that forgets it is visibly missing something rather
 * than quietly showing an unattributed number.
 */
export function basisLine({ cocBasis, wavelengthNm, model, extra }) {
  const bits = [];
  const line = div('basis');
  line.append('Circle of confusion: ');
  line.append(el('b', { text: `${cocBasis.label} (${(cocBasis.mm * 1000).toFixed(3)} µm)` }));
  if (wavelengthNm != null) {
    line.append(' · Wavelength: ');
    line.append(el('b', { text: `${wavelengthNm} nm` }));
  }
  if (model) {
    line.append(' · Model: ');
    line.append(el('b', { text: model }));
  }
  if (extra) bits.push(extra);
  for (const b of bits) { line.append(' · '); line.append(b); }
  return line;
}

/** A caveat block — an approximation or an unverified claim, said out loud. */
export function caveat(strongText, rest) {
  const node = div('caveat');
  if (strongText) node.append(el('strong', { text: strongText }), ' ');
  if (rest) node.append(rest);
  return node;
}

export function warnBox(text) {
  return div('warnbox', [text]);
}

export const empty = (text) => div('empty', [text]);

/** A section card with a heading. */
export function card(title, children, opts = {}) {
  const c = div('card', [], opts.id ? { id: opts.id } : {});
  if (title) c.append(h(2, title));
  for (const ch of [children].flat()) if (ch) c.append(ch);
  return c;
}

export function field(labelText, control, hintText) {
  const id = control.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  const wrap = div('field');
  wrap.append(el('label', { text: labelText, attrs: { for: id } }));
  wrap.append(control);
  if (hintText) wrap.append(p('hint', hintText));
  return wrap;
}

/**
 * A field whose control is a GROUP (chips, stepper) rather than a single
 * labellable input. Uses a real group role with an accessible name instead of
 * a <label>, which cannot label a group.
 */
export function groupField(labelText, control, hintText) {
  const wrap = div('field');
  const lab = div('field-label', [labelText]);
  lab.id = `gl-${Math.random().toString(36).slice(2, 9)}`;
  control.setAttribute('role', control.getAttribute('role') || 'group');
  control.setAttribute('aria-labelledby', lab.id);
  wrap.append(lab, control);
  if (hintText) wrap.append(p('hint', hintText));
  return wrap;
}
