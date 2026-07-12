'use strict';

const { execFile, spawn } = require('node:child_process');
const { detectEnvironment } = require('./desktop-env');
const { actionCandidates, workspaceCandidates } = require('./action-backends');
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

async function runCandidate(candidate) {
  // Legacy tuple form [command, args] is still accepted.
  if (Array.isArray(candidate)) candidate = { command: candidate[0], args: candidate[1] };
  if (typeof candidate.run === 'function') return candidate.run({ exec, detached });
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

class ActionExecutor {
  constructor({ plugins, notify, log = console.error, environment = detectEnvironment() }) {
    this.plugins = plugins;
    this.notify = notify;
    this.log = log;
    this.environment = environment;
  }

  async run(action, options = {}, context = {}) {
    if (!action || action === 'none') return;
    try {
      if (action === 'plugin-action') {
        await this.plugins.runAction(options.pluginAction, context);
        return;
      }
      let candidates;
      if (action === 'workspace-prev') candidates = workspaceCandidates(-1, this.environment);
      else if (action === 'workspace-next') candidates = workspaceCandidates(1, this.environment);
      else candidates = actionCandidates(action, this.environment);
      if (!candidates) throw new Error(t('error.unknownAction', { action }));
      await firstAvailable(candidates);
    } catch (error) {
      this.log(`action ${action} failed`, error);
      this.notify?.(t('notify.actionFailedTitle'), error.code === 'ENOENT' ? t('notify.missingCommand') : error.message);
    }
  }
}

module.exports = { ActionExecutor, firstAvailable };
