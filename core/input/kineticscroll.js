/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2026 The noVNC contributors
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

// Apple Screen Sharing consumes discrete VNC wheel clicks. Use a bounded
// wheel stream, sampling movement across a short time window rather than
// relying on the final tiny touchmove event (iOS reports touches separately).
const PIXELS_PER_NOTCH = 6;
const TOUCH_GAIN = 6.4;
const TICK_MS = 16;
const MAX_NOTCHES_PER_TICK = 3;
// A normal full-screen swipe can represent hundreds of wheel notches at
// high sensitivity. The former 72-notch cap caused different TOUCH_GAIN
// values to produce the same output once the queue saturated.
// Keep a generous, finite safety cap (768 notches, ~4.1s worst-case drain)
// while preserving all ordinary full-screen swipe input.
const MAX_PENDING = PIXELS_PER_NOTCH * 768;
const VELOCITY_WINDOW_MS = 130;
const MAX_SAMPLES = 48;
const MIN_FLING_DISTANCE = 7;
const MIN_FLING_VELOCITY = 0.15;  // px per ms over recent movement
const STOP_FLING_VELOCITY = 0.06;
const FLING_DECAY = 0.93;
const MAX_FLING_MS = 900;
// Separate the momentum budget from the *real finger travel* queue:
// widening the queue must not allow a short flick to coast for seconds.
const MAX_FLING_ADDED_NOTCHES = 120;
const RECENT_MOVE_MS = 120;

export default class KineticScroll {
    constructor(sendWheel) {
        this._sendWheel = sendWheel;
        this._timer = null;
        this.stop();
    }

    stop() {
        if (this._timer !== null) {
            clearTimeout(this._timer);
        }
        this._timer = null;
        this._tracking = false;
        this._pending = 0;
        this._velocity = 0;
        this._flingRemaining = 0;
        this._lastMotionAt = 0;
        this._flingStartedAt = 0;
        this._burstStartAt = -Infinity;
        this._burstCount = 0;
        this._direction = 0;
        this._distance = 0;
        this._samples = [];
        this._x = 0;
        this._y = 0;
    }

    start(x, y) {
        this.stop(); // Any new touch cancels the old fling.
        this._tracking = true;
        this._x = x;
        this._y = y;
        const now = Date.now();
        this._lastMotionAt = now;
        this._samples = [{ time: now, distance: 0 }];
    }

    move(deltaY, x, y) {
        if (!this._tracking || !Number.isFinite(deltaY) ||
            Math.abs(deltaY) < 0.1) {
            return;
        }

        this._x = x;
        this._y = y;
        const now = Date.now();
        const direction = Math.sign(deltaY);

        if (this._direction !== 0 && direction !== this._direction) {
            // A reversal must drop the old backlog *and* velocity history.
            this._pending = 0;
            this._distance = 0;
            this._samples = [{ time: now, distance: 0 }];
        }
        this._direction = direction;
        this._distance += deltaY;
        this._lastMotionAt = now;
        this._samples.push({ time: now, distance: this._distance });

        // Keep one sample older than the window where available, so the
        // distance/time estimate remains valid for split iOS touch events.
        while (this._samples.length > 2 &&
               this._samples[1].time < now - VELOCITY_WINDOW_MS) {
            this._samples.shift();
        }
        while (this._samples.length > MAX_SAMPLES) {
            this._samples.shift();
        }

        const amount = deltaY * TOUCH_GAIN;
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
        const first = this._samples[0];
        const last = this._samples[this._samples.length - 1];

        let velocity = 0;
        if (first && last &&
            now - this._lastMotionAt <= RECENT_MOVE_MS) {
            const distance = last.distance - first.distance;
            const elapsed = Math.max(16, last.time - first.time);
            if (Math.abs(distance) >= MIN_FLING_DISTANCE) {
                velocity = Math.max(-3, Math.min(3, distance / elapsed));
            }
        }
        this._velocity = Math.abs(velocity) >= MIN_FLING_VELOCITY ?
            velocity : 0;
        this._flingRemaining = this._velocity !== 0 ?
            PIXELS_PER_NOTCH * MAX_FLING_ADDED_NOTCHES : 0;
        this._flingStartedAt = now;

        if (this._velocity !== 0 ||
            Math.abs(this._pending) >= PIXELS_PER_NOTCH) {
            this._schedule();
        } else {
            this._pending = 0;
        }
    }

    _drain() {
        // Rate limit across all gesturemove callbacks in the same 16ms
        // window, not once per callback.
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
                Math.abs(this._velocity) < STOP_FLING_VELOCITY ||
                this._flingRemaining < PIXELS_PER_NOTCH) {
                this._velocity = 0;
            } else {
                const amount = Math.sign(this._velocity) *
                    Math.min(Math.abs(this._velocity * TICK_MS * TOUCH_GAIN),
                             this._flingRemaining);
                this._pending = Math.max(-MAX_PENDING,
                    Math.min(MAX_PENDING, this._pending + amount));
                this._flingRemaining -= Math.abs(amount);
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
