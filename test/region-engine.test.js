'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectZone, WheelGate } = require('../src/main/region-engine');

const bounds = { x: 100, y: 50, width: 1000, height: 700 };
const options = { edgeThickness: 8, cornerSize: 100 };

test('detects all eight zones and ignores the center', () => {
  assert.equal(detectZone({ x: 100, y: 50 }, bounds, options), 'topLeft');
  assert.equal(detectZone({ x: 600, y: 50 }, bounds, options), 'top');
  assert.equal(detectZone({ x: 1099, y: 50 }, bounds, options), 'topRight');
  assert.equal(detectZone({ x: 100, y: 400 }, bounds, options), 'left');
  assert.equal(detectZone({ x: 1099, y: 400 }, bounds, options), 'right');
  assert.equal(detectZone({ x: 100, y: 749 }, bounds, options), 'bottomLeft');
  assert.equal(detectZone({ x: 600, y: 749 }, bounds, options), 'bottom');
  assert.equal(detectZone({ x: 1099, y: 749 }, bounds, options), 'bottomRight');
  assert.equal(detectZone({ x: 600, y: 400 }, bounds, options), null);
});

test('corners extend along either adjoining edge and take precedence', () => {
  assert.equal(detectZone({ x: 150, y: 50 }, bounds, options), 'topLeft');
  assert.equal(detectZone({ x: 100, y: 120 }, bounds, options), 'topLeft');
  assert.equal(detectZone({ x: 210, y: 50 }, bounds, options), 'top');
});

test('rejects points beyond offset display bounds', () => {
  assert.equal(detectZone({ x: 99, y: 50 }, bounds, options), null);
  assert.equal(detectZone({ x: 1100, y: 400 }, bounds, options), null);
});

test('wheel gate debounces each zone and direction separately', () => {
  const gate = new WheelGate(200);
  assert.equal(gate.accept('top', 'up', 1000), true);
  assert.equal(gate.accept('top', 'up', 1100), false);
  assert.equal(gate.accept('top', 'down', 1100), true);
  assert.equal(gate.accept('left', 'up', 1100), true);
  assert.equal(gate.accept('top', 'up', 1200), true);
});
