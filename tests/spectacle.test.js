// Behavioural regression cases checked against eczarny/spectacle at
// e75c341ec2cba179c1bb8aa726a870c4132207df (calculation JS and *CalculationSpec.m).
// These are expected geometry/shortcut data, not a vendored implementation.
import assert from 'node:assert/strict';
import test from 'node:test';
import {ACTIONS, ACTION_BY_ID, SHORTCUT_PRESETS} from '../extension/actions.js';
import {moveToMonitorRect, nextLayoutRect, nextThirdRect, resizeRect} from '../extension/geometry.js';

const frame = {x: 0, y: 4, width: 1440, height: 873};
const rect = ([x, y, width, height]) => ({x, y, width, height});
// Cocoa has its origin at the bottom-left; Mutter has it at the top-left.
const fromCocoa = values => {
    const value = rect(values);
    return {...value, y: 2 * frame.y + frame.height - value.y - value.height};
};

const resizeExamples = [
    ['centre', [360, 222, 720, 436], [345, 207, 750, 466]],
    ['top', [402, 441, 720, 436], [387, 411, 750, 466]],
    ['bottom', [238, 4, 720, 436], [223, 4, 750, 466]],
    ['left', [0, 250, 720, 436], [0, 235, 750, 466]],
    ['right', [720, 303, 720, 436], [690, 288, 750, 466]],
    ['top left', [0, 441, 720, 436], [0, 411, 750, 466]],
    ['top right', [720, 441, 720, 436], [690, 411, 750, 466]],
    ['bottom left', [0, 4, 720, 436], [0, 4, 750, 466]],
    ['bottom right', [720, 4, 720, 436], [690, 4, 750, 466]],
    ['top and bottom', [344, 4, 720, 873], [329, 4, 750, 873]],
    ['left and right', [0, 285, 1440, 446], [0, 270, 1440, 476]],
];
for (const [name, smaller, larger] of resizeExamples) {
    test(`Spectacle resize reference: ${name}, both directions`, () => {
        assert.deepEqual(resizeRect(fromCocoa(smaller), frame, 30), fromCocoa(larger));
        assert.deepEqual(resizeRect(fromCocoa(larger), frame, -30), fromCocoa(smaller));
    });
}

test('Spectacle reference: shrinking a maximized rectangle releases all four edges', () => {
    assert.deepEqual(resizeRect(frame, frame, -30), fromCocoa([15, 19, 1410, 843]));
});

test('Spectacle reference: six horizontal/vertical thirds and wrap in either direction', () => {
    const expected = [
        [0, 4, 480, 873], [480, 4, 480, 873], [960, 4, 480, 873],
        [0, 586, 1440, 291], [0, 295, 1440, 291], [0, 4, 1440, 291],
    ].map(fromCocoa);
    const arbitrary = fromCocoa([165, 245, 564, 384]);
    assert.deepEqual(nextThirdRect(arbitrary, frame, 1), expected[0]);
    assert.deepEqual(nextThirdRect(arbitrary, frame, -1), expected[0]);
    for (let i = 0; i < 6; i++) {
        assert.deepEqual(nextThirdRect(expected[i], frame, 1), expected[(i + 1) % 6]);
        assert.deepEqual(nextThirdRect(expected[i], frame, -1), expected[(i + 5) % 6]);
    }
});

test('Spectacle reference: half and corner widths cycle half → two thirds → one third', () => {
    const area = {x: -1440, y: 32, width: 1440, height: 900};
    for (const id of ['left-half', 'right-half', 'top-left', 'top-right', 'bottom-left', 'bottom-right']) {
        let current = {x: -1100, y: 100, width: 600, height: 600};
        for (const width of [720, 960, 480, 720]) {
            current = nextLayoutRect(current, area, ACTION_BY_ID.get(id).layouts);
            assert.equal(current.width, width, id);
            assert.equal(current.height, id.endsWith('half') ? 900 : 450, id);
            assert.equal(current.x, id.startsWith('right') || id.endsWith('right') ? -width : -1440, id);
            assert.equal(current.y, id.startsWith('bottom') ? 482 : 32, id);
        }
    }
    for (const id of ['top-half', 'bottom-half']) {
        let current = {x: -1100, y: 100, width: 600, height: 600};
        for (const height of [450, 600, 300, 450]) {
            current = nextLayoutRect(current, area, ACTION_BY_ID.get(id).layouts);
            assert.equal(current.width, 1440);
            assert.equal(current.height, height);
            assert.equal(current.y, id === 'top-half' ? 32 : 932 - height);
        }
    }
});

test('Spectacle display reference: preserve size and centre rather than proportionally scaling', () => {
    const destination = {x: 1440, y: 4, width: 1440, height: 873};
    const moved = moveToMonitorRect(fromCocoa([165, 245, 564, 384]), destination);
    assert.deepEqual({x: moved.x, width: moved.width, height: moved.height}, {x: 1878, width: 564, height: 384});
    // Reflecting a rounded odd coordinate differs by one pixel between Cocoa
    // and Mutter; dimensions and the destination centre are otherwise equal.
    assert(Math.abs(moved.y - fromCocoa([1878, 249, 564, 384]).y) <= 1);
    assert.deepEqual(moveToMonitorRect({x: 0, y: 0, width: 1441, height: 500}, destination), destination);
});

test('Spectacle shortcut preset covers exactly the original 18 actions, without duplicates', () => {
    const preset = SHORTCUT_PRESETS.find(item => item.id === 'spectacle');
    const bindings = Object.values(preset.bindings).flat();
    assert.equal(bindings.length, 18);
    assert.equal(new Set(bindings).size, 18);
    assert.deepEqual(preset.bindings['atlas-left-half'], ['<Alt><Super>Left']);
    assert.deepEqual(preset.bindings['atlas-bottom-left'], ['<Control><Shift><Super>Left']);
    assert.deepEqual(preset.bindings['atlas-next-third'], ['<Control><Alt>Right']);
    assert.deepEqual(preset.bindings['atlas-larger'], ['<Control><Alt><Shift>Right']);
    assert.deepEqual(preset.bindings['atlas-restore'], []);
    assert.deepEqual(preset.bindings['atlas-left-third'], []);
    assert.deepEqual(preset.bindings['atlas-remember-window'], []);
});

test('Ubuntu preset preserves all schema defaults and both presets cover every action key', () => {
    for (const preset of SHORTCUT_PRESETS) {
        assert.deepEqual(Object.keys(preset.bindings).sort(), ACTIONS.map(action => action.key).sort());
        for (const action of ACTIONS)
            assert(Array.isArray(preset.bindings[action.key]));
    }
    const ubuntu = SHORTCUT_PRESETS.find(item => item.id === 'ubuntu');
    for (const action of ACTIONS)
        assert.deepEqual(ubuntu.bindings[action.key], action.accelerator ? [action.accelerator] : []);
});
