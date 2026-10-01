'use strict';

/**
 * Detects the graphics session and desktop family from environment variables.
 * Pure function of `env` so every combination is unit-testable.
 */
function detectEnvironment(env = process.env) {
  const sessionType = normalizeSessionType(env);
  const desktop = normalizeDesktop(env);
  return {
    sessionType,
    desktop,
    isWayland: sessionType === 'wayland',
    raw: {
      sessionType: env.XDG_SESSION_TYPE || '',
      currentDesktop: env.XDG_CURRENT_DESKTOP || ''
    }
  };
}

function normalizeSessionType(env) {
  const explicit = (env.XDG_SESSION_TYPE || '').toLowerCase();
  if (explicit === 'wayland' || explicit === 'x11') return explicit;
  if (env.WAYLAND_DISPLAY) return 'wayland';
  if (env.DISPLAY) return 'x11';
  return 'unknown';
}

function normalizeDesktop(env) {
  // Socket variables are the most reliable signal for wlroots compositors.
  if (env.HYPRLAND_INSTANCE_SIGNATURE) return 'hyprland';
  if (env.SWAYSOCK) return 'sway';

  const families = [
    ['hyprland', 'hyprland'], ['sway', 'sway'],
    ['kde', 'kde'], ['plasma', 'kde'], ['kubuntu', 'kde'],
    ['cinnamon', 'cinnamon'], ['x-cinnamon', 'cinnamon'],
    ['xfce', 'xfce'], ['xubuntu', 'xfce'], ['mate', 'mate'],
    ['lxqt', 'lxqt'], ['lxde', 'lxde'], ['lubuntu', 'lxqt'],
    ['budgie', 'budgie'], ['cosmic', 'cosmic'], ['deepin', 'deepin'], ['dde', 'deepin'],
    // Specific variants must win over shared GNOME/Ubuntu session labels.
    ['gnome', 'gnome'], ['unity', 'gnome'], ['pantheon', 'gnome'], ['ubuntu', 'gnome']
  ];
  for (const source of [env.XDG_CURRENT_DESKTOP, env.XDG_SESSION_DESKTOP, env.DESKTOP_SESSION]) {
    const names = String(source || '').toLowerCase();
    for (const [needle, family] of families) {
      if (names.includes(needle)) return family;
    }
  }
  return 'unknown';
}

module.exports = { detectEnvironment };
