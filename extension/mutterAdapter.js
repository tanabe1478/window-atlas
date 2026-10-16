import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import {clampRect, copyRect, sameState} from './geometry.js';

export class MutterAdapter {
    constructor() {
        this._pending = new Set();
        this._disposed = false;
    }

    isAlive(window) {
        return !this._disposed && Boolean(window?.get_compositor_private());
    }

    snapshot(window) {
        const maximized = window.get_maximize_flags
            ? window.get_maximize_flags() // GNOME 49+
            : window.get_maximized();
        return {
            rect: copyRect(window.get_frame_rect()),
            monitor: window.get_monitor(),
            maximized,
        };
    }

    monitorCount() {
        return global.display.get_n_monitors();
    }

    workArea(window, monitor) {
        return copyRect(window.get_work_area_for_monitor(monitor));
    }

    monitors(window) {
        const manager = global.backend.get_monitor_manager?.() ?? Meta.MonitorManager.get();
        const connectors = new Map();
        // Public monitor objects are available on current Mutter. On older
        // GNOME versions fall back to a geometry-based ID (documented).
        for (const logical of manager.get_logical_monitors?.() ?? []) {
            const connector = logical.get_monitors()[0]?.get_connector();
            if (connector)
                connectors.set(logical.get_number(), connector);
        }
        return Array.from({length: this.monitorCount()}, (_, index) => {
            const geometry = global.display.get_monitor_geometry(index);
            return {index, id: connectors.get(index) ??
                `geometry:${geometry.x}:${geometry.y}:${geometry.width}:${geometry.height}`,
            area: this.workArea(window, index)};
        });
    }

    apply(window, state) {
        if (!this.isAlive(window))
            return Promise.resolve(false);
        return new Promise((resolve, reject) => {
            let quietTimer = 0;
            let deadline = 0;
            let finished = false;
            let rect = null;
            let retried = false;
            const signals = [];
            const place = () => {
                if (window.get_monitor() !== state.monitor)
                    window.move_to_monitor(state.monitor);
                // Separate move also handles clients that ignore the position
                // component of move_resize_frame (notably some terminals).
                window.move_frame(true, rect.x, rect.y);
                window.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
            };
            const finish = (accepted, error = null) => {
                if (finished)
                    return;
                finished = true;
                if (quietTimer)
                    GLib.Source.remove(quietTimer);
                if (deadline)
                    GLib.Source.remove(deadline);
                for (const signal of signals)
                    window.disconnect(signal);
                this._pending.delete(cancel);
                if (error)
                    reject(error);
                else
                    resolve(accepted);
            };
            const cancel = () => finish(false);
            const armQuietTimer = (delay = 100) => {
                if (finished)
                    return;
                if (quietTimer)
                    GLib.Source.remove(quietTimer);
                quietTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                    quietTimer = 0;
                    try {
                        // Moving a wide window before its Wayland resize is
                        // acknowledged can briefly put it on an adjacent,
                        // shorter monitor. Mutter may then constrain its size
                        // against that monitor. Correct once after the first
                        // configure settles; never loop against client limits.
                        if (!state.maximized && !retried && rect && this.isAlive(window) &&
                            !sameState(this.snapshot(window), {...state, rect})) {
                            retried = true;
                            place();
                            armQuietTimer(200);
                        } else {
                            finish(true);
                        }
                    } catch (error) {
                        finish(false, error);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            };
            this._pending.add(cancel);
            try {
                for (const signal of ['position-changed', 'size-changed',
                    'notify::maximized-horizontally', 'notify::maximized-vertically'])
                    signals.push(window.connect(signal, () => armQuietTimer()));
                signals.push(window.connect('unmanaged', cancel));
                deadline = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
                    deadline = 0;
                    finish(true);
                    return GLib.SOURCE_REMOVE;
                });
                const flags = this.snapshot(window).maximized;
                if (flags) {
                    if (window.get_maximize_flags)
                        window.unmaximize();
                    else
                        window.unmaximize(flags);
                }
                rect = clampRect(state.rect, this.workArea(window, state.monitor));
                place();
                if (state.maximized) {
                    if (window.set_maximize_flags)
                        window.set_maximize_flags(state.maximized);
                    else
                        window.maximize(state.maximized & Meta.MaximizeFlags.BOTH);
                }
                // A Wayland client may acknowledge its configure asynchronously.
                // Wait for geometry to become quiet, with a hard upper bound.
                armQuietTimer(200);
            } catch (error) {
                finish(false, error);
            }
        });
    }

    dispose() {
        this._disposed = true;
        for (const cancel of [...this._pending])
            cancel();
    }
}
