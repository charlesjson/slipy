'use strict';

const { detectZone, WheelGate } = require('./region-engine');

/**
 * Turns a global cursor point plus wheel direction into a configured action.
 * Shared by both input backends (uiohook on X11, edge overlays on Wayland),
 * so debouncing behaves identically regardless of how the event arrived.
 */
class WheelDispatcher {
  constructor({ screen, getSettings, runAction }) {
    this.screen = screen;
    this.getSettings = getSettings;
    this.runAction = runAction;
    this.gate = new WheelGate();
  }

  dispatch(point, direction, meta = {}) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    const settings = this.getSettings();
    this.gate.cooldownMs = settings.wheelCooldownMs;
    const display = this.screen.getDisplayNearestPoint(point);
    const zone = detectZone(point, display.bounds, settings);
    if (!zone) return false;
    if (!this.gate.accept(zone, direction)) return false;
    const mapping = settings.zones[zone];
    this.runAction(mapping[direction], { pluginAction: mapping[`${direction}PluginAction`] }, {
      source: meta.source || 'wheel', zone, direction, point, displayId: display.id
    });
    return true;
  }
}

module.exports = { WheelDispatcher };
