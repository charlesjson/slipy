'use strict';

const path = require('node:path');
const { WheelDispatcher } = require('./wheel-dispatch');
const { activeEdges, stripRects } = require('./edge-layout');

/**
 * Wayland input backend. Compositors do not allow global input snooping, so
 * instead of hooking the pointer we park thin transparent always-on-top
 * windows on the configured screen edges: the compositor delivers wheel
 * events to them through the ordinary event path whenever the cursor touches
 * an edge. Works on any compositor (and doubles as an X11 fallback when
 * libuiohook is unavailable).
 *
 * Trade-off: the strips own their pixels, so clicks landing on the outermost
 * edge band hit the overlay. Only edges that actually have actions get strips.
 */
class EdgeWheelService {
  constructor({ electron, getSettings, runAction, onStatus = () => {} }) {
    this.electron = electron; // { BrowserWindow, screen, ipcMain }
    this.getSettings = getSettings;
    this.onStatus = onStatus;
    this.dispatcher = new WheelDispatcher({ screen: electron.screen, getSettings, runAction });
    this.windows = new Set();
    this.rebuildTimer = null;
    this.onDisplayChange = () => this.scheduleRebuild();
    this.onWheelMessage = (event, payload) => this.handleWheel(event, payload);
  }

  start() {
    const { screen, ipcMain } = this.electron;
    ipcMain.on('slipy:edge-wheel', this.onWheelMessage);
    for (const signal of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(signal, this.onDisplayChange);
    }
    this.build();
    this.onStatus({ wheelHook: 'running', error: null });
  }

  build() {
    const settings = this.getSettings();
    const edges = activeEdges(settings.zones);
    for (const display of this.electron.screen.getAllDisplays()) {
      for (const rect of stripRects(display.bounds, settings.edgeThickness, edges)) {
        this.createStrip(rect);
      }
    }
  }

  createStrip(rect) {
    const win = new this.electron.BrowserWindow({
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      frame: false, transparent: true, hasShadow: false, show: false,
      skipTaskbar: true, focusable: false, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false,
      alwaysOnTop: true, type: 'dock',
      webPreferences: {
        preload: path.join(__dirname, '../edge-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setMenuBarVisibility(false);
    win.loadFile(path.join(__dirname, '../renderer/edge.html'));
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) {
        win.showInactive();
        // Some window managers re-place frameless windows on show.
        win.setBounds(rect);
      }
    });
    this.windows.add(win);
    win.on('closed', () => this.windows.delete(win));
  }

  handleWheel(event, payload = {}) {
    const win = this.electron.BrowserWindow.fromWebContents(event.sender);
    if (!win || !this.windows.has(win)) return;
    const deltaX = Number(payload.deltaX) || 0;
    const deltaY = Number(payload.deltaY) || 0;
    if (Math.abs(deltaX) > Math.abs(deltaY) || deltaY === 0) return;
    const bounds = win.getBounds();
    const point = { x: bounds.x + Number(payload.x), y: bounds.y + Number(payload.y) };
    this.dispatcher.dispatch(point, deltaY < 0 ? 'up' : 'down', { source: 'wheel' });
  }

  scheduleRebuild() {
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => this.rebuild(), 250);
  }

  rebuild() {
    for (const win of [...this.windows]) win.destroy();
    this.windows.clear();
    this.build();
  }

  applySettings() { this.scheduleRebuild(); }

  stop() {
    clearTimeout(this.rebuildTimer);
    this.electron.ipcMain.removeListener('slipy:edge-wheel', this.onWheelMessage);
    for (const signal of ['display-added', 'display-removed', 'display-metrics-changed']) {
      this.electron.screen.removeListener(signal, this.onDisplayChange);
    }
    for (const win of [...this.windows]) win.destroy();
    this.windows.clear();
  }
}

module.exports = { EdgeWheelService };
