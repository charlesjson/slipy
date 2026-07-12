'use strict';

const ZONES = [
  'topLeft', 'top', 'topRight',
  'left', 'right',
  'bottomLeft', 'bottom', 'bottomRight'
];

const ACTIONS = Object.freeze({
  none: { label: '无操作' },
  'workspace-prev': { label: '上一个虚拟桌面' },
  'workspace-next': { label: '下一个虚拟桌面' },
  'volume-up': { label: '提高音量' },
  'volume-down': { label: '降低音量' },
  'brightness-up': { label: '提高亮度' },
  'brightness-down': { label: '降低亮度' },
  'media-play-pause': { label: '播放 / 暂停' },
  'media-next': { label: '下一曲' },
  'media-prev': { label: '上一曲' },
  'window-next': { label: '切换到下一个窗口' },
  'window-prev': { label: '切换到上一个窗口' },
  overview: { label: '显示活动概览' },
  'show-desktop': { label: '显示桌面' },
  'plugin-action': { label: '插件动作', internal: true }
});

module.exports = { ACTIONS, ZONES };
