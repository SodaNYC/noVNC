/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC authors
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

// A disposed browser socket may outlive the macOS Screen Sharing session
// on the server. Allow a small, bounded grace period for that old session
// to disappear before treating a resume-time authorization denial as final.
export default class IOSResumeRecovery {
    constructor() {
        this.reset();
    }

    reset() {
        this.active = false;
        this.retries = 0;
    }

    start() {
        this.active = true;
        this.retries = 0;
    }

    nextAuthRetryDelay(reason) {
        if (!this.active ||
            typeof reason !== "string" ||
            !reason.toLowerCase().includes("authentication or authorization failure")) {
            return null;
        }
        // Avoid rapid repeated ARD authentication attempts / account lockout.
        const delays = [2500, 6000];
        if (this.retries >= delays.length) {
            this.reset();
            return -1; // Exhausted: require manual reconnect/reauthentication.
        }
        return delays[this.retries++];
    }
}
