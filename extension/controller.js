import {ACTION_BY_ID} from './actions.js';
import {clampRect, centerRect, copyState, moveToMonitorRect, nextLayoutRect, nextThirdRect, resizeRect, sameState} from './geometry.js';
import {WindowHistory} from './history.js';

// adapter: isAlive(window), snapshot(window), monitorCount(), workArea(window,
// monitor), async apply(window, state). apply resolves false on cancellation.
export class WindowController {
    constructor(adapter, getOptions) {
        this._adapter = adapter;
        this._getOptions = getOptions;
        this._windows = new WeakMap();
        this._disposed = false;
    }

    dispatch(window, id) {
        return this._enqueue(window, id);
    }

    restoreSnapshot(window, state) {
        return this._enqueue(window, 'recall-window', copyState(state));
    }

    _enqueue(window, id, savedTarget = null) {
        if (this._disposed || !ACTION_BY_ID.has(id) || !this._adapter.isAlive(window))
            return Promise.resolve(false);
        let entry = this._windows.get(window);
        if (!entry) {
            entry = {queue: Promise.resolve(), pending: 0, history: null};
            this._windows.set(window, entry);
        }
        // Serialise Wayland configure/ack operations, independently per window.
        if (entry.pending >= 16)
            return Promise.resolve(false);
        entry.pending++;
        const task = entry.queue.then(() => this._run(window, id, entry, savedTarget));
        entry.queue = task.catch(() => {}).finally(() => entry.pending--);
        return task;
    }

    dispose() {
        this._disposed = true;
        this._windows = new WeakMap();
    }

    async _run(window, id, entry, savedTarget) {
        const adapter = this._adapter;
        if (this._disposed || !adapter.isAlive(window))
            return false;
        const before = adapter.snapshot(window);
        const options = this._getOptions();
        if (!entry.history && (id === 'undo' || id === 'redo' || id === 'restore'))
            return false;
        entry.history ??= new WindowHistory(before, options.historyLimit);
        entry.history.limit = options.historyLimit;
        const action = ACTION_BY_ID.get(id);
        let target = copyState(before);
        const area = adapter.workArea(window, before.monitor);

        if (savedTarget) {
            target = copyState(savedTarget);
        } else if (action.layouts) {
            target.rect = nextLayoutRect(before.rect, area, action.layouts, options.cycleSizes, options.gap);
            target.maximized = 0;
        } else {
            switch (id) {
            case 'maximize':
                target.rect = {...area};
                target.maximized = 3;
                break;
            case 'center':
                if (before.maximized === 3)
                    return false;
                target.rect = centerRect(before.rect, area);
                target.maximized = 0;
                break;
            case 'larger':
            case 'smaller': {
                if (id === 'larger' && before.maximized === 3)
                    return false;
                const step = options.resizeStep;
                target.rect = resizeRect(before.rect, area, id === 'larger' ? step : -step);
                target.maximized = 0;
                break;
            }
            case 'next-third':
            case 'previous-third':
                target.rect = nextThirdRect(before.rect, area, id === 'next-third' ? 1 : -1, options.gap);
                target.maximized = 0;
                break;
            case 'previous-monitor':
            case 'next-monitor': {
                const count = adapter.monitorCount();
                if (count < 2)
                    return false;
                const offset = id === 'next-monitor' ? 1 : -1;
                target.monitor = (before.monitor + offset + count) % count;
                const destination = adapter.workArea(window, target.monitor);
                target.rect = moveToMonitorRect(before.rect, destination);
                target.maximized = target.rect.width === destination.width && target.rect.height === destination.height ? 3 : 0;
                break;
            }
            case 'restore':
                target = copyState(entry.history.original);
                break;
            case 'undo':
                target = entry.history.peekUndo();
                break;
            case 'redo':
                target = entry.history.peekRedo();
                break;
            default:
                return false;
            }
        }
        if (!target)
            return false;
        // A screen may have been unplugged since the history entry was created.
        if (target.monitor < 0 || target.monitor >= adapter.monitorCount())
            target.monitor = before.monitor;
        target.rect = clampRect(target.rect, adapter.workArea(window, target.monitor));
        if (sameState(before, target, 0)) {
            // Consume no-op history entries, but do not destroy a redo branch.
            if (id === 'undo')
                entry.history.commitUndo(before);
            else if (id === 'redo')
                entry.history.commitRedo(before);
            return false;
        }
        if (!await adapter.apply(window, target) || this._disposed || !adapter.isAlive(window))
            return false;
        const after = adapter.snapshot(window);
        // A constrained/unresponsive client can ignore the operation entirely.
        // Keep the undo/redo stack intact so the user can retry.
        if (sameState(before, after, 0))
            return false;
        if (id === 'undo')
            entry.history.commitUndo(before);
        else if (id === 'redo')
            entry.history.commitRedo(before);
        else
            entry.history.record(before, after);
        return !sameState(before, after);
    }
}
