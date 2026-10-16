import assert from 'node:assert/strict';
import test from 'node:test';
import {ACTIONS, ACTION_BY_ID} from '../extension/actions.js';
import {clampRect, centerRect, moveToMonitorRect, matchesLayout, nextLayoutRect, nextThirdRect, resizeRect, sameState, thirdRects, tileRect} from '../extension/geometry.js';

const area = {x: 0, y: 32, width: 1920, height: 1048};
const layout = id => ACTION_BY_ID.get(id).layouts[0];

test('halves respect the work area (panel and dock excluded)', () => {
    assert.deepEqual(tileRect(area, layout('left-half')), {x: 0, y: 32, width: 960, height: 1048});
    assert.deepEqual(tileRect(area, layout('bottom-half')), {x: 0, y: 556, width: 1920, height: 524});
});

test('quarters respect both axes', () => {
    assert.deepEqual(tileRect(area, layout('bottom-right')), {x: 960, y: 556, width: 960, height: 524});
});

test('odd widths have shared boundaries and no missing pixels', () => {
    for (let width = 1; width < 300; width++) {
        const screen = {x: -width, y: 17, width, height: 187};
        const left = tileRect(screen, layout('left-half'));
        const right = tileRect(screen, layout('right-half'));
        if (width > 1) {
            assert.equal(left.x + left.width, right.x);
            assert.equal(right.x + right.width, screen.x + screen.width);
        }
        if (width >= 3) {
            const thirds = ['left-third', 'center-third', 'right-third'].map(id => tileRect(screen, layout(id)));
            assert.equal(thirds[0].x + thirds[0].width, thirds[1].x);
            assert.equal(thirds[1].x + thirds[1].width, thirds[2].x);
            assert.equal(thirds[2].x + thirds[2].width, screen.x + width);
        }
    }
});

test('gaps have equal outside and inside spacing', () => {
    const left = tileRect(area, layout('left-half'), 8);
    const right = tileRect(area, layout('right-half'), 8);
    assert.equal(left.x, 8);
    assert.equal(left.y, area.y + 8);
    assert.equal(right.x - left.x - left.width, 8);
    assert.equal(area.width - right.x - right.width, 8);
});

test('all layouts stay inside small, offset, and negative-coordinate monitors', () => {
    for (const screen of [area, {x: -1440, y: -400, width: 1440, height: 900},
        {x: 1920, y: 48, width: 2560, height: 1392}, {x: 0, y: 0, width: 5, height: 3}]) {
        for (const action of ACTIONS) {
            for (const fraction of action.layouts ?? []) {
                for (const gap of [0, 1, 8, 64]) {
                    const rect = tileRect(screen, fraction, gap);
                    assert(rect.width > 0 && rect.height > 0);
                    assert(rect.x >= screen.x && rect.y >= screen.y);
                    assert(rect.x + rect.width <= screen.x + screen.width);
                    assert(rect.y + rect.height <= screen.y + screen.height);
                    assert(Object.values(rect).every(Number.isInteger));
                }
            }
        }
    }
});

test('center preserves size and handles oversized windows', () => {
    assert.deepEqual(centerRect({x: 100, y: 80, width: 800, height: 600}, area),
        {x: 560, y: 256, width: 800, height: 600});
    assert.deepEqual(centerRect({x: -999, y: -999, width: 4000, height: 2000}, area), area);
});

test('resize uses a fixed pixel step and preserves the centre away from edges', () => {
    const rect = {x: 500, y: 400, width: 600, height: 400};
    const larger = resizeRect(rect, area, 30);
    assert.deepEqual(larger, {x: 485, y: 385, width: 630, height: 430});
    assert.deepEqual(resizeRect(larger, area, -30), rect);
    assert.deepEqual(resizeRect(area, area, 30), area);
});

test('resize keeps left, right, top, bottom, and corner contacts', () => {
    for (const x of [area.x, 500, area.width - 600]) {
        for (const y of [area.y, 400, area.y + area.height - 400]) {
            for (const offset of [-30, 30]) {
                const rect = resizeRect({x, y, width: 600, height: 400}, area, offset);
                assert.equal(rect.width, 600 + offset);
                assert.equal(rect.height, 400 + offset);
                if (x === area.x)
                    assert.equal(rect.x, area.x);
                else if (x === area.width - 600)
                    assert.equal(rect.x + rect.width, area.width);
                else
                    assert.equal(rect.x + rect.width / 2, x + 300);
                if (y === area.y)
                    assert.equal(rect.y, area.y);
                else if (y === area.y + area.height - 400)
                    assert.equal(rect.y + rect.height, area.y + area.height);
                else
                    assert.equal(rect.y + rect.height / 2, y + 200);
            }
        }
    }
});

test('resize preserves opposite contacted edges and shrinks a full screen from the centre', () => {
    assert.deepEqual(resizeRect({x: 0, y: 32, width: 960, height: 1048}, area, -30),
        {x: 0, y: 32, width: 930, height: 1048});
    assert.deepEqual(resizeRect({x: 0, y: 32, width: 1920, height: 524}, area, -30),
        {x: 0, y: 32, width: 1920, height: 494});
    assert.deepEqual(resizeRect(area, area, -30), {x: 15, y: 47, width: 1890, height: 1018});
});

test('edge contact uses five-pixel tolerance, not an arbitrary snap distance', () => {
    const close = resizeRect({x: 4, y: 200, width: 800, height: 500}, area, -30);
    assert.equal(close.x, 0);
    const away = resizeRect({x: 6, y: 200, width: 800, height: 500}, area, -30);
    assert.equal(away.x, 21);
});

test('resize refuses the whole operation at the quarter-screen size limit', () => {
    const rect = {x: 100, y: 100, width: 510, height: 500};
    assert.deepEqual(resizeRect(rect, area, -30), rect);
    const short = {x: 100, y: 100, width: 800, height: 292};
    assert.deepEqual(resizeRect(short, area, -30), short);
});

test('layout matching recognises smaller centred clients but rejects oversized or shifted clients', () => {
    const target = tileRect(area, layout('left-half'));
    assert(matchesLayout({x: 100, y: 132, width: 760, height: 848}, target));
    assert(!matchesLayout({...target, width: target.width + 20}, target));
    assert(!matchesLayout({...target, x: 50}, target));
    const targets = ACTION_BY_ID.get('left-half').layouts;
    assert.equal(nextLayoutRect({x: 100, y: 132, width: 760, height: 848}, area, targets).width, 1280);
});

test('thirds visit left, centre, right, top, middle, bottom, with gap-aware recognition', () => {
    for (const screen of [area, {x: -1600, y: -200, width: 1601, height: 901}]) {
        for (const gap of [0, 8]) {
            const thirds = thirdRects(screen, gap);
            assert.deepEqual(thirds.slice(0, 3), ['left-third', 'center-third', 'right-third'].map(id => tileRect(screen, layout(id), gap)));
            assert.deepEqual(thirds.slice(3), ['top-third', 'middle-third', 'bottom-third'].map(id => tileRect(screen, layout(id), gap)));
            for (let i = 0; i < 6; i++) {
                assert.deepEqual(nextThirdRect(thirds[i], screen, 1, gap), thirds[(i + 1) % 6]);
                assert.deepEqual(nextThirdRect(thirds[i], screen, -1, gap), thirds[(i + 5) % 6]);
            }
        }
    }
});

test('monitor transfer keeps size and centres, or fills the destination if it cannot fit', () => {
    const destination = {x: -1280, y: -200, width: 1280, height: 720};
    assert.deepEqual(moveToMonitorRect({x: 1920, y: 32, width: 960, height: 540}, destination),
        {x: -1120, y: -110, width: 960, height: 540});
    assert.deepEqual(moveToMonitorRect({x: 0, y: 32, width: 1440, height: 540}, destination), destination);
    assert.deepEqual(moveToMonitorRect({x: 0, y: 32, width: 960, height: 800}, destination), destination);
});

test('clamping rounds coordinates and keeps at least one logical pixel', () => {
    assert.deepEqual(clampRect({x: -99, y: 6000, width: 0, height: 9000}, area),
        {x: 0, y: 32, width: 1, height: 1048});
});

test('state comparison includes monitor and maximization flags', () => {
    const state = {rect: area, monitor: 0, maximized: 0};
    assert(sameState(state, {...state, rect: {...area, x: 1}}));
    assert(!sameState(state, {...state, monitor: 1}));
    assert(!sameState(state, {...state, maximized: 3}));
    assert(!sameState(null, state));
});
