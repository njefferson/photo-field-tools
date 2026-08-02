// router.js — hash routing.
//
// HASH, not history. This app is served as static files and must also run from
// a service-worker cache with no server to rewrite paths. A history router
// needs a server-side catch-all; a hash router needs nothing and cannot 404
// after a cold offline reload — which is precisely the state acceptance §11.1
// requires to work.

const routes = new Map();
let notFound = null;
let onNavigate = null;

export function defineRoute(path, render) {
  routes.set(path, render);
}

export function setNotFound(render) { notFound = render; }
export function setOnNavigate(fn) { onNavigate = fn; }

export function currentPath() {
  const raw = location.hash.replace(/^#/, '');
  return raw && raw.startsWith('/') ? raw : '/';
}

export function navigate(path) {
  if (currentPath() === path) { render(); return; }
  location.hash = path;
}

export function render() {
  const path = currentPath();
  const [base] = path.split('?');
  const view = routes.get(base) || notFound;
  const main = document.getElementById('main');
  if (!main || !view) return;

  while (main.firstChild) main.removeChild(main.firstChild);
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  try {
    const node = view({ path, params: parseQuery(path) });
    if (node) wrap.append(node);
  } catch (err) {
    // A module that throws must not leave a blank screen with no way back —
    // Doctrine §5: every failure explains itself and offers a way forward.
    console.error('route failed', base, err);
    const box = document.createElement('div');
    box.className = 'warnbox';
    box.textContent = `This tool failed to open: ${err.message}`;
    wrap.append(box);
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn';
    back.textContent = 'Back to all tools';
    back.addEventListener('click', () => navigate('/'));
    wrap.append(back);
  }
  main.append(wrap);
  main.scrollTop = 0;
  if (onNavigate) onNavigate(base);
}

function parseQuery(path) {
  const q = path.split('?')[1];
  if (!q) return {};
  return Object.fromEntries(new URLSearchParams(q).entries());
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  render();
}
