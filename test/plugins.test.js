'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PluginManager } = require('../src/main/plugins');

function makePlugin(root, dir, manifest, source) {
  const plugin = path.join(root, dir);
  fs.mkdirSync(plugin, { recursive: true });
  fs.writeFileSync(path.join(plugin, 'plugin.json'), JSON.stringify(manifest));
  if (source) fs.writeFileSync(path.join(plugin, 'index.js'), source);
  return plugin;
}

test('loads enabled plugins, exposes metadata and invokes registered actions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-plugins-'));
  makePlugin(root, 'hello', { id: 'org.test.hello', name: 'Hello', version: '1.0.0' },
    `exports.activate = api => api.registerAction({ id: 'run', name: 'Run', run: ctx => global.__slipyTestValue = ctx.source });`);
  const manager = new PluginManager(root);
  await manager.load({ 'org.test.hello': true });
  assert.equal(manager.publicPlugins()[0].enabled, true);
  assert.deepEqual(manager.publicActions().map((item) => item.id), ['org.test.hello:run']);
  await manager.runAction('org.test.hello:run', { source: 'test' });
  assert.equal(global.__slipyTestValue, 'test');
  manager.dispose(); delete global.__slipyTestValue;
});

test('rejects plugin entry paths that escape their directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-plugins-'));
  makePlugin(root, 'bad', { id: 'org.test.bad', name: 'Bad', main: '../escape.js' });
  const manager = new PluginManager(root);
  const result = manager.scan();
  assert.match(result[0].error, /inside the plugin directory/);
});

test('awaits async activate and keeps its disposer', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-plugins-'));
  makePlugin(root, 'async', { id: 'org.test.async', name: 'Async' },
    `exports.activate = async (api) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const off = api.registerAction({ id: 'later', name: 'Later', run: () => {} });
      return () => { global.__slipyAsyncDisposed = true; off(); };
    };`);
  const manager = new PluginManager(root);
  await manager.load({ 'org.test.async': true });
  assert.deepEqual(manager.publicActions().map((item) => item.id), ['org.test.async:later']);
  manager.dispose();
  assert.equal(global.__slipyAsyncDisposed, true);
  delete global.__slipyAsyncDisposed;
});

test('reload purges the whole plugin module subtree', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-plugins-'));
  const plugin = makePlugin(root, 'deep', { id: 'org.test.deep', name: 'Deep' },
    `const value = require('./lib.js'); exports.activate = api => api.registerAction({ id: 'val', name: String(value), run: () => {} });`);
  fs.writeFileSync(path.join(plugin, 'lib.js'), 'module.exports = "one";');
  const manager = new PluginManager(root);
  await manager.load({ 'org.test.deep': true });
  assert.equal(manager.publicActions()[0].name, 'one');
  fs.writeFileSync(path.join(plugin, 'lib.js'), 'module.exports = "two";');
  await manager.load({ 'org.test.deep': true });
  assert.equal(manager.publicActions()[0].name, 'two');
  manager.dispose();
});

test('rejects manifests requiring a newer api version and duplicate plugin ids', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-plugins-'));
  makePlugin(root, 'a-future', { id: 'org.test.future', name: 'Future', apiVersion: 99 });
  makePlugin(root, 'b-one', { id: 'org.test.same', name: 'One' }, 'exports.activate = () => {};');
  makePlugin(root, 'c-two', { id: 'org.test.same', name: 'Two' }, 'exports.activate = () => {};');
  const manager = new PluginManager(root);
  const result = manager.scan();
  const byName = Object.fromEntries(result.map((item) => [item.id, item.error]));
  assert.match(byName['invalid:a-future'], /API v99/);
  assert.equal(byName['org.test.same'], null);
  assert.match(byName['invalid:c-two'], /Duplicate plugin id/);
});

test('localizes plugin and action names with english fallback', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-plugins-'));
  makePlugin(root, 'l10n', {
    id: 'org.test.l10n',
    name: { 'zh-CN': '本地化', en: 'Localized' },
    description: { 'zh-CN': '中文说明' }
  }, `exports.activate = api => api.registerAction({ id: 'greet', name: { 'zh-CN': '问候', en: 'Greet' }, run: () => {} });`);
  const manager = new PluginManager(root);
  await manager.load({ 'org.test.l10n': true });
  // tests run with the default language (en)
  assert.equal(manager.publicPlugins()[0].name, 'Localized');
  assert.equal(manager.publicPlugins()[0].description, '中文说明');
  assert.equal(manager.publicActions()[0].name, 'Greet');
  manager.dispose();
});

test('a stuck action rejects after the timeout', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-plugins-'));
  makePlugin(root, 'stuck', { id: 'org.test.stuck', name: 'Stuck' },
    `exports.activate = api => api.registerAction({ id: 'hang', name: 'Hang', run: () => new Promise(() => {}) });`);
  const manager = new PluginManager(root, { actionTimeoutMs: 40 });
  await manager.load({ 'org.test.stuck': true });
  await assert.rejects(manager.runAction('org.test.stuck:hang', { source: 'test' }), /timed out/);
  manager.dispose();
});
