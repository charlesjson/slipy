'use strict';

const ZONE_EDGES = {
  top: ['topLeft', 'top', 'topRight'],
  bottom: ['bottomLeft', 'bottom', 'bottomRight'],
  left: ['topLeft', 'left', 'bottomLeft'],
  right: ['topRight', 'right', 'bottomRight']
};

// Strips thinner than this are hard to hit with a cursor.
const MIN_STRIP = 2;

function activeEdges(zones) {
  const used = new Set(Object.entries(zones || {})
    .filter(([, mapping]) => (mapping?.up && mapping.up !== 'none') || (mapping?.down && mapping.down !== 'none'))
    .map(([zone]) => zone));
  return Object.keys(ZONE_EDGES).filter((edge) => ZONE_EDGES[edge].some((zone) => used.has(zone)));
}

/**
 * Rectangles (DIP, same space as Electron display bounds) for the overlay
 * strips of one display. Left/right strips are inset by the horizontal strip
 * thickness so no point is covered twice.
 */
function stripRects(bounds, edgeThickness, edges = ['top', 'bottom', 'left', 'right']) {
  const t = Math.min(Math.max(MIN_STRIP, Math.round(edgeThickness) || MIN_STRIP), Math.floor(Math.min(bounds.width, bounds.height) / 2));
  const wanted = new Set(edges);
  const insetTop = wanted.has('top') ? t : 0;
  const insetBottom = wanted.has('bottom') ? t : 0;
  const sideHeight = bounds.height - insetTop - insetBottom;
  const rects = [];
  if (wanted.has('top')) rects.push({ edge: 'top', x: bounds.x, y: bounds.y, width: bounds.width, height: t });
  if (wanted.has('bottom')) rects.push({ edge: 'bottom', x: bounds.x, y: bounds.y + bounds.height - t, width: bounds.width, height: t });
  if (wanted.has('left') && sideHeight > 0) rects.push({ edge: 'left', x: bounds.x, y: bounds.y + insetTop, width: t, height: sideHeight });
  if (wanted.has('right') && sideHeight > 0) rects.push({ edge: 'right', x: bounds.x + bounds.width - t, y: bounds.y + insetTop, width: t, height: sideHeight });
  return rects;
}

module.exports = { activeEdges, stripRects };
