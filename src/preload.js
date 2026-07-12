'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('slipy', Object.freeze({
  getState: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  testAction: (action, pluginAction = '') => ipcRenderer.invoke('action:test', action, pluginAction),
  openPluginsDirectory: () => ipcRenderer.invoke('plugins:open-directory'),
  hide: () => ipcRenderer.invoke('window:hide'),
  quit: () => ipcRenderer.invoke('app:quit'),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('runtime:state', listener);
    return () => ipcRenderer.removeListener('runtime:state', listener);
  }
}));
