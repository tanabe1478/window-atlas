import {copyState, sameState} from './geometry.js';

export class WindowHistory {
    constructor(original, limit = 50) {
        this.original = copyState(original);
        this.limit = limit;
        this.past = [];
        this.future = [];
    }

    record(before, after) {
        if (sameState(before, after))
            return false;
        this.past.push(copyState(before));
        this.past = this.past.slice(-this.limit);
        this.future = [];
        return true;
    }

    peekUndo() {
        return this.past.length ? copyState(this.past.at(-1)) : null;
    }

    peekRedo() {
        return this.future.length ? copyState(this.future.at(-1)) : null;
    }

    // Commit only after the compositor accepts a restoration.
    commitUndo(current) {
        if (!this.past.length)
            return;
        this.past.pop();
        this.future.push(copyState(current));
        this.future = this.future.slice(-this.limit);
    }

    commitRedo(current) {
        if (!this.future.length)
            return;
        this.future.pop();
        this.past.push(copyState(current));
        this.past = this.past.slice(-this.limit);
    }
}
