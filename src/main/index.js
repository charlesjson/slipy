'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  app, BrowserWindow, Menu, Tray, ipcMain, globalShortcut, screen,
  nativeImage, Notification, shell, dialog
} = require('electron');
const { SettingsStore, DEFAULT_SETTINGS, migrateSettings, normalizeSettings, closeChoiceFromDialog } = require('./settings');
const { ACTIONS } = require('./constants');
const { PluginManager } = require('./plugins');
const { ActionExecutor } = require('./actions');
const { Autostart } = require('./autostart');
const { HotkeyManager } = require('./hotkeys');
const { WheelService } = require('./wheel-service');
const { RustWheelService } = require('./rust-wheel-service');
const { EdgeWheelService } = require('./edge-wheel-service');
const { detectEnvironment } = require('./desktop-env');
const { applicationDirs, listApplications } = require('./desktop-apps');
const { probeTools: probePathTools } = require('./tool-probe');
const { BackendClient, backendExecutable } = require('./backend-client');
const i18n = require('./i18n');
const { t } = i18n;
const { getWindowIcon, getTrayIcon } = require('./icons');
const { executeSystemUninstaller, installationFor, startCleanupWorker, userArtifactPaths } = require('./uninstall');

let mainWindow;
let tray;
let store;
let plugins;
let actions;
let autostart;
let hotkeys;
let wheel;
let wheelStartPromise = null;
let wheelGeneration = 0;
let rustWheelSuppressed = false;
let backend;
let quitting = false;
let paused = false;
let runtimeStatus = { wheelHook: 'starting', wheelBackend: null, error: null, shortcutResults: [], paused: false };
let toolAvailability = {};
let appList = [];
let environment = detectEnvironment(process.env);

// Launchable .desktop applications for the action pickers. Rescanned on
// settings saves so display names follow the interface language.
function scanApps() {
  try {
    appList = listApplications(applicationDirs(process.env), i18n.getLanguage());
  } catch {
    appList = [];
  }
}

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
    actions: Object.entries(ACTIONS).filter(([, value]) => !value.internal).map(([id]) => ({ id, name: t(`action.${id}`) })),
    pluginActions: plugins.publicActions(),
    plugins: plugins.publicPlugins(),
    apps: appList,
    runtime: runtimeStatus,
    environment: {
      language: i18n.getLanguage(),
      sessionType: environment.sessionType,
      desktop: environment.raw.currentDesktop || environment.desktop,
      desktopFamily: environment.desktop,
      tools: toolAvailability,
      pluginsDirectory: plugins.directory,
      version: app.getVersion(),
      packaged: app.isPackaged,
      uninstallAvailable: installation.available,
      installScope: installation.scope
    }
  };
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1120, width),
    height: Math.min(760, height),
    minWidth: Math.min(640, width),
    minHeight: Math.min(480, height),
    show: false,
    title: 'Slipy',
    icon: getWindowIcon(nativeImage),
    backgroundColor: store.get().theme === 'light' ? '#f0ede4' : '#14130f',
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
    if (quitting) return;
    const action = store.get().closeAction;
    if (action === 'quit') {
      quitting = true;
      app.quit();
      return;
    }
    event.preventDefault();
    if (action === 'tray') mainWindow.hide();
    else promptCloseAction();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

let closePromptOpen = false;

async function promptCloseAction() {
  if (closePromptOpen) return;
  closePromptOpen = true;
  try {
    const { response, checkboxChecked } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: t('closeDialog.title'),
      message: t('closeDialog.message'),
      detail: t('closeDialog.detail'),
      buttons: [t('closeDialog.tray'), t('closeDialog.quit'), t('closeDialog.cancel')],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      checkboxLabel: t('closeDialog.remember'),
      checkboxChecked: true
    });
    const choice = closeChoiceFromDialog(response, checkboxChecked);
    if (!choice.action) return;
    if (choice.remember) {
      const settings = store.get();
      settings.closeAction = choice.action;
      store.save(settings);
      sendState();
    }
    if (choice.action === 'tray') {
      mainWindow.hide();
    } else {
      quitting = true;
      app.quit();
    }
  } finally {
    closePromptOpen = false;
  }
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  mainWindow.show();
  mainWindow.focus();
}

function applyTrayLabels() {
  if (!tray) return;
  tray.setToolTip(paused ? t('tray.tooltipPaused') : t('tray.tooltip'));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t('tray.open'), click: showWindow },
    { label: t('tray.hide'), click: () => mainWindow?.hide() },
    { type: 'separator' },
    { label: paused ? t('tray.resume') : t('tray.pause'), click: () => setPaused(!paused) },
    { type: 'separator' },
    { label: t('tray.quit'), click: () => { quitting = true; app.quit(); } }
  ]));
}

// Tears down every input surface while paused: edge strips release their
// screen pixels (important for games and remote desktops on Wayland) and
// global shortcuts are unregistered, not merely ignored.
async function setPaused(next) {
  if (paused === next) return;
  paused = next;
  runtimeStatus.paused = next;
  if (next) {
    wheelGeneration += 1;
    wheel?.stop();
    wheel = null;
    hotkeys.clear();
    runtimeStatus = { ...runtimeStatus, wheelHook: 'paused', wheelBackend: null, shortcutResults: [] };
  } else {
    runtimeStatus.shortcutResults = hotkeys.apply(store.get().shortcuts);
    await ensureWheel();
  }
  applyTrayLabels();
  sendState();
}

function createTray() {
  const icon = getTrayIcon(nativeImage);
  tray = new Tray(icon);
  applyTrayLabels();
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

async function applyRuntime(settings) {
  await plugins.load(settings.plugins);
  if (!paused) runtimeStatus.shortcutResults = hotkeys.apply(settings.shortcuts);
  sendState();
}

function createWheelBackend(kind) {
  const common = {
    getSettings: () => store.get(),
    runAction: (...args) => actions.run(...args),
    onStatus: (status) => { runtimeStatus = { ...runtimeStatus, ...status }; sendState(); }
  };
  if (kind === 'rust-xinput2') {
    let service;
    service = new RustWheelService({
      backend, screen, ...common,
      onFailure: (error) => {
        recoverWheelService(service, error);
      }
    });
    return service;
  }
  if (kind === 'edge-windows') return new EdgeWheelService({ electron: { BrowserWindow, screen, ipcMain }, ...common });
  return new WheelService({ screen, ...common });
}

function wheelBackendOrder() {
  const preference = store.get().inputBackend;
  if (preference !== 'auto') return [preference];
  // Wayland compositors block global hooks; edge overlays are the native fit.
  // On X11 the global hook is better (no pixels claimed at the edges), with
  // overlays as a fallback when libuiohook fails to load.
  if (environment.isWayland) return ['edge-windows'];
  return rustWheelSuppressed ? ['uiohook', 'edge-windows'] : ['rust-xinput2', 'uiohook', 'edge-windows'];
}

async function startWheel() {
  if (paused) return;
  if (wheelStartPromise) return wheelStartPromise;
  const generation = wheelGeneration;
  wheelStartPromise = (async () => {
    for (const kind of wheelBackendOrder()) {
      const service = createWheelBackend(kind);
      try {
        await service.start();
        if (paused || generation !== wheelGeneration) {
          service.stop();
          return;
        }
        wheel = service;
        wheel.kind = kind;
        runtimeStatus = { ...runtimeStatus, wheelHook: 'running', wheelBackend: kind, error: null };
        sendState();
        return;
      } catch (error) {
        try { service.stop(); } catch { /* never started */ }
        runtimeStatus = { ...runtimeStatus, wheelHook: 'failed', wheelBackend: null, error: error.message };
      }
    }
    wheel = null;
    sendState();
  })();
  try { await wheelStartPromise; } finally { wheelStartPromise = null; }
}

async function ensureWheel() {
  await startWheel();
  if (!paused && !wheel) await startWheel();
}

function recoverWheelService(service, error) {
  service.stop();
  if (wheel === service) wheel = null;
  wheelGeneration += 1;
  if (service.kind === 'rust-xinput2') rustWheelSuppressed = true;
  runtimeStatus = { ...runtimeStatus, wheelHook: 'failed', wheelBackend: null, error: error.message };
  if (!paused) ensureWheel().catch(() => {});
}

async function refreshWheel({ preferFirst = false } = {}) {
  if (paused) return;
  const order = wheelBackendOrder();
  if (wheel && order.includes(wheel.kind) && (!preferFirst || wheel.kind === order[0])) {
    wheel.applySettings();
    return;
  }
  wheelGeneration += 1;
  wheel?.stop();
  wheel = null;
  await ensureWheel();
}

function probeTools() {
  const tools = ['wmctrl', 'xdotool', 'ydotool', 'gdbus', 'hyprctl', 'swaymsg', 'wpctl', 'pactl', 'playerctl', 'brightnessctl'];
  return backend.request('probe_tools', { tools })
    .catch(() => probePathTools(tools))
    .then((availability) => { toolAvailability = availability; sendState(); });
}

async function initializeBackend() {
  try {
    await backend.request('ping');
    environment = await backend.request('environment');
    actions.environment = environment;
    await refreshWheel({ preferFirst: true });
  } catch (error) {
    console.error(`Rust backend unavailable, using JavaScript fallback: ${error.message}`);
    backend.stop();
  }
  await probeTools();
}

// Single pipeline for every settings write (save, import, reset), so side
// effects — autostart, language, tray, plugins, shortcuts, edge strips —
// always stay in sync with the stored value.
async function applySettings(value) {
  const settings = store.save(value);
  try {
    autostart.set(settings.startAtLogin);
  } catch (error) {
    settings.startAtLogin = false;
    store.save(settings);
    runtimeStatus.error = t('error.autostartSet', { message: error.message });
  }
  i18n.setLanguage(i18n.resolveLanguage(store.get().language, app.getLocale()));
  scanApps();
  applyTrayLabels();
  await applyRuntime(store.get());
  await refreshWheel();
  return getBootstrap();
}

function registerIpc() {
  ipcMain.handle('settings:get', () => getBootstrap());
  ipcMain.handle('settings:save', (_event, value) => applySettings(value));
  ipcMain.handle('settings:export', async (_event, value) => {
    const settings = value === undefined ? store.get() : normalizeSettings(migrateSettings(value));
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: t('config.exportTitle'),
      defaultPath: path.join(app.getPath('documents'), 'slipy-settings.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (canceled || !filePath) return { canceled: true };
    fs.writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`);
    return { canceled: false, path: filePath };
  });
  ipcMain.handle('settings:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: t('config.importTitle'),
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (canceled || !filePaths.length) return { canceled: true };
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    } catch {
      throw new Error(t('error.importParse'));
    }
    let migrated;
    try {
      migrated = migrateSettings(parsed);
    } catch (error) {
      throw new Error(error.code === 'SETTINGS_TOO_NEW' ? t('error.importTooNew')
        : error.code === 'SETTINGS_INVALID' ? t('error.importInvalid') : error.message);
    }
    return { canceled: false, state: await applySettings(migrated) };
  });
  ipcMain.handle('settings:reset', async () => ({ canceled: false, state: await applySettings(DEFAULT_SETTINGS) }));
  ipcMain.handle('app:set-paused', async (_event, value) => { await setPaused(Boolean(value)); return getBootstrap(); });
  ipcMain.handle('input:restart', async () => {
    rustWheelSuppressed = false;
    wheelGeneration += 1;
    wheel?.stop();
    wheel = null;
    runtimeStatus = { ...runtimeStatus, wheelHook: paused ? 'paused' : 'starting', wheelBackend: null, error: null };
    await ensureWheel();
    return getBootstrap();
  });
  ipcMain.handle('action:test', (_event, action, options) => actions.run(action, {
    pluginAction: typeof options?.pluginAction === 'string' ? options.pluginAction : '',
    launch: options?.launch
  }, { source: 'test' }));
  ipcMain.handle('plugins:open-directory', () => shell.openPath(plugins.directory));
  ipcMain.handle('app:quit', () => { quitting = true; app.quit(); });
  ipcMain.handle('app:uninstall', async () => {
    const installation = installationFor(process.execPath, process.env.APPIMAGE, { packaged: app.isPackaged, appDir: process.env.APPDIR });
    if (!installation.available) throw new Error(t('error.uninstallDev'));
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

  backend = new BackendClient({ executable: backendExecutable({ packaged: app.isPackaged }) });
  backend.on('log', (message) => console.error(`[rust-backend] ${message}`));

  store = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  const settings = store.load();
  i18n.setLanguage(i18n.resolveLanguage(settings.language, app.getLocale()));
  scanApps();
  configureAutostart();
  try {
    // Refreshes AppImage paths after the application is moved or upgraded.
    autostart.set(settings.startAtLogin);
  } catch (error) {
    settings.startAtLogin = false;
    store.save(settings);
    runtimeStatus.error = t('error.autostartUpdate', { message: error.message });
  }

  plugins = new PluginManager(path.join(app.getPath('userData'), 'plugins'), { notify, log: console.log });
  actions = new ActionExecutor({ plugins, backend, notify, environment });
  hotkeys = new HotkeyManager(globalShortcut, (...args) => actions.run(...args));
  createWindow();
  createTray();
  registerIpc();
  await applyRuntime(store.get());

  await ensureWheel();
  initializeBackend().catch((error) => console.error(`Backend initialization failed: ${error.message}`));
}

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => {
  wheel?.stop();
  hotkeys?.clear();
  plugins?.dispose();
  backend?.stop();
});
app.on('window-all-closed', () => { /* tray application intentionally remains alive */ });

if (!needsXwaylandRelaunch) {
  start().catch((error) => {
    console.error(error);
    app.quit();
  });
}
