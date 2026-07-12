'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

test('offline installer installs and uninstalls a user payload in XDG paths', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-installer-'));
  const bundle = path.join(root, 'bundle');
  const home = path.join(root, 'home');
  const data = path.join(root, 'data');
  fs.mkdirSync(path.join(bundle, 'payload', 'resources'), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '../scripts/install.sh'), path.join(bundle, 'install.sh'));
  fs.copyFileSync(path.join(__dirname, '../assets/icon.png'), path.join(bundle, 'icon.png'));
  fs.writeFileSync(path.join(bundle, 'payload', 'resources', 'app.asar'), 'fixture');
  fs.writeFileSync(path.join(bundle, 'payload', 'slipy'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const env = { ...process.env, HOME: home, XDG_DATA_HOME: data, XDG_CONFIG_HOME: path.join(root, 'config') };
  const archive = path.join(root, 'payload.tar.gz');
  const installer = path.join(root, 'installer.run');
  await execFileAsync('tar', ['-czf', archive, '-C', bundle, '.']);
  fs.writeFileSync(installer, Buffer.concat([
    fs.readFileSync(path.join(__dirname, '../scripts/self-extract-header.sh')),
    fs.readFileSync(archive)
  ]), { mode: 0o755 });
  await execFileAsync(installer, ['--user', '--no-launch'], { env });

  const app = path.join(data, 'slipy');
  const binary = path.join(home, '.local', 'bin', 'slipy');
  const desktop = path.join(data, 'applications', 'org.slipy.app.desktop');
  assert.equal(fs.statSync(path.join(app, 'slipy')).mode & 0o777, 0o755);
  assert.equal(fs.realpathSync(binary), path.join(app, 'slipy'));
  assert.match(fs.readFileSync(desktop, 'utf8'), new RegExp(`Exec="${app}/slipy"`));
  assert.equal(fs.existsSync(path.join(app, 'uninstall.sh')), true);

  await execFileAsync('bash', [path.join(app, 'uninstall.sh'), '--user', '--uninstall'], { env });
  assert.equal(fs.existsSync(app), false);
  assert.equal(fs.existsSync(binary), false);
  assert.equal(fs.existsSync(desktop), false);

  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'keep-me'), 'unmanaged');
  await assert.rejects(execFileAsync(installer, ['--user', '--no-launch'], { env }), /不属于 Slipy/);
  assert.equal(fs.readFileSync(path.join(app, 'keep-me'), 'utf8'), 'unmanaged');
});
