'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { activeEdges, stripRects } = require('../src/main/edge-layout');

const bounds = { x: 100, y: 50, width: 1920, height: 1080 };

test('only edges touching configured zones get strips', () => {
  const zones = {
    topLeft: { up: 'workspace-prev', down: 'none' },
    bottom: { up: 'none', down: 'none' }
  };
  assert.deepEqual(activeEdges(zones), ['top', 'left']);
});

test('a corner zone activates both adjacent edges', () => {
  assert.deepEqual(activeEdges({ bottomRight: { up: 'volume-up', down: 'volume-down' } }), ['bottom', 'right']);
});

test('strips cover the display perimeter without overlap', () => {
  const rects = stripRects(bounds, 8);
  const top = rects.find((r) => r.edge === 'top');
  const left = rects.find((r) => r.edge === 'left');
  assert.deepEqual(top, { edge: 'top', x: 100, y: 50, width: 1920, height: 8 });
  // side strips start below the top strip so no pixel is claimed twice
  assert.equal(left.y, 58);
  assert.equal(left.height, 1080 - 16);
});

test('respects the requested edge subset and enforces minimum thickness', () => {
  const rects = stripRects(bounds, 1, ['right']);
  assert.equal(rects.length, 1);
  assert.equal(rects[0].edge, 'right');
  assert.equal(rects[0].width, 2);
  assert.equal(rects[0].x, 100 + 1920 - 2);
  // no top/bottom strips requested → side strip spans the full height
  assert.equal(rects[0].height, 1080);
});
