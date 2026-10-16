import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {sameState, thirdRects, tileRect} from '../window-atlas@tanabe1478/geometry.js';
import {ACTIONS, ACTION_BY_ID, SHORTCUT_PRESETS} from '../window-atlas@tanabe1478/actions.js';
import {PositionStorage} from '../window-atlas@tanabe1478/positionStorage.js';

const sleep = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));
const assert = (condition, message) => {
    if (!condition)
        throw new Error(message);
};

export default class Probe extends Extension {
    enable() {
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
            this._timer = 0;
            this._run().then(() => this._finish({status: 'pass'}))
                .catch(error => this._finish({status: 'fail', error: `${error.message ?? error}\n${error.stack ?? ''}`}));
            return GLib.SOURCE_REMOVE;
        });
    }

    _finish(result) {
        const file = Gio.File.new_for_path(GLib.getenv('ATLAS_SMOKE_RESULT'));
        file.replace_contents(JSON.stringify(result), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        console.log(`ATLAS_SMOKE ${JSON.stringify(result)}`);
        // Shut the compositor down before the private bus is killed, avoiding
        // unrelated calendar/service callbacks on already-disposed Shell UI.
        this._quitTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._quitTimer = 0;
            global.context.terminate();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _run() {
        const extension = Main.extensionManager.lookup('window-atlas@tanabe1478')?.stateObj;
        assert(extension?._indicator && extension?._controller, 'Main extension failed to enable');
        assert(extension._bindings.length === ACTIONS.length, 'Keybindings were not registered');
        Main.overview.hide();
        this._client = Gio.Subprocess.new(['gjs', '-m', GLib.getenv('ATLAS_SMOKE_CLIENT')], Gio.SubprocessFlags.NONE);
        let window = null;
        for (let tries = 0; tries < 60; tries++) {
            window = global.get_window_actors().map(actor => actor.meta_window)
                .find(candidate => candidate.get_title() === 'Window Atlas smoke window');
            if (window)
                break;
            await sleep(100);
        }
        assert(window, 'Wayland test window did not appear');
        await sleep(600);
        const adapter = extension._adapter;
        const controller = extension._controller;
        const before = adapter.snapshot(window);
        const area = adapter.workArea(window, before.monitor);
        window.activate(global.get_current_time());
        await sleep(200);
        const keyboard = Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const pressCombo = async keys => {
            for (const key of keys) {
                keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.PRESSED);
                await sleep(20);
            }
            for (const key of [...keys].reverse()) {
                keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.RELEASED);
                await sleep(20);
            }
            await sleep(400);
        };
        const modifiers = [Clutter.KEY_Super_L, Clutter.KEY_Control_L, Clutter.KEY_Alt_L];
        await pressCombo([...modifiers, Clutter.KEY_Left]);
        const current = adapter.snapshot(window);
        const expected = tileRect(area, ACTION_BY_ID.get('left-half').layouts[0]);
        assert(sameState(current, {...before, rect: expected, maximized: 0}, 3),
            `Left half mismatch: ${JSON.stringify({current, expected})}`);
        await controller.dispatch(window, 'left-half');
        assert(Math.abs(adapter.snapshot(window).rect.width - Math.round(area.width * 2 / 3)) <= 3,
            'Repeated placement did not cycle to two thirds');
        await controller.dispatch(window, 'undo');
        assert(Math.abs(adapter.snapshot(window).rect.width - expected.width) <= 3, 'Undo failed');
        await controller.dispatch(window, 'redo');
        assert(Math.abs(adapter.snapshot(window).rect.width - Math.round(area.width * 2 / 3)) <= 3, 'Redo failed');
        await controller.dispatch(window, 'restore');
        assert(sameState(adapter.snapshot(window), before, 3), 'Original geometry was not restored');
        const destinationMonitor = (before.monitor + 1) % adapter.monitorCount();
        const destinationArea = adapter.workArea(window, destinationMonitor);
        await controller.dispatch(window, 'next-monitor');
        const transferred = adapter.snapshot(window);
        assert(transferred.monitor === destinationMonitor && transferred.rect.width === before.rect.width &&
            transferred.rect.height === before.rect.height, 'Fitting window was scaled during monitor transfer');
        assert(Math.abs(transferred.rect.x - destinationArea.x - (destinationArea.width - before.rect.width) / 2) <= 3 &&
            Math.abs(transferred.rect.y - destinationArea.y - (destinationArea.height - before.rect.height) / 2) <= 3,
        'Fitting window was not centred on destination');
        await controller.dispatch(window, 'undo');
        assert(sameState(adapter.snapshot(window), before, 3), 'Monitor-transfer undo failed');
        console.log('PASS: monitor transfer preserves fitting window size and centres on destination');
        await controller.dispatch(window, 'maximize');
        assert(adapter.snapshot(window).maximized === 3, 'GNOME 50 maximize API failed');
        await controller.dispatch(window, 'top-left');
        assert(adapter.snapshot(window).maximized === 0, 'GNOME 50 unmaximize API failed');
        await controller.dispatch(window, 'undo');
        assert(adapter.snapshot(window).maximized === 3, 'Undo did not restore maximization');
        const originalMonitor = adapter.snapshot(window).monitor;
        assert(adapter.monitorCount() === 2, 'Expected two virtual monitors');
        await controller.dispatch(window, 'next-monitor');
        assert(adapter.snapshot(window).monitor !== originalMonitor, 'Monitor transfer failed');
        assert(adapter.snapshot(window).maximized === 3, 'Monitor transfer lost maximization');
        await controller.dispatch(window, 'restore');
        assert(sameState(adapter.snapshot(window), before, 3), 'Cross-monitor restoration failed');
        const assertRect = (rect, label) => {
            const actual = adapter.snapshot(window);
            assert(sameState(actual, {rect, monitor: before.monitor, maximized: 0}, 3),
                `${label}: ${JSON.stringify({actual, expected: rect})}`);
        };
        for (const id of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
            for (const index of [0, 1, 2, 0]) {
                await controller.dispatch(window, id);
                assertRect(tileRect(area, ACTION_BY_ID.get(id).layouts[index]), `${id}/${index}`);
            }
        }
        console.log('PASS: all four corner cycles, half → two thirds → one third → half');
        await controller.dispatch(window, 'restore');
        const thirds = thirdRects(area);
        for (const index of [0, 1, 2, 3, 4, 5, 0]) {
            await controller.dispatch(window, 'next-third');
            assertRect(thirds[index], `next third ${index}`);
        }
        for (const index of [5, 4, 3, 2, 1, 0]) {
            await controller.dispatch(window, 'previous-third');
            assertRect(thirds[index], `previous third ${index}`);
        }
        await controller.dispatch(window, 'restore');
        await pressCombo([...modifiers, Clutter.KEY_period]);
        assertRect(thirds[0], 'next-third keyboard binding');
        await pressCombo([...modifiers, Clutter.KEY_comma]);
        assertRect(thirds[5], 'previous-third keyboard binding');
        console.log('PASS: six thirds in both directions, including actual shortcut input');
        await controller.dispatch(window, 'left-half');
        await controller.dispatch(window, 'smaller');
        assertRect({...area, width: Math.round(area.width / 2) - 30}, 'shrink left half, keep three edges');
        await controller.dispatch(window, 'larger');
        assertRect(tileRect(area, ACTION_BY_ID.get('left-half').layouts[0]), 'grow left half');
        await controller.dispatch(window, 'right-half');
        await controller.dispatch(window, 'smaller');
        const rightWidth = Math.round(area.width / 2) - 30;
        assertRect({...area, x: area.x + area.width - rightWidth, width: rightWidth}, 'shrink right half, keep right edge');
        await controller.dispatch(window, 'maximize');
        await controller.dispatch(window, 'smaller');
        assertRect({x: area.x + 15, y: area.y + 15, width: area.width - 30, height: area.height - 30}, 'shrink from maximized');
        await controller.dispatch(window, 'undo');
        assert(adapter.snapshot(window).maximized === 3, 'Resize undo lost maximization');
        await controller.dispatch(window, 'restore');
        console.log('PASS: fixed 30px resize, anchored edges, full-screen shrinking, resize undo');
        const setPreset = async id => {
            const preset = SHORTCUT_PRESETS.find(item => item.id === id);
            const settings = extension.getSettings();
            settings.delay();
            for (const action of ACTIONS)
                settings.set_strv(action.key, preset.bindings[action.key]);
            settings.apply();
            await sleep(300);
        };
        await setPreset('spectacle');
        await pressCombo([Clutter.KEY_Alt_L, Clutter.KEY_Super_L, Clutter.KEY_f]);
        assert(adapter.snapshot(window).maximized === 3, 'Spectacle preset maximize binding failed');
        await pressCombo([Clutter.KEY_Alt_L, Clutter.KEY_Super_L, Clutter.KEY_z]);
        assert(sameState(adapter.snapshot(window), before, 3), 'Spectacle preset undo binding failed');
        await setPreset('ubuntu');
        console.log('PASS: live preset switching, original-style maximize and undo shortcuts');
        const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
        launcher.setenv('GSETTINGS_BACKEND', 'memory', true);
        launcher.setenv('GI_TYPELIB_PATH', '/usr/lib/gnome-shell/girepository-1.0', true);
        launcher.setenv('LD_LIBRARY_PATH', '/usr/lib/gnome-shell', true);
        launcher.setenv('G_DEBUG', 'fatal-warnings', true);
        launcher.setenv('ATLAS_SMOKE_CAPTURE', '1', true);
        const prefsProcess = launcher.spawnv(['gjs', '-m', GLib.getenv('ATLAS_SMOKE_PREFS'), extension.path]);
        await new Promise((resolve, reject) => prefsProcess.wait_check_async(null, (process, result) => {
            try {
                process.wait_check_finish(result);
                resolve();
            } catch (error) {
                reject(error);
            }
        }));
        // Exercise live settings and indicator cleanup without touching the host.
        extension._settings.set_boolean('show-indicator', false);
        assert(extension._indicator === null, 'Indicator toggle did not clean up');
        extension._settings.set_boolean('show-indicator', true);
        assert(extension._indicator, 'Indicator toggle did not recreate menu');
        // Automatic saves capture normal moves. Freeze a saved layout before
        // temporarily moving windows, then exercise manual recall and undo.
        await controller.dispatch(window, 'right-half');
        await sleep(700);
        const storage = new PositionStorage();
        assert(storage.load().size > 0, 'Automatic position saving did not reach disk');
        extension._settings.set_boolean('remember-positions', false);
        assert(extension._memory.remember(window), 'Manual position save failed');
        const saved = adapter.snapshot(window);
        await controller.dispatch(window, 'top-left');
        const temporary = adapter.snapshot(window);
        assert(await extension._memory.recall(window), 'Manual recall failed');
        assert(sameState(adapter.snapshot(window), saved, 3), 'Recalled geometry does not match saved position');
        await controller.dispatch(window, 'undo');
        assert(sameState(adapter.snapshot(window), temporary, 3), 'Persistent recall was not undoable');
        await controller.dispatch(window, 'redo');
        assert(sameState(adapter.snapshot(window), saved, 3), 'Persistent recall redo failed');
        assert(extension._memory.rememberAll() >= 1, 'Remember-all failed');
        await controller.dispatch(window, 'bottom-left');
        assert(await extension._memory.recallAll() >= 1, 'Recall-all failed');
        assert(sameState(adapter.snapshot(window), saved, 3), 'Recall-all did not restore saved layout');
        window.activate(global.get_current_time());
        await sleep(150);
        await pressCombo([...modifiers, Clutter.KEY_s]);
        await controller.dispatch(window, 'top-left');
        await pressCombo([...modifiers, Clutter.KEY_l]);
        assert(sameState(adapter.snapshot(window), saved, 3), 'Remember/recall keyboard shortcuts failed');
        console.log('PASS: automatic disk saves / remember-recall shortcuts / undo-redo / remember-all / recall-all');
        extension._settings.set_boolean('restore-on-open', true);
        extension.disable();
        assert(!extension._controller && !extension._indicator && !extension._memory, 'Disable leaked state');
        extension.enable();
        assert(extension._controller && extension._indicator && extension._memory, 'Re-enable failed');
        this._client.force_exit();
        await sleep(600);
        this._client = Gio.Subprocess.new(['gjs', '-m', GLib.getenv('ATLAS_SMOKE_CLIENT')], Gio.SubprocessFlags.NONE);
        let reopened = null;
        for (let tries = 0; tries < 70; tries++) {
            reopened = global.get_window_actors().map(actor => actor.meta_window)
                .find(candidate => candidate !== window && candidate.get_title() === 'Window Atlas smoke window');
            if (reopened && sameState(extension._adapter.snapshot(reopened), saved, 3))
                break;
            await sleep(100);
        }
        assert(reopened && sameState(extension._adapter.snapshot(reopened), saved, 3),
            'Automatic restore after app and extension restart failed');
        assert(storage.load().size > 0, 'Saved layout did not survive extension restart');
        console.log('PASS: persisted geometry restored after app close/reopen and extension restart');
        extension._settings.set_boolean('restore-on-open', false);
        this._client.force_exit();
        await sleep(600);
        this._client = Gio.Subprocess.new(['gjs', '-m', GLib.getenv('ATLAS_SMOKE_CLIENT')], Gio.SubprocessFlags.NONE);
        let notRestored = null;
        for (let tries = 0; tries < 50; tries++) {
            notRestored = global.get_window_actors().map(actor => actor.meta_window)
                .find(candidate => candidate !== reopened && candidate.get_title() === 'Window Atlas smoke window');
            if (notRestored)
                break;
            await sleep(100);
        }
        await sleep(1000);
        assert(notRestored && !sameState(extension._adapter.snapshot(notRestored), saved, 3),
            'Disabling automatic restore did not preserve app placement');
        console.log('PASS: automatic restore can be disabled without deleting saved positions');
        extension._memory.clear();
        assert(!storage.file.query_exists(null), 'Clearing remembered positions did not remove the file');
        this._client.force_exit();
        this._client = null;
    }

    disable() {
        if (this._timer)
            GLib.Source.remove(this._timer);
        this._timer = 0;
        if (this._quitTimer)
            GLib.Source.remove(this._quitTimer);
        this._quitTimer = 0;
        this._client?.force_exit();
        this._client = null;
    }
}
