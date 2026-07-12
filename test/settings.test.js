'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeSettings, SettingsStore } = require('../src/main/settings');

test('normalizes limits, actions, shortcuts and plugin configuration', () => {
  const value = normalizeSettings({
    edgeThickness: 999,
    cornerSize: 1,
    wheelCooldownMs: 0,
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
  assert.equal(value.zones.top.up, 'workspace-next');
  assert.equal(value.zones.top.down, 'none');
  assert.equal(value.shortcuts.length, 2);
  assert.equal(value.shortcuts[1].pluginAction, 'org.test:run');
  assert.equal(value.plugins['org.test'], true);
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
