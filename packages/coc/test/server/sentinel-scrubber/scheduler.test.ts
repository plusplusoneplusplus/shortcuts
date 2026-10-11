import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScrubberScheduler } from '../../../src/server/sentinel-scrubber/scrubber-scheduler';
import { ScrubberStore, type ScrubRunRecord } from '../../../src/server/sentinel-scrubber/scrubber-store';
import { createTodoTestDatabase, createTodoTestDirectory } from '../sentinel-todos/test-db';

const owner = { workspaceId: 'ws-a', processId: 'parent' };
const others = [{ ...owner, workspaceId: 'ws-b' }, { ...owner, processId: 'other' }];
let fixture: ReturnType<typeof createTodoTestDatabase>;
let store: ScrubberStore;
let scheduler: ScrubberScheduler;
let enabled: boolean;
let exists: boolean;
const start = vi.fn();
const assertOwner = vi.fn();
const settle = () => vi.advanceTimersByTimeAsync(0);
function save(target = owner, cron = '0 * * * *', on = true) {
    store.putConfig(target, { enabled: on, cron }, store.getConfig(target).revision);
    scheduler.refresh(target);
}
function fail(id: string, status: 'failed' | 'timed_out' = 'failed') {
    const run: ScrubRunRecord = { id, trigger: 'schedule', status: 'queued', createdAt: new Date().toISOString(),
        snapshot: [], deferredItemIds: [], awaitingReviewItemIds: [] };
    store.createRun(owner, run);
    store.transitionRun(owner, id, ['queued'], { status, finishedAt: new Date().toISOString() });
    scheduler.refresh(owner);
}
beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 11, 10, 30));
    fixture = createTodoTestDatabase(createTodoTestDirectory());
    store = new ScrubberStore(fixture.db);
    enabled = exists = true;
    start.mockReset().mockResolvedValue({});
    assertOwner.mockReset().mockImplementation(async () => { if (!exists) throw new Error('Missing owner'); });
    scheduler = new ScrubberScheduler({ scrubber: store, runs: { start }, getEnabled: () => enabled, assertOwner });
});
afterEach(() => { scheduler.dispose(); fixture.dispose(); vi.useRealTimers(); });

describe('ScrubberScheduler', () => {
    it('defaults off and restores enabled owner timers without catch-up', async () => {
        scheduler.refreshAll();
        await vi.advanceTimersByTimeAsync(60 * 60_000);
        expect(start).not.toHaveBeenCalled();
        save();
        scheduler.refreshAll();
        await settle();
        expect(start).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(30 * 60_000);
        expect(start).toHaveBeenCalledExactlyOnceWith(owner, { trigger: 'schedule' });
        await vi.advanceTimersByTimeAsync(60 * 60_000);
        expect(start).toHaveBeenCalledTimes(2);
    });

    it('keeps workspace and Sentinel timers independent and replaces changed crons', async () => {
        save();
        for (const other of others) save(other);
        await settle();
        save(owner, '15 * * * *');
        await vi.advanceTimersByTimeAsync(30 * 60_000);
        expect(start.mock.calls.map(call => call[0])).toEqual(others);
        await vi.advanceTimersByTimeAsync(15 * 60_000);
        expect(start).toHaveBeenLastCalledWith(owner, { trigger: 'schedule' });
    });

    it('disarms disabled schedules, live flags, removed owners and shutdown', async () => {
        save();
        await settle();
        save(owner, '0 * * * *', false);
        await vi.advanceTimersByTimeAsync(30 * 60_000);
        expect(start).not.toHaveBeenCalled();
        save();
        await settle();
        enabled = false;
        scheduler.refreshAll();
        await vi.advanceTimersByTimeAsync(60 * 60_000);
        expect(start).not.toHaveBeenCalled();
        enabled = true;
        scheduler.refreshAll();
        await settle();
        exists = false;
        scheduler.refreshAll();
        await settle();
        expect(vi.getTimerCount()).toBe(0);
        exists = true;
        scheduler.refreshAll();
        await settle();
        scheduler.dispose();
        await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
        expect(start).not.toHaveBeenCalled();
        scheduler.refreshAll();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('invalidates pending owner checks when config changes or shuts down', async () => {
        let release!: () => void;
        assertOwner.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
        save();
        save(owner, '0 * * * *', false);
        release();
        await settle();
        expect(vi.getTimerCount()).toBe(0);
        save();
        scheduler.dispose();
        release();
        await settle();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rechecks the owner and live flag at the tick, without queuing or rearming after removal', async () => {
        save();
        await settle();
        expect(scheduler.canStart(owner)).toBe(true);
        exists = false;
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await vi.advanceTimersByTimeAsync(30 * 60_000);
        expect(start).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        expect(scheduler.canStart(owner)).toBe(false);
        exists = true;
        save();
        await settle();
        enabled = false;
        await vi.advanceTimersByTimeAsync(60 * 60_000);
        expect(start).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        error.mockRestore();
    });

    it('rejects invalid persisted crons and avoids firing a tick awaiting a superseded owner check', async () => {
        save(owner, '*/30 * * * *');
        await settle();
        expect(vi.getTimerCount()).toBe(0);
        save();
        await settle();
        let release!: () => void;
        assertOwner.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
        await vi.advanceTimersByTimeAsync(30 * 60_000);
        save(owner, '15 * * * *');
        release();
        await settle();
        expect(start).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(15 * 60_000);
        expect(start).toHaveBeenCalledOnce();
    });

    it('auto-pauses after three failures and saving config resumes from now', async () => {
        save();
        fail('r1');
        fail('r2', 'timed_out');
        fail('r3');
        await settle();
        expect(store.getConfig(owner)).toMatchObject({ paused: true, consecutiveFailures: 3 });
        await vi.advanceTimersByTimeAsync(30 * 60_000);
        expect(start).not.toHaveBeenCalled();
        save();
        await vi.advanceTimersByTimeAsync(60 * 60_000);
        expect(start).toHaveBeenCalledOnce();
        expect(store.getConfig(owner)).toMatchObject({ paused: false, consecutiveFailures: 0 });
    });

    it('does not fire early when the shared registry caps a distant cron delay', async () => {
        save(owner, '0 9 1 12 *');
        await settle();
        await vi.advanceTimersByTimeAsync(2147483647);
        expect(start).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(new Date(2026, 11, 1, 9).getTime() - Date.now());
        expect(start).toHaveBeenCalledOnce();
    });

    it('continues recurring after overlap/unchanged skips and start errors', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        start.mockResolvedValueOnce({ status: 'skipped', skipReason: 'overlap' })
            .mockResolvedValueOnce({ status: 'skipped', skipReason: 'unchanged' })
            .mockRejectedValueOnce(new Error('Queue offline'));
        save();
        await vi.advanceTimersByTimeAsync(30 * 60_000 + 3 * 60 * 60_000);
        expect(start).toHaveBeenCalledTimes(4);
        expect(error).toHaveBeenCalledOnce();
        error.mockRestore();
    });
});
