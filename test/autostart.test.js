'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Autostart, desktopQuote } = require('../src/main/autostart');

test('quotes desktop entry arguments and toggles autostart file', () => {
  assert.equal(desktopQuote('/tmp/a b'), '"/tmp/a b"');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-autostart-'));
  const manager = new Autostart({ appName: 'Slipy', executable: '/opt/Slipy App/slipy', appArgs: ['/tmp/project'], configHome: root });
  manager.set(true);
  assert.equal(manager.isEnabled(), true);
  const contents = fs.readFileSync(manager.file, 'utf8');
  assert.match(contents, /Exec="\/opt\/Slipy App\/slipy" "\/tmp\/project" "--hidden"/);
  manager.set(false);
  assert.equal(manager.isEnabled(), false);
});
