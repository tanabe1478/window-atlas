import assert from 'node:assert/strict';
import test from 'node:test';
import {firstFreeSlot, MAX_POSITION_RECORDS, PositionDatabase, restoredPosition, validatePosition} from '../extension/positions.js';

const area = {x: -1600, y: 32, width: 1600, height: 868};
const position = () => ({appId: 'desktop:example.Editor.desktop', slot: 0, monitorId: 'DP-1', area: {...area},
    state: {rect: {x: -800, y: 32, width: 800, height: 868}, monitor: 1, maximized: 0}});
const monitors = () => [{index: 0, id: 'HDMI-1', area: {x: 0, y: 32, width: 1280, height: 688}},
    {index: 1, id: 'DP-1', area: {...area}}];

test('positions survive serialization and a new database instance', () => {
    const original = new PositionDatabase();
    original.set(position());
    const restarted = PositionDatabase.parse(original.stringify());
    assert.deepEqual(restarted.get('desktop:example.Editor.desktop', 0), position());
    assert.deepEqual(restoredPosition(restarted.get('desktop:example.Editor.desktop', 0), monitors(), 0), position().state);
});

test('saved and retrieved positions are independent copies', () => {
    const value = position();
    const database = new PositionDatabase();
    database.set(value);
    value.state.rect.x = 999;
    const recalled = database.get(value.appId, 0);
    recalled.area.x = 999;
    assert.equal(database.get(value.appId, 0).state.rect.x, -800);
    assert.equal(database.get(value.appId, 0).area.x, -1600);
});

test('multiple windows use independent per-app slots, and released slots are reusable', () => {
    const database = new PositionDatabase();
    database.set(position());
    database.set({...position(), slot: 1, state: {...position().state, rect: {x: -1600, y: 32, width: 800, height: 868}}});
    assert.equal(database.get(position().appId, 1).state.rect.x, -1600);
    assert.equal(database.get(position().appId, 0).state.rect.x, -800);
    assert.equal(firstFreeSlot([0, 1, 3]), 2);
    assert.equal(firstFreeSlot([1, 3]), 0);
    assert.equal(firstFreeSlot(Array.from({length: 32}, (_, index) => index)), null);
});

test('monitor connector identity takes priority over its old numeric index', () => {
    const swapped = monitors().map(item => ({...item, index: item.index === 0 ? 1 : 0}));
    assert.equal(restoredPosition(position(), swapped, 1).monitor, 0);
});

test('an unplugged monitor falls back inside the current screen', () => {
    const available = [monitors()[0]];
    const restored = restoredPosition(position(), available, 0);
    assert.deepEqual(restored, {rect: {x: 480, y: 32, width: 800, height: 688}, monitor: 0, maximized: 0});
    assert.equal(restoredPosition(position(), [], 0), null);
});

test('resolution and dock changes preserve logical size and right/bottom anchoring', () => {
    const value = position();
    value.state.rect = {x: -800, y: 500, width: 800, height: 400};
    const changed = [{index: 0, id: 'DP-1', area: {x: 1920, y: 48, width: 1920, height: 1032}}];
    assert.deepEqual(restoredPosition(value, changed, 0),
        {rect: {x: 3040, y: 680, width: 800, height: 400}, monitor: 0, maximized: 0});
});

test('maximized and partially maximized states adapt to the target work area', () => {
    const available = [monitors()[0]];
    for (const flags of [1, 2, 3]) {
        const value = position();
        value.state.maximized = flags;
        const state = restoredPosition(value, available, 0);
        assert.equal(state.maximized, flags);
        if (flags & 1) {
            assert.equal(state.rect.x, 0);
            assert.equal(state.rect.width, 1280);
        }
        if (flags & 2) {
            assert.equal(state.rect.y, 32);
            assert.equal(state.rect.height, 688);
        }
    }
});

test('untrusted or unknown-version data is rejected rather than silently overwritten', () => {
    for (const text of ['{', 'null', '{}', '{"version":2,"positions":[]}', '{"version":1,"positions":[{}]}'])
        assert.throws(() => PositionDatabase.parse(text));
    assert.throws(() => PositionDatabase.parse(' '.repeat(1024 * 1024 + 1)));
});

test('non-finite coordinates, illegal flags, slots, and excessive strings are rejected', () => {
    for (const bad of [
        {...position(), appId: ''}, {...position(), appId: 'x'.repeat(257)},
        {...position(), slot: -1}, {...position(), slot: 32},
        {...position(), monitorId: '\n'}, {...position(), area: {...area, width: 0}},
        {...position(), state: {...position().state, maximized: 4}},
        {...position(), state: {...position().state, rect: {...position().state.rect, x: Infinity}}},
    ]) {
        assert.equal(validatePosition(bad), false);
        assert.throws(() => new PositionDatabase().set(bad));
    }
});

test('window titles, paths, PIDs, and unknown attributes are never persisted', () => {
    const database = new PositionDatabase();
    database.set({...position(), title: 'Private document', pid: 1234, path: '/private/document'});
    const text = database.stringify();
    assert(!text.includes('Private document'));
    assert(!text.includes('/private/document'));
    assert(!text.includes('pid'));
});

test('record count is bounded and updating a position does not duplicate it', () => {
    const database = new PositionDatabase();
    for (let i = 0; i <= MAX_POSITION_RECORDS; i++)
        database.set({...position(), appId: `desktop:app${i}.desktop`});
    assert.equal(database.size, MAX_POSITION_RECORDS);
    assert.equal(database.get('desktop:app0.desktop', 0), null);
    database.set({...position(), appId: 'desktop:app500.desktop'});
    assert.equal(database.size, MAX_POSITION_RECORDS);
    assert.throws(() => PositionDatabase.parse(JSON.stringify({version: 1, positions: Array(MAX_POSITION_RECORDS + 1).fill(position())})));
});
