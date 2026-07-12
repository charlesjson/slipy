'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { actionCandidates, workspaceCandidates } = require('../src/main/action-backends');

const kdeWayland = { sessionType: 'wayland', desktop: 'kde', isWayland: true };
const gnomeWayland = { sessionType: 'wayland', desktop: 'gnome', isWayland: true };
const hyprland = { sessionType: 'wayland', desktop: 'hyprland', isWayland: true };
const x11 = { sessionType: 'x11', desktop: 'xfce', isWayland: false };

test('KDE Wayland workspace switch goes through KWin DBus first', () => {
  const [first] = workspaceCandidates(1, kdeWayland);
  assert.equal(first.command, 'gdbus');
  assert.ok(first.args.includes('org.kde.KWin.nextDesktop'));
});

test('GNOME Wayland workspace switch validates Eval output and keeps ydotool fallback', () => {
  const candidates = workspaceCandidates(-1, gnomeWayland);
  assert.equal(candidates[0].command, 'gdbus');
  assert.ok(candidates[0].expect.test("(true, '')"));
  assert.ok(!candidates[0].expect.test("(false, '')"));
  assert.ok(candidates.some((c) => c.command === 'ydotool'));
});

test('Hyprland uses hyprctl relative workspace dispatch', () => {
  const [first] = workspaceCandidates(1, hyprland);
  assert.deepEqual([first.command, ...first.args], ['hyprctl', 'dispatch', 'workspace', 'e+1']);
});

test('X11 keeps the wmctrl cycle strategy before xdotool', () => {
  const candidates = workspaceCandidates(1, x11);
  assert.equal(typeof candidates[0].run, 'function');
  assert.equal(candidates.at(-1).command, 'xdotool');
});

test('wmctrl cycle computes the wrapped target desktop', async () => {
  const calls = [];
  const candidates = workspaceCandidates(1, x11);
  await candidates[0].run({
    exec: async () => '0  -\n1  *\n', // two desktops, second active
    detached: async (command, args) => calls.push([command, args])
  });
  assert.deepEqual(calls, [['wmctrl', ['-s', '0']]]);
});

test('ydotool leads generic injection on Wayland, xdotool on X11', () => {
  assert.equal(actionCandidates('window-next', { desktop: 'unknown', isWayland: true })[0].command, 'ydotool');
  assert.equal(actionCandidates('window-next', x11)[0].command, 'xdotool');
});

test('volume actions are desktop-agnostic and unknown actions return null', () => {
  assert.equal(actionCandidates('volume-up', kdeWayland)[0].command, 'wpctl');
  assert.equal(actionCandidates('nope', kdeWayland), null);
});
