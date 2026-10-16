# Persistent position memory

Window Atlas has two separate kinds of state:

1. **Undo/redo and “restore first position”** are in-memory, per-window operation history. They are discarded when the extension is disabled.
2. **Remember/recall** uses a versioned local JSON database and survives app restarts, extension reloads, and logging in again.

## Controls

- **Automatic saving** (`remember-positions`, default **true**) observes normal window moves, resizes, and maximization changes. Writes are debounced for 500ms and pending changes are flushed when the extension is disabled.
- **Automatic restoration** (`restore-on-open`, default **false**) restores a new window after its application identity and initial Wayland geometry settle. Enabling the extension does not automatically reposition windows that are already open.
- **Remember this window** saves the focused window immediately, even if automatic saving is disabled.
- **Recall this window** restores its saved position through the same serialized operation queue as keyboard placement, so recall can be undone/redone.
- **Remember all / recall all** operate on currently open eligible windows. They do not start applications, reopen documents, restore workspaces, or restore stacking/focus order.

If you want the **latest position**, keep automatic saving enabled. If you want a **fixed layout that survives temporary moves**, disable automatic saving before remembering the layout. Moving windows with automatic saving enabled intentionally updates the saved positions.

## Window identity

A saved record contains:

- A desktop application ID when GNOME can resolve one; otherwise its WM class.
- A per-application slot, allocated in opening order, up to 32 windows per app.
- Position, size, maximization flags, monitor identity, and the source work area.

Window titles, document paths, process IDs, and window contents are **not stored**. An application identifier can itself contain personal/custom application names, so treat the JSON as private data.

The slot is not a persistent document ID. Opening the same app's windows in a different order may swap their restored positions. Closed slots are reusable. Apps that share a WM class or change identifiers, splash windows that look like normal windows, and unusual application architectures may need manual recall. For more than 32 simultaneous windows of one app, additional windows are not remembered.

## Monitors and geometry

On current Mutter versions, monitor connectors identify the saved monitor even if its numeric index changes. Older GNOME versions without public logical-monitor APIs fall back to an ID based on monitor position and dimensions; a connector change or resolution change may then look like a missing monitor.

If a saved monitor is unavailable, recall uses the window's current available monitor, or the first available monitor. It keeps the window inside that monitor's work area. Window sizes use Mutter logical pixels; saved positions are relative to the work area so that screen-edge anchoring can survive resolution or dock changes. Maximized axes adapt to the new work area.

Applying a fallback restore does not itself replace the record for a missing monitor. A later manual save or real move with automatic saving enabled may update it.

## File format, privacy, and recovery

Path:

```text
$XDG_CONFIG_HOME/window-atlas/positions.json
# Usually ~/.config/window-atlas/positions.json
```

The format is version 1, containing a `positions` array. Records are validated and sanitized on load. At most 500 records are retained; the oldest updated record is evicted when necessary. Input files are limited to 1 MiB, coordinates and strings are bounded, and unsupported versions are rejected.

The directory is created with mode **0700**, and the file with **0600**. Writes replace the file atomically, do not follow destination symlinks, and make no network requests. Runtime data is ignored by Git and is not included in the extension ZIP.

If loading fails, Window Atlas keeps ordinary placement available but pauses position writes rather than overwriting unreadable/corrupt/future-version data. Back up or clear the file explicitly through preferences to recover. Do not edit the JSON while the extension is running; disable it first. Multiple simultaneous GNOME sessions sharing the same configuration file are not coordinated.

The preferences “clear remembered positions” action asks for confirmation. It deletes the file and clears the active extension's position cache, without moving windows or changing shortcuts. With automatic saving enabled, subsequent window moves can create new records again.

Uninstalling the extension preserves the file and GSettings. Clear positions before uninstalling if you want to remove that private data too.

## Tests and limitations

Node tests cover serialization/reload, independent window slots, validation, privacy filtering, bounded records, missing/reordered monitors, work-area changes, and maximized state. GJS tests cover actual file I/O, private modes, corruption/version rejection, and deletion. The isolated GNOME/Wayland test closes and reopens a real GTK app after reloading the extension and verifies automatic restoration from disk, manual keyboard recall, undo/redo, and restoration opt-out.

This is not a complete session manager. Client minimum sizes, terminal resize increments, fullscreen applications, physical monitor hotplug timing, mixed-DPI setups, and individual non-GTK apps still need environment-specific testing.
