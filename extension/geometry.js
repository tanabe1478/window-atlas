// All coordinates are Mutter logical pixels, never physical monitor pixels.
const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

export function copyRect(rect) {
    return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
}

export function clampRect(rect, area) {
    const width = clamp(Math.round(rect.width), 1, area.width);
    const height = clamp(Math.round(rect.height), 1, area.height);
    return {
        x: clamp(Math.round(rect.x), area.x, area.x + area.width - width),
        y: clamp(Math.round(rect.y), area.y, area.y + area.height - height),
        width,
        height,
    };
}

export function tileRect(area, fraction, gap = 0) {
    // Round shared boundaries rather than widths so odd-sized screens have no
    // unassigned pixels. Internal borders share a gap; outer borders get a full gap.
    gap = clamp(gap, 0, Math.floor(Math.min(
        area.width * fraction.width, area.height * fraction.height) / 3));
    const rightEdge = fraction.x + fraction.width;
    const bottomEdge = fraction.y + fraction.height;
    const x = Math.round(area.x + area.width * fraction.x + (fraction.x === 0 ? gap : gap / 2));
    const y = Math.round(area.y + area.height * fraction.y + (fraction.y === 0 ? gap : gap / 2));
    const right = Math.round(area.x + area.width * rightEdge - (rightEdge >= 1 - 1e-9 ? gap : gap / 2));
    const bottom = Math.round(area.y + area.height * bottomEdge - (bottomEdge >= 1 - 1e-9 ? gap : gap / 2));
    return clampRect({x, y, width: right - x, height: bottom - y}, area);
}

export function centerRect(rect, area) {
    const fitted = clampRect(rect, area);
    return clampRect({
        ...fitted,
        x: area.x + (area.width - fitted.width) / 2,
        y: area.y + (area.height - fitted.height) / 2,
    }, area);
}

// Like Spectacle, recognise constrained clients that are smaller but centred
// inside a target region. Do not rely on the previous key/action being the same.
export function matchesLayout(rect, target, tolerance = 2) {
    return rect.x >= target.x - tolerance && rect.y >= target.y - tolerance &&
        rect.x + rect.width <= target.x + target.width + tolerance &&
        rect.y + rect.height <= target.y + target.height + tolerance &&
        Math.abs(rect.x + rect.width / 2 - target.x - target.width / 2) <= tolerance &&
        Math.abs(rect.y + rect.height / 2 - target.y - target.height / 2) <= tolerance;
}

export function nextLayoutRect(rect, area, layouts, cycleSizes = true, gap = 0) {
    const targets = layouts.map(layout => tileRect(area, layout, gap));
    const current = cycleSizes ? targets.findIndex(target => matchesLayout(rect, target)) : -1;
    return targets[(current + 1) % targets.length];
}

export function thirdRects(area, gap = 0) {
    // Order is left → centre → right → top → middle → bottom → left.
    return [
        ...Array.from({length: 3}, (_, index) => ({x: index / 3, y: 0, width: 1 / 3, height: 1})),
        ...Array.from({length: 3}, (_, index) => ({x: 0, y: index / 3, width: 1, height: 1 / 3})),
    ].map(layout => tileRect(area, layout, gap));
}

export function nextThirdRect(rect, area, direction, gap = 0) {
    const targets = thirdRects(area, gap);
    const current = targets.findIndex(target => matchesLayout(rect, target));
    // Both next and previous start at the left third from an arbitrary rect.
    return targets[current < 0 ? 0 : (current + direction + targets.length) % targets.length];
}

export function resizeRect(rect, area, offset) {
    // Spectacle changes both dimensions by a fixed amount (default ±30), not
    // a percentage. Keep contacted edges within a five-logical-pixel tolerance.
    const left = Math.abs(rect.x - area.x) <= 5;
    const right = Math.abs(rect.x + rect.width - area.x - area.width) <= 5;
    const top = Math.abs(rect.y - area.y) <= 5;
    const bottom = Math.abs(rect.y + rect.height - area.y - area.height) <= 5;
    const shrinkFromFullArea = offset < 0 && left && right && top && bottom;
    const width = left && right && !shrinkFromFullArea ? area.width : Math.min(area.width, rect.width + offset);
    const height = top && bottom && !shrinkFromFullArea ? area.height : Math.min(area.height, rect.height + offset);
    // Match Spectacle's minimum: refuse the whole resize if either dimension
    // would be no more than one quarter of the work area.
    if (width <= Math.floor(area.width / 4) || height <= Math.floor(area.height / 4))
        return copyRect(rect);
    let x = rect.x + (rect.width - width) / 2;
    let y = rect.y + (rect.height - height) / 2;
    if (!shrinkFromFullArea) {
        if (right)
            x = area.x + area.width - width;
        if (left)
            x = area.x;
        if (bottom)
            y = area.y + area.height - height;
        if (top)
            y = area.y;
    }
    return clampRect({x, y, width, height}, area);
}

export function moveToMonitorRect(rect, destination) {
    // Spectacle keeps the size and centres on the destination. If either
    // dimension does not fit, it fills the whole destination work area.
    return rect.width <= destination.width && rect.height <= destination.height
        ? centerRect(rect, destination) : copyRect(destination);
}

export function copyState(state) {
    return {rect: copyRect(state.rect), monitor: state.monitor, maximized: state.maximized};
}

export function sameState(a, b, tolerance = 2) {
    return Boolean(a && b && a.monitor === b.monitor && a.maximized === b.maximized &&
        ['x', 'y', 'width', 'height'].every(key => Math.abs(a.rect[key] - b.rect[key]) <= tolerance));
}
