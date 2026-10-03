'use strict';

let state;
let draft;
let selectedZone = 'topLeft';
let settingsBusy = false;
let testSequence = 0;
let testBusy = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const FALLBACK_LANGUAGE = 'en';

function t(key, params) {
  const language = state?.environment?.language || FALLBACK_LANGUAGE;
  const table = window.SLIPY_LOCALES[language] || window.SLIPY_LOCALES[FALLBACK_LANGUAGE];
  let template = table[key] ?? window.SLIPY_LOCALES[FALLBACK_LANGUAGE][key] ?? key;
  if (params) template = template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
  return template;
}

function applyI18n() {
  document.documentElement.lang = state.environment.language;
  for (const element of $$('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  // *Html keys hold trusted literals from our own dictionary only.
  for (const element of $$('[data-i18n-html]')) element.innerHTML = t(element.dataset.i18nHtml);
  for (const element of $$('[data-i18n-title]')) element.title = t(element.dataset.i18nTitle);
  for (const element of $$('[data-i18n-label]')) element.setAttribute('aria-label', t(element.dataset.i18nLabel));
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $$('.theme-picker button').forEach((button) => {
    const active = button.dataset.theme === theme;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function option(value, text) {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = text;
  return element;
}

function fillActionSelect(select, value, pluginAction = '', launch = null) {
  select.replaceChildren();
  for (const action of state.actions) select.append(option(action.id, action.name));
  if (state.pluginActions.length) {
    const group = document.createElement('optgroup');
    group.label = t('plugins.actionsGroup');
    for (const action of state.pluginActions) group.append(option(`plugin:${action.id}`, action.name));
    select.append(group);
  }
  const apps = document.createElement('optgroup');
  apps.label = t('apps.group');
  apps.append(option('exec', t('apps.custom')));
  for (const app of state.apps || []) apps.append(option(`app:${app.file}`, app.name));
  select.append(apps);

  let wanted = value;
  if (value === 'plugin-action') wanted = `plugin:${pluginAction}`;
  else if (value === 'launch-app') wanted = launch?.kind === 'desktop' ? `app:${launch.entry}` : 'exec';
  select.value = wanted;
  if (select.selectedIndex < 0) {
    if (value === 'launch-app' && launch?.kind === 'desktop') {
      // The entry is configured but no longer installed — keep it selectable
      // instead of silently rewriting the configuration to 'none'.
      const name = launch.entry.split('/').pop().replace(/\.desktop$/, '');
      apps.append(option(wanted, t('apps.missing', { name })));
      select.value = wanted;
    } else if (value === 'plugin-action') {
      select.append(option(wanted, t('plugins.missingAction', { name: pluginAction })));
      select.value = wanted;
    } else {
      select.value = 'none';
    }
  }
}

// Select values encode the action family: 'plugin:<id>' → plugin-action,
// 'app:<file>'/'exec' → launch-app; everything else is a built-in action.
// For 'exec' the command line lives in a sibling input the caller owns.
function readActionSelect(select) {
  if (select.value.startsWith('plugin:')) return { action: 'plugin-action', pluginAction: select.value.slice(7), launch: null };
  if (select.value.startsWith('app:')) return { action: 'launch-app', pluginAction: '', launch: { kind: 'desktop', entry: select.value.slice(4) } };
  if (select.value === 'exec') return { action: 'launch-app', pluginAction: '', launch: { kind: 'exec', command: '' } };
  return { action: select.value, pluginAction: '', launch: null };
}

function syncZoneCommand(direction) {
  const mapping = draft.zones[selectedZone];
  const input = $(`#zone-${direction}-command`);
  const launch = mapping[`${direction}Launch`];
  const isExec = mapping[direction] === 'launch-app' && launch?.kind === 'exec';
  input.hidden = !isExec;
  input.placeholder = t('apps.commandPlaceholder');
  input.value = isExec ? launch.command || '' : '';
}

function renderZone() {
  renderZoneOverview();
  $('#zone-name').textContent = t(`zone.${selectedZone}`);
  const mapping = draft.zones[selectedZone];
  fillActionSelect($('#zone-up'), mapping.up, mapping.upPluginAction, mapping.upLaunch);
  fillActionSelect($('#zone-down'), mapping.down, mapping.downPluginAction, mapping.downLaunch);
  syncZoneCommand('up');
  syncZoneCommand('down');
  updateTestButtons();
}

function actionName(mapping, direction) {
  const action = mapping[direction];
  if (action === 'plugin-action') return state.pluginActions.find((item) => item.id === mapping[`${direction}PluginAction`])?.name
    || t('plugins.missingAction', { name: mapping[`${direction}PluginAction`] });
  if (action === 'launch-app') {
    const launch = mapping[`${direction}Launch`];
    return launch?.kind === 'exec' ? launch.command || t('apps.custom')
      : (state.apps || []).find((item) => item.file === launch?.entry)?.name || launch?.entry || t('apps.custom');
  }
  return state.actions.find((item) => item.id === action)?.name || action;
}

function renderZoneOverview() {
  let configured = 0;
  $$('#zone-grid button').forEach((button) => {
    const mapping = draft.zones[button.dataset.zone];
    const active = button.dataset.zone === selectedZone;
    const assigned = mapping.up !== 'none' || mapping.down !== 'none';
    if (assigned) configured += 1;
    button.classList.toggle('active', active);
    button.classList.toggle('configured', assigned);
    button.setAttribute('aria-pressed', String(active));
    button.title = `${t(`zone.${button.dataset.zone}`)} · ↑ ${actionName(mapping, 'up')} · ↓ ${actionName(mapping, 'down')}`;
  });
  $('#zone-summary').textContent = t('zones.configured', { count: configured });
}

function updateTestButtons() {
  for (const direction of ['up', 'down']) {
    const mapping = draft.zones[selectedZone];
    const launch = mapping[`${direction}Launch`];
    $(`#test-${direction}`).disabled = testBusy || mapping[direction] === 'none'
      || (mapping[direction] === 'launch-app' && (!launch || (launch.kind === 'exec' && !launch.command?.trim())));
  }
}

function clearTestResult() {
  testSequence += 1;
  $('#test-result').textContent = '';
  $('#test-result').classList.remove('ok', 'error');
}

function commitZone(direction) {
  const value = readActionSelect($(`#zone-${direction}`));
  if (value.launch?.kind === 'exec') value.launch.command = $(`#zone-${direction}-command`).value;
  draft.zones[selectedZone][direction] = value.action;
  draft.zones[selectedZone][`${direction}PluginAction`] = value.pluginAction;
  draft.zones[selectedZone][`${direction}Launch`] = value.launch;
  syncZoneCommand(direction);
  clearTestResult();
  renderZoneOverview();
  updateTestButtons();
  markDirty();
}

let recorder = null;

function stopRecording() {
  if (!recorder) return;
  window.removeEventListener('keydown', recorder.onKey, true);
  recorder.button.classList.remove('recording');
  recorder.button.textContent = t('shortcuts.recordButton');
  recorder.button.setAttribute('aria-pressed', 'false');
  recorder.input.value = recorder.shortcut.accelerator;
  recorder.input.placeholder = t('shortcuts.placeholder');
  recorder = null;
}

function startRecording(shortcut, input, button) {
  if (recorder?.button === button) return stopRecording();
  stopRecording();
  const onKey = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.code === 'Escape' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) return stopRecording();
    const accelerator = window.SLIPY_ACCELERATOR.acceleratorFromEvent(event);
    if (!accelerator) return; // modifiers still held, or a bare key — keep waiting
    shortcut.accelerator = accelerator;
    stopRecording();
    renderShortcuts();
    markDirty();
  };
  recorder = { shortcut, input, button, onKey };
  button.classList.add('recording');
  button.textContent = t('shortcuts.cancelRecording');
  button.setAttribute('aria-pressed', 'true');
  input.focus();
  input.value = '';
  input.placeholder = t('shortcuts.recording');
  window.addEventListener('keydown', onKey, true);
}

function createShortcutRow(shortcut) {
  const row = document.createElement('div');
  row.className = 'panel shortcut';
  row.dataset.id = shortcut.id;
  const enabled = document.createElement('input');
  enabled.type = 'checkbox'; enabled.className = 'enabled'; enabled.checked = shortcut.enabled;
  enabled.title = t('shortcuts.enable');
  enabled.setAttribute('aria-label', t('shortcuts.enable'));
  const accelerator = document.createElement('input');
  accelerator.type = 'text'; accelerator.value = shortcut.accelerator; accelerator.placeholder = t('shortcuts.placeholder');
  accelerator.setAttribute('aria-label', t('shortcuts.keys'));
  const record = document.createElement('button');
  record.className = 'record-button record'; record.textContent = t('shortcuts.recordButton'); record.title = t('shortcuts.record');
  record.setAttribute('aria-label', t('shortcuts.record'));
  record.setAttribute('aria-pressed', 'false');
  const action = document.createElement('select');
  fillActionSelect(action, shortcut.action, shortcut.pluginAction, shortcut.launch);
  action.setAttribute('aria-label', t('shortcuts.action'));
  const remove = document.createElement('button');
  remove.className = 'icon-button'; remove.textContent = '×'; remove.title = t('shortcuts.remove');
  remove.setAttribute('aria-label', t('shortcuts.remove'));
  row.append(enabled, accelerator, record, action, remove);

  const command = document.createElement('input');
  command.type = 'text'; command.className = 'command-input';
  command.placeholder = t('apps.commandPlaceholder');
  command.setAttribute('aria-label', t('apps.custom'));
  const isExec = shortcut.action === 'launch-app' && shortcut.launch?.kind === 'exec';
  command.value = isExec ? shortcut.launch.command || '' : '';
  command.hidden = !isExec;
  row.append(command);

  const error = document.createElement('span'); error.className = 'shortcut-error'; error.hidden = true; row.append(error);
  enabled.addEventListener('change', () => { shortcut.enabled = enabled.checked; updateShortcutProblems(); markDirty(); });
  accelerator.addEventListener('input', () => { shortcut.accelerator = accelerator.value; updateShortcutProblems(); markDirty(); });
  record.addEventListener('click', () => startRecording(shortcut, accelerator, record));
  action.addEventListener('change', () => {
    const value = readActionSelect(action);
    if (value.launch?.kind === 'exec') value.launch.command = command.value;
    Object.assign(shortcut, value);
    command.hidden = !(value.launch?.kind === 'exec');
    updateShortcutProblems();
    markDirty();
  });
  command.addEventListener('input', () => { shortcut.launch = { kind: 'exec', command: command.value }; updateShortcutProblems(); markDirty(); });
  remove.addEventListener('click', () => { stopRecording(); draft.shortcuts = draft.shortcuts.filter((item) => item.id !== shortcut.id); renderShortcuts(); markDirty(); });
  return row;
}

// Format and duplicate problems are flagged before saving; conflicts with
// other applications can only be reported after registration and arrive via
// runtime.shortcutResults.
function shortcutProblems() {
  const { isValidAccelerator, canonicalAccelerator } = window.SLIPY_ACCELERATOR;
  const counts = new Map();
  for (const shortcut of draft.shortcuts) {
    if (!shortcut.enabled) continue;
    const canonical = canonicalAccelerator(shortcut.accelerator);
    if (canonical) counts.set(canonical, (counts.get(canonical) || 0) + 1);
  }
  return draft.shortcuts.map((shortcut) => {
    if (!shortcut.enabled) return null;
    if (shortcut.action === 'launch-app' && (!shortcut.launch || (shortcut.launch.kind === 'exec' && !shortcut.launch.command?.trim()))) {
      return t('shortcuts.missingCommand');
    }
    if (!shortcut.accelerator) return t('shortcuts.invalid');
    if (!isValidAccelerator(shortcut.accelerator)) return t('shortcuts.invalid');
    if (counts.get(canonicalAccelerator(shortcut.accelerator)) > 1) return t('shortcuts.duplicate');
    return null;
  });
}

function renderShortcuts() {
  stopRecording();
  const list = $('#shortcut-list');
  list.replaceChildren(...draft.shortcuts.map(createShortcutRow));
  updateShortcutProblems();
  $('#shortcut-empty').classList.toggle('visible', draft.shortcuts.length === 0);
}

function updateShortcutProblems() {
  // Keep inputs and click targets mounted while editing. Replacing a row on
  // blur/change discards the target between mouseDown and click.
  const problems = shortcutProblems();
  $$('#shortcut-list .shortcut').forEach((row, index) => {
    const shortcut = draft.shortcuts[index];
    const saved = state.settings.shortcuts.find((item) => item.id === shortcut.id);
    const result = sameValue(saved, shortcut) && shortcut.enabled
      ? state.runtime.shortcutResults?.find((item) => item.id === shortcut.id) : null;
    const message = problems[index] || (result && !result.ok ? result.error : null);
    const error = row.querySelector('.shortcut-error');
    error.textContent = message || '';
    error.hidden = !message;
  });
}

function renderPlugins() {
  const list = $('#plugin-list'); list.replaceChildren();
  if (!state.plugins.length) {
    const empty = document.createElement('div'); empty.className = 'empty visible';
    const title = document.createElement('b'); title.textContent = t('plugins.noneTitle');
    const text = document.createElement('span'); text.textContent = t('plugins.noneBody');
    empty.append(title, text); list.append(empty); return;
  }
  for (const plugin of state.plugins) {
    const card = document.createElement('div'); card.className = 'panel plugin-card';
    const heading = document.createElement('div'); heading.className = 'plugin-title';
    const info = document.createElement('div');
    const name = document.createElement('h3'); name.textContent = plugin.name;
    const meta = document.createElement('span'); meta.className = 'plugin-meta'; meta.textContent = `${plugin.id} · v${plugin.version}`;
    info.append(name, meta);
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.className = 'toggle';
    toggle.checked = draft.plugins[plugin.id] === true; toggle.disabled = plugin.id.startsWith('invalid:');
    toggle.setAttribute('aria-label', t('plugins.enable', { name: plugin.name }));
    toggle.addEventListener('change', () => { draft.plugins[plugin.id] = toggle.checked; markDirty(); });
    heading.append(info, toggle); card.append(heading);
    const description = document.createElement('p'); description.textContent = plugin.description || t('plugins.noDesc'); card.append(description);
    if (plugin.error) { const error = document.createElement('p'); error.className = 'plugin-error'; error.textContent = t('plugins.loadError', { message: plugin.error }); card.append(error); }
    list.append(card);
  }
}

function renderGeneral() {
  $('#edge-thickness').value = draft.edgeThickness; $('#edge-output').textContent = `${draft.edgeThickness} px`;
  $('#corner-size').value = draft.cornerSize; $('#corner-output').textContent = `${draft.cornerSize} px`;
  $('#cooldown').value = draft.wheelCooldownMs; $('#cooldown-output').textContent = `${draft.wheelCooldownMs} ms`;
  $('#input-backend').value = draft.inputBackend || 'auto';
  $('#close-action').value = draft.closeAction || 'ask';
  $('#language').value = draft.language || 'auto';
  $('#start-at-login').checked = draft.startAtLogin;
}

function renderStatus() {
  const hook = state.runtime.wheelHook;
  const paused = state.runtime.paused;
  const status = $('#hook-status'); status.className = `status-dot ${paused ? 'paused' : hook === 'running' ? 'ok' : hook === 'failed' ? 'error' : ''}`;
  status.querySelector('span').textContent = paused ? t('status.paused') : hook === 'running' ? t('status.running') : hook === 'failed' ? t('status.failed') : t('status.starting');
  $('#pause-button').textContent = paused ? t('pause.resume') : t('pause.button');
  $('#pause-button').setAttribute('aria-pressed', String(paused));
  $('#restart-input').disabled = paused || $('#restart-input').dataset.busy === 'true';
  $('#diag-hook').textContent = paused ? t('diag.paused') : hook === 'running' ? t('diag.running') : hook === 'failed' ? t('diag.failed') : t('diag.starting');
  $('#diag-error').textContent = state.runtime.error || '—';
  $('#diag-backend').textContent = state.runtime.wheelBackend ? t(`backend.${state.runtime.wheelBackend}`) : '—';
  $('#diag-session').textContent = state.environment.sessionType;
  $('#diag-desktop').textContent = state.environment.desktop;
  const tools = $('#diag-tools'); tools.replaceChildren();
  for (const [tool, available] of Object.entries(state.environment.tools || {})) {
    const chip = document.createElement('span');
    chip.className = `tool-chip ${available ? 'ok' : ''}`;
    chip.textContent = `${available ? '✓' : '✕'} ${tool}`;
    tools.append(chip);
  }
  $('#diag-version').textContent = state.environment.version;
  const uninstall = $('#uninstall-button');
  uninstall.disabled = !state.environment.uninstallAvailable;
  const scopeKey = state.environment.installScope === 'system' ? 'uninstall.scopeSystem'
    : state.environment.installScope === 'appimage' ? 'uninstall.scopeAppimage' : 'uninstall.scopeUser';
  // Packaged but unrecognized layout means a distribution package (deb/rpm/
  // pacman) — those are removed through the system package manager.
  $('#uninstall-note').textContent = state.environment.uninstallAvailable
    ? t('uninstall.note', { target: t(scopeKey) })
    : t(state.environment.packaged ? 'uninstall.notePackage' : 'uninstall.noteNone');
}

function renderAll() { applyI18n(); applyTheme(draft.theme); renderZone(); renderShortcuts(); renderPlugins(); renderGeneral(); renderStatus(); updatePageTitle(); updateDirty(); }

// ipcRenderer.invoke rejections are wrapped as
// "Error invoking remote method 'x': Error: <message>" — keep the message.
function ipcMessage(error) {
  return String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}
function sameValue(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// Merge values changed elsewhere only where the user has not edited locally.
// Shortcut arrays are one editable unit, so additions/removals keep their order.
function mergeDraft(base, local, next) {
  if (sameValue(base, local)) return structuredClone(next);
  if (base && local && next && !Array.isArray(local)
      && typeof base === 'object' && typeof local === 'object' && typeof next === 'object') {
    const result = {};
    for (const key of new Set([...Object.keys(next), ...Object.keys(local)])) {
      const value = mergeDraft(base[key], local[key], next[key]);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }
  return structuredClone(local);
}

function updateDirty() {
  const dirty = !sameValue(draft, state.settings);
  $('#save-note').textContent = dirty ? t('save.dirty') : '';
  $('#save-note').classList.remove('error');
  $('#discard-button').disabled = settingsBusy || !dirty;
  document.title = `${dirty ? '• ' : ''}Slipy`;
  return dirty;
}

function markDirty() { updateDirty(); }

function setSettingsBusy(busy, saving = false) {
  settingsBusy = busy;
  for (const id of ['save-button', 'export-config', 'import-config', 'reset-config']) $(`#${id}`).disabled = busy;
  $('#save-button').textContent = t(busy && saving ? 'save.saving' : 'save.button');
  $('#save-button').setAttribute('aria-busy', String(busy));
  $('#discard-button').disabled = busy || sameValue(draft, state.settings);
}

function showError(error) {
  $('#app-message').textContent = t('operation.failed', { message: ipcMessage(error) });
  $('#app-message').hidden = false;
}

async function runOperation(button, operation) {
  if (button.dataset.busy === 'true') return;
  button.dataset.busy = 'true'; button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  $('#app-message').hidden = true;
  try { await operation(); }
  catch (error) { showError(error); }
  finally {
    delete button.dataset.busy; button.disabled = false;
    button.setAttribute('aria-busy', 'false');
    renderStatus();
  }
}

function receiveState(next) {
  const previous = state.settings;
  if (!settingsBusy) draft = mergeDraft(previous, draft, next.settings);
  state = next;
  if (!settingsBusy && !sameValue(previous, next.settings)) renderAll();
  else renderStatus();
}

function updatePageTitle() {
  const active = $('.nav.active .nav-label');
  if (active) $('#page-title').textContent = active.textContent;
}

async function save() {
  if (settingsBusy) return;
  stopRecording();
  const submitted = structuredClone(draft);
  setSettingsBusy(true, true);
  try {
    const next = await window.slipy.saveSettings(submitted);
    draft = mergeDraft(submitted, draft, next.settings);
    state = next;
    renderAll();
    if (!updateDirty()) $('#save-note').textContent = t('save.saved');
    setTimeout(() => { if ($('#save-note').textContent === t('save.saved')) $('#save-note').textContent = ''; }, 1800);
  } catch (error) {
    $('#save-note').classList.add('error');
    $('#save-note').textContent = t('save.failed', { message: ipcMessage(error) });
  } finally { setSettingsBusy(false); }
}

async function testZone(direction) {
  if (testBusy) return;
  const sequence = ++testSequence;
  const mapping = structuredClone(draft.zones[selectedZone]);
  testBusy = true;
  updateTestButtons();
  const output = $('#test-result');
  output.classList.remove('ok', 'error');
  output.textContent = t('zones.testRunning');
  try {
    const result = await window.slipy.testAction(mapping[direction], {
      pluginAction: mapping[`${direction}PluginAction`],
      launch: mapping[`${direction}Launch`]
    });
    if (sequence !== testSequence) return;
    output.classList.add(result.ok ? 'ok' : 'error');
    output.textContent = result.ok ? t('zones.testOk') : t('zones.testFailed', { message: result.error });
  } catch (error) {
    if (sequence !== testSequence) return;
    output.classList.add('error');
    output.textContent = t('zones.testFailed', { message: ipcMessage(error) });
  } finally { testBusy = false; updateTestButtons(); }
}

function adoptState(next, previousDraft) {
  draft = previousDraft ? mergeDraft(previousDraft, draft, next.settings) : structuredClone(next.settings);
  state = next;
  renderAll();
  clearTestResult();
}

function bind() {
  $$('.nav').forEach((button) => button.addEventListener('click', () => {
    stopRecording();
    $$('.nav').forEach((item) => { item.classList.remove('active'); item.removeAttribute('aria-current'); });
    button.classList.add('active'); button.setAttribute('aria-current', 'page');
    $$('.page').forEach((page) => page.classList.remove('active')); $(`#page-${button.dataset.page}`).classList.add('active');
    updatePageTitle();
  }));
  $$('.theme-picker button').forEach((button) => button.addEventListener('click', () => {
    draft.theme = button.dataset.theme; applyTheme(draft.theme); markDirty();
  }));
  $$('#zone-grid button').forEach((button) => button.addEventListener('click', () => { selectedZone = button.dataset.zone; clearTestResult(); renderZone(); }));
  $('#zone-up').addEventListener('change', () => commitZone('up'));
  $('#zone-down').addEventListener('change', () => commitZone('down'));
  for (const direction of ['up', 'down']) {
    $(`#zone-${direction}-command`).addEventListener('input', (event) => {
      draft.zones[selectedZone][`${direction}Launch`] = { kind: 'exec', command: event.target.value };
      clearTestResult(); renderZoneOverview(); updateTestButtons();
      markDirty();
    });
  }
  $('#test-up').addEventListener('click', () => testZone('up'));
  $('#test-down').addEventListener('click', () => testZone('down'));
  $('#add-shortcut').addEventListener('click', () => {
    draft.shortcuts.push({ id: crypto.randomUUID(), accelerator: '', action: 'none', pluginAction: '', enabled: true }); renderShortcuts(); markDirty();
    $('#shortcut-list .shortcut:last-child input[type="text"]').focus();
  });
  for (const [id, output, key, suffix] of [['edge-thickness','edge-output','edgeThickness',' px'], ['corner-size','corner-output','cornerSize',' px'], ['cooldown','cooldown-output','wheelCooldownMs',' ms']]) {
    $(`#${id}`).addEventListener('input', (event) => { draft[key] = Number(event.target.value); $(`#${output}`).textContent = `${event.target.value}${suffix}`; markDirty(); });
  }
  $('#input-backend').addEventListener('change', (event) => { draft.inputBackend = event.target.value; markDirty(); });
  $('#close-action').addEventListener('change', (event) => { draft.closeAction = event.target.value; markDirty(); });
  $('#language').addEventListener('change', (event) => { draft.language = event.target.value; markDirty(); });
  $('#start-at-login').addEventListener('change', (event) => { draft.startAtLogin = event.target.checked; markDirty(); });
  $('#save-button').addEventListener('click', save);
  $('#discard-button').addEventListener('click', () => {
    if (!settingsBusy && window.confirm(t('save.discardConfirm'))) adoptState(state);
  });
  window.addEventListener('blur', stopRecording);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopRecording(); });
  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.code === 'KeyS') {
      event.preventDefault(); save();
    }
  });
  $('#pause-button').addEventListener('click', (event) => runOperation(event.currentTarget, async () => {
    receiveState(await window.slipy.setPaused(!state.runtime.paused));
  }));
  $('#restart-input').addEventListener('click', (event) => runOperation(event.currentTarget, async () => {
    receiveState(await window.slipy.restartInput());
  }));
  $('#export-config').addEventListener('click', async () => {
    if (settingsBusy) return;
    setSettingsBusy(true);
    try {
      const result = await window.slipy.exportSettings(structuredClone(draft));
      if (!result.canceled) $('#config-note').textContent = t('config.exported', { path: result.path });
    } catch (error) { $('#config-note').textContent = ipcMessage(error); }
    finally { setSettingsBusy(false); }
  });
  $('#import-config').addEventListener('click', async () => {
    if (settingsBusy) return;
    if (!window.confirm(t('config.importConfirm'))) return;
    const previousDraft = structuredClone(draft);
    setSettingsBusy(true);
    try {
      const result = await window.slipy.importSettings();
      if (result.canceled) return;
      adoptState(result.state, previousDraft);
      $('#config-note').textContent = t('config.imported');
    } catch (error) { $('#config-note').textContent = ipcMessage(error); }
    finally { setSettingsBusy(false); }
  });
  $('#reset-config').addEventListener('click', async () => {
    if (settingsBusy) return;
    if (!window.confirm(t('config.resetConfirm'))) return;
    const previousDraft = structuredClone(draft);
    setSettingsBusy(true);
    try {
      const result = await window.slipy.resetSettings();
      if (!result.canceled) { adoptState(result.state, previousDraft); $('#config-note').textContent = t('config.resetDone'); }
    } catch (error) { $('#config-note').textContent = ipcMessage(error); }
    finally { setSettingsBusy(false); }
  });
  $('#open-plugins').addEventListener('click', (event) => runOperation(event.currentTarget, async () => {
    const error = await window.slipy.openPluginsDirectory();
    if (error) throw new Error(error);
  }));
  $('#quit-button').addEventListener('click', (event) => runOperation(event.currentTarget, () => window.slipy.quit()));
  $('#uninstall-button').addEventListener('click', async () => {
    if (!window.confirm(t('uninstall.confirm'))) return;
    const button = $('#uninstall-button');
    button.disabled = true; button.textContent = t('uninstall.busy');
    try {
      const result = await window.slipy.uninstall();
      if (result.warnings?.length) window.alert(result.warnings.join('\n'));
    } catch (error) {
      button.disabled = false; button.textContent = t('about.uninstall');
      window.alert(error.message);
    }
  });
  window.slipy.onState(receiveState);
}

async function initialize() {
  $('#startup-retry').hidden = true;
  $('#startup-message').textContent = t('startup.loading');
  try {
    const initial = await window.slipy.getState();
    state = initial; draft = structuredClone(state.settings); renderAll(); bind();
    $('#startup-panel').hidden = true;
    $('main').inert = false; $('.sidebar').inert = false;
  } catch (error) {
    $('#startup-message').textContent = t('startup.failed', { message: ipcMessage(error) });
    $('#startup-retry').textContent = t('startup.retry');
    $('#startup-retry').hidden = false;
  }
}
$('#startup-retry').addEventListener('click', initialize);
initialize();
