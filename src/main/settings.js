'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ACTIONS, ZONES } = require('./constants');

const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  edgeThickness: 8,
  cornerSize: 96,
  wheelCooldownMs: 220,
  inputBackend: 'auto',
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

function validAction(value, pluginAction) {
  if (value === 'plugin-action') return typeof pluginAction === 'string' && pluginAction.length <= 160;
  return Object.hasOwn(ACTIONS, value);
}

function normalizeSettings(input = {}) {
  const output = clone(DEFAULT_SETTINGS);
  output.edgeThickness = clamp(input.edgeThickness, 1, 64, output.edgeThickness);
  output.cornerSize = clamp(input.cornerSize, 24, 320, output.cornerSize);
  output.wheelCooldownMs = clamp(input.wheelCooldownMs, 50, 2000, output.wheelCooldownMs);
  output.inputBackend = ['auto', 'uiohook', 'edge-windows'].includes(input.inputBackend) ? input.inputBackend : 'auto';
  output.theme = input.theme === 'light' ? 'light' : 'dark';
  if (['ask', 'tray', 'quit'].includes(input.closeAction)) {
    output.closeAction = input.closeAction;
  } else if (typeof input.closeToTray === 'boolean') {
    // Settings written before closeAction existed already made the choice.
    output.closeAction = input.closeToTray ? 'tray' : 'quit';
  }
  output.startAtLogin = input.startAtLogin === true;

  for (const zone of ZONES) {
    const source = input.zones?.[zone] || {};
    for (const direction of ['up', 'down']) {
      const action = source[direction];
      const pluginAction = source[`${direction}PluginAction`] || '';
      if (validAction(action, pluginAction)) {
        output.zones[zone][direction] = action;
        if (action === 'plugin-action') output.zones[zone][`${direction}PluginAction`] = pluginAction;
      }
    }
  }

  if (Array.isArray(input.shortcuts)) {
    output.shortcuts = input.shortcuts.slice(0, 64).flatMap((item) => {
      if (!item || typeof item.accelerator !== 'string' || item.accelerator.length > 80) return [];
      if (!validAction(item.action, item.pluginAction)) return [];
      return [{
        id: typeof item.id === 'string' && item.id ? item.id.slice(0, 80) : crypto.randomUUID(),
        accelerator: item.accelerator.trim(),
        action: item.action,
        pluginAction: item.action === 'plugin-action' ? item.pluginAction : '',
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
      this.value = normalizeSettings(JSON.parse(fs.readFileSync(this.file, 'utf8')));
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

module.exports = { DEFAULT_SETTINGS, SettingsStore, normalizeSettings, closeChoiceFromDialog };
