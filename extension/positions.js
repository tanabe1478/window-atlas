// Persistent position data and restoration geometry, independent of GNOME/GIO.
import {clampRect, copyRect, copyState} from './geometry.js';

export const MAX_POSITION_RECORDS = 500;
export const MAX_POSITION_BYTES = 1024 * 1024;
const validRect = rect => rect && ['x', 'y', 'width', 'height'].every(key => Number.isInteger(rect[key]) && Math.abs(rect[key]) <= 1_000_000) &&
    rect.width > 0 && rect.height > 0 && rect.width <= 65536 && rect.height <= 65536;
const validIdentity = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f]/.test(value);

export function validatePosition(value) {
    return Boolean(value && validIdentity(value.appId) && Number.isInteger(value.slot) && value.slot >= 0 && value.slot < 32 &&
        validIdentity(value.monitorId) && validRect(value.area) && value.state && validRect(value.state.rect) &&
        Number.isInteger(value.state.monitor) && value.state.monitor >= 0 && value.state.monitor < 128 &&
        Number.isInteger(value.state.maximized) && value.state.maximized >= 0 && value.state.maximized <= 3);
}

const copyPosition = value => ({appId: value.appId, slot: value.slot, monitorId: value.monitorId,
    area: copyRect(value.area), state: copyState(value.state)});
const positionKey = (appId, slot) => JSON.stringify([appId, slot]);

export class PositionDatabase {
    constructor() {
        this._records = new Map();
    }

    static parse(text) {
        if (typeof text !== 'string' || text.length > MAX_POSITION_BYTES)
            throw new Error('Position data exceeds the size limit');
        const data = JSON.parse(text);
        if (!data || data.version !== 1 || !Array.isArray(data.positions) || data.positions.length > MAX_POSITION_RECORDS ||
            !data.positions.every(validatePosition))
            throw new Error('Invalid or unsupported position data; file was not overwritten');
        const database = new PositionDatabase();
        for (const record of data.positions)
            database.set(record);
        return database;
    }

    get size() {
        return this._records.size;
    }

    get(appId, slot) {
        const value = this._records.get(positionKey(appId, slot));
        return value ? copyPosition(value) : null;
    }

    set(value) {
        if (!validatePosition(value))
            throw new Error('Invalid window position');
        const key = positionKey(value.appId, value.slot);
        this._records.delete(key);
        this._records.set(key, copyPosition(value));
        while (this._records.size > MAX_POSITION_RECORDS)
            this._records.delete(this._records.keys().next().value);
    }

    stringify() {
        return `${JSON.stringify({version: 1, positions: [...this._records.values()]}, null, 2)}\n`;
    }
}

export function firstFreeSlot(used) {
    for (let slot = 0; slot < 32; slot++) {
        if (!used.includes(slot))
            return slot;
    }
    return null;
}

export function restoredPosition(record, monitors, fallbackIndex) {
    if (!validatePosition(record) || !monitors.length)
        return null;
    const monitor = monitors.find(item => item.id === record.monitorId) ??
        monitors.find(item => item.index === fallbackIndex) ?? monitors[0];
    const source = record.area;
    const destination = monitor.area;
    const fitted = clampRect(record.state.rect, destination);
    // Preserve logical size and relative travel within the work area. This
    // keeps right/bottom anchoring when a dock or monitor resolution changes.
    const xRatio = (record.state.rect.x - source.x) / Math.max(1, source.width - record.state.rect.width);
    const yRatio = (record.state.rect.y - source.y) / Math.max(1, source.height - record.state.rect.height);
    let rect = clampRect({...fitted,
        x: destination.x + xRatio * (destination.width - fitted.width),
        y: destination.y + yRatio * (destination.height - fitted.height)}, destination);
    if (record.state.maximized & 1)
        rect = {...rect, x: destination.x, width: destination.width};
    if (record.state.maximized & 2)
        rect = {...rect, y: destination.y, height: destination.height};
    return {rect, monitor: monitor.index, maximized: record.state.maximized};
}
