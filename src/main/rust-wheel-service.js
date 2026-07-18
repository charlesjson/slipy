'use strict';

const { WheelDispatcher } = require('./wheel-dispatch');

class RustWheelService {
  constructor({ backend, screen, getSettings, runAction, onStatus = () => {}, onFailure = () => {} }) {
    this.backend = backend;
    this.screen = screen;
    this.onStatus = onStatus;
    this.dispatcher = new WheelDispatcher({ screen, getSettings, runAction });
    this.onWheel = (payload) => this.handleWheel(payload);
    this.onError = (payload) => {
      if (payload?.listenerId !== this.listenerId) return;
      const error = new Error(payload?.error || 'Rust X11 listener failed');
      this.startupError = error;
      this.onStatus({ wheelHook: 'failed', error: error.message });
      if (this.started) onFailure(error);
    };
    this.onUnavailable = (error) => onFailure(error);
    this.started = false;
    this.startupError = null;
    this.listenerId = RustWheelService.nextListenerId++;
    this.startAccepted = false;
  }

  async start() {
    if (!this.backend.isAvailable()) throw new Error('Rust backend is unavailable');
    this.backend.on('event:wheel', this.onWheel);
    this.backend.on('event:x11-wheel-error', this.onError);
    this.backend.on('unavailable', this.onUnavailable);
    try {
      await this.backend.request('start_x11_wheel', { listenerId: this.listenerId });
      this.startAccepted = true;
      if (this.startupError) throw this.startupError;
      this.started = true;
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  handleWheel(payload = {}) {
    if (!this.started || payload.listenerId !== this.listenerId) return;
    if (payload.direction !== 'up' && payload.direction !== 'down') return;
    const point = this.screen.getCursorScreenPoint();
    this.dispatcher.dispatch(point, payload.direction, { source: 'wheel' });
  }

  applySettings() { /* dispatcher reads settings for every event */ }

  stop() {
    this.removeListeners();
    if ((this.started || this.startAccepted) && this.backend.isAvailable()) this.backend.request('stop_x11_wheel').catch(() => {});
    this.started = false;
    this.startAccepted = false;
  }

  removeListeners() {
    this.backend.removeListener('event:wheel', this.onWheel);
    this.backend.removeListener('event:x11-wheel-error', this.onError);
    this.backend.removeListener('unavailable', this.onUnavailable);
  }
}

RustWheelService.nextListenerId = 1;

module.exports = { RustWheelService };
