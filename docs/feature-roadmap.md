# Slipy Feature Review and Roadmap

I reviewed the source code, UI, Plugin API, and test suite, and ran the following checks:

- `npm run check`: passed
- `npm test`: all 46 tests passed
- The working tree is clean, with no outstanding TODOs

The core workflow for version 0.1 is already complete: edge-wheel zones, global shortcuts, the system tray, autostart, plugins, Wayland/X11 support, internationalization, diagnostics, installation, and uninstallation are all implemented. The following additions should be prioritized next.

## High Priority Before Release

### 1. Master Enable/Pause Control

- Add **Pause Slipy / Resume Slipy** to the tray menu.
- On Wayland, the edge overlay strips occupy the outermost screen pixels, so users particularly need a way to disable them temporarily while gaming, using remote desktop software, or running other full-screen applications.
- An optional **Automatically pause for full-screen applications** setting could be added as well.

### 2. Better Action Testing and Error Feedback

- The UI currently tests only the wheel-up action; it cannot test the wheel-down action.
- `ActionExecutor` catches failures and only sends a notification, so the test call cannot clearly report success or failure.
- `runtimeStatus.error` is recorded but is not displayed on the diagnostics page.
- Errors encountered while saving settings are not shown in the UI.
- Add separate tests for both directions, visible success/failure results, detailed failure reasons, and a button to restart the input listener.

### 3. Shortcut Recorder

- Users currently have to type accelerators such as `Super+Shift+W` manually.
- Replace or supplement the text field with a recorder that captures the key combination and generates a valid Electron accelerator.
- Validate the format and detect duplicates before saving, while continuing to report system-level shortcut conflicts after registration.

### 4. Configuration Import, Export, and Reset

- Recreating a large set of zones and shortcuts manually is costly.
- Allow users to export all settings to a JSON file, import a validated configuration, and restore the defaults.
- `settings.version` already exists, but there is no complete versioned migration mechanism. This should be added before the settings schema is expanded further.

## Highly Recommended Additions

### 5. Custom Actions Without Plugins

Support common custom actions directly in the UI:

- Launch an application or `.desktop` entry
- Open a URL, file, or directory
- Send a custom keyboard shortcut
- Run a program with arguments
- Run multiple actions in sequence

This would provide the largest practical improvement. Ordinary users should not need to write a plugin merely to open a terminal or browser.

### 6. More Built-in Actions

- Mute audio and mute the microphone
- Lock the screen
- Take a screenshot
- Close, minimize, or maximize the active window
- Stop media playback
- Navigate backward and forward in a browser
- Open clipboard history

### 7. Per-Display Configuration

- Slipy currently detects multiple displays, but every display shares the same `zones` configuration.
- Support a common configuration with optional per-display overrides.
- Allow edge listening to be disabled on individual displays.

### 8. Profiles and Usage Scenarios

- Provide profiles such as Work, Entertainment, and Presentation.
- Profiles could eventually switch according to connected displays or full-screen state.
- The first implementation only needs manual profile switching; complex automation can come later.

### 9. Enhanced Diagnostics

- The current diagnostics page only reports whether commands are installed; it does not explain whether a particular action can actually run.
- Report the selected backend and health of each action, for example:
  - Volume: `wpctl` is available
  - Workspace switching: KWin DBus is available
  - Show desktop: GNOME Shell Eval is unavailable in the current session
- Add **Copy diagnostics report** and persistent application logs. The current implementation primarily uses `console.log` and `console.error` and does not yet provide a complete file-based logging system.

## Lower-Priority Ideas

- Plugin refresh, ZIP installation, and removal without requiring the user to open the plugin directory and save the settings.
- Additional triggers such as horizontal touchpad scrolling and the middle mouse button.
- On-screen display feedback for volume changes, workspace changes, and other actions.
- AppImage update checks.

## Recommended Implementation Order

1. Error feedback and testing for both wheel directions
2. Master pause control and tray integration
3. Shortcut recorder
4. Configuration import/export and versioned migrations
5. Custom actions
6. Per-display configuration

The first four items require relatively little work but would significantly improve product completeness, usability, and maintainability.
