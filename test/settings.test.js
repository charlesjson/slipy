'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeSettings, migrateSettings, SettingsStore, closeChoiceFromDialog, CURRENT_VERSION, DEFAULT_SETTINGS } = require('../src/main/settings');

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

test('close action defaults to ask and validates values', () => {
  assert.equal(normalizeSettings({}).closeAction, 'ask');
  assert.equal(normalizeSettings({ closeAction: 'quit' }).closeAction, 'quit');
  assert.equal(normalizeSettings({ closeAction: 'sideways' }).closeAction, 'ask');
});

test('migrations upgrade v1 files, folding closeToTray into closeAction', () => {
  // files written before closeAction existed already carried a decision
  assert.equal(migrateSettings({ version: 1, closeToTray: true }).closeAction, 'tray');
  assert.equal(migrateSettings({ version: 1, closeToTray: false }).closeAction, 'quit');
  const migrated = migrateSettings({ closeToTray: true, closeAction: 'ask' });
  assert.equal(migrated.closeAction, 'ask'); // an explicit choice wins
  assert.equal('closeToTray' in migrated, false);
  assert.equal(migrated.version, CURRENT_VERSION);
  // missing or nonsense versions are treated as version 1
  assert.equal(migrateSettings({}).version, CURRENT_VERSION);
  assert.equal(migrateSettings({ version: 'x' }).version, CURRENT_VERSION);
});

test('migration refuses files from a newer version', () => {
  assert.throws(() => migrateSettings({ version: CURRENT_VERSION + 1 }), (error) => error.code === 'SETTINGS_TOO_NEW');
});

test('defaults are already at the current version', () => {
  assert.equal(DEFAULT_SETTINGS.version, CURRENT_VERSION);
  assert.deepEqual(migrateSettings(DEFAULT_SETTINGS), JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
});

test('launch configurations validate per kind on zones and shortcuts', () => {
  const value = normalizeSettings({
    zones: {
      top: { up: 'launch-app', upLaunch: { kind: 'exec', command: ' mpv --fs ' } },
      bottom: { up: 'launch-app' } // missing launch config
    },
    shortcuts: [
      { accelerator: 'Super+E', action: 'launch-app', launch: { kind: 'desktop', entry: '/usr/share/applications/org.kde.dolphin.desktop' } },
      { accelerator: 'Super+R', action: 'launch-app', launch: { kind: 'desktop', entry: 'not-a-desktop-entry' } },
      { accelerator: 'Super+T', action: 'volume-up', launch: { kind: 'exec', command: 'stray' } }
    ]
  });
  assert.equal(value.zones.top.up, 'launch-app');
  assert.deepEqual(value.zones.top.upLaunch, { kind: 'exec', command: 'mpv --fs' });
  assert.equal(value.zones.bottom.up, 'none');
  assert.equal(value.shortcuts.length, 2);
  assert.deepEqual(value.shortcuts[0].launch, { kind: 'desktop', entry: '/usr/share/applications/org.kde.dolphin.desktop' });
  // launch data never sticks to non-launch actions
  assert.equal('launch' in value.shortcuts[1], false);
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

test('invalid root values normalize to defaults instead of throwing', () => {
  for (const input of [null, false, 42, 'invalid', []]) {
    assert.deepEqual(normalizeSettings(input), normalizeSettings({}));
  }
});

test('imports reject non-object JSON roots before migration', () => {
  for (const input of [undefined, null, false, 42, 'invalid', []]) {
    assert.throws(() => migrateSettings(input), { code: 'SETTINGS_INVALID' });
  }
});

test('saving a non-object root leaves saved settings and the file untouched', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-invalid-settings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings.json');
  const store = new SettingsStore(file);
  const previous = store.save({ edgeThickness: 17, theme: 'light' });
  const persisted = fs.readFileSync(file, 'utf8');
  for (const input of [undefined, null, false, 42, 'invalid', []]) {
    assert.throws(() => store.save(input), { code: 'SETTINGS_INVALID' });
    assert.deepEqual(store.get(), previous);
    assert.equal(fs.readFileSync(file, 'utf8'), persisted);
  }
  assert.deepEqual(fs.readdirSync(root), ['settings.json']);
});

test('loading invalid JSON roots still recovers defaults without rewriting the file', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-settings-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings.json');
  for (const input of [null, false, 42, 'invalid', []]) {
    const contents = JSON.stringify(input);
    fs.writeFileSync(file, contents);
    assert.deepEqual(new SettingsStore(file).load(), normalizeSettings({}));
    assert.equal(fs.readFileSync(file, 'utf8'), contents);
  }
});

test('a failed settings write keeps the last saved value and removes its temporary file', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-settings-failure-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings.json');
  const store = new SettingsStore(file);
  store.save({ edgeThickness: 17 });
  const persisted = fs.readFileSync(file, 'utf8');
  const error = Object.assign(new Error('read-only filesystem'), { code: 'EROFS' });
  t.mock.method(fs, 'renameSync', () => { throw error; });

  assert.throws(() => store.save({ edgeThickness: 23 }), { code: 'EROFS' });
  assert.equal(store.get().edgeThickness, 17);
  assert.equal(fs.readFileSync(file, 'utf8'), persisted);
  assert.deepEqual(fs.readdirSync(root), ['settings.json']);
});
