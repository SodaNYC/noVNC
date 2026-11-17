import KineticScroll from '../core/input/kineticscroll.js';

describe('Kinetic touch scrolling', function () {
    let clock;
    let send;
    let scroll;

    beforeEach(function () {
        clock = sinon.useFakeTimers();
        send = sinon.spy();
        scroll = new KineticScroll(send);
    });

    afterEach(function () {
        scroll.stop();
        clock.restore();
    });

    it('scrolls immediately but limits wheel bursts', function () {
        scroll.start(10, 20);
        scroll.move(200, 10, 20);
        expect(send.callCount).to.equal(3);
        expect(send.firstCall).to.have.been.calledWith(1, 10, 20);
        clock.tick(16);
        expect(send.callCount).to.equal(6);
        clock.tick(100);
        expect(send.callCount).to.be.at.most(8);
    });

    it('caps total wheel events across multiple rapid browser callbacks', function () {
        scroll.start(10, 20);
        scroll.move(35, 10, 20);
        scroll.move(35, 10, 20);
        scroll.move(35, 10, 20);
        expect(send.callCount).to.be.at.most(3);
        clock.tick(16);
        expect(send.callCount).to.be.at.most(6);
    });

    it('preserves up/down direction and abandons the old backlog on reversal', function () {
        scroll.start(1, 2);
        scroll.move(30, 1, 2);
        expect(send.firstCall).to.have.been.calledWith(1, 1, 2);
        clock.tick(16);
        scroll.move(-30, 1, 2);
        expect(send.lastCall).to.have.been.calledWith(-1, 1, 2);
    });

    it('keeps scrolling briefly after a fast flick then stops', function () {
        scroll.start(10, 20);
        clock.tick(16);
        scroll.move(35, 10, 20);
        clock.tick(16);
        scroll.move(35, 10, 20);
        const activeCount = send.callCount;
        scroll.end();
        clock.tick(160);
        expect(send.callCount).to.be.greaterThan(activeCount);
        clock.tick(900);
        const stoppedCount = send.callCount;
        clock.tick(900);
        expect(send.callCount).to.equal(stoppedCount);
    });

    it('flings from a short, quick two-finger flick', function () {
        scroll.start(10, 20);
        clock.tick(16);
        scroll.move(7, 10, 20);
        // Seven pixels is below one VNC wheel notch before release.
        expect(send).to.not.have.been.called;
        scroll.end();
        clock.tick(160);
        expect(send).to.have.been.called;
        const count = send.callCount;
        clock.tick(1000);
        clock.tick(300);
        expect(send.callCount).to.be.at.least(count);
    });

    it('does not fling after a pause or a slow drag', function () {
        scroll.start(10, 20);
        clock.tick(100);
        scroll.move(2, 10, 20);
        clock.tick(120);
        scroll.end();
        const sent = send.callCount;
        clock.tick(700);
        expect(send.callCount).to.equal(sent);
    });

    it('interrupts momentum when a new touch begins', function () {
        scroll.start(0, 0);
        clock.tick(16);
        scroll.move(60, 0, 0);
        scroll.end();
        clock.tick(32);
        scroll.start(0, 0);
        const sent = send.callCount;
        clock.tick(800);
        expect(send.callCount).to.equal(sent);
    });

    it('stops all pending wheel events on teardown', function () {
        scroll.start(10, 20);
        scroll.move(200, 10, 20);
        scroll.end();
        scroll.stop();
        const sent = send.callCount;
        clock.tick(1000);
        expect(send.callCount).to.equal(sent);
    });
});
