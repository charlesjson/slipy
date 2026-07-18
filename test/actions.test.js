'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ActionExecutor, firstAvailable, backendCandidates } = require('../src/main/actions');

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

test('serializes command and workspace candidates for the Rust backend', () => {
  const serialized = backendCandidates([
    { command: 'tool', args: ['one'], expect: /success/ },
    { operation: 'wmctrl-cycle', delta: -1, run: () => {} }
  ]);
  assert.deepEqual(serialized, [
    { command: 'tool', args: ['one'], expect: 'success' },
    { operation: 'wmctrl-cycle', delta: -1 }
  ]);
  assert.deepEqual(backendCandidates([{ run: () => {} }]), [null]);
});

test('uses the Rust backend for built-in actions and reports its failures', async () => {
  const calls = [];
  const backend = {
    isAvailable: () => true,
    request: async (...args) => { calls.push(args); return { ok: true }; }
  };
  const executor = new ActionExecutor({ plugins: null, backend, notify: () => {}, log: () => {}, environment: { desktop: 'unknown', isWayland: false } });
  assert.deepEqual(await executor.run('volume-up', {}, { source: 'test' }), { ok: true });
  assert.equal(calls[0][0], 'run_candidates');
  assert.equal(calls[0][2].timeoutMs, 18_000);

  backend.request = async () => ({ ok: false, code: 'COMMAND_FAILED', error: 'backend failed' });
  assert.deepEqual(await executor.run('volume-up', {}, { source: 'test' }), { ok: false, error: 'backend failed' });
});

test('drops overlapping Rust actions instead of queueing or falling back', async () => {
  let release;
  const backend = {
    isAvailable: () => true,
    request: () => new Promise((resolve) => { release = () => resolve({ ok: true }); })
  };
  const executor = new ActionExecutor({ plugins: null, backend, notify: () => {}, log: () => {}, environment: { desktop: 'unknown', isWayland: false } });
  const first = executor.run('volume-up', {}, { source: 'test' });
  const second = executor.run('volume-down', {}, { source: 'test' });
  const busy = await second;
  assert.equal(busy.ok, false);
  assert.equal(busy.busy, true);
  assert.equal(typeof busy.error, 'string');
  release();
  assert.deepEqual(await first, { ok: true });
});
