'use strict';

const { WheelDispatcher } = require('./wheel-dispatch');

/**
 * X11 input backend: a global libuiohook listener. Does not work on Wayland,
 * where compositors isolate input per client — EdgeWheelService covers that.
 */
class WheelService {
  constructor({ screen, getSettings, runAction, onStatus = () => {} }) {
    this.screen = screen;
    this.onStatus = onStatus;
    this.hook = null;
    this.listener = null;
    this.dispatcher = new WheelDispatcher({ screen, getSettings, runAction });
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
      throw error;
    }
  }

  onWheel(event) {
    // libuiohook sends horizontal and vertical wheels to this listener.
    // WheelDirection.VERTICAL is 3.
    if (event.direction !== undefined && event.direction !== 3) return;
    // uiohook uses native X11 pixels while Electron display bounds use DIP.
    // Electron's cursor point keeps the point and bounds in one coordinate space.
    const cursor = this.screen.getCursorScreenPoint?.() || event;
    const point = { x: Number(cursor.x), y: Number(cursor.y) };
    this.dispatcher.dispatch(point, event.rotation < 0 ? 'up' : 'down', { source: 'wheel' });
  }

  applySettings() { /* uiohook needs no rebuild on settings changes */ }

  stop() {
    if (!this.hook) return;
    if (this.listener) this.hook.off('wheel', this.listener);
    try { this.hook.stop(); } catch { /* already stopped */ }
    this.hook = null;
  }
}

module.exports = { WheelService };
