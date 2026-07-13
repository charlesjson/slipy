'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('slipy', Object.freeze({
  getState: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  exportSettings: () => ipcRenderer.invoke('settings:export'),
  importSettings: () => ipcRenderer.invoke('settings:import'),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  setPaused: (value) => ipcRenderer.invoke('app:set-paused', value),
  restartInput: () => ipcRenderer.invoke('input:restart'),
  testAction: (action, options = {}) => ipcRenderer.invoke('action:test', action, options),
  openPluginsDirectory: () => ipcRenderer.invoke('plugins:open-directory'),
  quit: () => ipcRenderer.invoke('app:quit'),
  uninstall: () => ipcRenderer.invoke('app:uninstall'),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('runtime:state', listener);
    return () => ipcRenderer.removeListener('runtime:state', listener);
  }
}));
