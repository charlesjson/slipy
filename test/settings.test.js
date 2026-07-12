'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeSettings, SettingsStore, closeChoiceFromDialog } = require('../src/main/settings');

test('normalizes limits, actions, shortcuts and plugin configuration', () => {
  const value = normalizeSettings({
    edgeThickness: 999,
    cornerSize: 1,
    wheelCooldownMs: 0,
    theme: 'light',
    zones: { top: { up: 'workspace-next', down: 'bad' } },
    shortcuts: [
      { accelerator: 'Super+Q', action: 'workspace-prev' },
      { accelerator: 'x'.repeat(100), action: 'none' },
      { accelerator: 'Super+P', action: 'plugin-action', pluginAction: 'org.test:run' }
    ],
    plugins: { 'org.test': true }
  });
  assert.equal(value.edgeThickness, 64);
  assert.equal(value.cornerSize, 24);
  assert.equal(value.wheelCooldownMs, 50);
  assert.equal(value.theme, 'light');
  assert.equal(value.zones.top.up, 'workspace-next');
  assert.equal(value.zones.top.down, 'none');
  assert.equal(value.shortcuts.length, 2);
  assert.equal(value.shortcuts[1].pluginAction, 'org.test:run');
  assert.equal(value.plugins['org.test'], true);
});

test('close action defaults to ask, validates values and migrates closeToTray', () => {
  assert.equal(normalizeSettings({}).closeAction, 'ask');
  assert.equal(normalizeSettings({ closeAction: 'quit' }).closeAction, 'quit');
  assert.equal(normalizeSettings({ closeAction: 'sideways' }).closeAction, 'ask');
  // files written before closeAction existed already carried a decision
  assert.equal(normalizeSettings({ closeToTray: true }).closeAction, 'tray');
  assert.equal(normalizeSettings({ closeToTray: false }).closeAction, 'quit');
});

test('language preference validates and defaults to auto', () => {
  assert.equal(normalizeSettings({}).language, 'auto');
  assert.equal(normalizeSettings({ language: 'en' }).language, 'en');
  assert.equal(normalizeSettings({ language: 'zh-CN' }).language, 'zh-CN');
  assert.equal(normalizeSettings({ language: 'fr' }).language, 'auto');
});

test('close dialog result maps buttons to actions and remembers only when asked', () => {
  assert.deepEqual(closeChoiceFromDialog(0, true), { action: 'tray', remember: true });
  assert.deepEqual(closeChoiceFromDialog(0, false), { action: 'tray', remember: false });
  assert.deepEqual(closeChoiceFromDialog(1, true), { action: 'quit', remember: true });
  // cancel never persists and never closes
  assert.deepEqual(closeChoiceFromDialog(2, true), { action: null, remember: false });
});

test('settings store persists atomically and reloads', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-settings-'));
  const file = path.join(root, 'nested', 'settings.json');
  const store = new SettingsStore(file);
  store.load();
  const value = store.get(); value.edgeThickness = 17;
  store.save(value);
  assert.equal(new SettingsStore(file).load().edgeThickness, 17);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
});
