'use strict';

let state;
let draft;
let selectedZone = 'topLeft';

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

function fillActionSelect(select, value, pluginAction = '') {
  select.replaceChildren();
  for (const action of state.actions) select.append(option(action.id, action.name));
  if (state.pluginActions.length) {
    const group = document.createElement('optgroup');
    group.label = t('plugins.actionsGroup');
    for (const action of state.pluginActions) group.append(option(`plugin:${action.id}`, action.name));
    select.append(group);
  }
  select.value = value === 'plugin-action' ? `plugin:${pluginAction}` : value;
  if (select.selectedIndex < 0) select.value = 'none';
}

function readActionSelect(select) {
  return select.value.startsWith('plugin:')
    ? { action: 'plugin-action', pluginAction: select.value.slice(7) }
    : { action: select.value, pluginAction: '' };
}

function renderZone() {
  $$('#zone-grid button').forEach((button) => button.classList.toggle('active', button.dataset.zone === selectedZone));
  $('#zone-name').textContent = t(`zone.${selectedZone}`);
  const mapping = draft.zones[selectedZone];
  fillActionSelect($('#zone-up'), mapping.up, mapping.upPluginAction);
  fillActionSelect($('#zone-down'), mapping.down, mapping.downPluginAction);
}

function commitZone(direction) {
  const value = readActionSelect($(`#zone-${direction}`));
  draft.zones[selectedZone][direction] = value.action;
  draft.zones[selectedZone][`${direction}PluginAction`] = value.pluginAction;
  markDirty();
}

function createShortcutRow(shortcut) {
  const row = document.createElement('div');
  row.className = 'panel shortcut';
  row.dataset.id = shortcut.id;
  const enabled = document.createElement('input');
  enabled.type = 'checkbox'; enabled.className = 'enabled'; enabled.checked = shortcut.enabled;
  enabled.title = t('shortcuts.enable');
  const accelerator = document.createElement('input');
  accelerator.type = 'text'; accelerator.value = shortcut.accelerator; accelerator.placeholder = t('shortcuts.placeholder');
  const action = document.createElement('select');
  fillActionSelect(action, shortcut.action, shortcut.pluginAction);
  const remove = document.createElement('button');
  remove.className = 'icon-button'; remove.textContent = '×'; remove.title = t('shortcuts.remove');
  row.append(enabled, accelerator, action, remove);

  const result = state.runtime.shortcutResults?.find((item) => item.id === shortcut.id);
  if (result && !result.ok) {
    const error = document.createElement('span'); error.className = 'shortcut-error'; error.textContent = result.error; row.append(error);
  }
  enabled.addEventListener('change', () => { shortcut.enabled = enabled.checked; markDirty(); });
  accelerator.addEventListener('input', () => { shortcut.accelerator = accelerator.value; markDirty(); });
  action.addEventListener('change', () => { Object.assign(shortcut, readActionSelect(action)); markDirty(); });
  remove.addEventListener('click', () => { draft.shortcuts = draft.shortcuts.filter((item) => item.id !== shortcut.id); renderShortcuts(); markDirty(); });
  return row;
}

function renderShortcuts() {
  const list = $('#shortcut-list');
  list.replaceChildren(...draft.shortcuts.map(createShortcutRow));
  $('#shortcut-empty').classList.toggle('visible', draft.shortcuts.length === 0);
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
    toggle.checked = draft.plugins[plugin.id] === true && !plugin.error; toggle.disabled = plugin.id.startsWith('invalid:');
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
  const status = $('#hook-status'); status.className = `status-dot ${hook === 'running' ? 'ok' : hook === 'failed' ? 'error' : ''}`;
  status.querySelector('span').textContent = hook === 'running' ? t('status.running') : hook === 'failed' ? t('status.failed') : t('status.starting');
  $('#diag-hook').textContent = hook === 'running' ? t('diag.running') : hook === 'failed' ? t('diag.failed') : t('diag.starting');
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
  $('#uninstall-note').textContent = state.environment.uninstallAvailable
    ? t('uninstall.note', { target: t(scopeKey) })
    : t('uninstall.noteNone');
}

function renderAll() { applyI18n(); applyTheme(draft.theme); renderZone(); renderShortcuts(); renderPlugins(); renderGeneral(); renderStatus(); updatePageTitle(); }
function markDirty() { $('#save-note').textContent = t('save.dirty'); }

function updatePageTitle() {
  const active = $('.nav.active .nav-label');
  if (active) $('#page-title').textContent = active.textContent;
}

async function save() {
  const button = $('#save-button'); button.disabled = true; button.textContent = t('save.saving');
  try {
    state = await window.slipy.saveSettings(draft);
    draft = structuredClone(state.settings);
    renderAll(); $('#save-note').textContent = t('save.saved');
    setTimeout(() => { if ($('#save-note').textContent === t('save.saved')) $('#save-note').textContent = ''; }, 1800);
  } finally { button.disabled = false; button.textContent = t('save.button'); }
}

function bind() {
  $$('.nav').forEach((button) => button.addEventListener('click', () => {
    $$('.nav').forEach((item) => item.classList.remove('active')); button.classList.add('active');
    $$('.page').forEach((page) => page.classList.remove('active')); $(`#page-${button.dataset.page}`).classList.add('active');
    updatePageTitle();
  }));
  $$('.theme-picker button').forEach((button) => button.addEventListener('click', () => {
    draft.theme = button.dataset.theme; applyTheme(draft.theme); markDirty();
  }));
  $$('#zone-grid button').forEach((button) => button.addEventListener('click', () => { selectedZone = button.dataset.zone; renderZone(); }));
  $('#zone-up').addEventListener('change', () => commitZone('up'));
  $('#zone-down').addEventListener('change', () => commitZone('down'));
  $('#test-zone').addEventListener('click', () => { const mapping = draft.zones[selectedZone]; window.slipy.testAction(mapping.up, mapping.upPluginAction); });
  $('#add-shortcut').addEventListener('click', () => {
    draft.shortcuts.push({ id: crypto.randomUUID(), accelerator: '', action: 'none', pluginAction: '', enabled: true }); renderShortcuts(); markDirty();
  });
  for (const [id, output, key, suffix] of [['edge-thickness','edge-output','edgeThickness',' px'], ['corner-size','corner-output','cornerSize',' px'], ['cooldown','cooldown-output','wheelCooldownMs',' ms']]) {
    $(`#${id}`).addEventListener('input', (event) => { draft[key] = Number(event.target.value); $(`#${output}`).textContent = `${event.target.value}${suffix}`; markDirty(); });
  }
  $('#input-backend').addEventListener('change', (event) => { draft.inputBackend = event.target.value; markDirty(); });
  $('#close-action').addEventListener('change', (event) => { draft.closeAction = event.target.value; markDirty(); });
  $('#language').addEventListener('change', (event) => { draft.language = event.target.value; markDirty(); });
  $('#start-at-login').addEventListener('change', (event) => { draft.startAtLogin = event.target.checked; markDirty(); });
  $('#save-button').addEventListener('click', save);
  $('#open-plugins').addEventListener('click', () => window.slipy.openPluginsDirectory());
  $('#quit-button').addEventListener('click', () => window.slipy.quit());
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
  window.slipy.onState((next) => {
    state = next;
    // the close dialog can persist closeAction from the main process
    draft.closeAction = state.settings.closeAction;
    renderGeneral();
    renderStatus();
  });
}

window.slipy.getState().then((initial) => {
  state = initial; draft = structuredClone(state.settings); bind(); renderAll();
});
