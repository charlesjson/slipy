'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WheelService } = require('../src/main/wheel-service');

function createService(runAction) {
  return new WheelService({
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ id: 7, bounds: { x: 0, y: 0, width: 1920, height: 1080 } })
    },
    getSettings: () => ({
      edgeThickness: 8,
      cornerSize: 96,
      wheelCooldownMs: 50,
      zones: { topLeft: { up: 'workspace-prev', down: 'workspace-next' } }
    }),
    runAction
  });
}

test('maps libuiohook negative rotation to wheel up', () => {
  const calls = [];
  createService((...args) => calls.push(args)).onWheel({ x: 4000, y: 4000, direction: 3, rotation: -1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'workspace-prev');
  assert.equal(calls[0][2].direction, 'up');
  assert.deepEqual(calls[0][2].point, { x: 0, y: 0 });
});

test('maps positive rotation to down and ignores horizontal wheels', () => {
  const calls = [];
  const service = createService((...args) => calls.push(args));
  service.onWheel({ direction: 4, rotation: -1 });
  service.onWheel({ direction: 3, rotation: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'workspace-next');
  assert.equal(calls[0][2].direction, 'down');
});

test('ignores zero and invalid wheel rotations', () => {
  const calls = [];
  const service = createService((...args) => calls.push(args));
  for (const rotation of [0, undefined, NaN, Infinity, -Infinity]) {
    service.onWheel({ direction: 3, rotation });
  }
  assert.equal(calls.length, 0);
});
