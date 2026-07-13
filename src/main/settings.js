'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ACTIONS, ZONES } = require('./constants');

const CURRENT_VERSION = 2;

const DEFAULT_SETTINGS = Object.freeze({
  version: CURRENT_VERSION,
  edgeThickness: 8,
  cornerSize: 96,
  wheelCooldownMs: 220,
  inputBackend: 'auto',
  language: 'auto',
  theme: 'dark',
  closeAction: 'ask',
  startAtLogin: false,
  zones: Object.fromEntries(ZONES.map((zone) => [zone, { up: 'none', down: 'none' }])),
  shortcuts: [
    { id: 'workspace-prev', accelerator: 'Super+Alt+Left', action: 'workspace-prev', pluginAction: '', enabled: false },
    { id: 'workspace-next', accelerator: 'Super+Alt+Right', action: 'workspace-next', pluginAction: '', enabled: false }
  ],
  plugins: {}
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// Stepwise schema upgrades: MIGRATIONS[n] rewrites a version-n object into
// version n+1. Files written before `version` existed count as version 1.
const MIGRATIONS = {
  1: (value) => {
    // v2 replaced the closeToTray boolean with the three-way closeAction.
    if (value.closeAction === undefined && typeof value.closeToTray === 'boolean') {
      value.closeAction = value.closeToTray ? 'tray' : 'quit';
    }
    delete value.closeToTray;
    return value;
  }
};

function migrateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { version: CURRENT_VERSION };
  let value = clone(input);
  let version = Number.isInteger(value.version) && value.version > 0 ? value.version : 1;
  if (version > CURRENT_VERSION) {
    const error = new Error(`settings version ${version} is newer than supported version ${CURRENT_VERSION}`);
    error.code = 'SETTINGS_TOO_NEW';
    throw error;
  }
  while (version < CURRENT_VERSION) {
    value = MIGRATIONS[version](value);
    version += 1;
  }
  value.version = CURRENT_VERSION;
  return value;
}

function validAction(value, pluginAction, launch) {
  if (value === 'plugin-action') return typeof pluginAction === 'string' && pluginAction.length <= 160;
  if (value === 'launch-app') return launch !== null && launch !== undefined;
  return Object.hasOwn(ACTIONS, value);
}

// Launch configurations are user-owned commands, so only shape and size are
// enforced here — whether the target exists is a runtime concern.
function normalizeLaunch(input) {
  if (!input || typeof input !== 'object') return null;
  if (input.kind === 'desktop') {
    const entry = typeof input.entry === 'string' ? input.entry.trim() : '';
    if (!entry || entry.length > 500 || !entry.endsWith('.desktop')) return null;
    return { kind: 'desktop', entry };
  }
  if (input.kind === 'exec') {
    const command = typeof input.command === 'string' ? input.command.trim() : '';
    if (!command || command.length > 2000) return null;
    return { kind: 'exec', command };
  }
  return null;
}

function normalizeSettings(input = {}) {
  const output = clone(DEFAULT_SETTINGS);
  output.edgeThickness = clamp(input.edgeThickness, 1, 64, output.edgeThickness);
  output.cornerSize = clamp(input.cornerSize, 24, 320, output.cornerSize);
  output.wheelCooldownMs = clamp(input.wheelCooldownMs, 50, 2000, output.wheelCooldownMs);
  output.inputBackend = ['auto', 'uiohook', 'edge-windows'].includes(input.inputBackend) ? input.inputBackend : 'auto';
  output.language = ['auto', 'zh-CN', 'en'].includes(input.language) ? input.language : 'auto';
  output.theme = input.theme === 'light' ? 'light' : 'dark';
  if (['ask', 'tray', 'quit'].includes(input.closeAction)) output.closeAction = input.closeAction;
  output.startAtLogin = input.startAtLogin === true;

  for (const zone of ZONES) {
    const source = input.zones?.[zone] || {};
    for (const direction of ['up', 'down']) {
      const action = source[direction];
      const pluginAction = source[`${direction}PluginAction`] || '';
      const launch = normalizeLaunch(source[`${direction}Launch`]);
      if (validAction(action, pluginAction, launch)) {
        output.zones[zone][direction] = action;
        if (action === 'plugin-action') output.zones[zone][`${direction}PluginAction`] = pluginAction;
        if (action === 'launch-app') output.zones[zone][`${direction}Launch`] = launch;
      }
    }
  }

  if (Array.isArray(input.shortcuts)) {
    output.shortcuts = input.shortcuts.slice(0, 64).flatMap((item) => {
      if (!item || typeof item.accelerator !== 'string' || item.accelerator.length > 80) return [];
      const launch = normalizeLaunch(item.launch);
      if (!validAction(item.action, item.pluginAction, launch)) return [];
      return [{
        id: typeof item.id === 'string' && item.id ? item.id.slice(0, 80) : crypto.randomUUID(),
        accelerator: item.accelerator.trim(),
        action: item.action,
        pluginAction: item.action === 'plugin-action' ? item.pluginAction : '',
        ...(item.action === 'launch-app' ? { launch } : {}),
        enabled: item.enabled !== false
      }];
    });
  }

  if (input.plugins && typeof input.plugins === 'object' && !Array.isArray(input.plugins)) {
    output.plugins = Object.fromEntries(Object.entries(input.plugins).slice(0, 128).map(([id, value]) => [id.slice(0, 100), value === true]));
  }
  return output;
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

// Interprets the close-prompt dialog result. Buttons are ordered
// [minimize-to-tray, quit, cancel]; the checkbox persists the choice.
function closeChoiceFromDialog(response, checkboxChecked) {
  if (response === 0) return { action: 'tray', remember: Boolean(checkboxChecked) };
  if (response === 1) return { action: 'quit', remember: Boolean(checkboxChecked) };
  return { action: null, remember: false };
}

class SettingsStore {
  constructor(file) {
    this.file = file;
    this.value = clone(DEFAULT_SETTINGS);
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      let migrated;
      // A file from a newer Slipy must not prevent startup; normalization
      // keeps whatever fields this version understands.
      try { migrated = migrateSettings(raw); } catch { migrated = raw; }
      this.value = normalizeSettings(migrated);
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    return this.get();
  }

  get() { return clone(this.value); }

  save(value) {
    this.value = normalizeSettings(value);
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.file);
    return this.get();
  }
}

module.exports = { CURRENT_VERSION, DEFAULT_SETTINGS, SettingsStore, normalizeSettings, migrateSettings, closeChoiceFromDialog };
