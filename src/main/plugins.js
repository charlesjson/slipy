'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { t, getLanguage } = require('./i18n');

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/i;
const API_VERSION = 1;
const ACTION_TIMEOUT_MS = 10_000;

/**
 * Plugin-provided text is either a plain string or a locale map such as
 * `{ "zh-CN": "问候", "en": "Greet" }`. Resolution follows the active UI
 * language, then English, then whatever the plugin defined first.
 */
function localizeText(value, max) {
  let text = '';
  if (typeof value === 'string') text = value;
  else if (isLocaleMap(value)) {
    text = value[getLanguage()] ?? value.en ?? Object.values(value).find((entry) => typeof entry === 'string') ?? '';
  }
  return text.slice(0, max);
}

function isLocaleMap(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).some((entry) => typeof entry === 'string');
}

function validText(value) {
  return typeof value === 'string' || isLocaleMap(value);
}

class PluginManager extends EventEmitter {
  constructor(directory, services = {}) {
    super();
    this.directory = directory;
    this.services = services;
    this.actionTimeoutMs = services.actionTimeoutMs || ACTION_TIMEOUT_MS;
    this.plugins = [];
    this.actions = new Map();
    this.disposers = [];
  }

  scan() {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const plugins = [];
    const seen = new Map();
    for (const entry of fs.readdirSync(this.directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const root = path.join(this.directory, entry.name);
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
        if (!ID_PATTERN.test(manifest.id) || !validText(manifest.name)) throw new Error(t('error.pluginManifest'));
        if (seen.has(manifest.id)) throw new Error(t('error.pluginDuplicateId', { id: manifest.id }));
        if (manifest.apiVersion !== undefined && Number(manifest.apiVersion) > API_VERSION) {
          throw new Error(t('error.pluginApiVersion', { required: manifest.apiVersion, current: API_VERSION }));
        }
        const main = typeof manifest.main === 'string' ? manifest.main : 'index.js';
        const mainPath = path.resolve(root, main);
        if (!mainPath.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(t('error.pluginEscape'));
        seen.set(manifest.id, root);
        plugins.push({
          id: manifest.id,
          name: manifest.name,
          version: String(manifest.version || '0.0.0').slice(0, 40),
          description: manifest.description,
          mainPath,
          root,
          enabled: false,
          error: null
        });
      } catch (error) {
        plugins.push({
          id: `invalid:${entry.name}`, name: entry.name, version: '', description: '', root,
          enabled: false, error: error.message
        });
      }
    }
    this.plugins = plugins;
    return this.publicPlugins();
  }

  async load(enabled = {}) {
    this.dispose();
    this.scan();
    for (const plugin of this.plugins) {
      plugin.enabled = enabled[plugin.id] === true;
      if (!plugin.enabled || plugin.error) continue;
      try {
        this.purgeCache(plugin.root);
        const moduleValue = require(plugin.mainPath);
        if (typeof moduleValue.activate !== 'function') throw new Error(t('error.pluginActivate'));
        const api = this.createApi(plugin);
        // activate may be async; its (optionally promised) return value is
        // the disposer called on reload and quit.
        const disposer = await moduleValue.activate(Object.freeze(api));
        if (typeof disposer === 'function') this.disposers.push(disposer);
      } catch (error) {
        plugin.error = error.message;
        plugin.enabled = false;
      }
    }
    this.emit('changed', this.publicPlugins());
    return this.publicPlugins();
  }

  // Drops every cached module under the plugin directory, not just the entry
  // file, so editing a plugin's submodules takes effect on the next reload.
  purgeCache(root) {
    const prefix = `${path.resolve(root)}${path.sep}`;
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(prefix)) delete require.cache[key];
    }
  }

  createApi(plugin) {
    return {
      apiVersion: API_VERSION,
      plugin: Object.freeze({ id: plugin.id, root: plugin.root }),
      registerAction: (action) => {
        if (!action || !ID_PATTERN.test(action.id) || !validText(action.name) || typeof action.run !== 'function') {
          throw new Error(t('error.pluginRegister'));
        }
        const fullId = `${plugin.id}:${action.id}`;
        if (this.actions.has(fullId)) throw new Error(t('error.pluginDuplicate', { id: fullId }));
        this.actions.set(fullId, {
          id: fullId,
          pluginId: plugin.id,
          name: action.name,
          description: action.description,
          run: action.run
        });
        return () => this.actions.delete(fullId);
      },
      notify: (title, body) => this.services.notify?.(String(title), String(body)),
      log: (...values) => this.services.log?.(`[plugin:${plugin.id}]`, ...values)
    };
  }

  async runAction(id, context) {
    const action = this.actions.get(id);
    if (!action) throw new Error(t('error.pluginMissing', { id }));
    const frozen = Object.freeze({ ...context, pluginId: action.pluginId });
    let timer;
    try {
      // The timeout cannot cancel plugin code; it caps how long a trigger
      // waits so a stuck plugin surfaces as an error instead of silence.
      return await Promise.race([
        Promise.resolve(action.run(frozen)),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(t('error.pluginTimeout', { id }))), this.actionTimeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  publicPlugins() {
    return this.plugins.map(({ id, name, version, description, enabled, error }) => ({
      id, version, enabled, error,
      name: localizeText(name, 100) || id,
      description: localizeText(description, 300)
    }));
  }

  publicActions() {
    return [...this.actions.values()].map(({ id, pluginId, name, description }) => ({
      id, pluginId,
      name: localizeText(name, 100) || id,
      description: localizeText(description, 300)
    }));
  }

  dispose() {
    for (const disposer of this.disposers.splice(0)) {
      try { disposer(); } catch { /* plugin cleanup is best effort */ }
    }
    this.actions.clear();
  }
}

module.exports = { PluginManager, API_VERSION };
