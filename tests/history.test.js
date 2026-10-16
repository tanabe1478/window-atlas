import assert from 'node:assert/strict';
import test from 'node:test';
import {WindowHistory} from '../extension/history.js';

const state = x => ({rect: {x, y: 32, width: 500, height: 400}, monitor: 0, maximized: 0});

test('history stores independent copies and an immutable original snapshot', () => {
    const original = state(100);
    const history = new WindowHistory(original);
    original.rect.x = 999;
    history.record(state(100), state(200));
    const peek = history.peekUndo();
    peek.rect.x = 999;
    assert.equal(history.peekUndo().rect.x, 100);
    assert.equal(history.original.rect.x, 100);
});

test('undo and redo commit only when called', () => {
    const history = new WindowHistory(state(100));
    history.record(state(100), state(200));
    assert.equal(history.peekUndo().rect.x, 100);
    assert.equal(history.past.length, 1);
    history.commitUndo(state(200));
    assert.equal(history.peekUndo(), null);
    assert.equal(history.peekRedo().rect.x, 200);
    history.commitRedo(state(100));
    assert.equal(history.peekRedo(), null);
    assert.equal(history.peekUndo().rect.x, 100);
    history.commitRedo(state(100)); // empty stack is harmless
});

test('a new change clears redo but a no-op does not', () => {
    const history = new WindowHistory(state(100));
    history.record(state(100), state(200));
    history.commitUndo(state(200));
    assert.equal(history.record(state(100), state(100)), false);
    assert(history.peekRedo());
    history.record(state(100), state(300));
    assert.equal(history.peekRedo(), null);
});

test('history is bounded and original survives eviction', () => {
    const history = new WindowHistory(state(0), 3);
    for (let index = 0; index < 10; index++)
        history.record(state(index * 10), state((index + 1) * 10));
    assert.deepEqual(history.past.map(item => item.rect.x), [70, 80, 90]);
    assert.equal(history.original.rect.x, 0);
});
