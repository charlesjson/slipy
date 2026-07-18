'use strict';

const { execFile, spawn } = require('node:child_process');
const { detectEnvironment } = require('./desktop-env');
const { actionCandidates, workspaceCandidates } = require('./action-backends');
const { launchCandidates } = require('./desktop-apps');
const { t } = require('./i18n');

function detached(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) return resolve();
      const error = new Error(t('error.exitCode', { command, code }));
      error.code = 'COMMAND_FAILED';
      reject(error);
    });
  });
}

function exec(command, args = []) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 2500, maxBuffer: 128 * 1024 }, (error, stdout) => {
      if (error) reject(error); else resolve(stdout);
    });
  });
}

// Fire-and-forget for launching applications: resolves once the process has
// spawned instead of waiting for it to exit, and unrefs it so a long-lived
// program never keeps Slipy alive.
function launch(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

async function runCandidate(candidate) {
  // Legacy tuple form [command, args] is still accepted.
  if (Array.isArray(candidate)) candidate = { command: candidate[0], args: candidate[1] };
  if (typeof candidate.run === 'function') return candidate.run({ exec, detached, launch });
  if (candidate.expect) {
    const stdout = await exec(candidate.command, candidate.args);
    if (!candidate.expect.test(stdout)) {
      const error = new Error(t('error.refused', { command: candidate.command, output: stdout.trim() || t('error.emptyOutput') }));
      error.code = 'COMMAND_REFUSED';
      throw error;
    }
    return;
  }
  return detached(candidate.command, candidate.args);
}

async function firstAvailable(candidates) {
  let lastError;
  for (const candidate of candidates) {
    try { return await runCandidate(candidate); } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(t('error.noCommand'));
}

function backendCandidates(candidates) {
  return candidates.map((candidate) => {
    if (Array.isArray(candidate)) return { command: candidate[0], args: candidate[1] };
    if (candidate.operation === 'wmctrl-cycle') return { operation: candidate.operation, delta: candidate.delta };
    if (typeof candidate.run === 'function') return null;
    return { command: candidate.command, args: candidate.args || [], expect: candidate.expect?.source };
  });
}

class ActionExecutor {
  constructor({ plugins, backend = null, notify, log = console.error, environment = detectEnvironment() }) {
    this.plugins = plugins;
    this.backend = backend;
    this.notify = notify;
    this.log = log;
    this.environment = environment;
    this.backendActionRunning = false;
  }

  async run(action, options = {}, context = {}) {
    if (!action || action === 'none') return { ok: true };
    try {
      if (action === 'plugin-action') {
        await this.plugins.runAction(options.pluginAction, context);
        return { ok: true };
      }
      let candidates;
      if (action === 'workspace-prev') candidates = workspaceCandidates(-1, this.environment);
      else if (action === 'workspace-next') candidates = workspaceCandidates(1, this.environment);
      else if (action === 'launch-app') candidates = launchCandidates(options.launch);
      else candidates = actionCandidates(action, this.environment);
      if (!candidates) throw new Error(t('error.unknownAction', { action }));
      const rustCandidates = backendCandidates(candidates);
      if (this.backend?.isAvailable() && rustCandidates.every(Boolean)) {
        if (this.backendActionRunning) return { ok: false, busy: true, error: t('error.actionBusy') };
        this.backendActionRunning = true;
        try {
          const result = await this.backend.request('run_candidates', { candidates: rustCandidates }, { timeoutMs: 18_000 });
          if (!result.ok) {
            const error = new Error(result.error);
            error.code = result.code;
            Object.assign(error, result.details);
            throw error;
          }
        } finally {
          this.backendActionRunning = false;
        }
      } else {
        await firstAvailable(candidates);
      }
      return { ok: true };
    } catch (error) {
      this.log(`action ${action} failed`, error);
      let message = error.message;
      if (error.code === 'ENOENT') message = t('notify.missingCommand');
      else if (error.code === 'COMMAND_FAILED' && error.command) message = t('error.exitCode', { command: error.command, code: error.exitCode ?? '?' });
      else if (error.code === 'COMMAND_REFUSED' && error.command) message = t('error.refused', { command: error.command, output: error.output || t('error.emptyOutput') });
      else if (error.code === 'COMMAND_TIMEOUT' && error.command) message = t('error.commandTimeout', { command: error.command });
      else if (error.code === 'NO_WORKSPACES') message = t('error.noWorkspaces');
      // Test runs surface the result in the UI; a notification would be noise.
      if (context.source !== 'test') this.notify?.(t('notify.actionFailedTitle'), message);
      return { ok: false, error: message };
    }
  }
}

module.exports = { ActionExecutor, firstAvailable, backendCandidates };
