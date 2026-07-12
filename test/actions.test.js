'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { firstAvailable } = require('../src/main/actions');

test('falls back when an available candidate exits unsuccessfully', async () => {
  await assert.doesNotReject(firstAvailable([
    [process.execPath, ['-e', 'process.exit(2)']],
    [process.execPath, ['-e', 'process.exit(0)']]
  ]));
});

test('rejects when every command candidate fails', async () => {
  await assert.rejects(firstAvailable([
    [process.execPath, ['-e', 'process.exit(3)']]
  ]), /退出码/);
});
