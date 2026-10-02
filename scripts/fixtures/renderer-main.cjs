'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');

// Every fixture uses temporary Chromium storage supplied by the launcher.
// No application startup, global shortcuts, plugins or native hooks run.
app.setPath('userData', process.env.SLIPY_RENDERER_USER_DATA);
app.disableHardwareAcceleration();
// X11 also works through XWayland and xvfb-run; permit native Wayland runs
// explicitly without coupling these DOM checks to a compositor's lifetime.
app.commandLine.appendSwitch('ozone-platform', process.env.SLIPY_RENDERER_OZONE_PLATFORM || 'x11');
app.on('window-all-closed', () => {});
const root = process.env.SLIPY_RENDERER_ROOT || path.join(__dirname, '../..');
const fixtures = new Map();
const results = [];
const clone = (value) => JSON.parse(JSON.stringify(value));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const zones = ['topLeft', 'top', 'topRight', 'left', 'right', 'bottomLeft', 'bottom', 'bottomRight'];

function makeState(language = 'zh-CN') {
  return {
    settings: {
      version: 2, edgeThickness: 8, cornerSize: 96, wheelCooldownMs: 220,
      inputBackend: 'auto', language, theme: 'dark', closeAction: 'ask', startAtLogin: false,
      zones: Object.fromEntries(zones.map((zone) => [zone, { up: 'none', down: 'none' }])),
      shortcuts: [{ id: 'fixture-shortcut', accelerator: 'Super+Alt+Left', action: 'none', pluginAction: '', enabled: true }],
      plugins: {}
    },
    actions: [{ id: 'none', name: language === 'en' ? 'No action' : '不执行动作' }],
    pluginActions: [], plugins: [], apps: [],
    runtime: { wheelHook: 'running', wheelBackend: 'edge-windows', paused: false, shortcutResults: [], error: null },
    environment: {
      language, sessionType: 'wayland', desktop: 'KDE', desktopFamily: 'kde',
      tools: { wmctrl: false, xdotool: false, playerctl: true },
      pluginsDirectory: '/tmp/slipy-fixture-plugins', version: '0.1.0-test',
      packaged: false, uninstallAvailable: false, installScope: 'user'
    }
  };
}

ipcMain.handle('renderer-test:invoke', async (event, method, ...args) => {
  const fixture = fixtures.get(event.sender.id);
  if (!fixture) throw new Error('Unknown renderer fixture');
  fixture.calls.push({ method, args: clone(args) });
  if (fixture.failures[method]) throw new Error(fixture.failures[method]);
  if (fixture.holds.has(method)) await new Promise((resolve) => { fixture.pending[method] = resolve; });
  switch (method) {
    case 'getState': return clone(fixture.state);
    case 'saveSettings': {
      const settings = clone(args[0]);
      if (fixture.holdSave) await new Promise((resolve) => { fixture.finishSave = resolve; });
      fixture.state.settings = settings;
      return clone(fixture.state);
    }
    case 'setPaused':
      fixture.state.runtime.paused = Boolean(args[0]);
      return clone(fixture.state);
    case 'restartInput': return clone(fixture.state);
    case 'resetSettings':
      fixture.state.settings = makeState(fixture.state.environment.language).settings;
      return { canceled: false, state: clone(fixture.state) };
    case 'testAction': return fixture.testResult || { ok: true };
    case 'exportSettings': return { canceled: true };
    case 'importSettings':
      if (!fixture.importedSettings) return { canceled: true };
      fixture.state.settings = clone(fixture.importedSettings);
      return { canceled: false, state: clone(fixture.state) };
    case 'openPluginsDirectory': return fixture.openDirectoryError || '';
    default: return { ok: true };
  }
});

async function waitFor(fixture, predicate, message, timeout = 2500) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await predicate()) return;
    await delay(20);
  }
  throw new Error(message);
}

async function createFixture({ language = 'zh-CN', modify, initialFailure } = {}) {
  const fixture = { state: makeState(language), failures: {}, calls: [], holdSave: false, holds: new Set(), pending: {} };
  if (modify) modify(fixture.state);
  if (initialFailure) fixture.failures.getState = initialFailure;
  fixture.window = new BrowserWindow({
    width: 1120, height: 760, useContentSize: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'renderer-preload.cjs'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
    }
  });
  fixture.run = (code) => fixture.window.webContents.executeJavaScript(code);
  fixtures.set(fixture.window.webContents.id, fixture);
  await fixture.window.loadFile(path.join(root, 'src/renderer/index.html'));
  await waitFor(fixture, () => fixture.run(initialFailure
    ? `document.body.innerText.includes(${JSON.stringify(initialFailure)})`
    : "document.querySelector('#zone-up').options.length > 0"), 'Renderer did not initialize or show a startup error');
  await fixture.run(`
    window.confirm = () => true;
    window.alert = (message) => { window.__alerts.push(String(message)); };
    window.__alerts = [];
    window.__unhandled = [];
    window.addEventListener('unhandledrejection', (event) => {
      window.__unhandled.push(String(event.reason));
      event.preventDefault();
    });
  `);
  return fixture;
}

async function check(name, action, options) {
  let fixture;
  process.stderr.write(`renderer: ${name}\n`);
  try {
    fixture = await createFixture(options);
    await action(fixture);
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error.stack || String(error) });
  } finally {
    if (fixture) {
      if (fixture.finishSave) fixture.finishSave();
      for (const finish of Object.values(fixture.pending)) finish();
      fixtures.delete(fixture.window.webContents.id);
      fixture.window.destroy();
    }
  }
}

function setCloseAction(value) {
  return `document.querySelector('#close-action').value = ${JSON.stringify(value)};
    document.querySelector('#close-action').dispatchEvent(new Event('change', { bubbles: true }));`;
}

async function main() {
  await app.whenReady();

  await check('desktop and tray icons decode to visible native images', async () => {
    const { getWindowIcon, getTrayIcon } = require(path.join(root, 'src/main/icons'));
    for (const [name, icon] of [['window', getWindowIcon(nativeImage)], ['tray', getTrayIcon(nativeImage)]]) {
      assert.equal(icon.isEmpty(), false, `${name} icon must not be empty`);
      assert.ok(icon.toBitmap().some((byte, index) => index % 4 === 3 && byte > 0), `${name} icon must have visible pixels`);
    }
    assert.deepEqual(getTrayIcon(nativeImage).getSize(), { width: 32, height: 32 });
  });

  await check('runtime broadcasts preserve an unsaved close action', async (fixture) => {
    await fixture.run(setCloseAction('tray'));
    fixture.window.webContents.send('runtime:state', clone(fixture.state));
    await delay(40);
    assert.equal(await fixture.run("document.querySelector('#close-action').value"), 'tray');
    await fixture.run("document.querySelector('#save-button').click()");
    await waitFor(fixture, async () => fixture.calls.some((call) => call.method === 'saveSettings'), 'Save was not invoked');
    assert.equal(fixture.calls.find((call) => call.method === 'saveSettings').args[0].closeAction, 'tray');
  });

  await check('edits made while saving survive the save response', async (fixture) => {
    fixture.holdSave = true;
    await fixture.run(`${setCloseAction('tray')} document.querySelector('#save-button').click();`);
    await waitFor(fixture, async () => Boolean(fixture.finishSave), 'Save did not start');
    await fixture.run(setCloseAction('quit'));
    fixture.finishSave();
    await waitFor(fixture, () => fixture.run("!document.querySelector('#save-button').disabled"), 'Save remained busy');
    assert.equal(await fixture.run("document.querySelector('#close-action').value"), 'quit');
    assert.match(await fixture.run("document.querySelector('#save-note').textContent"), /未保存|Unsaved/);
    assert.equal(await fixture.run("document.querySelector('#discard-button').disabled"), false);
    fixture.holdSave = false;
    await fixture.run("document.querySelector('#save-button').click()");
    await waitFor(fixture, async () => fixture.calls.filter((call) => call.method === 'saveSettings').length === 2, 'Second save did not start');
    assert.equal(fixture.calls.filter((call) => call.method === 'saveSettings')[1].args[0].closeAction, 'quit');
  });

  await check('export includes the current unsaved draft', async (fixture) => {
    await fixture.run(`${setCloseAction('quit')} document.querySelector('#export-config').click();`);
    await waitFor(fixture, async () => fixture.calls.some((call) => call.method === 'exportSettings'), 'Export was not invoked');
    assert.equal(fixture.calls.find((call) => call.method === 'exportSettings').args[0]?.closeAction, 'quit');
    assert.equal(fixture.state.settings.closeAction, 'ask', 'Export must not implicitly apply the draft');
  });

  for (const [method, selector] of [['importSettings', '#import-config'], ['resetSettings', '#reset-config']]) {
    await check(`${method} applies returned settings while retaining edits made during the operation`, async (fixture) => {
      fixture.holds.add(method);
      fixture.importedSettings = makeState().settings;
      fixture.importedSettings.edgeThickness = 22;
      await fixture.run(`${setCloseAction('tray')}
        document.querySelector('#edge-thickness').value = '32';
        document.querySelector('#edge-thickness').dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('${selector}').click();`);
      await waitFor(fixture, async () => Boolean(fixture.pending[method]), 'Settings operation did not start');
      await fixture.run(setCloseAction('quit'));
      fixture.pending[method]();
      await waitFor(fixture, () => fixture.run(`!document.querySelector('${selector}').disabled`), 'Settings operation remained busy');
      assert.equal(await fixture.run("document.querySelector('#close-action').value"), 'quit');
      assert.equal(await fixture.run("document.querySelector('#edge-thickness').value"), method === 'importSettings' ? '22' : '8');
      assert.match(await fixture.run("document.querySelector('#save-note').textContent"), /未保存|Unsaved/);
    });
  }

  await check('startup failure supports retry without duplicate event handlers', async (fixture) => {
    assert.equal(await fixture.run("document.querySelector('#startup-retry').hidden"), false);
    delete fixture.failures.getState;
    await fixture.run("document.querySelector('#startup-retry').click()");
    await waitFor(fixture, () => fixture.run("document.querySelector('#startup-panel').hidden"), 'Retry did not initialize the renderer');
    await fixture.run("document.querySelector('#add-shortcut').click()");
    assert.equal(await fixture.run("document.querySelectorAll('.shortcut').length"), 2);
    assert.equal(fixture.calls.filter((call) => call.method === 'getState').length, 2);
  }, { initialFailure: 'fixture-startup-failure' });

  await check('open-directory error strings are displayed', async (fixture) => {
    fixture.openDirectoryError = 'fixture-open-directory-failure';
    await fixture.run("document.querySelector('.nav[data-page=plugins]').click(); document.querySelector('#open-plugins').click()");
    await waitFor(fixture, () => fixture.run("document.body.innerText.includes('fixture-open-directory-failure')"), 'Directory failure was not shown');
    assert.equal(await fixture.run("document.querySelector('#open-plugins').disabled"), false);
    assert.deepEqual(await fixture.run('window.__unhandled'), []);
  });

  for (const [method, selector] of [['saveSettings', '#save-button'], ['setPaused', '#pause-button']]) {
    await check(`repeated ${method} clicks invoke only one pending operation`, async (fixture) => {
      fixture.holds.add(method);
      await fixture.run(`document.querySelector('${selector}').click(); document.querySelector('${selector}').click();`);
      await waitFor(fixture, async () => Boolean(fixture.pending[method]), 'Operation did not start');
      assert.equal(fixture.calls.filter((call) => call.method === method).length, 1);
      fixture.pending[method]();
      await waitFor(fixture, () => fixture.run(`!document.querySelector('${selector}').disabled`), 'Operation remained busy');
    });
  }

  await check('a completed action test does not overwrite another zone', async (fixture) => {
    fixture.holds.add('testAction');
    fixture.testResult = { ok: false, error: 'fixture-old-zone-result' };
    await fixture.run("document.querySelector('#test-up').click()");
    await waitFor(fixture, async () => Boolean(fixture.pending.testAction), 'Action test did not start');
    await fixture.run("document.querySelector('#zone-grid button[data-zone=topRight]').click()");
    fixture.pending.testAction();
    await delay(60);
    assert.equal(await fixture.run("document.querySelector('#test-result').textContent"), '');
    await fixture.run("document.querySelector('#zone-grid button[data-zone=topLeft]').click()");
    assert.equal(await fixture.run("document.querySelector('#test-up').disabled"), false);
  }, { modify: (state) => {
    state.actions.push({ id: 'volume-up', name: 'Volume up' });
    state.settings.zones.topLeft.up = 'volume-up';
  } });

  await check('the first mouse click deletes a shortcut after editing its accelerator', async (fixture) => {
    await fixture.run(`
      document.querySelector('.nav[data-page="shortcuts"]').click();
      const accelerator = document.querySelector('.shortcut input[type="text"]');
      accelerator.focus(); accelerator.select();
    `);
    await fixture.window.webContents.insertText('Super+Alt+Right');
    assert.equal(await fixture.run("document.querySelector('.shortcut input[type=\"text\"]').value"), 'Super+Alt+Right');
    const position = await fixture.run(`(() => {
      const bounds = document.querySelector('.shortcut .icon-button:not(.record)').getBoundingClientRect();
      return { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) };
    })()`);
    const click = async () => {
      fixture.window.webContents.sendInputEvent({ type: 'mouseMove', ...position });
      fixture.window.webContents.sendInputEvent({ type: 'mouseDown', ...position, button: 'left', clickCount: 1 });
      fixture.window.webContents.sendInputEvent({ type: 'mouseUp', ...position, button: 'left', clickCount: 1 });
      await delay(60);
      return fixture.run("document.querySelectorAll('.shortcut').length");
    };
    const afterFirstClick = await click();
    const afterSecondClick = afterFirstClick ? await click() : 0;
    assert.equal(afterFirstClick, 0, `First physical click left ${afterFirstClick} rows; second click left ${afterSecondClick}`);
  });

  for (const interruption of ['navigation', 'blur']) {
    await check(`shortcut recording stops on ${interruption}`, async (fixture) => {
      await fixture.run(`
        document.querySelector('.nav[data-page="shortcuts"]').click();
        document.querySelector('.shortcut .record').click();
      `);
      assert.equal(await fixture.run("Boolean(document.querySelector('.record.recording'))"), true);
      await fixture.run(interruption === 'navigation'
        ? "document.querySelector('.nav[data-page=\"general\"]').click()"
        : "window.dispatchEvent(new Event('blur'))");
      const outcome = await fixture.run(`(() => {
        const key = new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true });
        window.dispatchEvent(key);
        return { prevented: key.defaultPrevented, recording: Boolean(document.querySelector('.record.recording')), value: document.querySelector('.shortcut input[type="text"]').value };
      })()`);
      assert.equal(outcome.prevented, false, 'A hidden recorder still captures keyboard input');
      assert.equal(outcome.recording, false);
      assert.equal(outcome.value, 'Super+Alt+Left');
    });
  }

  await check('missing plugin actions remain selected and survive save', async (fixture) => {
    assert.equal(await fixture.run("document.querySelector('#zone-up').value"), 'plugin:missing/action');
    assert.equal(await fixture.run("document.querySelector('.shortcut select').value"), 'plugin:missing/action');
    await fixture.run("document.querySelector('#save-button').click()");
    await waitFor(fixture, async () => fixture.calls.some((call) => call.method === 'saveSettings'), 'Save was not invoked');
    const settings = fixture.calls.find((call) => call.method === 'saveSettings').args[0];
    assert.equal(settings.zones.topLeft.upPluginAction, 'missing/action');
    assert.equal(settings.shortcuts[0].pluginAction, 'missing/action');
  }, { modify: (state) => {
    state.settings.zones.topLeft = { up: 'plugin-action', upPluginAction: 'missing/action', down: 'none' };
    state.settings.shortcuts[0].action = 'plugin-action';
    state.settings.shortcuts[0].pluginAction = 'missing/action';
  } });

  for (const [method, selector, page] of [
    ['setPaused', '#pause-button', 'zones'],
    ['resetSettings', '#reset-config', 'general']
  ]) {
    await check(`${method} errors are visible and its button recovers`, async (fixture) => {
      const message = `fixture-${method}-failure`;
      fixture.failures[method] = message;
      await fixture.run(`document.querySelector('.nav[data-page="${page}"]').click(); document.querySelector('${selector}').click();`);
      await waitFor(fixture, () => fixture.run(`document.body.innerText.includes(${JSON.stringify(message)}) || window.__alerts.some((message) => message.includes(${JSON.stringify(message)}))`), 'IPC error was not shown to the user');
      assert.equal(await fixture.run(`document.querySelector('${selector}').disabled`), false);
      assert.deepEqual(await fixture.run('window.__unhandled'), []);
      delete fixture.failures[method];
      await fixture.run(`document.querySelector('${selector}').click()`);
      await waitFor(fixture, async () => fixture.calls.filter((call) => call.method === method).length === 2, 'Button did not allow retry');
      await waitFor(fixture, () => fixture.run(`!document.querySelector('${selector}').disabled`), 'Button remained busy after retry');
    });
  }

  for (const language of ['zh-CN', 'en']) {
    for (const width of [1120, 1024, 880, 720]) {
      await check(`all five ${language} pages fit a ${width}px window`, async (fixture) => {
        fixture.window.setContentSize(width, 760);
        await delay(40);
        const overflows = [];
        for (const page of ['zones', 'shortcuts', 'plugins', 'general', 'about']) {
          await fixture.run(`document.querySelector('.nav[data-page="${page}"]').click()`);
          const screenshotName = language === 'zh-CN' && width === 1120 && page === 'zones' ? 'zones-1120-zh-dark.png'
            : language === 'en' && width === 880 && page === 'general' ? 'general-880-en-light.png'
              : language === 'en' && width === 720 && page === 'shortcuts' ? 'shortcuts-720-en-dark.png' : null;
          if (screenshotName && process.env.SLIPY_RENDERER_SCREENSHOTS) {
            await fixture.window.webContents.insertCSS('*, *::before, *::after { animation: none !important; transition: none !important; }');
            if (page === 'general') await fixture.run("document.querySelector('.theme-picker button[data-theme=light]').click()");
            // A hidden Chromium view may have stale compositor surfaces even
            // after layout finishes. Warm up capture, then capture a fresh frame.
            await fixture.window.webContents.capturePage();
            await delay(150);
            const screenshot = await fixture.window.webContents.capturePage();
            fs.mkdirSync(process.env.SLIPY_RENDERER_SCREENSHOTS, { recursive: true });
            fs.writeFileSync(path.join(process.env.SLIPY_RENDERER_SCREENSHOTS, screenshotName), screenshot.toPNG());
          }
          const dimensions = await fixture.run(`(() => ({
            viewport: window.innerWidth,
            document: document.documentElement.scrollWidth,
            offenders: [...document.querySelectorAll('body *')].filter((element) => {
              const bounds = element.getBoundingClientRect();
              return bounds.width > 0 && (bounds.right > window.innerWidth + 1 || bounds.left < -1);
            }).slice(0, 6).map((element) => element.id || element.className || element.tagName)
          }))()`);
          if (dimensions.document > dimensions.viewport + 1) overflows.push({ page, ...dimensions });
        }
        assert.deepEqual(overflows, [], JSON.stringify(overflows));
      }, { language });
    }
  }

  process.stdout.write(`SLIPY_RENDERER_RESULTS=${JSON.stringify(results)}\n`);
  app.exit(0);
}

main().catch((error) => {
  process.stdout.write(`SLIPY_RENDERER_RESULTS=${JSON.stringify([{ name: 'Renderer fixture setup', ok: false, error: error.stack || String(error) }])}\n`);
  app.exit(1);
});
