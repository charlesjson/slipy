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
  "name": { "zh-CN": "示例插件", "en": "Example plugin" },
  "version": "1.0.0",
  "apiVersion": 1,
  "description": { "zh-CN": "注册一个示例动作", "en": "Registers an example action" },
  "main": "index.js"
}
```

- `id` 只能包含字母、数字、点、下划线和连字符（至少 2 个字符）。同一插件目录中的 `id` 不能重复，重复的目录会被标记为无效。
- `name` 和 `description` 可以是字符串，也可以是按语言键入的对象（`zh-CN`、`en`）。显示时按当前界面语言选择，缺失时回退英文，再回退到任意可用语言。
- `apiVersion` 可选。声明插件需要的最低 API 版本；若高于当前 Slipy 提供的版本，插件不会加载并显示明确错误。
- `main` 必须位于插件自己的目录内，默认 `index.js`。

## 入口模块

入口必须导出 `activate(api)`，**可以是 async 函数**。它（或其 Promise）返回的清理函数会在插件重载或退出时调用。

```js
'use strict';

exports.activate = async (api) => {
  const unregister = api.registerAction({
    id: 'say-hello',
    name: { 'zh-CN': '显示问候', en: 'Say hello' },
    description: { 'zh-CN': '弹出一条桌面通知', en: 'Shows a desktop notification' },
    run: async (context) => {
      api.log('Triggered from', context.source);
      api.notify('Hello', context.source);
    }
  });

  return unregister;
};
```

## API

### `api.apiVersion`

当前为数字 `1`。插件可据此检查兼容性；清单中的 `apiVersion` 字段是声明式的等价物。

### `api.plugin`

只读对象：

- `id`：清单中的插件 ID。
- `root`：插件的绝对目录，可用于读取插件自带资源。

### `api.registerAction(action)`

注册可供滚轮区域和全局快捷键选择的动作，返回取消注册函数。

`action` 包含：

- `id`：插件内唯一的动作 ID。
- `name`：设置页面显示的名称，字符串或语言对象。
- `description`：可选说明，字符串或语言对象。
- `run(context)`：触发动作时调用，可返回 Promise。

最终动作 ID 为 `<plugin-id>:<action-id>`。

**超时**：单次触发最多等待 10 秒。超过后该次触发按失败处理并提示用户；插件内部代码不会被强制终止，请自行避免悬挂的 Promise。

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

在设置页启用或禁用插件并点击“保存设置”后，所有插件会重新扫描和加载。重载会清除插件目录下**全部**模块缓存（包括入口引用的子模块），修改任何文件后保存设置即可生效。

插件加载失败时，错误会显示在插件卡片上，其动作不会注册。禁用插件会调用其清理函数，但无法强制终止插件已启动的定时器或服务——请务必在清理函数中释放这些资源。
