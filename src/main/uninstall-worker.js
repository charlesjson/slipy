'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
const sleep = (milliseconds) => Atomics.wait(sleepBuffer, 0, 0, milliseconds);

function processExists(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

function safeRemove(target, roots, failures) {
  const resolved = path.resolve(target);
  if (!roots.some((root) => resolved.startsWith(`${root}${path.sep}`))) {
    failures.push(`${resolved}: unsafe path`);
    return;
  }
  try { fs.rmSync(resolved, { recursive: true, force: true }); }
  catch (error) { failures.push(`${resolved}: ${error.message}`); }
}

function main() {
  const manifestFile = process.argv[2];
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const deadline = Date.now() + 10 * 60 * 1000;
  while (!fs.existsSync(manifest.armFile)) {
    if (!processExists(manifest.parentPid) || Date.now() > deadline) return;
    sleep(100);
  }
  while (processExists(manifest.parentPid)) sleep(100);
  // Give Chromium, Crashpad and native hook threads time to observe the main
  // process exit before removing their cache/log directories.
  sleep(750);

  const failures = [];
  if (manifest.scope === 'user') {
    const result = spawnSync('/bin/bash', [manifest.helper, '--user', '--uninstall'], { stdio: 'ignore' });
    if (result.status !== 0) failures.push(`uninstaller exited with ${result.status}`);
  } else if (manifest.scope === 'appimage') {
    try { fs.rmSync(manifest.appImage, { force: true }); }
    catch (error) { failures.push(`${manifest.appImage}: ${error.message}`); }
  }
  for (const target of manifest.paths) safeRemove(target, manifest.safeRoots, failures);
  if (failures.length) {
    fs.writeFileSync(path.join(manifest.workDir, 'uninstall-errors.log'), `${failures.join('\n')}\n`);
    return;
  }
  fs.rmSync(manifest.workDir, { recursive: true, force: true });
}

try { main(); } catch (error) {
  try { fs.writeFileSync(`${process.argv[2]}.error.log`, `${error.stack || error}\n`); } catch { /* best effort */ }
  process.exitCode = 1;
}
