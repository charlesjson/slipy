'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { t, resolveLanguage, setLanguage, getLanguage, LOCALES } = require('../src/main/i18n');

test('locale dictionaries stay in sync', () => {
  const zh = Object.keys(LOCALES['zh-CN']).sort();
  const en = Object.keys(LOCALES.en).sort();
  assert.deepEqual(zh, en);
});

test('resolves explicit preference over system locale', () => {
  assert.equal(resolveLanguage('en', 'zh-CN'), 'en');
  assert.equal(resolveLanguage('zh-CN', 'en-US'), 'zh-CN');
});

test('auto preference follows the system locale with english fallback', () => {
  assert.equal(resolveLanguage('auto', 'zh-CN'), 'zh-CN');
  assert.equal(resolveLanguage('auto', 'zh-Hans-CN'), 'zh-CN');
  assert.equal(resolveLanguage('auto', 'en-US'), 'en');
  assert.equal(resolveLanguage('auto', 'de-DE'), 'en');
  assert.equal(resolveLanguage('auto', ''), 'en');
});

test('t translates, substitutes params and falls back to the key', () => {
  setLanguage('zh-CN');
  assert.equal(getLanguage(), 'zh-CN');
  assert.equal(t('tray.open'), '打开设置');
  assert.equal(t('error.exitCode', { command: 'wmctrl', code: 1 }), 'wmctrl 退出码为 1');
  assert.equal(t('does.not.exist'), 'does.not.exist');
  setLanguage('en');
  assert.equal(t('tray.open'), 'Open settings');
  setLanguage('nope');
  assert.equal(getLanguage(), 'en');
});
