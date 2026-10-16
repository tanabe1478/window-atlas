import assert from 'node:assert/strict';
import test from 'node:test';
import {ACTIONS} from '../extension/actions.js';
import {WindowController} from '../extension/controller.js';
import {copyState} from '../extension/geometry.js';

const options = {cycleSizes: true, gap: 0, resizeStep: 30, historyLimit: 50};
const original = () => ({rect: {x: 300, y: 200, width: 800, height: 600}, monitor: 0, maximized: 0});
const makeWindow = () => ({state: original(), alive: true});

class FakeAdapter {
    areas = [{x: 0, y: 32, width: 1920, height: 1048}, {x: -1280, y: 0, width: 1280, height: 720}];
    calls = [];
    failure = null;
    ignore = false;
    isAlive(window) { return window.alive; }
    snapshot(window) { return copyState(window.state); }
    monitorCount() { return this.areas.length; }
    workArea(_window, monitor) { return {...this.areas[monitor]}; }
    async apply(window, target) {
        this.calls.push(copyState(target));
        await new Promise(resolve => setImmediate(resolve));
        if (this.failure)
            throw this.failure;
        if (!window.alive)
            return false;
        if (!this.ignore)
            window.state = copyState(target);
        return true;
    }
}

function setup(overrides = {}) {
    const adapter = new FakeAdapter();
    const settings = {...options, ...overrides};
    return {adapter, settings, controller: new WindowController(adapter, () => settings), window: makeWindow()};
}

test('half placement cycles 1/2 → 2/3 → 1/3 → 1/2', async () => {
    const {controller, window} = setup();
    for (const width of [960, 1280, 640, 960]) {
        await controller.dispatch(window, 'left-half');
        assert.equal(window.state.rect.width, width);
    }
});

test('cycle recognises current geometry after manual movement or a different placement', async () => {
    const {controller, window} = setup();
    await controller.dispatch(window, 'left-half');
    window.state.rect.x += 100;
    await controller.dispatch(window, 'left-half');
    assert.equal(window.state.rect.width, 960);
    await controller.dispatch(window, 'top-left');
    await controller.dispatch(window, 'left-half');
    assert.equal(window.state.rect.width, 960);
});

test('cycling can be disabled and settings are read on each action', async () => {
    const {controller, settings, window} = setup({cycleSizes: false});
    await controller.dispatch(window, 'left-half');
    await controller.dispatch(window, 'left-half');
    assert.equal(window.state.rect.width, 960);
    settings.gap = 8;
    await controller.dispatch(window, 'right-half');
    assert.equal(window.state.rect.x, 964);
});

test('all four corners cycle widths while preserving their half-height and anchors', async () => {
    for (const id of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
        const {controller, window} = setup();
        for (const width of [960, 1280, 640, 960]) {
            await controller.dispatch(window, id);
            assert.equal(window.state.rect.width, width, id);
            assert.equal(window.state.rect.height, 524, id);
            assert.equal(window.state.rect.x, id.endsWith('right') ? 1920 - width : 0);
            assert.equal(window.state.rect.y, id.startsWith('bottom') ? 556 : 32);
        }
    }
});

test('half cycling also recognises a matching rectangle before any recorded action', async () => {
    const {controller, window} = setup();
    window.state.rect = {x: 0, y: 32, width: 960, height: 1048};
    await controller.dispatch(window, 'left-half');
    assert.equal(window.state.rect.width, 1280);
    await controller.dispatch(window, 'undo');
    await controller.dispatch(window, 'left-half');
    assert.equal(window.state.rect.width, 1280);
});

test('thirds cycle all six regions forward and backward, independently of cycle-sizes', async () => {
    const {controller, window} = setup({cycleSizes: false});
    const positions = [];
    for (let i = 0; i < 6; i++) {
        await controller.dispatch(window, 'next-third');
        positions.push(copyState(window.state));
    }
    for (let i = 4; i >= 0; i--) {
        await controller.dispatch(window, 'previous-third');
        assert.deepEqual(window.state, positions[i]);
    }
    await controller.dispatch(window, 'previous-third');
    assert.deepEqual(window.state, positions[5]);
    await controller.dispatch(window, 'next-third');
    assert.deepEqual(window.state, positions[0]);
});

test('thirds recognise a direct placement, and undo/redo restore the full state', async () => {
    const {controller, window} = setup();
    await controller.dispatch(window, 'right-third');
    const right = copyState(window.state);
    await controller.dispatch(window, 'next-third');
    assert.equal(window.state.rect.width, 1920);
    assert.equal(window.state.rect.y, 32);
    const top = copyState(window.state);
    await controller.dispatch(window, 'undo');
    assert.deepEqual(window.state, right);
    await controller.dispatch(window, 'redo');
    assert.deepEqual(window.state, top);
});

test('previous third starts at the left third from an arbitrary window', async () => {
    const {controller, window} = setup();
    await controller.dispatch(window, 'previous-third');
    assert.deepEqual(window.state.rect, {x: 0, y: 32, width: 640, height: 1048});
});

test('resizing a half preserves both vertical edges and reads the configured pixel step', async () => {
    const {controller, window, settings} = setup();
    await controller.dispatch(window, 'left-half');
    await controller.dispatch(window, 'smaller');
    assert.deepEqual(window.state.rect, {x: 0, y: 32, width: 930, height: 1048});
    await controller.dispatch(window, 'larger');
    assert.deepEqual(window.state.rect, {x: 0, y: 32, width: 960, height: 1048});
    settings.resizeStep = 50;
    await controller.dispatch(window, 'larger');
    assert.equal(window.state.rect.width, 1010);
});

test('rapid actions are serialized per window and undo observes actual intermediate states', async () => {
    const {controller, window} = setup();
    await Promise.all(['left-half', 'right-half', 'undo', 'undo', 'redo'].map(id => controller.dispatch(window, id)));
    assert.deepEqual(window.state.rect, {x: 0, y: 32, width: 960, height: 1048});
});

test('new action after undo discards the redo branch', async () => {
    const {controller, window} = setup();
    await controller.dispatch(window, 'left-half');
    await controller.dispatch(window, 'undo');
    await controller.dispatch(window, 'right-half');
    assert.equal(await controller.dispatch(window, 'redo'), false);
    assert.equal(window.state.rect.x, 960);
});

test('restore returns to first captured geometry and can itself be undone', async () => {
    const {controller, window} = setup();
    await controller.dispatch(window, 'left-half');
    await controller.dispatch(window, 'top-right');
    const last = copyState(window.state);
    await controller.dispatch(window, 'restore');
    assert.deepEqual(window.state, original());
    await controller.dispatch(window, 'undo');
    assert.deepEqual(window.state, last);
});

test('undo and restore preserve partial/full maximization', async () => {
    for (const maximized of [1, 2, 3]) {
        const {controller, window} = setup();
        window.state.maximized = maximized;
        const before = copyState(window.state);
        await controller.dispatch(window, 'left-half');
        assert.equal(window.state.maximized, 0);
        await controller.dispatch(window, 'restore');
        assert.deepEqual(window.state, before);
        await controller.dispatch(window, 'undo');
        assert.equal(window.state.maximized, 0);
    }
});

test('maximize records a maximized state; center and larger leave it unchanged', async () => {
    const {controller, window, adapter} = setup();
    await controller.dispatch(window, 'maximize');
    assert.equal(window.state.maximized, 3);
    assert.deepEqual(window.state.rect, adapter.areas[0]);
    assert.equal(await controller.dispatch(window, 'center'), false);
    assert.equal(await controller.dispatch(window, 'larger'), false);
    await controller.dispatch(window, 'smaller');
    assert.equal(window.state.maximized, 0);
    assert(window.state.rect.width < 1920);
});

test('monitor transfers fill a smaller display, centre on a larger display, and wrap', async () => {
    const {controller, window} = setup();
    await controller.dispatch(window, 'maximize');
    await controller.dispatch(window, 'previous-monitor');
    assert.equal(window.state.monitor, 1);
    assert.equal(window.state.maximized, 3);
    assert.deepEqual(window.state.rect, {x: -1280, y: 0, width: 1280, height: 720});
    await controller.dispatch(window, 'next-monitor');
    assert.equal(window.state.monitor, 0);
    assert.equal(window.state.maximized, 0);
    assert.deepEqual(window.state.rect, {x: 320, y: 196, width: 1280, height: 720});
    await controller.dispatch(window, 'undo');
    assert.equal(window.state.monitor, 1);
});

test('single-monitor transfers are no-ops', async () => {
    const {controller, adapter, window} = setup();
    adapter.areas.pop();
    assert.equal(await controller.dispatch(window, 'next-monitor'), false);
    assert.equal(adapter.calls.length, 0);
});

test('unplugged monitor history is clamped into the current monitor', async () => {
    const {controller, adapter, window} = setup();
    window.state = {rect: {x: -1280, y: 0, width: 640, height: 720}, monitor: 1, maximized: 0};
    await controller.dispatch(window, 'next-monitor');
    adapter.areas.pop();
    await controller.dispatch(window, 'restore');
    assert.equal(window.state.monitor, 0);
    assert.equal(window.state.rect.x, 0);
    assert.equal(window.state.rect.y, 32);
});

test('histories and originals are independent for each window', async () => {
    const {controller, window} = setup();
    const second = makeWindow();
    second.state.rect.x = 600;
    await Promise.all([controller.dispatch(window, 'left-half'), controller.dispatch(second, 'right-half')]);
    await controller.dispatch(second, 'restore');
    assert.equal(second.state.rect.x, 600);
    assert.equal(window.state.rect.x, 0);
});

test('undo, redo and restore without prior actions do not capture an original', async () => {
    const {controller, window, adapter} = setup();
    for (const id of ['undo', 'redo', 'restore', 'unknown'])
        assert.equal(await controller.dispatch(window, id), false);
    assert.equal(adapter.calls.length, 0);
    window.state.rect.x = 400;
    await controller.dispatch(window, 'left-half');
    await controller.dispatch(window, 'restore');
    assert.equal(window.state.rect.x, 400);
});

test('failed operations leave history retryable and the queue continues', async () => {
    const {controller, window, adapter} = setup();
    await controller.dispatch(window, 'left-half');
    adapter.failure = new Error('client failed');
    await assert.rejects(controller.dispatch(window, 'undo'), /client failed/);
    adapter.failure = null;
    await controller.dispatch(window, 'undo');
    assert.deepEqual(window.state, original());
});

test('a client ignoring undo does not consume the history entry', async () => {
    const {controller, window, adapter} = setup();
    await controller.dispatch(window, 'left-half');
    adapter.ignore = true;
    assert.equal(await controller.dispatch(window, 'undo'), false);
    adapter.ignore = false;
    await controller.dispatch(window, 'undo');
    assert.deepEqual(window.state, original());
});

test('persistent recalls share the action queue and are undoable', async () => {
    const {controller, window} = setup();
    const saved = {rect: {x: 960, y: 32, width: 960, height: 1048}, monitor: 0, maximized: 0};
    const recalled = controller.restoreSnapshot(window, saved);
    saved.rect.x = 99; // caller mutation must not alter queued state
    await recalled;
    assert.equal(window.state.rect.x, 960);
    await controller.dispatch(window, 'undo');
    assert.deepEqual(window.state, original());
    await controller.dispatch(window, 'redo');
    assert.equal(window.state.rect.x, 960);
});

test('closing a window and disabling the controller cancel queued work', async () => {
    const {controller, window, adapter} = setup();
    window.alive = false;
    assert.equal(await controller.dispatch(window, 'left-half'), false);
    window.alive = true;
    const pending = controller.dispatch(window, 'left-half');
    controller.dispose();
    assert.equal(await pending, false);
    assert.equal(await controller.dispatch(window, 'right-half'), false);
    assert.equal(adapter.calls.length, 0);
});

test('all 33 action IDs can be dispatched without invalid rectangles', async () => {
    assert.equal(ACTIONS.length, 33);
    const {controller, window} = setup();
    for (const action of ACTIONS) {
        await controller.dispatch(window, action.id);
        assert(Object.values(window.state.rect).every(Number.isFinite));
        assert(window.state.rect.width > 0 && window.state.rect.height > 0);
    }
});
