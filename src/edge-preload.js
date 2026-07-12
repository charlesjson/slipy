'use strict';

const { ipcRenderer } = require('electron');

// Overlay strips only relay wheel gestures; coordinates are window-local and
// converted to screen space in the main process using the strip's bounds.
window.addEventListener('wheel', (event) => {
  ipcRenderer.send('slipy:edge-wheel', {
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    x: event.clientX,
    y: event.clientY
  });
}, { passive: true });
