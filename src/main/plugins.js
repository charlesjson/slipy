'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/i;

class PluginManager extends EventEmitter {
  constructor(directory, services = {}) {
    super();
    this.directory = directory;
    this.services = services;
    this.plugins = [];
    this.actions = new Map();
    this.disposers = [];
  }

  scan() {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const plugins = [];
    for (const entry of fs.readdirSync(this.directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const root = path.join(this.directory, entry.name);
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
        if (!ID_PATTERN.test(manifest.id) || typeof manifest.name !== 'string') throw new Error('插件 id 或 name 无效');
        const main = typeof manifest.main === 'string' ? manifest.main : 'index.js';
        const mainPath = path.resolve(root, main);
        if (!mainPath.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('main 必须位于插件目录中');
        plugins.push({
          id: manifest.id,
          name: manifest.name.slice(0, 100),
          version: String(manifest.version || '0.0.0').slice(0, 40),
          description: String(manifest.description || '').slice(0, 300),
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

  load(enabled = {}) {
    this.dispose();
    this.scan();
    for (const plugin of this.plugins) {
      plugin.enabled = enabled[plugin.id] === true;
      if (!plugin.enabled || plugin.error) continue;
      try {
        delete require.cache[require.resolve(plugin.mainPath)];
        const moduleValue = require(plugin.mainPath);
        if (typeof moduleValue.activate !== 'function') throw new Error('插件必须导出 activate(api)');
        const api = this.createApi(plugin);
        const disposer = moduleValue.activate(Object.freeze(api));
        if (typeof disposer === 'function') this.disposers.push(disposer);
      } catch (error) {
        plugin.error = error.message;
        plugin.enabled = false;
      }
    }
    this.emit('changed', this.publicPlugins());
    return this.publicPlugins();
  }

  createApi(plugin) {
    return {
      apiVersion: 1,
      plugin: Object.freeze({ id: plugin.id, root: plugin.root }),
      registerAction: (action) => {
        if (!action || !ID_PATTERN.test(action.id) || typeof action.name !== 'string' || typeof action.run !== 'function') {
          throw new Error('registerAction 需要合法的 id、name 和 run(context)');
        }
        const fullId = `${plugin.id}:${action.id}`;
        if (this.actions.has(fullId)) throw new Error(`动作重复：${fullId}`);
        this.actions.set(fullId, {
          id: fullId,
          pluginId: plugin.id,
          name: action.name.slice(0, 100),
          description: String(action.description || '').slice(0, 300),
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
    if (!action) throw new Error(`插件动作不存在或插件未启用：${id}`);
    return action.run(Object.freeze({ ...context, pluginId: action.pluginId }));
  }

  publicPlugins() {
    return this.plugins.map(({ id, name, version, description, enabled, error }) => ({ id, name, version, description, enabled, error }));
  }

  publicActions() {
    return [...this.actions.values()].map(({ id, pluginId, name, description }) => ({ id, pluginId, name, description }));
  }

  dispose() {
    for (const disposer of this.disposers.splice(0)) {
      try { disposer(); } catch { /* plugin cleanup is best effort */ }
    }
    this.actions.clear();
  }
}

module.exports = { PluginManager };
