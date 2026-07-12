'use strict';

const { execFile, spawn } = require('node:child_process');

function detached(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) return resolve();
      const error = new Error(`${command} 退出码为 ${code}`);
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

async function firstAvailable(candidates) {
  let lastError;
  for (const [command, args] of candidates) {
    try { return await detached(command, args); } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('找不到动作所需的系统命令');
}

class ActionExecutor {
  constructor({ plugins, notify, log = console.error }) {
    this.plugins = plugins;
    this.notify = notify;
    this.log = log;
  }

  async run(action, options = {}, context = {}) {
    if (!action || action === 'none') return;
    try {
      if (action === 'plugin-action') {
        await this.plugins.runAction(options.pluginAction, context);
        return;
      }
      if (action === 'workspace-prev') return await this.switchWorkspace(-1);
      if (action === 'workspace-next') return await this.switchWorkspace(1);

      const commands = {
        'volume-up': [['wpctl', ['set-volume', '@DEFAULT_AUDIO_SINK@', '5%+']], ['pactl', ['set-sink-volume', '@DEFAULT_SINK@', '+5%']]],
        'volume-down': [['wpctl', ['set-volume', '@DEFAULT_AUDIO_SINK@', '5%-']], ['pactl', ['set-sink-volume', '@DEFAULT_SINK@', '-5%']]],
        'brightness-up': [['brightnessctl', ['set', '+5%']]],
        'brightness-down': [['brightnessctl', ['set', '5%-']]],
        'media-play-pause': [['playerctl', ['play-pause']]],
        'media-next': [['playerctl', ['next']]],
        'media-prev': [['playerctl', ['previous']]],
        'window-next': [['xdotool', ['key', 'alt+Tab']]],
        'window-prev': [['xdotool', ['key', 'alt+shift+Tab']]],
        overview: [['xdotool', ['key', 'super']]],
        'show-desktop': [['xdotool', ['key', 'super+d']]]
      };
      if (!commands[action]) throw new Error(`未知动作：${action}`);
      await firstAvailable(commands[action]);
    } catch (error) {
      this.log(`执行动作 ${action} 失败`, error);
      this.notify?.('Slipy 动作执行失败', error.code === 'ENOENT' ? '缺少所需系统命令，请查看“关于与诊断”。' : error.message);
    }
  }

  async switchWorkspace(delta) {
    try {
      const output = await exec('wmctrl', ['-d']);
      const desktops = output.trim().split('\n').filter(Boolean);
      const current = desktops.findIndex((line) => /^\s*\d+\s+\*/.test(line));
      if (current < 0 || desktops.length < 2) throw new Error('无法获取虚拟桌面');
      const target = (current + delta + desktops.length) % desktops.length;
      await detached('wmctrl', ['-s', String(target)]);
    } catch (error) {
      await detached('xdotool', ['key', delta < 0 ? 'ctrl+alt+Left' : 'ctrl+alt+Right']);
    }
  }
}

module.exports = { ActionExecutor, firstAvailable };
