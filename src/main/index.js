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
const { EdgeWheelService } = require('./edge-wheel-service');
const { detectEnvironment } = require('./desktop-env');
const { executeSystemUninstaller, installationFor, startCleanupWorker, userArtifactPaths } = require('./uninstall');

let mainWindow;
let tray;
let store;
let plugins;
let actions;
let autostart;
let hotkeys;
let wheel;
let quitting = false;
let runtimeStatus = { wheelHook: 'starting', wheelBackend: null, error: null, shortcutResults: [] };
let toolAvailability = {};
const environment = detectEnvironment(process.env);

app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal');
// Edge overlay strips need absolute screen placement, which xdg-shell denies
// to native Wayland clients; through XWayland (composited into the same
// stack) placement works. Electron resolves the ozone platform before the
// main script runs, so appendSwitch is too late — relaunch once with the
// explicit switch instead. DISPLAY is only set when XWayland is available.
const needsXwaylandRelaunch = environment.isWayland && process.env.DISPLAY
  && !process.argv.some((arg) => arg.startsWith('--ozone-platform'));
if (needsXwaylandRelaunch) {
  app.relaunch({ args: [...process.argv.slice(1), '--ozone-platform=x11'] });
  app.exit(0);
}

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body }).show();
}

function sendState() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('runtime:state', getBootstrap());
}

function getBootstrap() {
  const installation = installationFor(process.execPath, process.env.APPIMAGE, { packaged: app.isPackaged, appDir: process.env.APPDIR });
  return {
    settings: store.get(),
    actions: Object.entries(ACTIONS).filter(([, value]) => !value.internal).map(([id, value]) => ({ id, name: value.label })),
    pluginActions: plugins.publicActions(),
    plugins: plugins.publicPlugins(),
    runtime: runtimeStatus,
    environment: {
      sessionType: environment.sessionType,
      desktop: environment.raw.currentDesktop || environment.desktop,
      desktopFamily: environment.desktop,
      tools: toolAvailability,
      pluginsDirectory: plugins.directory,
      version: app.getVersion(),
      uninstallAvailable: installation.available,
      installScope: installation.scope
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

function createWheelBackend(kind) {
  const common = {
    getSettings: () => store.get(),
    runAction: (...args) => actions.run(...args),
    onStatus: (status) => { runtimeStatus = { ...runtimeStatus, ...status }; sendState(); }
  };
  if (kind === 'edge-windows') return new EdgeWheelService({ electron: { BrowserWindow, screen, ipcMain }, ...common });
  return new WheelService({ screen, ...common });
}

function wheelBackendOrder() {
  const preference = store.get().inputBackend;
  if (preference !== 'auto') return [preference];
  // Wayland compositors block global hooks; edge overlays are the native fit.
  // On X11 the global hook is better (no pixels claimed at the edges), with
  // overlays as a fallback when libuiohook fails to load.
  return environment.isWayland ? ['edge-windows'] : ['uiohook', 'edge-windows'];
}

function startWheel() {
  for (const kind of wheelBackendOrder()) {
    const service = createWheelBackend(kind);
    try {
      service.start();
      wheel = service;
      wheel.kind = kind;
      runtimeStatus.wheelBackend = kind;
      sendState();
      return;
    } catch (error) {
      try { service.stop(); } catch { /* never started */ }
      runtimeStatus = { ...runtimeStatus, wheelHook: 'failed', wheelBackend: null, error: error.message };
    }
  }
  wheel = null;
  sendState();
}

function refreshWheel() {
  const order = wheelBackendOrder();
  if (wheel && order.includes(wheel.kind)) {
    wheel.applySettings();
    return;
  }
  wheel?.stop();
  wheel = null;
  startWheel();
}

function probeTools() {
  const { execFile } = require('node:child_process');
  const tools = ['wmctrl', 'xdotool', 'ydotool', 'gdbus', 'hyprctl', 'swaymsg', 'wpctl', 'pactl', 'playerctl', 'brightnessctl'];
  return Promise.all(tools.map((tool) => new Promise((resolve) => {
    execFile('which', [tool], (error) => resolve([tool, !error]));
  }))).then((entries) => { toolAvailability = Object.fromEntries(entries); sendState(); });
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
    refreshWheel();
    return getBootstrap();
  });
  ipcMain.handle('action:test', (_event, action, pluginAction) => actions.run(action, { pluginAction }, { source: 'test' }));
  ipcMain.handle('plugins:open-directory', () => shell.openPath(plugins.directory));
  ipcMain.handle('window:hide', () => mainWindow?.hide());
  ipcMain.handle('app:quit', () => { quitting = true; app.quit(); });
  ipcMain.handle('app:uninstall', async () => {
    const installation = installationFor(process.execPath, process.env.APPIMAGE, { packaged: app.isPackaged, appDir: process.env.APPDIR });
    if (!installation.available) throw new Error('当前是源码开发模式，没有可卸载的安装包。');
    const electronPaths = ['userData', 'sessionData', 'logs', 'crashDumps'].flatMap((name) => {
      try { return [app.getPath(name)]; } catch { return []; }
    });
    const home = app.getPath('home');
    const paths = userArtifactPaths(process.env, home, electronPaths);
    const safeRoots = [home, process.env.XDG_CONFIG_HOME, process.env.XDG_CACHE_HOME, process.env.XDG_STATE_HOME, process.env.XDG_DATA_HOME].filter(Boolean);
    const worker = startCleanupWorker({ installation, paths, safeRoots });
    try {
      await executeSystemUninstaller(installation);
      worker.arm();
    } catch (error) {
      worker.cancel();
      throw error;
    }
    quitting = true;
    setImmediate(() => app.quit());
    return { ok: true, warnings: [] };
  });
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
  actions = new ActionExecutor({ plugins, notify, environment });
  hotkeys = new HotkeyManager(globalShortcut, (...args) => actions.run(...args));
  createWindow();
  createTray();
  registerIpc();
  applyRuntime(store.get());

  startWheel();
  probeTools().catch(() => { /* diagnostics only */ });
}

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => {
  wheel?.stop();
  hotkeys?.clear();
  plugins?.dispose();
});
app.on('window-all-closed', () => { /* tray application intentionally remains alive */ });

if (!needsXwaylandRelaunch) {
  start().catch((error) => {
    console.error(error);
    app.quit();
  });
}
