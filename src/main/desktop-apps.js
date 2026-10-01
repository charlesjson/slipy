'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Application launching: discovery of freedesktop .desktop entries and
 * command candidates for the two launch kinds —
 *   { kind: 'desktop', entry: '/…/app.desktop' }  a discovered application
 *   { kind: 'exec', command: '/usr/bin/mpv --fs' } a user-typed command line
 */

/**
 * Shell-like tokenizer for user command lines and Exec= values: whitespace
 * separates arguments, single/double quotes group, backslash escapes inside
 * double quotes and outside quotes. Returns [] for unbalanced quotes.
 */
function splitArgs(line) {
  const args = [];
  let current = '';
  let quote = null;
  let started = false;
  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];
    if (quote) {
      if (character === quote) quote = null;
      else if (character === '\\' && quote === '"' && i + 1 < line.length) current += line[++i];
      else current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (character === '\\' && i + 1 < line.length) {
      current += line[++i];
    } else if (/\s/.test(character)) {
      if (started || current) args.push(current);
      current = '';
      started = false;
    } else {
      current += character;
    }
  }
  if (started || current) args.push(current);
  return quote ? [] : args;
}

/** Exec= value → argv: tokenize, drop field codes (%f, %U, …), unescape %%. */
function execArgv(execLine) {
  return splitArgs(String(execLine || ''))
    .map((argument) => argument.replace(/%%/g, '\0'))
    .filter((argument) => !/%[fFuUdDnNickvm]/.test(argument))
    .map((argument) => argument.replace(/\0/g, '%'));
}

/** 'zh-CN' → ['zh_CN', 'zh'] lookup order for localized entry keys. */
function localeCandidates(language) {
  const tag = String(language || '').replace('-', '_');
  const base = tag.split('_')[0];
  return [...new Set([tag, base])].filter(Boolean);
}

/** Reads the [Desktop Entry] group of a .desktop file. */
function parseDesktopEntry(text, language) {
  const values = {};
  let inEntry = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) { inEntry = line === '[Desktop Entry]'; continue; }
    if (!inEntry) continue;
    const equals = line.indexOf('=');
    if (equals < 0) continue;
    values[line.slice(0, equals).trim()] = line.slice(equals + 1).trim();
  }
  const localized = (key) => {
    for (const locale of localeCandidates(language)) {
      if (values[`${key}[${locale}]`] !== undefined) return values[`${key}[${locale}]`];
    }
    return values[key];
  };
  return {
    type: values.Type,
    name: localized('Name'),
    exec: values.Exec,
    dbusActivatable: values.DBusActivatable === 'true',
    noDisplay: values.NoDisplay === 'true',
    hidden: values.Hidden === 'true',
    terminal: values.Terminal === 'true'
  };
}

/** XDG application directories in precedence order (first wins). */
function applicationDirs(env, home = env.HOME || '') {
  const fallbackHome = home && path.isAbsolute(home) ? path.join(home, '.local', 'share') : '';
  const dataHome = env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : fallbackHome;
  const dataDirs = (env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':');
  return [...new Set([dataHome, ...dataDirs].filter((dir) => dir && path.isAbsolute(dir))
    .map((dir) => path.join(dir, 'applications')))];
}

/**
 * Launchable applications visible in menus, sorted by display name:
 * [{ id, name, file }]. Subdirectories map to dashed ids per the spec
 * (kde4/ark.desktop → kde4-ark), and earlier directories shadow later ones.
 */
function listApplications(dirs, language) {
  const byId = new Map();
  const seen = new Set();
  for (const dir of dirs) {
    let names = [];
    try { names = fs.readdirSync(dir, { recursive: true }); } catch { continue; }
    for (const name of names.map(String)) {
      if (!name.endsWith('.desktop')) continue;
      const id = name.split(path.sep).join('-').replace(/\.desktop$/, '');
      if (seen.has(id)) continue;
      let entry;
      try { entry = parseDesktopEntry(fs.readFileSync(path.join(dir, name), 'utf8'), language); } catch { continue; }
      // Higher-priority entries also shadow lower-priority ones when hidden
      // or incomplete. Hidden=true is commonly a minimal deletion marker.
      seen.add(id);
      if (entry.type !== 'Application' || !entry.name || (!entry.exec && !entry.dbusActivatable)) continue;
      if (entry.noDisplay || entry.hidden) continue;
      byId.set(id, { id, name: entry.name, file: path.join(dir, name) });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Candidates (see action-backends.js) for a launch configuration, or null
 * when it is invalid. gio/gtk-launch handle DBus activation, Terminal= and
 * field codes properly, so the hand-rolled Exec parse is only a fallback.
 */
function launchCandidates(launch) {
  if (!launch || typeof launch !== 'object') return null;
  if (launch.kind === 'exec') {
    const argv = splitArgs(String(launch.command || ''));
    if (!argv.length) return null;
    return [{ run: (tools) => tools.launch(argv[0], argv.slice(1)) }];
  }
  if (launch.kind === 'desktop') {
    const file = String(launch.entry || '');
    if (!file.endsWith('.desktop')) return null;
    return [
      { command: 'gio', args: ['launch', file] },
      { command: 'gtk-launch', args: [path.basename(file, '.desktop')] },
      {
        run: (tools) => {
          const entry = parseDesktopEntry(fs.readFileSync(file, 'utf8'));
          const argv = execArgv(entry.exec);
          if (!argv.length) throw new Error(require('./i18n').t('error.noExec', { file }));
          return tools.launch(argv[0], argv.slice(1));
        }
      }
    ];
  }
  return null;
}

module.exports = { splitArgs, execArgv, parseDesktopEntry, applicationDirs, listApplications, launchCandidates };
