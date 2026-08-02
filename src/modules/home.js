// home.js — the module grid (spec §5, §9: "one tap to any tool").

import { el, div, h, p } from '../ui/dom.js';
import { navigate } from '../router.js';
import * as store from '../store/state.js';

const TOOLS = [
  { path: '/dof', name: 'Depth of field', sub: 'Near, far, total, hyperfocal' },
  { path: '/exposure', name: 'Exposure', sub: 'Triangle solver, stop difference' },
  { path: '/nd', name: 'ND & long exposure', sub: 'Stacked filters, countdown' },
  { path: '/diffraction', name: 'Diffraction', sub: 'Airy disk against your CoC' },
  { path: '/sunmoon', name: 'Sun & moon', sub: 'Twilight, golden hour, phase' },
  { path: '/meter', name: 'Light meter', sub: 'Incident, needs calibration' },
  { path: '/wildlife', name: 'Wildlife', sub: 'Reach, framing, shutter floor' },
  { path: '/macro', name: 'Macro', sub: 'Tubes, magnification, stacking' },
  { path: '/infrared', name: 'Infrared', sub: 'IR body only', irOnly: true },
];

export function renderHome() {
  const body = store.activeBody();
  const wrap = div('');

  wrap.append(h(1, 'Photo Field Tools'));
  wrap.append(p('lede',
    'Capture-time calculators for the Z50 pair. Everything runs on this device, '
    + 'offline, and nothing is sent anywhere.'));

  const grid = div('tiles');
  for (const t of TOOLS) {
    // Spec §5.9: the infrared module is ACTIVE ONLY when the IR body profile is
    // selected. It stays visible but disabled, saying why — a tool that
    // vanishes reads as a bug, and §3 requires modes to announce themselves.
    const disabled = t.irOnly && !body.infrared;
    const tile = el('button', {
      type: 'button',
      class: 'tile',
      attrs: {
        'aria-disabled': disabled ? 'true' : null,
        'aria-label': disabled
          ? `${t.name} — unavailable. Select the IR converted body to use it.`
          : `${t.name} — ${t.sub}`,
      },
      on: {
        click: () => {
          if (disabled) return;
          navigate(t.path);
        },
      },
    }, [
      div('t-name', [t.name]),
      div('t-sub', [disabled ? 'Select the IR body to use it' : t.sub]),
    ]);
    grid.append(tile);
  }
  wrap.append(grid);

  const admin = div('tiles');
  admin.append(el('button', {
    type: 'button', class: 'tile',
    attrs: { 'aria-label': 'Gear — lenses, extension tubes, teleconverters' },
    on: { click: () => navigate('/gear') },
  }, [div('t-name', ['Gear']), div('t-sub', ['Lenses, tubes, teleconverters'])]));
  admin.append(el('button', {
    type: 'button', class: 'tile',
    attrs: { 'aria-label': 'Settings — backup, restore, about' },
    on: { click: () => navigate('/settings') },
  }, [div('t-name', ['Settings']), div('t-sub', ['Backup, restore, about'])]));
  wrap.append(admin);

  if (!store.getState().lenses.length) {
    wrap.append(div('card', [
      h(2, 'Start by adding a lens'),
      p('', 'The lens list is empty on purpose — no gear is invented for you. '
           + 'Most tools work without one, but reach, VR floors, working distance '
           + 'and the hotspot matrix all key off a lens.'),
      el('button', {
        type: 'button', class: 'btn primary', text: 'Add a lens',
        on: { click: () => navigate('/gear') },
      }),
    ]));
  }

  return wrap;
}
