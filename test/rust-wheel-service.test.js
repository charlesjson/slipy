'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { RustWheelService } = require('../src/main/rust-wheel-service');

function fixture() {
  const calls = [];
  const backend = new EventEmitter();
  backend.isAvailable = () => true;
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
