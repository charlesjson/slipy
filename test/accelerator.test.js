'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { acceleratorFromEvent, isValidAccelerator, canonicalAccelerator } = require('../src/shared/accelerator');

function event(code, modifiers = {}) {
  return { code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers };
}

test('builds accelerators from keyboard events', () => {
  assert.equal(acceleratorFromEvent(event('KeyW', { metaKey: true, shiftKey: true })), 'Shift+Super+W');
  assert.equal(acceleratorFromEvent(event('Digit3', { ctrlKey: true })), 'Ctrl+3');
  assert.equal(acceleratorFromEvent(event('ArrowLeft', { altKey: true, metaKey: true })), 'Alt+Super+Left');
  assert.equal(acceleratorFromEvent(event('Numpad7', { ctrlKey: true })), 'Ctrl+num7');
  assert.equal(acceleratorFromEvent(event('Comma', { ctrlKey: true })), 'Ctrl+,');
});

test('waits while only modifiers are held and rejects bare keys', () => {
  assert.equal(acceleratorFromEvent(event('ControlLeft', { ctrlKey: true })), null);
  // an unmodified letter would swallow the key desktop-wide
  assert.equal(acceleratorFromEvent(event('KeyA')), null);
  // function keys are the exception: fine without modifiers
  assert.equal(acceleratorFromEvent(event('F9')), 'F9');
});

test('validates accelerator format', () => {
  for (const good of ['Super+Shift+W', 'ctrl+alt+Left', 'F13', 'CmdOrCtrl+Plus', 'Super+num0', 'Ctrl+`']) {
    assert.equal(isValidAccelerator(good), true, good);
  }
  for (const bad of ['', 'Super+', 'Super', 'Ctrl+Foo', 'Ctrl+A+B', 'Ctrl + A', 'F25']) {
    assert.equal(isValidAccelerator(bad), false, bad);
  }
});

test('canonical form ignores order, case and Linux modifier aliases', () => {
  assert.equal(canonicalAccelerator('Shift+Control+W'), canonicalAccelerator('ctrl+shift+w'));
  assert.equal(canonicalAccelerator('CmdOrCtrl+Return'), canonicalAccelerator('Ctrl+Enter'));
  assert.notEqual(canonicalAccelerator('Ctrl+W'), canonicalAccelerator('Super+W'));
  assert.equal(canonicalAccelerator('not valid'), null);
});
