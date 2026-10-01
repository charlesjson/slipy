'use strict';

// Run separately from the pure Node suite: Electron needs a graphical session
// (or xvfb-run on CI). The fixture never loads Slipy's main process or hooks.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPORT_PREFIX = 'SLIPY_RENDERER_RESULTS=';

async function runFixture() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-renderer-test-'));
  const env = { ...process.env, SLIPY_RENDERER_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [path.join(__dirname, 'fixtures/renderer-main.cjs')], {
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Renderer fixture exceeded 90 seconds.'));
      }, 90_000);
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-12_000); });
      child.once('error', (error) => { clearTimeout(timeout); reject(error); });
      child.once('close', (code, signal) => {
        clearTimeout(timeout);
        const reportLine = stdout.split('\n').find((line) => line.startsWith(REPORT_PREFIX));
        if (!reportLine) {
          reject(new Error(`Electron fixture exited ${code ?? signal} without a report. Run in a graphical session or with xvfb-run.\n${stderr}\n${stdout}`));
          return;
        }
        try { resolve(JSON.parse(reportLine.slice(REPORT_PREFIX.length))); } catch (error) { reject(error); }
      });
    });
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

test('Slipy renderer with isolated Electron IPC', { timeout: 95_000 }, async (t) => {
  const results = await runFixture();
  for (const result of results) {
    await t.test(result.name, () => {
      assert.equal(result.ok, true, result.error || result.name);
    });
  }
});
