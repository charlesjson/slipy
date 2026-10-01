'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { RustWheelService } = require('../src/main/rust-wheel-service');

function fixture() {
  const calls = [];
  const backend = new EventEmitter();
  backend.isAvailable = () => true;
  backend.supports = (capability) => capability === 'listener-scoped-stop';
  backend.request = async (method, params) => { calls.push([method, params]); return { started: true }; };
  const service = new RustWheelService({
    backend,
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ id: 1, bounds: { x: 0, y: 0, width: 100, height: 100 } })
    },
    getSettings: () => ({ edgeThickness: 8, cornerSize: 24, wheelCooldownMs: 0, zones: { topLeft: { up: 'volume-up', down: 'volume-down' } } }),
    runAction: (...args) => calls.push(args)
  });
  return { backend, service, calls };
}

test('starts Rust listener and dispatches backend wheel events at the Electron cursor', async () => {
  const { backend, service, calls } = fixture();
  await service.start();
  backend.emit('event:wheel', { direction: 'up', listenerId: service.listenerId });
  backend.emit('event:wheel', { direction: 'horizontal', listenerId: service.listenerId });
  backend.emit('event:wheel', { direction: 'down', listenerId: service.listenerId + 1 });
  assert.deepEqual(calls[0], ['start_x11_wheel', { listenerId: service.listenerId }]);
  assert.equal(calls[1][0], 'volume-up');
  service.stop();
  assert.equal(backend.listenerCount('event:wheel'), 0);
});

test('does not send a start request before the backend handshake is ready', async () => {
  const { backend, service, calls } = fixture();
  backend.isAvailable = () => false;
  await assert.rejects(service.start(), /unavailable/);
  assert.equal(calls.length, 0);
  assert.equal(backend.listenerCount('event:wheel'), 0);
});

test('ignores wheel events until startup has completed', async () => {
  const { backend, service, calls } = fixture();
  let resolveStart;
  backend.request = () => new Promise((resolve) => { resolveStart = resolve; });
  const starting = service.start();
  backend.emit('event:wheel', { direction: 'up', listenerId: service.listenerId });
  assert.equal(calls.length, 0);
  resolveStart({ started: true });
  await starting;
  service.stop();
});

test('reports sidecar process failure and removes all listeners on stop', async () => {
  const { backend } = fixture();
  let failure;
  const service = new RustWheelService({
    backend,
    screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ id: 1, bounds: { x: 0, y: 0, width: 100, height: 100 } }) },
    getSettings: () => ({ wheelCooldownMs: 50, zones: {} }),
    runAction: () => {},
    onFailure: (error) => { failure = error; }
  });
  await service.start();
  backend.emit('unavailable', new Error('backend exited'));
  assert.equal(failure.message, 'backend exited');
  service.stop();
  assert.equal(backend.listenerCount('unavailable'), 0);
});

test('cleans up a listener when its startup response times out', async () => {
  const { backend, service, calls } = fixture();
  backend.request = async (method, params) => {
    calls.push([method, params]);
    if (method === 'start_x11_wheel') throw new Error('request timed out');
    return { stopped: true };
  };
  await assert.rejects(service.start(), /timed out/);
  assert.deepEqual(calls.map(([method]) => method), ['start_x11_wheel', 'stop_x11_wheel']);
  assert.equal(backend.listenerCount('event:wheel'), 0);
});

test('a late startup response cannot reactivate a stopped listener', async () => {
  const { backend, service, calls } = fixture();
  let resolveStart;
  backend.request = (method) => {
    calls.push([method]);
    if (method === 'start_x11_wheel') return new Promise((resolve) => { resolveStart = resolve; });
    return Promise.resolve({ stopped: true });
  };
  const starting = service.start();
  service.stop();
  resolveStart({ started: true });
  await assert.rejects(starting, /stopped/);
  assert.equal(service.started, false);
  assert.deepEqual(calls.map(([method]) => method), ['start_x11_wheel', 'stop_x11_wheel']);
});

test('does not send cleanup after an explicit startup rejection', async () => {
  for (const supportsScopedStop of [true, false]) {
    const { backend, service, calls } = fixture();
    backend.supports = () => supportsScopedStop;
    backend.request = async (method) => {
      calls.push([method]);
      if (method === 'start_x11_wheel') {
        throw Object.assign(new Error('another listener is active'), { backendResponse: true });
      }
    };
    await assert.rejects(service.start(), /another listener/);
    assert.deepEqual(calls.map(([method]) => method), ['start_x11_wheel']);
  }
});

test('does not stop an unconfirmed listener on a sidecar without scoped cleanup', async () => {
  const { backend, service, calls } = fixture();
  backend.supports = () => false;
  backend.request = async (method) => {
    calls.push([method]);
    if (method === 'start_x11_wheel') throw new Error('request timed out');
  };
  await assert.rejects(service.start(), /timed out/);
  assert.deepEqual(calls.map(([method]) => method), ['start_x11_wheel']);
});

test('still stops an acknowledged listener on an older sidecar', async () => {
  const { backend, service, calls } = fixture();
  backend.supports = () => false;
  await service.start();
  service.stop();
  assert.deepEqual(calls.map(([method]) => method), ['start_x11_wheel', 'stop_x11_wheel']);
});

test('restarting the same service ignores failures from its previous listener', async () => {
  const { backend, service } = fixture();
  await service.start();
  const previousId = service.listenerId;
  service.stop();
  const restarting = service.start();
  backend.emit('event:x11-wheel-error', { listenerId: previousId, error: 'stale failure' });
  await restarting;
  assert.notEqual(service.listenerId, previousId);
  assert.equal(service.startupError, null);
  assert.equal(service.started, true);
  service.stop();
});

test('ignores null and malformed wheel payloads', async () => {
  const { backend, service, calls } = fixture();
  await service.start();
  for (const payload of [null, undefined, false, 1, 'up', []]) {
    assert.doesNotThrow(() => backend.emit('event:wheel', payload));
  }
  assert.equal(calls.length, 1);
  service.stop();
});
