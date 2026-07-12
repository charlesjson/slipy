'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PluginManager } = require('../src/main/plugins');

test('loads enabled plugins, exposes metadata and invokes registered actions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-plugins-'));
  const plugin = path.join(root, 'hello'); fs.mkdirSync(plugin);
  fs.writeFileSync(path.join(plugin, 'plugin.json'), JSON.stringify({ id: 'org.test.hello', name: 'Hello', version: '1.0.0' }));
  fs.writeFileSync(path.join(plugin, 'index.js'), `exports.activate = api => api.registerAction({ id: 'run', name: 'Run', run: ctx => global.__slipyTestValue = ctx.source });`);
  const manager = new PluginManager(root);
  manager.load({ 'org.test.hello': true });
  assert.equal(manager.publicPlugins()[0].enabled, true);
  assert.deepEqual(manager.publicActions().map((item) => item.id), ['org.test.hello:run']);
  await manager.runAction('org.test.hello:run', { source: 'test' });
  assert.equal(global.__slipyTestValue, 'test');
  manager.dispose(); delete global.__slipyTestValue;
});

test('rejects plugin entry paths that escape their directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-plugins-'));
  const plugin = path.join(root, 'bad'); fs.mkdirSync(plugin);
  fs.writeFileSync(path.join(plugin, 'plugin.json'), JSON.stringify({ id: 'org.test.bad', name: 'Bad', main: '../escape.js' }));
  const manager = new PluginManager(root);
  const result = manager.scan();
  assert.match(result[0].error, /inside the plugin directory/);
});
