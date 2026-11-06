import IOSResumeRecovery from '../app/ios-resume-recovery.js';

describe('iOS resume authentication recovery', function () {
    let recovery;

    beforeEach(function () {
        recovery = new IOSResumeRecovery();
    });

    it('does not retry unrelated failures or initial logins', function () {
        expect(recovery.nextAuthRetryDelay('Authentication or authorization failure')).to.equal(null);
        recovery.start();
        expect(recovery.nextAuthRetryDelay('Invalid security protocol')).to.equal(null);
        expect(recovery.retries).to.equal(0);
    });

    it('backs off after transient Apple Screen Sharing rejections', function () {
        recovery.start();
        expect(recovery.nextAuthRetryDelay('Authentication or authorization failure')).to.equal(2500);
        expect(recovery.nextAuthRetryDelay('Authentication or authorization failure')).to.equal(6000);
        expect(recovery.nextAuthRetryDelay('Authentication or authorization failure')).to.equal(-1);
        expect(recovery.active).to.equal(false);
        expect(recovery.nextAuthRetryDelay('Authentication or authorization failure')).to.equal(null);
    });

    it('resets failed attempts for each new background/resume cycle', function () {
        recovery.start();
        recovery.nextAuthRetryDelay('Authentication or authorization failure');
        recovery.reset();
        expect(recovery.retries).to.equal(0);
        recovery.start();
        expect(recovery.nextAuthRetryDelay('Authentication or authorization failure')).to.equal(2500);
    });
});
