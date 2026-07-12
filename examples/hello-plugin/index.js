'use strict';

exports.activate = (api) => api.registerAction({
  id: 'hello',
  name: 'Hello 通知',
  description: '显示动作的触发来源',
  run: ({ source }) => api.notify('Hello Slipy', `动作来自 ${source}`)
});
