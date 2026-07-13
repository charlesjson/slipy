# Changelog

All notable changes to Slipy are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Application launching from wheel zones and global shortcuts: every action
  picker now lists the applications installed on the system (freedesktop
  `.desktop` entries, localized names, launched via `gio launch` /
  `gtk-launch` with a manual Exec fallback) plus a **Custom command** option
  that runs any executable with custom arguments (quoting supported, e.g.
  `"/opt/My App/run" --flag value`).
- Master pause control: **Pause Slipy / Resume Slipy** in the tray menu and a
  matching button in the settings window header. Pausing tears down every
  input surface — edge overlay strips release their screen pixels (useful for
  games and remote desktops on Wayland) and global shortcuts are unregistered.
- Separate **test wheel-up / test wheel-down** buttons in the zone editor,
  with an inline success or failure result including the failure reason.
- **Last error** panel and a **Restart input listener** button on the About &
  diagnostics page.
- Shortcut recorder: a record button next to each shortcut captures the key
  combination and generates the Electron accelerator; the format is validated
  and duplicate shortcuts are flagged before saving. System-level conflicts
  are still reported after registration.
- Configuration **export**, **import** and **restore defaults** on the General
  page. Imports are validated, migrated to the current schema version and
  rejected when written by a newer Slipy.
- Versioned settings migrations (`settings.version` = 2); the legacy
  `closeToTray` flag is now upgraded through the migration chain.
- New built-in actions: toggle mute, toggle microphone mute, and lock the
  screen (`wpctl`/`pactl`, `loginctl`/`xdg-screensaver`).
- Errors while saving settings or testing actions are now shown in the UI
  instead of being silently dropped.

## [0.1.0] - 2026-07-12

### Added
- Initial release: edge wheel zones with per-zone up/down actions, global
  shortcuts, system tray with close-behavior prompt, autostart, plugin system
  (API v1), X11 global-hook and Wayland edge-overlay input backends with
  per-compositor action candidates, zh-CN/en interface languages, day and
  night themes, diagnostics page, AppImage build, offline installer and a
  complete built-in uninstaller.
