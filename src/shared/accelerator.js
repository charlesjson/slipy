'use strict';

/**
 * Electron accelerator helpers shared by the renderer (shortcut recorder,
 * validation, duplicate detection) and the test suite. UMD-style like
 * shared/locales.js: require()-able from Node, window.SLIPY_ACCELERATOR in
 * the sandboxed renderer.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.SLIPY_ACCELERATOR = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MODIFIERS = new Set([
    'ctrl', 'control', 'alt', 'option', 'altgr', 'shift',
    'super', 'meta', 'cmd', 'command', 'cmdorctrl', 'commandorcontrol'
  ]);

  // Slipy only runs on Linux, where Electron resolves the Command aliases to
  // Control — fold them together so duplicate detection matches registration.
  const CANONICAL_MODIFIER = {
    control: 'ctrl', option: 'alt', altgr: 'alt', meta: 'super',
    cmd: 'ctrl', command: 'ctrl', cmdorctrl: 'ctrl', commandorcontrol: 'ctrl'
  };

  const KEY_PATTERN = new RegExp(
    '^([0-9A-Z]|F([1-9]|1[0-9]|2[0-4])' +
    '|[)!@#$%^&*(:;+=<,_\\-\\.>/?~`{\\]\\[|\\\\}"\']' +
    '|Plus|Space|Tab|Capslock|Numlock|Scrolllock|Backspace|Delete|Insert' +
    '|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Esc' +
    '|VolumeUp|VolumeDown|VolumeMute|MediaNextTrack|MediaPreviousTrack' +
    '|MediaStop|MediaPlayPause|PrintScreen' +
    '|num[0-9]|numdec|numadd|numsub|nummult|numdiv)$', 'i');

  // KeyboardEvent.code → Electron accelerator key, for codes that do not
  // follow one of the regular KeyX / DigitX / NumpadX / Fn shapes.
  const CODE_KEYS = {
    Space: 'Space', Tab: 'Tab', Enter: 'Return', Backspace: 'Backspace',
    Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
    PageUp: 'PageUp', PageDown: 'PageDown', PrintScreen: 'PrintScreen',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.',
    Slash: '/', Backquote: '`',
    NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult',
    NumpadDivide: 'numdiv', NumpadDecimal: 'numdec'
  };

  function keyFromCode(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`;
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
    return CODE_KEYS[code] || null;
  }

  /**
   * Builds an Electron accelerator from a KeyboardEvent. Returns null while
   * only modifiers are held, for keys with no accelerator equivalent, and for
   * bare non-function keys: a global shortcut on an unmodified letter would
   * swallow that key desktop-wide.
   */
  function acceleratorFromEvent(event) {
    const key = keyFromCode(event.code);
    if (!key) return null;
    const modifiers = [];
    if (event.ctrlKey) modifiers.push('Ctrl');
    if (event.altKey) modifiers.push('Alt');
    if (event.shiftKey) modifiers.push('Shift');
    if (event.metaKey) modifiers.push('Super');
    if (!modifiers.length && !/^F\d+$/.test(key)) return null;
    return [...modifiers, key].join('+');
  }

  /** Splits an accelerator into { modifiers, key }, or returns null. */
  function parseAccelerator(text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    const parts = text.trim().split('+');
    if (parts.some((part) => part === '')) return null;
    const modifiers = [];
    let key = null;
    for (const part of parts) {
      if (MODIFIERS.has(part.toLowerCase())) { modifiers.push(part); continue; }
      if (key !== null || !KEY_PATTERN.test(part)) return null;
      key = part;
    }
    return key === null ? null : { modifiers, key };
  }

  function isValidAccelerator(text) {
    return parseAccelerator(text) !== null;
  }

  /**
   * Order- and case-insensitive comparable form, e.g. 'Shift+Control+W' and
   * 'ctrl+shift+w' both become 'ctrl+shift+w'. Null for invalid accelerators.
   */
  function canonicalAccelerator(text) {
    const parsed = parseAccelerator(text);
    if (!parsed) return null;
    const modifiers = parsed.modifiers
      .map((part) => CANONICAL_MODIFIER[part.toLowerCase()] || part.toLowerCase())
      .sort();
    const key = parsed.key.toLowerCase() === 'return' ? 'enter' : parsed.key.toLowerCase();
    return [...new Set(modifiers), key].join('+');
  }

  return { acceleratorFromEvent, parseAccelerator, isValidAccelerator, canonicalAccelerator };
});
