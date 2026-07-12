'use strict';

const ZONE_NAMES = {
  topLeft: '左上角', top: '顶部', topRight: '右上角', left: '左侧', right: '右侧',
  bottomLeft: '左下角', bottom: '底部', bottomRight: '右下角'
};

let state;
let draft;
let selectedZone = 'topLeft';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

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
    group.label = '插件动作';
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
  $('#zone-name').textContent = ZONE_NAMES[selectedZone];
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
  enabled.title = '启用快捷键';
  const accelerator = document.createElement('input');
  accelerator.type = 'text'; accelerator.value = shortcut.accelerator; accelerator.placeholder = '例如 Super+Shift+W';
  const action = document.createElement('select');
  fillActionSelect(action, shortcut.action, shortcut.pluginAction);
  const remove = document.createElement('button');
  remove.className = 'icon-button'; remove.textContent = '×'; remove.title = '删除';
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
    const title = document.createElement('b'); title.textContent = '尚未发现插件';
    const text = document.createElement('span'); text.textContent = '打开插件目录，放入插件后保存设置以重新扫描。';
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
    const description = document.createElement('p'); description.textContent = plugin.description || '此插件没有说明。'; card.append(description);
    if (plugin.error) { const error = document.createElement('p'); error.className = 'plugin-error'; error.textContent = `加载失败：${plugin.error}`; card.append(error); }
    list.append(card);
  }
}

function renderGeneral() {
  $('#edge-thickness').value = draft.edgeThickness; $('#edge-output').textContent = `${draft.edgeThickness} px`;
  $('#corner-size').value = draft.cornerSize; $('#corner-output').textContent = `${draft.cornerSize} px`;
  $('#cooldown').value = draft.wheelCooldownMs; $('#cooldown-output').textContent = `${draft.wheelCooldownMs} ms`;
  $('#close-to-tray').checked = draft.closeToTray; $('#start-at-login').checked = draft.startAtLogin;
}

function renderStatus() {
  const hook = state.runtime.wheelHook;
  const status = $('#hook-status'); status.className = `status-dot ${hook === 'running' ? 'ok' : hook === 'failed' ? 'error' : ''}`;
  status.querySelector('span').textContent = hook === 'running' ? '全局监听运行中' : hook === 'failed' ? '全局监听不可用' : '正在启动监听…';
  $('#diag-hook').textContent = hook === 'running' ? '运行中' : hook === 'failed' ? '不可用' : '启动中';
  $('#diag-session').textContent = state.environment.sessionType;
  $('#diag-desktop').textContent = state.environment.desktop;
  $('#diag-version').textContent = state.environment.version;
  const uninstall = $('#uninstall-button');
  uninstall.disabled = !state.environment.uninstallAvailable;
  $('#uninstall-note').textContent = state.environment.uninstallAvailable
    ? `将删除${state.environment.installScope === 'system' ? '系统级程序及当前用户' : state.environment.installScope === 'appimage' ? 'AppImage 及当前用户' : '程序及当前用户'}的配置、插件、缓存和日志。`
    : '源码开发模式没有安装内容。';
}

function renderAll() { renderZone(); renderShortcuts(); renderPlugins(); renderGeneral(); renderStatus(); }
function markDirty() { $('#save-note').textContent = '有未保存的修改'; }

async function save() {
  const button = $('#save-button'); button.disabled = true; button.textContent = '保存中…';
  try {
    state = await window.slipy.saveSettings(draft);
    draft = structuredClone(state.settings);
    renderAll(); $('#save-note').textContent = '已保存';
    setTimeout(() => { if ($('#save-note').textContent === '已保存') $('#save-note').textContent = ''; }, 1800);
  } finally { button.disabled = false; button.textContent = '保存设置'; }
}

function bind() {
  $$('.nav').forEach((button) => button.addEventListener('click', () => {
    $$('.nav').forEach((item) => item.classList.remove('active')); button.classList.add('active');
    $$('.page').forEach((page) => page.classList.remove('active')); $(`#page-${button.dataset.page}`).classList.add('active');
    $('#page-title').textContent = button.textContent.trim();
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
  $('#close-to-tray').addEventListener('change', (event) => { draft.closeToTray = event.target.checked; markDirty(); });
  $('#start-at-login').addEventListener('change', (event) => { draft.startAtLogin = event.target.checked; markDirty(); });
  $('#save-button').addEventListener('click', save);
  $('#open-plugins').addEventListener('click', () => window.slipy.openPluginsDirectory());
  $('#hide-button').addEventListener('click', () => window.slipy.hide());
  $('#quit-button').addEventListener('click', () => window.slipy.quit());
  $('#uninstall-button').addEventListener('click', async () => {
    if (!window.confirm('确定完整卸载 Slipy？程序、设置、插件、缓存、日志和自启动项都会被永久删除。')) return;
    const button = $('#uninstall-button');
    button.disabled = true; button.textContent = '正在卸载…';
    try {
      const result = await window.slipy.uninstall();
      if (result.warnings?.length) window.alert(result.warnings.join('\n'));
    } catch (error) {
      button.disabled = false; button.textContent = '卸载 Slipy 并删除全部数据';
      window.alert(error.message);
    }
  });
  window.slipy.onState((next) => { state = next; renderStatus(); });
}

window.slipy.getState().then((initial) => {
  state = initial; draft = structuredClone(state.settings); bind(); renderAll();
});
