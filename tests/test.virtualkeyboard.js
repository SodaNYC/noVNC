import VirtualKeyboardInput from '../app/virtualkeyboard.js';
import KeyTable from '../core/input/keysym.js';
import keysyms from '../core/input/keysymdef.js';

describe('Virtual keyboard committed text', function () {
    let sendKey;
    let input;
    let field;

    beforeEach(function () {
        sendKey = sinon.spy();
        input = new VirtualKeyboardInput(sendKey);
        field = { value: '' };
        input.reset(field);
    });

    it('sends ordinary characters once, including repeated letters', function () {
        field.value += 'a';
        input.input({ target: field, inputType: 'insertText' });
        input.input({ target: field, inputType: 'insertText' });
        expect(sendKey).to.have.been.calledOnce;

        field.value += 'a';
        input.input({ target: field, inputType: 'insertText' });
        expect(sendKey).to.have.been.calledTwice;
        expect(sendKey.secondCall).to.have.been.calledWith(
            keysyms.lookup('a'.codePointAt(0)));
    });

    it('waits for Chinese IME candidate commit without deleting existing text', function () {
        const clock = sinon.useFakeTimers();
        try {
            field.value += '好';
            input.input({ target: field, inputType: 'insertText' });
            sendKey.resetHistory();

            input.compositionStart();
            field.value += 'n';
            input.input({ target: field, isComposing: true,
                          inputType: 'insertCompositionText' });
            field.value += 'i';
            input.input({ target: field, inputType: 'insertCompositionText' });
            field.value += 'h';
            input.input({ target: field, isComposing: true });
            expect(sendKey).to.not.have.been.called;

            input.compositionEnd(field);
            field.value = field.value.slice(0, -3) + '你';
            input.input({ target: field, inputType: 'insertFromComposition' });
            expect(sendKey).to.not.have.been.called;
            clock.tick(0);
            expect(sendKey).to.have.been.calledOnce;
            expect(sendKey.firstCall).to.have.been.calledWith(
                keysyms.lookup('你'.codePointAt(0)));

            // Safari can issue another input event with the same value.
            input.input({ target: field, inputType: 'insertText' });
            expect(sendKey).to.have.been.calledOnce;
        } finally {
            clock.restore();
        }
    });

    it('flushes compositionend even without a following input event', function () {
        const clock = sinon.useFakeTimers();
        try {
            input.compositionStart();
            field.value += '测';
            input.compositionEnd(field);
            clock.tick(0);
            expect(sendKey).to.have.been.calledOnce;
        } finally {
            clock.restore();
        }
    });

    it('maps deletion and return to remote keyboard keys', function () {
        field.value += 'a';
        input.input({ target: field });
        sendKey.resetHistory();

        field.value = field.value.slice(0, -1);
        input.input({ target: field, inputType: 'deleteContentBackward' });
        expect(sendKey).to.have.been.calledOnce;
        expect(sendKey.firstCall).to.have.been.calledWith(
            KeyTable.XK_BackSpace, 'Backspace');

        field.value += '\n';
        input.input({ target: field, inputType: 'insertLineBreak' });
        expect(sendKey.secondCall).to.have.been.calledWith(
            KeyTable.XK_Return, 'Enter');
    });

    it('keeps non-BMP characters as one Unicode code point', function () {
        field.value += '🙂';
        input.input({ target: field, inputType: 'insertText' });
        expect(sendKey).to.have.been.calledOnce;
        expect(sendKey.firstCall).to.have.been.calledWith(
            keysyms.lookup('🙂'.codePointAt(0)));
    });
});
