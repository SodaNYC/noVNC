/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC authors
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

import KeyTable from "../core/input/keysym.js";
import keysyms from "../core/input/keysymdef.js";

// The browser owns composing text. Only send committed changes over RFB.
// Never forward intermediate pinyin/candidate updates or their deletions.
export default class VirtualKeyboardInput {
    constructor(sendKey) {
        this._sendKey = sendKey;
        this._lastValue = null;
        this._composing = false;
        this._pendingFinalize = false;
        this._finalizeTimer = null;
    }

    _cancelFinalize() {
        if (this._finalizeTimer !== null) {
            clearTimeout(this._finalizeTimer);
            this._finalizeTimer = null;
        }
        this._pendingFinalize = false;
    }

    reset(element) {
        this._cancelFinalize();
        this._composing = false;
        // The sentinel keeps Backspace working without an empty textarea.
        element.value = "_".repeat(99);
        this._lastValue = element.value;
    }

    compositionStart() {
        this._cancelFinalize();
        this._composing = true;
    }

    compositionEnd(element) {
        this._composing = false;
        this._cancelFinalize();
        this._pendingFinalize = true;

        // WebKit may update textarea.value in a final input event *after*
        // compositionend. Reconcile once after that event, not twice.
        this._finalizeTimer = setTimeout(() => {
            this._finalizeTimer = null;
            this._pendingFinalize = false;
            this._commit(element);
        }, 0);
    }

    input(event) {
        if (this._composing || this._pendingFinalize ||
            event.isComposing ||
            event.inputType === "insertCompositionText" ||
            event.inputType === "deleteCompositionText") {
            return;
        }
        this._commit(event.target);
    }

    _commit(element) {
        if (this._lastValue === null) {
            this.reset(element);
            return;
        }

        const value = element.value;
        if (value === this._lastValue) {
            return;
        }

        // Use Unicode code points, not UTF-16 code units, so surrogate
        // pairs stay intact. Match the committed prefix only: the remote
        // caret remains at the end of the previously sent text.
        const oldChars = Array.from(this._lastValue);
        const newChars = Array.from(value);
        let prefix = 0;
        while (prefix < oldChars.length && prefix < newChars.length &&
               oldChars[prefix] === newChars[prefix]) {
            prefix++;
        }

        for (let i = prefix; i < oldChars.length; i++) {
            this._sendKey(KeyTable.XK_BackSpace, "Backspace");
        }

        for (const ch of newChars.slice(prefix)) {
            if (ch === "\n" || ch === "\r") {
                this._sendKey(KeyTable.XK_Return, "Enter");
            } else if (ch === "\t") {
                this._sendKey(KeyTable.XK_Tab, "Tab");
            } else {
                const keysym = keysyms.lookup(ch.codePointAt(0));
                if (keysym) {
                    this._sendKey(keysym);
                }
            }
        }

        if (value.length > 200 || value.length === 0) {
            this.reset(element);
        } else {
            this._lastValue = value;
        }
    }
}
