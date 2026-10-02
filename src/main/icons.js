'use strict';

const path = require('node:path');

function getWindowIcon(nativeImage) {
  const image = nativeImage.createFromPath(path.join(__dirname, '../../assets/icon.png'));
  if (image.isEmpty()) throw new Error('Slipy application icon could not be loaded');
  return image;
}

function getTrayIcon(nativeImage) {
  // NativeImage does not decode SVG. Reuse the PNG branding so the tray has
  // visible pixels on both light and dark panels, including from app.asar.
  return getWindowIcon(nativeImage).resize({ width: 32, height: 32, quality: 'best' });
}

module.exports = { getWindowIcon, getTrayIcon };
