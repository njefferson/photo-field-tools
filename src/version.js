// version.js — THE single source of the running version (Doctrine §7b).
//
// Never typed twice. The on-screen build stamp, the service-worker cache name
// and the changelog all read this one constant, so a stale cache shows a
// version that disagrees with the code and becomes VISIBLE rather than
// mysterious — which is the specific failure §7b exists to make diagnosable.
//
// Numbering is version.capability.iteration (Doctrine §7). NOAH DECIDES what
// counts as a VERSION; this stays at 0 until he says otherwise.
export const VERSION = '0.1.0';

/** Build stamp text. Written at BOOT, never when a panel opens (§7b). */
export const BUILD_STAMP = `v${VERSION}`;
