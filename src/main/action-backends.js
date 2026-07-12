'use strict';

/**
 * Ordered command candidates for every desktop action, specialised per
 * environment. Each candidate is one of:
 *   { command, args }           — run detached, success = exit code 0
 *   { command, args, expect }   — run captured, success = stdout matches
 *   { run(tools) }              — custom strategy using { exec, detached }
 *
 * The executor walks the list until one candidate succeeds, so entries are
 * sorted: native compositor APIs first, generic input injection last.
 */

// Linux input-event keycodes used by ydotool (uinput works on any compositor,
// but requires the ydotoold daemon).
const KEY = { ctrl: 29, alt: 56, shift: 42, super: 125, tab: 15, d: 32, left: 105, right: 106 };

function ydoKey(...codes) {
  const press = codes.map((code) => `${code}:1`);
  const release = [...codes].reverse().map((code) => `${code}:0`);
  return { command: 'ydotool', args: ['key', ...press, ...release] };
}

function gnomeShellEval(script) {
  return {
    command: 'gdbus',
    args: ['call', '--session', '--dest', 'org.gnome.Shell',
      '--object-path', '/org/gnome/Shell', '--method', 'org.gnome.Shell.Eval', script],
    // Locked-down Eval (GNOME ≥ 41 without unsafe mode) still exits 0 but
    // prints "(false, '')", so success must be read from stdout.
    expect: /\(true/
  };
}

function kwin(method) {
  return {
    command: 'gdbus',
    args: ['call', '--session', '--dest', 'org.kde.KWin', '--object-path', '/KWin',
      '--method', `org.kde.KWin.${method}`]
  };
}

function kdeShortcut(name) {
  return {
    command: 'gdbus',
    args: ['call', '--session', '--dest', 'org.kde.kglobalaccel',
      '--object-path', '/component/kwin',
      '--method', 'org.kde.kglobalaccel.Component.invokeShortcut', name]
  };
}

function gnomeWorkspaceEval(delta) {
  const step = delta > 0 ? '(i + 1) % n' : '(i - 1 + n) % n';
  return gnomeShellEval(
    '(() => { const wm = global.workspace_manager; const n = wm.get_n_workspaces(); ' +
    `const i = wm.get_active_workspace_index(); wm.get_workspace_by_index(${step})` +
    '.activate(global.get_current_time()); return true; })()'
  );
}

// EWMH cycle used on X11: read the desktop list, activate the neighbour.
function wmctrlCycle(delta) {
  return {
    async run({ exec, detached }) {
      const output = await exec('wmctrl', ['-d']);
      const desktops = output.trim().split('\n').filter(Boolean);
      const current = desktops.findIndex((line) => /^\s*\d+\s+\*/.test(line));
      if (current < 0 || desktops.length < 2) throw new Error(require('./i18n').t('error.noWorkspaces'));
      const target = (current + delta + desktops.length) % desktops.length;
      await detached('wmctrl', ['-s', String(target)]);
    }
  };
}

function xdo(...keys) {
  return { command: 'xdotool', args: ['key', ...keys] };
}

function workspaceCandidates(delta, env) {
  const arrow = delta > 0 ? 'right' : 'left';
  const list = [];
  if (env.desktop === 'hyprland') list.push({ command: 'hyprctl', args: ['dispatch', 'workspace', delta > 0 ? 'e+1' : 'e-1'] });
  if (env.desktop === 'sway') list.push({ command: 'swaymsg', args: ['workspace', delta > 0 ? 'next_on_output' : 'prev_on_output'] });
  if (env.desktop === 'kde') list.push(kwin(delta > 0 ? 'nextDesktop' : 'previousDesktop'));
  if (env.desktop === 'gnome') list.push(gnomeWorkspaceEval(delta));
  if (env.isWayland) {
    // Ctrl+Alt+arrow switches workspaces on GNOME, Cinnamon and XFCE defaults.
    list.push(ydoKey(KEY.ctrl, KEY.alt, KEY[arrow]));
  }
  list.push(wmctrlCycle(delta), xdo(delta > 0 ? 'ctrl+alt+Right' : 'ctrl+alt+Left'));
  return list;
}

function actionCandidates(action, env) {
  const wayland = env.isWayland;
  const byDesktop = {
    'window-next': {
      hyprland: [{ command: 'hyprctl', args: ['dispatch', 'cyclenext'] }],
      kde: [kdeShortcut('Walk Through Windows')]
    },
    'window-prev': {
      hyprland: [{ command: 'hyprctl', args: ['dispatch', 'cyclenext', 'prev'] }],
      kde: [kdeShortcut('Walk Through Windows (Reverse)')]
    },
    overview: {
      kde: [kdeShortcut('Overview')],
      // FocusSearch opens the Activities overview and is allowed even when
      // Eval is locked down.
      gnome: [{ command: 'gdbus', args: ['call', '--session', '--dest', 'org.gnome.Shell', '--object-path', '/org/gnome/Shell', '--method', 'org.gnome.Shell.FocusSearch'] }]
    },
    'show-desktop': {
      kde: [kdeShortcut('Show Desktop')],
      gnome: [gnomeShellEval('(() => { global.workspace_manager.get_active_workspace().list_windows().forEach((w) => w.minimize()); return true; })()')]
    }
  };
  const generic = {
    'volume-up': [{ command: 'wpctl', args: ['set-volume', '@DEFAULT_AUDIO_SINK@', '5%+'] }, { command: 'pactl', args: ['set-sink-volume', '@DEFAULT_SINK@', '+5%'] }],
    'volume-down': [{ command: 'wpctl', args: ['set-volume', '@DEFAULT_AUDIO_SINK@', '5%-'] }, { command: 'pactl', args: ['set-sink-volume', '@DEFAULT_SINK@', '-5%'] }],
    'brightness-up': [{ command: 'brightnessctl', args: ['set', '+5%'] }],
    'brightness-down': [{ command: 'brightnessctl', args: ['set', '5%-'] }],
    'media-play-pause': [{ command: 'playerctl', args: ['play-pause'] }],
    'media-next': [{ command: 'playerctl', args: ['next'] }],
    'media-prev': [{ command: 'playerctl', args: ['previous'] }],
    'window-next': wayland ? [ydoKey(KEY.alt, KEY.tab), xdo('alt+Tab')] : [xdo('alt+Tab'), ydoKey(KEY.alt, KEY.tab)],
    'window-prev': wayland ? [ydoKey(KEY.alt, KEY.shift, KEY.tab), xdo('alt+shift+Tab')] : [xdo('alt+shift+Tab'), ydoKey(KEY.alt, KEY.shift, KEY.tab)],
    overview: wayland ? [ydoKey(KEY.super), xdo('super')] : [xdo('super'), ydoKey(KEY.super)],
    'show-desktop': wayland ? [ydoKey(KEY.super, KEY.d), xdo('super+d')] : [xdo('super+d'), { command: 'wmctrl', args: ['-k', 'on'] }]
  };
  if (!generic[action]) return null;
  return [...(byDesktop[action]?.[env.desktop] || []), ...generic[action]];
}

module.exports = { actionCandidates, workspaceCandidates };
