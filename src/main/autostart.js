'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function desktopQuote(value) {
  return '"' + String(value).replace(/([\\"`$])/g, '\\$1') + '"';
}

class Autostart {
  constructor({ appName, executable, appArgs = [], configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config') }) {
    this.appName = appName;
    this.executable = executable;
    this.appArgs = appArgs;
    this.file = path.join(configHome, 'autostart', 'slipy.desktop');
  }

  set(enabled) {
    if (!enabled) {
      try { fs.unlinkSync(this.file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return false;
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const command = [this.executable, ...this.appArgs, '--hidden'].map(desktopQuote).join(' ');
    const contents = [
      '[Desktop Entry]', 'Type=Application', `Name=${this.appName}`, `Exec=${command}`,
      'Terminal=false', 'X-GNOME-Autostart-enabled=true', 'StartupNotify=false', ''
    ].join('\n');
    fs.writeFileSync(this.file, contents, { mode: 0o600 });
    return true;
  }

  isEnabled() { return fs.existsSync(this.file); }
}

module.exports = { Autostart, desktopQuote };
