'use strict';

const LOCALES = require('../shared/locales');

const DEFAULT_LANGUAGE = 'en';
let current = DEFAULT_LANGUAGE;

/**
 * Maps a language preference ('auto' | supported tag) to a supported tag.
 * `systemLocale` is whatever Electron's app.getLocale() reports — Chromium
 * already resolved the platform locale, so no env-var parsing here.
 */
function resolveLanguage(preference, systemLocale = '') {
  if (LOCALES[preference]) return preference;
  const locale = String(systemLocale).toLowerCase();
  if (locale.startsWith('zh')) return 'zh-CN';
  return DEFAULT_LANGUAGE;
}

function setLanguage(language) {
  current = LOCALES[language] ? language : DEFAULT_LANGUAGE;
  return current;
}

function getLanguage() { return current; }

function format(template, params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

function t(key, params) {
  const table = LOCALES[current] || LOCALES[DEFAULT_LANGUAGE];
  const template = table[key] ?? LOCALES[DEFAULT_LANGUAGE][key] ?? key;
  return format(template, params);
}

module.exports = { t, resolveLanguage, setLanguage, getLanguage, LOCALES };
