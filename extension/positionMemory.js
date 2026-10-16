import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {firstFreeSlot, PositionDatabase, restoredPosition} from './positions.js';
import {PositionStorage} from './positionStorage.js';

export class PositionMemory {
    constructor(settings, adapter, controller) {
        this._settings = settings;
        this._adapter = adapter;
        this._controller = controller;
        this._storage = new PositionStorage();
        this._entries = new Map();
        this._disposed = false;
        this._dirty = false;
        this._flushTimer = 0;
        this._readError = null;
        try {
            this._database = this._storage.load();
        } catch (error) {
            this._database = new PositionDatabase();
            this._readError = error;
            this._warn(error);
        }
        this._createdSignal = global.display.connect('window-created', (_display, window) => this._watch(window, true));
        this._clearSignal = settings.connect('changed::clear-positions-request', () => {
            try {
                this.clear();
            } catch (error) {
                this._warn(error);
            }
        });
        for (const window of global.get_window_actors().map(actor => actor.meta_window)
            .sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence()))
            this._watch(window, false);
    }

    _warn(error) {
        if (!this._warned) {
            console.warn(`[Window Atlas] Position memory: ${error.message ?? error}`);
            this._warned = true;
        }
    }

    _normal(window) {
        return this._adapter.isAlive(window) && window.get_window_type() === Meta.WindowType.NORMAL &&
            !window.is_skip_taskbar() && window.allows_move();
    }

    _appId(window) {
        const app = Shell.WindowTracker.get_default().get_window_app(window);
        const desktopId = app?.get_id();
        if (desktopId && !app.is_window_backed())
            return `desktop:${desktopId}`;
        const wmClass = window.get_wm_class();
        return wmClass ? `wm:${wmClass}` : null;
    }

    _watch(window, isNew) {
        if (this._disposed || this._entries.has(window) || window.get_window_type() !== Meta.WindowType.NORMAL)
            return;
        const entry = {window, appId: null, slot: null, ready: false, restoring: false, timer: 0, signals: []};
        this._entries.set(window, entry);
        entry.signals.push(window.connect('unmanaged', () => this._unwatch(entry)));
        let tries = 0;
        const initialise = async () => {
            entry.timer = 0;
            if (this._disposed || !this._entries.has(window))
                return;
            const appId = this._normal(window) ? this._appId(window) : null;
            if (!appId) {
                if (++tries < 12)
                    schedule(150);
                else
                    this._unwatch(entry);
                return;
            }
            entry.appId = appId;
            entry.slot = firstFreeSlot([...this._entries.values()]
                .filter(other => other !== entry && other.appId === appId).map(other => other.slot));
            if (entry.slot === null) {
                this._unwatch(entry);
                return;
            }
            try {
                if (isNew && this._settings.get_boolean('restore-on-open'))
                    await this._restore(entry);
                if (this._disposed || !this._entries.has(window) || !this._normal(window))
                    return;
                entry.ready = true;
                // Start observing after initial app placement/automatic restore.
                // Opening an app must not overwrite an existing saved layout.
                for (const signal of ['position-changed', 'size-changed',
                    'notify::maximized-horizontally', 'notify::maximized-vertically'])
                    entry.signals.push(window.connect(signal, () => {
                        if (!entry.restoring && this._settings.get_boolean('remember-positions')) {
                            try {
                                this._capture(entry);
                            } catch (error) {
                                this._warn(error);
                            }
                        }
                    }));
                if (this._settings.get_boolean('remember-positions') && !this._database.get(appId, entry.slot))
                    this._capture(entry);
            } catch (error) {
                this._warn(error);
            }
        };
        const schedule = delay => {
            entry.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                initialise().catch(error => this._warn(error));
                return GLib.SOURCE_REMOVE;
            });
        };
        // Let Wayland app IDs, actors, and initial geometry settle first.
        schedule(isNew ? 500 : 100);
    }

    _unwatch(entry) {
        if (entry.timer)
            GLib.Source.remove(entry.timer);
        entry.timer = 0;
        for (const signal of entry.signals)
            entry.window.disconnect(signal);
        entry.signals = [];
        this._entries.delete(entry.window);
    }

    _capture(entry) {
        if (this._readError)
            throw new Error('記憶ファイルを読み込めません。設定画面で削除するまで上書きしません。');
        if (!this._normal(entry.window) || entry.window.is_fullscreen() || entry.restoring || entry.slot === null)
            return false;
        const state = this._adapter.snapshot(entry.window);
        const monitor = this._adapter.monitors(entry.window).find(item => item.index === state.monitor);
        if (!monitor)
            return false;
        this._database.set({appId: entry.appId, slot: entry.slot, monitorId: monitor.id, area: monitor.area, state});
        this._dirty = true;
        if (this._flushTimer)
            GLib.Source.remove(this._flushTimer);
        this._flushTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._flushTimer = 0;
            this.flush();
            return GLib.SOURCE_REMOVE;
        });
        return true;
    }

    flush(throwErrors = false) {
        if (this._flushTimer)
            GLib.Source.remove(this._flushTimer);
        this._flushTimer = 0;
        if (!this._dirty || this._readError)
            return;
        try {
            this._storage.save(this._database);
            this._dirty = false;
            this._warned = false;
        } catch (error) {
            if (throwErrors)
                throw error;
            this._warn(error);
        }
    }

    remember(window) {
        const entry = this._entries.get(window);
        const saved = Boolean(entry?.ready && this._capture(entry));
        this.flush(true);
        return saved;
    }

    rememberAll() {
        let count = 0;
        for (const entry of this._entries.values()) {
            if (entry.ready && this._capture(entry))
                count++;
        }
        this.flush(true);
        return count;
    }

    async _restore(entry) {
        const record = this._database.get(entry.appId, entry.slot);
        if (!record || !this._normal(entry.window) || entry.window.is_fullscreen())
            return false;
        const target = restoredPosition(record, this._adapter.monitors(entry.window), entry.window.get_monitor());
        if (!target)
            return false;
        entry.restoring = true;
        try {
            await this._controller.restoreSnapshot(entry.window, target);
            return true;
        } finally {
            entry.restoring = false;
        }
    }

    recall(window) {
        const entry = this._entries.get(window);
        return entry?.ready ? this._restore(entry) : Promise.resolve(false);
    }

    async recallAll() {
        const results = await Promise.all([...this._entries.values()].filter(entry => entry.ready).map(entry => this._restore(entry)));
        return results.filter(Boolean).length;
    }

    clear() {
        this._storage.clear();
        this._database = new PositionDatabase();
        this._dirty = false;
        this._readError = null;
        this._warned = false;
        if (this._flushTimer)
            GLib.Source.remove(this._flushTimer);
        this._flushTimer = 0;
    }

    dispose() {
        this._disposed = true;
        global.display.disconnect(this._createdSignal);
        this._settings.disconnect(this._clearSignal);
        for (const entry of [...this._entries.values()])
            this._unwatch(entry);
        this.flush();
    }
}
