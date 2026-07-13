'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ActionExecutor, firstAvailable } = require('../src/main/actions');

test('falls back when an available candidate exits unsuccessfully', async () => {
  await assert.doesNotReject(firstAvailable([
    [process.execPath, ['-e', 'process.exit(2)']],
    [process.execPath, ['-e', 'process.exit(0)']]
  ]));
});

test('rejects when every command candidate fails', async () => {
  await assert.rejects(firstAvailable([
    [process.execPath, ['-e', 'process.exit(3)']]
  ]), /exited with code/);
});

test('run reports the outcome and only notifies outside test runs', async () => {
  const notifications = [];
  const executor = new ActionExecutor({
    plugins: null,
    notify: (...args) => notifications.push(args),
    log: () => {},
    environment: { desktop: 'unknown', isWayland: false }
  });
  assert.deepEqual(await executor.run('none'), { ok: true });

  const test1 = await executor.run('no-such-action', {}, { source: 'test' });
  assert.equal(test1.ok, false);
  assert.match(test1.error, /no-such-action/);
  assert.equal(notifications.length, 0);

  const wheel = await executor.run('no-such-action', {}, { source: 'wheel' });
  assert.equal(wheel.ok, false);
  assert.equal(notifications.length, 1);
});

test('launch-app spawns the configured command without waiting for exit', async () => {
  const executor = new ActionExecutor({ plugins: null, notify: () => {}, log: () => {}, environment: { desktop: 'unknown', isWayland: false } });
  // a process that outlives the test: success must mean "spawned", not "exited"
  const running = await executor.run('launch-app', {
    launch: { kind: 'exec', command: `"${process.execPath}" -e "setTimeout(() => {}, 3000)"` }
  }, { source: 'test' });
  assert.deepEqual(running, { ok: true });

  const missing = await executor.run('launch-app', {
    launch: { kind: 'exec', command: '/definitely/not/a/real/binary' }
  }, { source: 'test' });
  assert.equal(missing.ok, false);

  const invalid = await executor.run('launch-app', {}, { source: 'test' });
  assert.equal(invalid.ok, false);
});
