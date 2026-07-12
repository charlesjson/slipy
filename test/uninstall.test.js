'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { installationFor, removeUserArtifacts, startCleanupWorker, userArtifactPaths } = require('../src/main/uninstall');

function writeFakeAppImage(file) {
  const header = Buffer.alloc(16); header[0] = 0x7f; header.write('ELF', 1, 'ascii'); header[8] = 0x41; header[9] = 0x49; header[10] = 0x02;
  fs.writeFileSync(file, header, { mode: 0o755 });
}

test('detects an installed helper and its installation scope', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-uninstall-'));
  fs.writeFileSync(path.join(root, 'uninstall.sh'), '');
  fs.writeFileSync(path.join(root, '.slipy-install'), 'org.slipy.app\n');
  assert.deepEqual(installationFor(path.join(root, 'slipy'), ''), { available: true, scope: 'user', helper: path.join(root, 'uninstall.sh') });
  assert.equal(installationFor(path.join(root, 'missing', 'slipy'), '').available, false);
  const appImage = path.join(root, 'renamed-slipy'); writeFakeAppImage(appImage);
  assert.equal(installationFor('/tmp/.mount/slipy', appImage).available, false);
  assert.deepEqual(installationFor('/tmp/.mount/slipy', appImage, { packaged: true, appDir: '/tmp/.mount' }), {
    available: true, scope: 'appimage', helper: null, appImage
  });
});

test('rejects an APPIMAGE variable that is not tied to a packaged mount', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-appimage-'));
  const unrelated = path.join(root, 'notes.AppImage'); writeFakeAppImage(unrelated);
  assert.equal(installationFor('/usr/bin/node', unrelated, { packaged: false, appDir: '/tmp/.mount' }).available, false);
  assert.equal(installationFor('/usr/bin/node', unrelated, { packaged: true, appDir: '/tmp/.mount' }).available, false);
  assert.equal(fs.existsSync(unrelated), true);
});

test('post-exit worker removes the AppImage and user artifacts after its parent is gone', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-worker-'));
  const appImage = path.join(root, 'Slipy.AppImage');
  const cache = path.join(root, 'cache', 'slipy');
  fs.writeFileSync(appImage, 'fixture'); fs.mkdirSync(cache, { recursive: true });
  const worker = startCleanupWorker({
    installation: { scope: 'appimage', appImage }, paths: [cache], safeRoots: [root], parentPid: 99999999
  });
  worker.arm();
  const deadline = Date.now() + 3000;
  while ((fs.existsSync(appImage) || fs.existsSync(cache)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(fs.existsSync(appImage), false);
  assert.equal(fs.existsSync(cache), false);
});

test('collects and removes XDG config, cache, state, logs and legacy paths safely', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-home-'));
  const env = {
    XDG_CONFIG_HOME: path.join(home, 'cfg'),
    XDG_CACHE_HOME: path.join(home, 'cache'),
    XDG_STATE_HOME: path.join(home, 'state'),
    XDG_DATA_HOME: path.join(home, 'data')
  };
  const paths = userArtifactPaths(env, home, [path.join(home, 'electron-logs')]);
  for (const target of paths) {
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'artifact'), 'data');
  }
  assert.deepEqual(removeUserArtifacts(paths, home, env), []);
  assert.equal(paths.every((target) => !fs.existsSync(target)), true);

  const outside = path.join(os.tmpdir(), `slipy-outside-${process.pid}`);
  fs.mkdirSync(outside, { recursive: true });
  const failures = removeUserArtifacts([outside], home, env);
  assert.match(failures[0], /outside the user directory/);
  assert.equal(fs.existsSync(outside), true);
  fs.rmSync(outside, { recursive: true });
});
