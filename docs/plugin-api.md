# Slipy Plugin API v1

插件是放在 Slipy 用户数据目录 `plugins/` 下的 CommonJS 模块。可以在应用的“插件”页面查看实际目录。插件在 Slipy 主进程中运行，只应安装可信代码。

## 目录结构

```text
plugins/
└── my-plugin/
    ├── plugin.json
    └── index.js
```

`plugin.json`：

```json
{
  "id": "org.example.my-plugin",
  "name": "示例插件",
  "version": "1.0.0",
  "description": "注册一个示例动作",
  "main": "index.js"
}
```

`id` 只能包含字母、数字、点、下划线和连字符。`main` 必须位于插件自己的目录内。

## 入口模块

入口必须导出 `activate(api)`。它可以返回清理函数，Slipy 在插件重载或退出时调用该函数。

```js
'use strict';

exports.activate = (api) => {
  const unregister = api.registerAction({
    id: 'say-hello',
    name: '显示问候',
    description: '弹出一条桌面通知',
    run: async (context) => {
      api.log('Triggered from', context.source);
      api.notify('示例插件', `触发来源：${context.source}`);
    }
  });

  return unregister;
};
```

## API

### `api.apiVersion`

当前为数字 `1`。插件可据此检查兼容性。

### `api.plugin`

只读对象：

- `id`：清单中的插件 ID。
- `root`：插件的绝对目录，可用于读取插件自带资源。

### `api.registerAction(action)`

注册可供滚轮区域和全局快捷键选择的动作，返回取消注册函数。

`action` 包含：

- `id`：插件内唯一的动作 ID。
- `name`：设置页面显示的名称。
- `description`：可选说明。
- `run(context)`：触发动作时调用，可返回 Promise。

最终动作 ID 为 `<plugin-id>:<action-id>`。

### 动作上下文

所有上下文都包含 `source`：`wheel`、`shortcut` 或 `test`。

滚轮触发还包含：

```js
{
  source: 'wheel',
  zone: 'topLeft',
  direction: 'up',
  point: { x: 0, y: 0 },
  displayId: 1,
  pluginId: 'org.example.my-plugin'
}
```

快捷键触发还包含 `accelerator`。每次传入的上下文都是冻结的只读浅拷贝。

### `api.notify(title, body)`

显示 Linux 桌面通知。

### `api.log(...values)`

写入带插件 ID 前缀的 Slipy 日志。

## 重载规则

在设置页启用或禁用插件并点击“保存设置”后，所有插件会重新扫描和加载。插件加载失败时，错误会显示在插件卡片上，其动作不会注册。
