/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2026 The noVNC contributors
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

// VNC offers discrete wheel clicks, not pixel-precise scrolling. Convert
// touch motion into a bounded wheel stream and a short decaying fling.
// Never leave a large queue of clicks waiting for a slow VNC server.
const PIXELS_PER_NOTCH = 12;
const TOUCH_GAIN = 1.5;
const TICK_MS = 16;
const MAX_NOTCHES_PER_TICK = 3;
const MAX_PENDING = PIXELS_PER_NOTCH * 8;
const MIN_FLING_VELOCITY = 0.25; // screen pixels per millisecond
const STOP_FLING_VELOCITY = 0.12;
const FLING_DECAY = 0.87;
const MAX_FLING_MS = 640;
const RECENT_MOVE_MS = 90;

export default class KineticScroll {
    constructor(sendWheel) {
        this._sendWheel = sendWheel;
        this.stop();
    }

    stop() {
        if (this._timer !== null && this._timer !== undefined) {
            clearTimeout(this._timer);
        }
        this._timer = null;
        this._tracking = false;
        this._pending = 0;
        this._velocity = 0;
        this._lastMoveAt = 0;
        this._lastMotionAt = 0;
        this._flingStartedAt = 0;
        this._burstStartAt = -Infinity;
        this._burstCount = 0;
        this._x = 0;
        this._y = 0;
    }

    start(x, y) {
        this.stop(); // New gesture interrupts the previous fling immediately.
        this._tracking = true;
        this._x = x;
        this._y = y;
        this._lastMoveAt = Date.now();
        this._lastMotionAt = this._lastMoveAt;
    }

    move(deltaY, x, y) {
        if (!this._tracking || !Number.isFinite(deltaY)) {
            return;
        }
        this._x = x;
        this._y = y;
        if (Math.abs(deltaY) < 0.1) {
            return;
        }

        const now = Date.now();
        const dt = Math.max(8, Math.min(80, now - this._lastMoveAt));
        const instantaneous = Math.max(-3, Math.min(3, deltaY / dt));
        this._velocity = this._velocity === 0 ? instantaneous :
            this._velocity * 0.35 + instantaneous * 0.65;
        this._lastMoveAt = now;
        this._lastMotionAt = now;

        // Reversing direction must discard pending movement from the
        // previous direction; it must not scroll the wrong way first.
        const amount = deltaY * TOUCH_GAIN;
        if (this._pending * amount < 0) {
            this._pending = 0;
        }
        this._pending = Math.max(-MAX_PENDING,
                                 Math.min(MAX_PENDING, this._pending + amount));
        this._drain();
        this._schedule();
    }

    end() {
        if (!this._tracking) {
            return;
        }
        this._tracking = false;
        const now = Date.now();
        if (now - this._lastMotionAt > RECENT_MOVE_MS ||
            Math.abs(this._velocity) < MIN_FLING_VELOCITY) {
            this._velocity = 0;
        }
        this._flingStartedAt = now;
        if (this._velocity !== 0 || Math.abs(this._pending) >= PIXELS_PER_NOTCH) {
            this._schedule();
        } else {
            this._pending = 0;
        }
    }

    _drain() {
        // Limit across ALL gesture callbacks inside a 16ms window, not
        // per callback: Safari can deliver many gesturemove events at once.
        const now = Date.now();
        if (now - this._burstStartAt >= TICK_MS) {
            this._burstStartAt = now;
            this._burstCount = 0;
        }
        while (Math.abs(this._pending) >= PIXELS_PER_NOTCH &&
               this._burstCount < MAX_NOTCHES_PER_TICK) {
            const direction = Math.sign(this._pending);
            this._sendWheel(direction, this._x, this._y);
            this._pending -= direction * PIXELS_PER_NOTCH;
            this._burstCount++;
        }
    }

    _schedule() {
        if (this._timer !== null) {
            return;
        }
        if (Math.abs(this._pending) < PIXELS_PER_NOTCH &&
            (this._tracking || this._velocity === 0)) {
            return;
        }
        this._timer = setTimeout(() => this._tick(), TICK_MS);
    }

    _tick() {
        this._timer = null;
        if (!this._tracking && this._velocity !== 0) {
            if (Date.now() - this._flingStartedAt >= MAX_FLING_MS ||
                Math.abs(this._velocity) < STOP_FLING_VELOCITY) {
                this._velocity = 0;
            } else {
                this._pending = Math.max(-MAX_PENDING,
                    Math.min(MAX_PENDING,
                             this._pending + this._velocity * TICK_MS * TOUCH_GAIN));
                this._velocity *= FLING_DECAY;
            }
        }

        this._drain();
        if (Math.abs(this._pending) >= PIXELS_PER_NOTCH ||
            (!this._tracking && this._velocity !== 0)) {
            this._schedule();
        } else if (!this._tracking) {
            this._pending = 0;
        }
    }
}
