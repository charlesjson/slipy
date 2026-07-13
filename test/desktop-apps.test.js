'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  splitArgs, execArgv, parseDesktopEntry, applicationDirs, listApplications, launchCandidates
} = require('../src/main/desktop-apps');

test('splitArgs handles quoting, escapes and unbalanced quotes', () => {
  assert.deepEqual(splitArgs('/usr/bin/mpv --fs'), ['/usr/bin/mpv', '--fs']);
  assert.deepEqual(splitArgs('"/opt/My App/run" --name "Jane Doe"'), ['/opt/My App/run', '--name', 'Jane Doe']);
  assert.deepEqual(splitArgs("echo 'a b'  c"), ['echo', 'a b', 'c']);
  assert.deepEqual(splitArgs('a\\ b'), ['a b']);
  assert.deepEqual(splitArgs('mpv ""'), ['mpv', '']);
  assert.deepEqual(splitArgs('broken "quote'), []);
  assert.deepEqual(splitArgs('   '), []);
});

test('execArgv strips field codes and unescapes percent signs', () => {
  assert.deepEqual(execArgv('firefox %u'), ['firefox']);
  assert.deepEqual(execArgv('env FOO=100%% vlc --started-from-file %U'), ['env', 'FOO=100%', 'vlc', '--started-from-file']);
});

test('parseDesktopEntry reads the entry group with locale fallback', () => {
  const text = [
    '# comment', '[Desktop Entry]', 'Type=Application', 'Name=Files',
    'Name[zh_CN]=文件', 'Exec=nautilus %U', 'Terminal=false',
    '[Desktop Action new-window]', 'Name=Ignored'
  ].join('\n');
  assert.equal(parseDesktopEntry(text, 'zh-CN').name, '文件');
  assert.equal(parseDesktopEntry(text, 'en').name, 'Files');
  assert.equal(parseDesktopEntry(text, 'en').exec, 'nautilus %U');
});

test('applicationDirs follows XDG precedence with defaults', () => {
  const dirs = applicationDirs({ XDG_DATA_HOME: '/custom/data', XDG_DATA_DIRS: '/a:/b' });
  assert.deepEqual(dirs, ['/custom/data/applications', '/a/applications', '/b/applications']);
  const fallback = applicationDirs({ HOME: '/home/u' });
  assert.equal(fallback[0], '/home/u/.local/share/applications');
  assert.ok(fallback.includes('/usr/share/applications'));
});

test('listApplications filters hidden entries, dedupes by id and sorts by name', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-apps-'));
  const user = path.join(root, 'user');
  const system = path.join(root, 'system', 'kde4');
  fs.mkdirSync(user, { recursive: true });
  fs.mkdirSync(system, { recursive: true });
  const write = (dir, name, lines) => fs.writeFileSync(path.join(dir, name), ['[Desktop Entry]', 'Type=Application', ...lines].join('\n'));
  write(user, 'zed.desktop', ['Name=Zed', 'Exec=zed']);
  write(user, 'shadowed.desktop', ['Name=User wins', 'Exec=a']);
  write(path.join(root, 'system'), 'shadowed.desktop', ['Name=System loses', 'Exec=b']);
  write(path.join(root, 'system'), 'hidden.desktop', ['Name=Hidden', 'Exec=x', 'NoDisplay=true']);
  write(path.join(root, 'system'), 'settings.desktop', ['Name=Not an app', 'Exec=x', 'Type=Service'].filter((line) => line !== 'Type=Application'));
  write(system, 'ark.desktop', ['Name=Ark', 'Exec=ark %U']);

  const apps = listApplications([user, path.join(root, 'system')], 'en');
  assert.deepEqual(apps.map((app) => app.name), ['Ark', 'User wins', 'Zed']);
  assert.equal(apps.find((app) => app.name === 'Ark').id, 'kde4-ark');
  assert.equal(apps.find((app) => app.name === 'User wins').file, path.join(user, 'shadowed.desktop'));
});

test('desktop launches try gio, then gtk-launch, then the Exec line itself', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipy-launch-'));
  const file = path.join(root, 'player.desktop');
  fs.writeFileSync(file, '[Desktop Entry]\nType=Application\nName=Player\nExec="/opt/my player/mpv" --fs %U\n');
  const candidates = launchCandidates({ kind: 'desktop', entry: file });
  assert.deepEqual([candidates[0].command, ...candidates[0].args], ['gio', 'launch', file]);
  assert.deepEqual([candidates[1].command, ...candidates[1].args], ['gtk-launch', 'player']);
  const launched = [];
  await candidates[2].run({ launch: async (command, args) => launched.push([command, args]) });
  assert.deepEqual(launched, [['/opt/my player/mpv', ['--fs']]]);
});

test('exec launches parse the command line and reject empty ones', async () => {
  const launched = [];
  const [candidate] = launchCandidates({ kind: 'exec', command: '"/usr/local/bin/my tool" --flag value' });
  await candidate.run({ launch: async (command, args) => launched.push([command, args]) });
  assert.deepEqual(launched, [['/usr/local/bin/my tool', ['--flag', 'value']]]);
  assert.equal(launchCandidates({ kind: 'exec', command: '  ' }), null);
  assert.equal(launchCandidates({ kind: 'desktop', entry: 'not-a-desktop-file' }), null);
  assert.equal(launchCandidates(undefined), null);
});
