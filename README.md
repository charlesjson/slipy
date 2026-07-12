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
- 可持久化的白天/黑夜模式，采用暖中性色和橙色强调的双主题界面。
- “关于与诊断”页面内置完整卸载，删除程序、设置、插件、缓存、日志、崩溃转储和自启动项。

## 环境要求

- Linux x64/arm64 桌面，推荐 X11 会话。
- Node.js 20+ 和 npm（从源码运行时）。
- 虚拟桌面切换推荐安装 `wmctrl`，后备方案需要 `xdotool`。
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

离线 `.run` 安装器遵循 XDG 和 freedesktop 目录规范，不调用特定发行版的包管理器，兼容 Debian/Ubuntu/Linux Mint、Fedora/RHEL、Arch/Manjaro、openSUSE 等主流桌面发行版，以及 GNOME、KDE Plasma、XFCE、Cinnamon 和 MATE。系统级图形化卸载通过通用的 PolicyKit `pkexec` 请求管理员权限。

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
- `uiohook-napi` 监听全局滚轮位置；纯函数区域引擎负责八区域判定。
- 配置写入 Electron `userData/settings.json`，使用临时文件 + rename 原子替换。
- 插件只从独立目录扫描，入口路径不得逃逸插件目录；插件代码拥有主进程权限，因此仅加载可信插件。
