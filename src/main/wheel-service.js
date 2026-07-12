'use strict';

const { detectZone, WheelGate } = require('./region-engine');

class WheelService {
  constructor({ screen, getSettings, runAction, onStatus = () => {} }) {
    this.screen = screen;
    this.getSettings = getSettings;
    this.runAction = runAction;
    this.onStatus = onStatus;
    this.hook = null;
    this.listener = null;
    this.gate = new WheelGate();
  }

  start() {
    try {
      this.hook = require('uiohook-napi').uIOhook;
      this.listener = (event) => this.onWheel(event);
      this.hook.on('wheel', this.listener);
      this.hook.start();
      this.onStatus({ wheelHook: 'running', error: null });
    } catch (error) {
      this.onStatus({ wheelHook: 'failed', error: error.message });
    }
  }

  onWheel(event) {
    // libuiohook sends horizontal and vertical wheels to this listener.
    // WheelDirection.VERTICAL is 3.
    if (event.direction !== undefined && event.direction !== 3) return;
    const settings = this.getSettings();
    this.gate.cooldownMs = settings.wheelCooldownMs;
    // uiohook uses native X11 pixels while Electron display bounds use DIP.
    // Electron's cursor point keeps the point and bounds in one coordinate space.
    const cursor = this.screen.getCursorScreenPoint?.() || event;
    const point = { x: Number(cursor.x), y: Number(cursor.y) };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const display = this.screen.getDisplayNearestPoint(point);
    const zone = detectZone(point, display.bounds, settings);
    if (!zone) return;
    const direction = event.rotation < 0 ? 'up' : 'down';
    if (!this.gate.accept(zone, direction)) return;
    const mapping = settings.zones[zone];
    this.runAction(mapping[direction], { pluginAction: mapping[`${direction}PluginAction`] }, {
      source: 'wheel', zone, direction, point, displayId: display.id
    });
  }

  stop() {
    if (!this.hook) return;
    if (this.listener) this.hook.off('wheel', this.listener);
    try { this.hook.stop(); } catch { /* already stopped */ }
    this.hook = null;
  }
}

module.exports = { WheelService };
