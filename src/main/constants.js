'use strict';

const ZONES = [
  'topLeft', 'top', 'topRight',
  'left', 'right',
  'bottomLeft', 'bottom', 'bottomRight'
];

// Display names live in shared/locales.js under `action.<id>`.
const ACTIONS = Object.freeze({
  none: {},
  'workspace-prev': {},
  'workspace-next': {},
  'volume-up': {},
  'volume-down': {},
  'brightness-up': {},
  'brightness-down': {},
  'media-play-pause': {},
  'media-next': {},
  'media-prev': {},
  'window-next': {},
  'window-prev': {},
  overview: {},
  'show-desktop': {},
  'plugin-action': { internal: true }
});

module.exports = { ACTIONS, ZONES };
