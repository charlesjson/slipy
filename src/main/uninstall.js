'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const APP_ID = 'org.slipy.app';

function hasAppImageMagic(file) {
  let descriptor;
  try {
    descriptor = fs.openSync(file, 'r');
    const header = Buffer.alloc(11);
    fs.readSync(descriptor, header, 0, header.length, 0);
    return header[0] === 0x7f && header.toString('ascii', 1, 4) === 'ELF'
      && header[8] === 0x41 && header[9] === 0x49 && header[10] === 0x02;
  } catch { return false; }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function installationFor(executable, appImage = process.env.APPIMAGE, runtime = {}) {
  const appDir = runtime.appDir;
  const validAppImage = runtime.packaged === true
    && typeof appImage === 'string'
    && path.isAbsolute(appImage)
    && typeof appDir === 'string'
    && path.isAbsolute(appDir)
    && path.resolve(executable).startsWith(`${path.resolve(appDir)}${path.sep}`)
    && fs.existsSync(appImage)
    && (fs.statSync(appImage).mode & 0o111) !== 0
    && hasAppImageMagic(appImage);
  if (validAppImage) {
    return { available: true, scope: 'appimage', helper: null, appImage: path.resolve(appImage) };
  }
  const directory = path.dirname(executable);
  const helper = path.join(directory, 'uninstall.sh');
  const marker = path.join(directory, '.slipy-install');
  let managed = false;
  try {
    managed = fs.statSync(helper).isFile() && fs.readFileSync(marker, 'utf8').trim() === APP_ID;
  } catch { managed = false; }
  if (!managed) return { available: false, scope: null, helper: null };
  return {
    available: true,
    scope: directory === '/opt/slipy' ? 'system' : 'user',
    helper
  };
}

function userArtifactPaths(env = process.env, home = os.homedir(), electronPaths = []) {
  const config = env.XDG_CONFIG_HOME || path.join(home, '.config');
  const cache = env.XDG_CACHE_HOME || path.join(home, '.cache');
  const state = env.XDG_STATE_HOME || path.join(home, '.local', 'state');
  const data = env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return [...new Set([
    path.join(config, 'slipy'),
    path.join(config, 'Slipy'),
    path.join(config, APP_ID),
    path.join(cache, 'slipy'),
    path.join(cache, 'Slipy'),
    path.join(cache, APP_ID),
    path.join(state, 'slipy'),
    path.join(state, 'Slipy'),
    path.join(state, APP_ID),
    path.join(data, 'Slipy'),
    path.join(data, APP_ID),
    path.join(config, 'autostart', 'slipy.desktop'),
    ...electronPaths
  ].map((value) => path.resolve(value)))];
}

function removeUserArtifacts(paths, home = os.homedir(), env = process.env) {
  const safeRoots = [
    path.resolve(home),
    env.XDG_CONFIG_HOME,
    env.XDG_CACHE_HOME,
    env.XDG_STATE_HOME,
    env.XDG_DATA_HOME
  ].filter(Boolean).map((value) => path.resolve(value));
  const failures = [];
  for (const target of paths) {
    const resolved = path.resolve(target);
    const safe = safeRoots.some((root) => resolved.startsWith(`${root}${path.sep}`));
    if (!safe) {
      failures.push(`${resolved}: 路径不在用户目录内`);
      continue;
    }
    try { fs.rmSync(resolved, { recursive: true, force: true }); }
    catch (error) { failures.push(`${resolved}: ${error.message}`); }
  }
  return failures;
}

function executeSystemUninstaller(installation) {
  if (installation.scope !== 'system') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const child = spawn('pkexec', ['/bin/bash', installation.helper, '--system', '--uninstall'], { stdio: 'ignore' });
    child.once('error', (error) => {
      if (error.code === 'ENOENT' && installation.scope === 'system') {
        error.message = '系统缺少 pkexec，无法请求管理员权限。请在终端中使用 sudo 运行卸载脚本。';
      }
      reject(error);
    });
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(code === 126 || code === 127 ? '管理员授权已取消。' : `卸载程序退出码为 ${code}`));
    });
  });
}

function startCleanupWorker({ installation, paths, safeRoots, parentPid = process.pid }) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-uninstall-'));
  fs.chmodSync(workDir, 0o700);
  const worker = path.join(workDir, 'worker.js');
  const manifestFile = path.join(workDir, 'manifest.json');
  const armFile = path.join(workDir, 'armed');
  fs.copyFileSync(path.join(__dirname, 'uninstall-worker.js'), worker);
  fs.chmodSync(worker, 0o700);
  fs.writeFileSync(manifestFile, JSON.stringify({
    parentPid,
    scope: installation.scope,
    helper: installation.helper,
    appImage: installation.appImage,
    paths,
    safeRoots: safeRoots.map((root) => path.resolve(root)),
    armFile,
    workDir
  }), { mode: 0o600 });
  const child = spawn(process.execPath, [worker, manifestFile], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  });
  child.unref();
  return {
    arm() { fs.writeFileSync(armFile, 'armed\n', { mode: 0o600 }); },
    cancel() { try { child.kill(); } catch { /* already exited */ } fs.rmSync(workDir, { recursive: true, force: true }); },
    workDir
  };
}

module.exports = {
  executeSystemUninstaller, installationFor, removeUserArtifacts,
  startCleanupWorker, userArtifactPaths
};
