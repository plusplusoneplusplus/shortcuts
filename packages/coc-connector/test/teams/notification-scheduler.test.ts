import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { TeamsNotificationScheduler, type TeamsReadHints } from '../../src/teams/notification-scheduler';

describe('notification read scheduler', () => {
    const schedulers: TeamsNotificationScheduler[] = [];
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
    afterEach(() => { schedulers.splice(0).forEach(s => s.stop()); vi.useRealTimers(); });
    function setup(scan = vi.fn(async (_hints: TeamsReadHints) => ({ success: true, retryAt: 0 }))) {
        const scheduler = new TeamsNotificationScheduler(scan);
        schedulers.push(scheduler);
        return { scheduler, scan };
    }
    it('syncs at startup then uses exactly 60 seconds from successful completion', async () => {
        const s = setup();
        s.scheduler.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(s.scan).toHaveBeenCalledWith(expect.objectContaining({ reconcile: true, rootMessageIds: [] }));
        await vi.advanceTimersByTimeAsync(59_999);
        expect(s.scan).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(s.scan).toHaveBeenCalledTimes(2);
    });
    it('retries failed ordinary reads after two seconds while retaining targeted hints and cooldown', async () => {
        const s = setup(vi.fn(async (_hints: TeamsReadHints) => ({ success: false, retryAt: 0 })));
        s.scheduler.wake({ cause: 'message', rootMessageId: 'first' });
        await vi.advanceTimersByTimeAsync(0);
        s.scheduler.wake({ cause: 'message', rootMessageId: 'second' });
        await vi.advanceTimersByTimeAsync(1999);
        expect(s.scan).toHaveBeenCalledOnce();
        s.scan.mockResolvedValue({ success: true, retryAt: 0 });
        await vi.advanceTimersByTimeAsync(1);
        expect(s.scan.mock.calls[1][0]).toMatchObject({
            reconcile: false, rootMessageIds: expect.arrayContaining(['first', 'second']),
        });
        await vi.advanceTimersByTimeAsync(59_999);
        expect(s.scan).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(s.scan).toHaveBeenCalledTimes(3);
    });
    it('coalesces duplicates, remains single-flight, follows a wake during a slow scan', async () => {
        let release!: (result: { success: boolean; retryAt: number }) => void;
        const scan = vi.fn((_hints: TeamsReadHints) => new Promise<{ success: boolean; retryAt: number }>(r => { release = r; }));
        const s = setup(scan);
        s.scheduler.start();
        await vi.advanceTimersByTimeAsync(0);
        for (let i = 0; i < 10; i++) s.scheduler.wake({ cause: 'message', rootMessageId: 'root' });
        await vi.advanceTimersByTimeAsync(120_000);
        expect(scan).toHaveBeenCalledOnce();
        release({ success: true, retryAt: 0 });
        await vi.advanceTimersByTimeAsync(0);
        expect(scan).toHaveBeenCalledTimes(2);
        expect(scan.mock.calls[1][0]).toMatchObject({ reconcile: false, rootMessageIds: ['root'] });
        release({ success: true, retryAt: 0 });
        await vi.advanceTimersByTimeAsync(59_999);
        expect(scan).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(scan).toHaveBeenCalledTimes(3);
    });
    it.each(['message-loss', 'disconnect', 'overflow'] as const)('reconciles on %s', async cause => {
        const s = setup();
        s.scheduler.wake({ cause });
        await vi.advanceTimersByTimeAsync(0);
        expect(s.scan.mock.calls[0][0].reconcile).toBe(true);
    });
    it('collapses queue overflow to reconciliation', async () => {
        const s = setup();
        for (let i = 0; i < 65; i++) s.scheduler.wake({ cause: 'message', rootMessageId: String(i) });
        await vi.advanceTimersByTimeAsync(0);
        expect(s.scan.mock.calls[0][0]).toMatchObject({ reconcile: true, rootMessageIds: [] });
    });
    it('a coalesced wake without a parent retains known hints but requires full reconciliation', async () => {
        const s = setup();
        s.scheduler.wake({ cause: 'message', rootMessageId: 'known' });
        s.scheduler.wake({ cause: 'message' });
        await vi.advanceTimersByTimeAsync(0);
        expect(s.scan.mock.calls[0][0]).toMatchObject({ reconcile: true, rootMessageIds: ['known'] });
    });
    it('retains failed work and incoming wakes without bypassing 429 cooldown', async () => {
        const scan = vi.fn(async (_hints: TeamsReadHints) => ({ success: false, retryAt: 90_000 }));
        const s = setup(scan);
        s.scheduler.start();
        await vi.advanceTimersByTimeAsync(0);
        for (let i = 0; i < 10; i++) s.scheduler.wake({ cause: 'message', rootMessageId: 'root' });
        await vi.advanceTimersByTimeAsync(89_999);
        expect(scan).toHaveBeenCalledOnce();
        scan.mockResolvedValue({ success: true, retryAt: 0 });
        await vi.advanceTimersByTimeAsync(1);
        expect(scan).toHaveBeenCalledTimes(2);
        expect(scan.mock.calls[1][0].reconcile).toBe(true);
    });
    it('backs off read failures without a tight retry loop', async () => {
        const s = setup(vi.fn(async () => { throw new Error('read failure'); }));
        s.scheduler.start();
        await vi.advanceTimersByTimeAsync(1999);
        expect(s.scan).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(s.scan).toHaveBeenCalledTimes(2);
    });
    it('does not bypass a cooldown longer than the platform timer maximum', async () => {
        const retryAt = 2_147_483_647 + 60_000;
        const s = setup(vi.fn(async () => ({ success: false, retryAt })));
        s.scheduler.start();
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(2_147_483_647);
        expect(s.scan).toHaveBeenCalledOnce();
        s.scan.mockResolvedValue({ success: true, retryAt: 0 });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(s.scan).toHaveBeenCalledTimes(2);
    });
    it('retains a targeted root when its scan fails and loss triggers reconciliation', async () => {
        const s = setup(vi.fn(async () => ({ success: false, retryAt: 90_000 })));
        s.scheduler.wake({ cause: 'message', rootMessageId: 'targeted' });
        await vi.advanceTimersByTimeAsync(0);
        s.scheduler.wake({ cause: 'message-loss' });
        s.scan.mockResolvedValue({ success: true, retryAt: 0 });
        await vi.advanceTimersByTimeAsync(90_000);
        expect(s.scan.mock.calls[1][0]).toMatchObject({ reconcile: true, rootMessageIds: ['targeted'] });
    });
    it('stop cancels scans and prevents pending/inflight wakes from rearming', async () => {
        let release!: (result: { success: boolean; retryAt: number }) => void;
        const scan = vi.fn((_hints: TeamsReadHints) => new Promise<{ success: boolean; retryAt: number }>(r => { release = r; }));
        const s = setup(scan);
        s.scheduler.start();
        await vi.advanceTimersByTimeAsync(0);
        s.scheduler.wake({ cause: 'message' });
        s.scheduler.stop();
        expect(scan.mock.calls[0][0].signal!.aborted).toBe(true);
        release({ success: true, retryAt: 0 });
        s.scheduler.wake({ cause: 'message' });
        await vi.advanceTimersByTimeAsync(120_000);
        expect(scan).toHaveBeenCalledOnce();
    });
});
