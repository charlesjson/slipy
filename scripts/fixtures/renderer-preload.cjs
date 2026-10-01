'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const methods = [
  'getState', 'saveSettings', 'exportSettings', 'importSettings', 'resetSettings',
  'setPaused', 'restartInput', 'testAction', 'openPluginsDirectory', 'quit', 'uninstall'
];
const api = Object.fromEntries(methods.map((method) => [
  method, (...args) => ipcRenderer.invoke('renderer-test:invoke', method, ...args)
]));
api.onState = (callback) => {
  const listener = (_event, state) => callback(state);
  ipcRenderer.on('runtime:state', listener);
  return () => ipcRenderer.removeListener('runtime:state', listener);
};
contextBridge.exposeInMainWorld('slipy', Object.freeze(api));
