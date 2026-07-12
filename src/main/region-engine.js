'use strict';

/**
 * Returns one of the eight configurable edge zones, or null. Corners take
 * precedence over edges. Bounds and points use Electron's DIP coordinates.
 */
function detectZone(point, bounds, options) {
  const edge = Math.max(1, Number(options.edgeThickness) || 1);
  const corner = Math.max(edge, Number(options.cornerSize) || edge);
  const x = point.x - bounds.x;
  const y = point.y - bounds.y;

  if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) return null;

  const atLeft = x < edge;
  const atRight = x >= bounds.width - edge;
  const atTop = y < edge;
  const atBottom = y >= bounds.height - edge;
  const nearLeft = x < corner;
  const nearRight = x >= bounds.width - corner;
  const nearTop = y < corner;
  const nearBottom = y >= bounds.height - corner;

  if (nearLeft && nearTop && (atLeft || atTop)) return 'topLeft';
  if (nearRight && nearTop && (atRight || atTop)) return 'topRight';
  if (nearLeft && nearBottom && (atLeft || atBottom)) return 'bottomLeft';
  if (nearRight && nearBottom && (atRight || atBottom)) return 'bottomRight';
  if (atTop) return 'top';
  if (atBottom) return 'bottom';
  if (atLeft) return 'left';
  if (atRight) return 'right';
  return null;
}

class WheelGate {
  constructor(cooldownMs = 220) {
    this.cooldownMs = cooldownMs;
    this.last = new Map();
  }

  accept(zone, direction, now = Date.now()) {
    const key = `${zone}:${direction}`;
    const previous = this.last.get(key) || 0;
    if (now - previous < this.cooldownMs) return false;
    this.last.set(key, now);
    return true;
  }
}

module.exports = { detectZone, WheelGate };
