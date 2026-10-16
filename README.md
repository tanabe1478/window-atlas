# Window Atlas

**Arrange windows. Remember where they belong.**

Keyboard-driven window placement and persistent position memory for **GNOME / Wayland**, inspired by macOS Spectacle. No background daemon, root privileges, npm dependencies, or runtime network access required.

[日本語ガイド](docs/guide.ja.md) · [Spectacle compatibility notes](docs/compatibility.md) · [Position memory](docs/position-memory.md)

## Features

- Halves, corners, and horizontal/vertical thirds and two-thirds.
- Repeated placement cycles **1/2 → 2/3 → 1/3**. Corners retain half height while cycling width.
- Next/previous third across six regions; maximize, center, grow/shrink with edge anchoring.
- Move to the next/previous display; per-window undo/redo.
- **Remember position, size, maximization state, and monitor across app restarts and extension reloads.**
- Automatic position saving; optional automatic restoration when a new window appears.
- Manual remember/recall for one window or all currently open windows.
- Panel menu and Japanese preferences UI, shortcut editor, and Ubuntu/Spectacle shortcut presets.

### Supported environment

Targets **GNOME Shell 45–50**. Runtime smoke tests use **Ubuntu 26.04.1 / GNOME 50.1 / Wayland**, real GTK clients, a virtual keyboard, and two virtual monitors. Older supported Shell versions and X11 need additional runtime testing. KDE, Xfce, and Sway are not supported.

This is an independent implementation, not an official Spectacle port, and is unrelated to KDE's screenshot app named Spectacle. See the [documented platform differences](docs/compatibility.md).

## Install

Requirements: GNOME Shell, GTK 4 / libadwaita, Python 3, and `glib-compile-schemas` (`libglib2.0-bin` on Ubuntu). Node.js is only needed for development tests.

```bash
git clone https://github.com/tanabe1478/window-atlas.git
cd window-atlas
python3 tools/manage.py validate
python3 tools/manage.py doctor
python3 tools/manage.py install
```

Install **without sudo**. Files go to:

```text
~/.local/share/gnome-shell/extensions/window-atlas@tanabe1478/
```

Save your work, **log out and log back in** (required for initial extension discovery on Wayland), then:

```bash
gnome-extensions enable window-atlas@tanabe1478
gnome-extensions prefs window-atlas@tanabe1478
```

If user extensions are globally disabled, enable them in GNOME's Extensions app. The installer does not enable the extension or change GNOME/other extensions' keybindings.

## Quick start

Default modifier keys: **Super + Ctrl + Alt**, abbreviated **SCA**. Super is usually the Windows key.

| Action | Default shortcut |
| --- | --- |
| Left / right / top / bottom half | SCA + arrow |
| Top left / top right | SCA + Shift + Left / Right |
| Bottom left / bottom right | SCA + Shift + Down / Up |
| Next / previous third | SCA + `.` / `,` |
| Maximize / center | SCA + F / C |
| Grow / shrink | SCA + `=` / `-` |
| Previous / next display | SCA + PageUp / PageDown |
| Undo / redo | SCA + Z / Shift + Z |
| Remember this window | **SCA + S** |
| Recall this window's saved position | **SCA + L** |
| Restore the first position in this extension session | SCA + R |
| Left / center / right third | SCA + 1 / 2 / 3 |
| Left / right two-thirds | SCA + 4 / 5 |

All actions are available in the panel menu, including remember/recall-all and vertical thirds. Shortcut editing supports Escape to cancel and Backspace/Delete to clear.

The **Spectacle preset** maps Command → Super and Option → Alt. Some combinations conflict with GNOME workspace shortcuts. The confirmation dialog reports known conflicts but does **not** remove OS bindings. The preset leaves Window Atlas-specific extra actions unassigned. Use Ubuntu defaults or resolve conflicts explicitly.

## Persistent position memory

- **Automatic saving is on by default.** Moving or resizing a regular window updates its saved position.
- **Automatic restoration is off by default.** Enable “新しく開いたウィンドウを記憶した位置へ復元” in preferences to restore new windows automatically.
- For a **fixed saved layout**, turn automatic saving off, arrange windows, choose **remember-all**, and recall that layout later. Otherwise, later moves intentionally replace the saved positions.
- Recall only moves open windows; it does not launch applications or reopen documents.
- Multiple windows of one app are matched by their opening-order slot, **not by document title**. App/window identity is best-effort; see [limitations](docs/position-memory.md).
- Missing monitors fall back to an available screen. Resolution/dock changes keep windows inside the work area.

Data is local at `$XDG_CONFIG_HOME/window-atlas/positions.json` (normally `~/.config/window-atlas/positions.json`). Window Atlas stores app identifiers and geometry, **not window titles or document paths**. The directory is mode 0700 and the file mode 0600. Writes are atomic and debounced. No telemetry or external service is used.

Delete remembered positions using the confirmation button in preferences. Unknown-version/corrupt files are not silently overwritten; explicitly clear or back up the file to recover.

## Development and verification

```bash
npm test                              # No npm install needed; Node.js >=20
npm run test:coverage
python3 tools/manage.py validate
python3 tools/manage.py pack           # dist/window-atlas@tanabe1478.shell-extension.zip
python3 tools/smoke.py prefs           # Isolated settings/config; does not show UI
python3 tools/smoke.py shell           # GNOME 50 only; isolated headless Wayland session
```

The shell smoke test uses temporary HOME/XDG directories and a private D-Bus session; it does not install into your desktop. It covers keyboard input, placement, presets/preferences, two-monitor operations, persistent disk storage, recall undo/redo, app close/reopen, extension reload, and the automatic-restore toggle. Logs/bundles in `dist/` and runtime position data are not tracked by Git.

Unit and smoke tests do not guarantee compatibility with every application, physical monitor/DPI arrangement, or GNOME release. Client minimum sizes and terminal character-cell increments can prevent exact placement. Fullscreen apps, panels, and dialogs are excluded.

## Update / uninstall

Disable the extension before updating, then install and log in again:

```bash
gnome-extensions disable window-atlas@tanabe1478
git pull --ff-only
python3 tools/manage.py install
# Log out/in, then enable again.
```

```bash
gnome-extensions disable window-atlas@tanabe1478
python3 tools/manage.py uninstall
```

Uninstall preserves saved settings and position data. Clear positions through preferences before uninstalling if you want to remove that data too.

## License

MIT. See [LICENSE](LICENSE). Spectacle's source is referenced for behavioral compatibility, not bundled into this extension.
