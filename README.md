# Slipy

Slipy 是一个 Linux 桌面效率工具：让鼠标滚轮在屏幕四角和四边执行不同动作，同时提供全局快捷键、托盘运行、自启动和插件扩展。

## 功能

- 分别配置左上、顶部、右上、左侧、右侧、左下、底部、右下八个区域。
- 每个区域可以为滚轮向上、向下设置不同动作。
- 区域示意图标记已配置动作的区域，并显示配置数量。
- 内置虚拟桌面切换、音量、亮度、媒体、窗口切换、活动概览和显示桌面动作。
- 配置多个 Electron 全局快捷键；设置页会提示无效或被占用的组合键。
- 点击关闭按钮时可最小化到系统托盘或完全退出；首次关闭会弹窗询问并可记住选择，之后可在通用设置中随时更改。通过 freedesktop `.desktop` 文件登录自启动。
- Plugin API v1，可由本地 CommonJS 插件注册新动作。
- 多显示器区域识别、可调命中宽度及滚轮防抖。
- 可持久化的白天/黑夜模式，采用暖中性色和橙色强调的双主题界面。
- 小窗口下自适应布局，按钮和表单支持清晰的键盘焦点提示。
- 未保存修改有明确提示，可撤销回上次保存的配置；支持 `Ctrl+S` 保存，保存期间继续编辑的内容会保留为未保存草稿。
- 导出配置包含当前未保存修改，便于备份和迁移正在编辑的配置。
- 界面多语言（简体中文 / English），默认跟随系统区域设置，可在通用设置中切换；词条位于 `src/shared/locales.js`，主进程与渲染器共用同一份字典。
- “关于与诊断”页面内置完整卸载，删除程序、设置、插件、缓存、日志、崩溃转储和自启动项。

## 环境要求

- Linux x64/arm64 桌面；提供 X11 与 Wayland 输入后端。
- Node.js 20+、npm 和 Rust 工具链（从源码运行时）。
- X11 会话：虚拟桌面切换推荐安装 `wmctrl`，窗口动作需要 `xdotool`。
- Wayland 会话：根据桌面和动作优先尝试 DBus、`hyprctl` 或 `swaymsg`；需要通用按键注入时，安装 `ydotool` 并启用 `ydotoold` 服务。
- 其他动作按需安装 `playerctl`、`brightnessctl` 以及 `wpctl` 或 `pactl`。

Debian/Ubuntu 示例：

```bash
sudo apt install wmctrl xdotool playerctl brightnessctl
```

Fedora/RHEL 系：

```bash
sudo dnf install wmctrl xdotool playerctl brightnessctl
```

Arch Linux/Manjaro：

```bash
sudo pacman -S wmctrl xdotool playerctl brightnessctl
```

openSUSE：

```bash
sudo zypper install wmctrl xdotool playerctl brightnessctl
```

### Wayland 支持

Wayland 禁止普通应用读取全局指针事件，因此 Slipy 在 Wayland 会话中不再使用全局钩子，而是在**已配置动作的屏幕边缘**放置透明悬浮条：光标触碰边缘时合成器会把滚轮事件正常派发给悬浮条，无需任何特殊权限。动作执行按检测到的桌面环境选择后端：

| 桌面环境 | 虚拟桌面切换 | 窗口 / 概览动作 |
| --- | --- | --- |
| KDE Plasma | KWin DBus（`nextDesktop`/`previousDesktop`） | `kglobalaccel` DBus 快捷键 |
| GNOME | Shell DBus `Eval`（需要 unsafe 模式），否则 `ydotool` | `FocusSearch` DBus / `ydotool` |
| Hyprland | `hyprctl dispatch workspace` | `hyprctl dispatch cyclenext` |
| Sway | `swaymsg workspace` | `ydotool` |
| 其他 | `ydotool`（Ctrl+Alt+方向键） | `ydotool` |

表中列出已实现的后端策略，实际可用性取决于桌面版本、系统工具和权限；尚未逐一实机验证所有桌面与会话组合。

在“通用设置 → 输入监听方式”中可以强制选择全局钩子或边缘悬浮窗；“关于与诊断”页会显示实际使用的后端和系统命令可用性。注意：悬浮条会占用边缘最外侧的少量像素（默认 8px，仅限已配置动作的边），点击这些像素不会传给下层窗口。

## 开发运行

```bash
npm install
npm start
```

检查和测试：

```bash
npm run check
npm test
npm run test:renderer
```

`npm test` 会同时运行 Node.js 和 Rust 测试。`npm run test:renderer` 单独运行 `scripts/check-renderer.cjs`：使用独立 Electron 实例和模拟 IPC 验证界面，不启动真实输入钩子。此项需要桌面会话；无图形会话的 CI 可安装 Xvfb 后运行：

```bash
xvfb-run -a npm run test:renderer
```

打包通用 AppImage：

```bash
npm run dist
```

### 构建携带 Electron 的离线安装程序

```bash
npm run dist:installer
```

该命令先通过 electron-builder 生成完整的 Electron 运行目录，再把 Electron、原生滚轮模块和 Slipy 代码一起封装为：

```text
dist/Slipy-<版本>-linux-<架构>-installer.run
dist/Slipy-<版本>-linux-<架构>.tar.gz
```

最终用户不需要安装 Node.js、npm 或 Electron。安装程序会自动选择标准位置：

```bash
# 当前用户安装到 ~/.local/share/slipy
./Slipy-0.1.0-linux-x64-installer.run --user

# 系统安装到 /opt/slipy，并创建 /usr/local/bin/slipy
sudo ./Slipy-0.1.0-linux-x64-installer.run --system
```

系统级安装程序不会以 root 身份启动 Electron；安装完成后请回到普通桌面用户，从应用菜单或运行 `slipy` 启动。这样可正确连接当前用户的 X11/Wayland 会话，并避免生成 root 所有的配置文件。

离线 `.run` 安装器遵循 XDG 和 freedesktop 目录规范，不调用特定发行版的包管理器，面向 Debian/Ubuntu/Linux Mint、Fedora/RHEL、Arch/Manjaro、openSUSE 等主流桌面发行版。安装与桌面动作的兼容性仍需在目标环境验证。系统级图形化卸载通过通用的 PolicyKit `pkexec` 请求管理员权限。

两种模式都会安装桌面菜单、512×512 图标和命令行入口。推荐在应用“关于与诊断”页面点击“卸载 Slipy 并删除全部数据”：独立卸载助手会等待 Electron 及其子进程退出，再删除程序和用户数据，避免退出阶段重新生成缓存。

用户级安装也可直接运行：

```bash
~/.local/share/slipy/uninstall.sh --user --uninstall
```

系统级命令行卸载采用权限分离：先以桌面用户清理个人数据，再以管理员权限删除系统程序。不要用 root 权限遍历用户目录。

```bash
/opt/slipy/uninstall.sh --clean-user-data
sudo /opt/slipy/uninstall.sh --system --uninstall
```

完整卸载会删除以下内容：

- Electron/Slipy 程序目录和命令行链接；
- desktop 菜单、应用图标和登录自启动项；
- XDG 配置目录中的设置与插件；
- Chromium/Electron GPUCache、Cache、崩溃转储；
- XDG state 下的运行状态和日志；
- 旧版本使用的 `Slipy` 大写配置、缓存和数据目录。

从 AppImage 运行时，内置卸载会删除当前 AppImage 文件并清理同样的用户数据；系统级安装会通过 PolicyKit 显示桌面管理员授权对话框。

所有产物位于 `dist/`。

## 插件

在“插件”页面点击“打开插件目录”，将插件文件夹放入其中，启用插件并保存。项目自带的 [`examples/hello-plugin`](examples/hello-plugin) 可以直接复制试用。

完整接口见 [`docs/plugin-api.md`](docs/plugin-api.md)。

## 技术设计

- Electron 主进程持有所有系统能力，渲染器启用 `contextIsolation`、sandbox 和 CSP。
- 常驻 Rust sidecar 通过逐行 JSON RPC 向 Electron 提供桌面环境识别、系统工具探测和内置命令动作执行；sidecar 不可用时自动回退到 JavaScript 实现。
- 输入采集是可插拔后端：X11 优先使用 Rust XInput2 原始滚轮监听，失败时回退到 `uiohook-napi` 或边缘悬浮窗；Wayland 使用屏幕边缘透明悬浮窗（`edge-wheel-service`）。所有后端共享同一个纯函数区域引擎与防抖调度器（`wheel-dispatch`）。
- 动作执行同样分层：`desktop-env` 检测会话与桌面家族，`action-backends` 为每个动作生成按优先级排序的命令链（原生合成器接口 → 通用注入工具），逐一尝试直到成功。
- 配置写入 Electron `userData/settings.json`，使用临时文件 + rename 原子替换。
- 插件只从独立目录扫描，入口路径不得逃逸插件目录；插件代码拥有主进程权限，因此仅加载可信插件。
