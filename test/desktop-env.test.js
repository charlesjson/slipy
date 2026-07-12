'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectEnvironment } = require('../src/main/desktop-env');

test('detects KDE on Wayland', () => {
  const env = detectEnvironment({ XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'KDE' });
  assert.equal(env.sessionType, 'wayland');
  assert.equal(env.desktop, 'kde');
  assert.equal(env.isWayland, true);
});

test('detects GNOME variants from ubuntu desktop string', () => {
  const env = detectEnvironment({ XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' });
  assert.equal(env.desktop, 'gnome');
});

test('socket variables beat XDG_CURRENT_DESKTOP', () => {
  const env = detectEnvironment({ XDG_CURRENT_DESKTOP: 'wlroots', HYPRLAND_INSTANCE_SIGNATURE: 'abc' });
  assert.equal(env.desktop, 'hyprland');
  const sway = detectEnvironment({ SWAYSOCK: '/run/sway.sock' });
  assert.equal(sway.desktop, 'sway');
});

test('falls back to display variables when session type is missing', () => {
  assert.equal(detectEnvironment({ WAYLAND_DISPLAY: 'wayland-0' }).sessionType, 'wayland');
  assert.equal(detectEnvironment({ DISPLAY: ':0' }).sessionType, 'x11');
  assert.equal(detectEnvironment({}).sessionType, 'unknown');
});

test('unknown desktop stays unknown', () => {
  assert.equal(detectEnvironment({ XDG_SESSION_TYPE: 'x11', XDG_CURRENT_DESKTOP: 'weston' }).desktop, 'unknown');
});
