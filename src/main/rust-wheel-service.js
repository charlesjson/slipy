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
    this.listenerId = null;
    this.startRequested = false;
    this.startAccepted = false;
    this.generation = 0;
  }

  async start() {
    if (this.started) return;
    if (this.startRequested) throw new Error('Rust X11 listener is already starting');
    if (!this.backend.isAvailable()) throw new Error('Rust backend is unavailable');
    const generation = ++this.generation;
    this.listenerId = RustWheelService.nextListenerId++;
    this.startupError = null;
    this.backend.on('event:wheel', this.onWheel);
    this.backend.on('event:x11-wheel-error', this.onError);
    this.backend.on('unavailable', this.onUnavailable);
    this.startRequested = true;
    try {
      await this.backend.request('start_x11_wheel', { listenerId: this.listenerId });
      if (generation !== this.generation) throw new Error('Rust X11 listener was stopped');
      this.startAccepted = true;
      if (this.startupError) throw this.startupError;
      this.started = true;
    } catch (error) {
      if (generation === this.generation) {
        // An explicit rejection proves this request did not acquire a listener.
        if (!this.startAccepted && error.backendResponse) this.startRequested = false;
        this.stop();
      }
      throw error;
    }
  }

  handleWheel(payload = {}) {
    if (!this.started || payload?.listenerId !== this.listenerId) return;
    if (payload.direction !== 'up' && payload.direction !== 'down') return;
    const point = this.screen.getCursorScreenPoint();
    this.dispatcher.dispatch(point, payload.direction, { source: 'wheel' });
  }

  applySettings() { /* dispatcher reads settings for every event */ }

  stop() {
    this.generation += 1;
    this.removeListeners();
    // Older sidecars ignore listenerId on stop. Only an acknowledgement proves
    // ownership there; scoped-stop sidecars can also clean up an uncertain start.
    const cleanup = this.startAccepted || (this.startRequested && this.backend.supports?.('listener-scoped-stop'));
    this.started = false;
    this.startRequested = false;
    this.startAccepted = false;
    if (cleanup && this.backend.isAvailable()) {
      this.backend.request('stop_x11_wheel', { listenerId: this.listenerId }).catch(() => {});
    }
  }

  removeListeners() {
    this.backend.removeListener('event:wheel', this.onWheel);
    this.backend.removeListener('event:x11-wheel-error', this.onError);
    this.backend.removeListener('unavailable', this.onUnavailable);
  }
}

RustWheelService.nextListenerId = 1;

module.exports = { RustWheelService };
