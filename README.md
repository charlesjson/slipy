# Slipy

Slipy 是一个 Linux 桌面效率工具：让鼠标滚轮在屏幕四角和四边执行不同动作，同时提供全局快捷键、托盘运行、自启动和插件扩展。

## 功能

- 分别配置左上、顶部、右上、左侧、右侧、左下、底部、右下八个区域。
- 每个区域可以为滚轮向上、向下设置不同动作。
- 内置虚拟桌面切换、音量、亮度、媒体、窗口切换、活动概览和显示桌面动作。
- 配置多个 Electron 全局快捷键；设置页会提示无效或被占用的组合键。
- 最小化到系统托盘，通过 freedesktop `.desktop` 文件登录自启动。
- Plugin API v1，可由本地 CommonJS 插件注册新动作。
- 多显示器区域识别、可调命中宽度及滚轮防抖。

## 环境要求

- Linux x64/arm64 桌面，推荐 X11 会话。
- Node.js 20+ 和 npm（从源码运行时）。
- 虚拟桌面切换推荐安装 `wmctrl`，后备方案需要 `xdotool`。
- 其他动作按需安装 `playerctl`、`brightnessctl` 以及 `wpctl` 或 `pactl`。

Debian/Ubuntu 示例：

```bash
sudo apt install wmctrl xdotool playerctl brightnessctl
```

Wayland 默认禁止普通应用读取全局指针事件，滚轮区域功能可能不可用。可以从显示管理器选择 X11/Xorg 会话；托盘、设置页及桌面环境允许的全局快捷键仍可使用。

## 开发运行

```bash
npm install
npm start
```

检查和测试：

```bash
npm run check
npm test
```

打包通用 AppImage：

```bash
npm run dist
```

单独构建 deb（需要构建机提供 `libcrypt.so.1`）：

```bash
npm run dist:deb
```

产物位于 `dist/`。

## 插件

在“插件”页面点击“打开插件目录”，将插件文件夹放入其中，启用插件并保存。项目自带的 [`examples/hello-plugin`](examples/hello-plugin) 可以直接复制试用。

完整接口见 [`docs/plugin-api.md`](docs/plugin-api.md)。

## 技术设计

- Electron 主进程持有所有系统能力，渲染器启用 `contextIsolation`、sandbox 和 CSP。
- `uiohook-napi` 监听全局滚轮位置；纯函数区域引擎负责八区域判定。
- 配置写入 Electron `userData/settings.json`，使用临时文件 + rename 原子替换。
- 插件只从独立目录扫描，入口路径不得逃逸插件目录；插件代码拥有主进程权限，因此仅加载可信插件。
