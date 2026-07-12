'use strict';

// activate may also be async; the returned function is called on reload/quit.
exports.activate = (api) => api.registerAction({
  id: 'hello',
  name: { 'zh-CN': 'Hello 通知', en: 'Hello notification' },
  description: { 'zh-CN': '显示动作的触发来源', en: 'Shows what triggered the action' },
  run: ({ source }) => api.notify('Hello Slipy', source)
});
