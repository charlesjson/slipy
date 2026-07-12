'use strict';

class HotkeyManager {
  constructor(globalShortcut, runAction) {
    this.globalShortcut = globalShortcut;
    this.runAction = runAction;
    this.registered = [];
  }

  apply(shortcuts) {
    this.clear();
    const results = [];
    for (const shortcut of shortcuts) {
      if (!shortcut.enabled || !shortcut.accelerator) {
        results.push({ id: shortcut.id, ok: true, inactive: true });
        continue;
      }
      let ok = false;
      try {
        ok = this.globalShortcut.register(shortcut.accelerator, () => this.runAction(
          shortcut.action,
          { pluginAction: shortcut.pluginAction },
          { source: 'shortcut', accelerator: shortcut.accelerator }
        ));
      } catch { ok = false; }
      if (ok) this.registered.push(shortcut.accelerator);
      results.push({ id: shortcut.id, ok, error: ok ? null : '快捷键无效或已被其他程序占用' });
    }
    return results;
  }

  clear() {
    for (const accelerator of this.registered) this.globalShortcut.unregister(accelerator);
    this.registered = [];
  }
}

module.exports = { HotkeyManager };
