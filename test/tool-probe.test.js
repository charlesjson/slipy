'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { executableOnPath, probeTools } = require('../src/main/tool-probe');

test('probes executables directly from PATH without requiring which', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-tools-'));
  fs.writeFileSync(path.join(root, 'available'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'not-executable'), 'fixture', { mode: 0o644 });
  const env = { PATH: root };

  assert.equal(executableOnPath('available', env), true);
  assert.equal(executableOnPath('not-executable', env), false);
  assert.equal(executableOnPath('which', env), false);
  assert.deepEqual(probeTools(['available', 'missing'], env), { available: true, missing: false });
});

test('an empty PATH reports tools as unavailable', () => {
  assert.equal(executableOnPath('sh', { PATH: '' }), false);
});
