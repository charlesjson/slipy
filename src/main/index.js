'use strict';

const path = require('node:path');
const {
  app, BrowserWindow, Menu, Tray, ipcMain, globalShortcut, screen,
  nativeImage, Notification, shell
} = require('electron');
const { SettingsStore } = require('./settings');
const { ACTIONS } = require('./constants');
const { PluginManager } = require('./plugins');
const { ActionExecutor } = require('./actions');
const { Autostart } = require('./autostart');
const { HotkeyManager } = require('./hotkeys');
const { WheelService } = require('./wheel-service');

let mainWindow;
let tray;
let store;
let plugins;
let actions;
let autostart;
let hotkeys;
let wheel;
let quitting = false;
let runtimeStatus = { wheelHook: 'starting', error: null, shortcutResults: [] };

app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal');

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body }).show();
}

function sendState() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('runtime:state', getBootstrap());
}

function getBootstrap() {
  return {
    settings: store.get(),
    actions: Object.entries(ACTIONS).filter(([, value]) => !value.internal).map(([id, value]) => ({ id, name: value.label })),
    pluginActions: plugins.publicActions(),
    plugins: plugins.publicPlugins(),
    runtime: runtimeStatus,
    environment: {
      sessionType: process.env.XDG_SESSION_TYPE || 'unknown',
      desktop: process.env.XDG_CURRENT_DESKTOP || 'unknown',
      pluginsDirectory: plugins.directory,
      version: app.getVersion()
    }
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 880,
    minHeight: 620,
    show: false,
    title: 'Slipy',
    icon: path.join(__dirname, '../../assets/icon.png'),
    backgroundColor: '#0d1220',
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) mainWindow.show();
  });
  mainWindow.on('close', (event) => {
    if (!quitting && store.get().closeToTray) {
      event.preventDefault();
      mainWindow.hide();
    } else if (!quitting) {
      quitting = true;
      app.quit();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '../../assets/tray.svg'));
  tray = new Tray(icon);
  tray.setToolTip('Slipy · 屏幕边缘滚轮');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开设置', click: showWindow },
    { label: '隐藏窗口', click: () => mainWindow?.hide() },
    { type: 'separator' },
    { label: '退出 Slipy', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', showWindow);
}

function configureAutostart() {
  const packaged = app.isPackaged;
  autostart = new Autostart({
    appName: 'Slipy',
    executable: packaged && process.env.APPIMAGE ? process.env.APPIMAGE : process.execPath,
    appArgs: packaged ? [] : [app.getAppPath()]
  });
}

function applyRuntime(settings) {
  plugins.load(settings.plugins);
  runtimeStatus.shortcutResults = hotkeys.apply(settings.shortcuts);
  sendState();
}

function registerIpc() {
  ipcMain.handle('settings:get', () => getBootstrap());
  ipcMain.handle('settings:save', (_event, value) => {
    const settings = store.save(value);
    try {
      autostart.set(settings.startAtLogin);
    } catch (error) {
      settings.startAtLogin = false;
      store.save(settings);
      runtimeStatus.error = `设置开机启动失败：${error.message}`;
    }
    applyRuntime(store.get());
    return getBootstrap();
  });
  ipcMain.handle('action:test', (_event, action, pluginAction) => actions.run(action, { pluginAction }, { source: 'test' }));
  ipcMain.handle('plugins:open-directory', () => shell.openPath(plugins.directory));
  ipcMain.handle('window:hide', () => mainWindow?.hide());
  ipcMain.handle('app:quit', () => { quitting = true; app.quit(); });
}

async function start() {
  if (!app.requestSingleInstanceLock()) return app.quit();
  app.on('second-instance', showWindow);
  await app.whenReady();

  store = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  const settings = store.load();
  configureAutostart();
  try {
    // Refreshes AppImage paths after the application is moved or upgraded.
    autostart.set(settings.startAtLogin);
  } catch (error) {
    settings.startAtLogin = false;
    store.save(settings);
    runtimeStatus.error = `更新开机启动项失败：${error.message}`;
  }

  plugins = new PluginManager(path.join(app.getPath('userData'), 'plugins'), { notify, log: console.log });
  actions = new ActionExecutor({ plugins, notify });
  hotkeys = new HotkeyManager(globalShortcut, (...args) => actions.run(...args));
  createWindow();
  createTray();
  registerIpc();
  applyRuntime(store.get());

  wheel = new WheelService({
    screen,
    getSettings: () => store.get(),
    runAction: (...args) => actions.run(...args),
    onStatus: (status) => { runtimeStatus = { ...runtimeStatus, ...status }; sendState(); }
  });
  wheel.start();
}

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => {
  wheel?.stop();
  hotkeys?.clear();
  plugins?.dispose();
});
app.on('window-all-closed', () => { /* tray application intentionally remains alive */ });

start().catch((error) => {
  console.error(error);
  app.quit();
});
