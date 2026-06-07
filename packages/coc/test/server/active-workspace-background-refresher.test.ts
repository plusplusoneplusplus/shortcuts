import { describe, expect, it, vi } from 'vitest';
import { ActiveWorkspaceBackgroundRefresher } from '../../src/server/dashboard/active-workspace-background-refresher';
import { ActiveWorkspaceTracker } from '../../src/server/dashboard/active-workspace-tracker';

async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('ActiveWorkspaceBackgroundRefresher', () => {
    it('refreshes a newly active workspace immediately and active workspaces on each interval', async () => {
        let now = 1000;
        const tracker = new ActiveWorkspaceTracker(10_000, () => now);
        const refreshWorkspace = vi.fn().mockResolvedValue(undefined);
        const intervalHandle = { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>;
        let intervalCallback: (() => void) | undefined;
        const setIntervalFn = vi.fn((callback: () => void, _intervalMs: number) => {
            intervalCallback = callback;
            return intervalHandle;
        }) as unknown as typeof setInterval;
        const clearIntervalFn = vi.fn() as unknown as typeof clearInterval;
        const refresher = new ActiveWorkspaceBackgroundRefresher({
            tracker,
            refreshWorkspace,
            intervalMs: 1000,
            setIntervalFn,
            clearIntervalFn,
        });

        refresher.start();
        await flushPromises();

        expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 1000);
        expect(intervalHandle.unref).toHaveBeenCalledTimes(1);
        expect(refreshWorkspace).not.toHaveBeenCalled();

        tracker.reportActiveWorkspace({ clientId: 'tab-a', workspaceId: 'ws-one' });
        await flushPromises();

        expect(refreshWorkspace).toHaveBeenCalledTimes(1);
        expect(refreshWorkspace).toHaveBeenLastCalledWith('ws-one', 'active-workspace-change');

        now += 1000;
        intervalCallback?.();
        await flushPromises();

        expect(refreshWorkspace).toHaveBeenCalledTimes(2);
        expect(refreshWorkspace).toHaveBeenLastCalledWith('ws-one', 'interval');

        now += 500;
        tracker.reportActiveWorkspace({ clientId: 'tab-b', workspaceId: 'ws-two' });
        await flushPromises();

        expect(refreshWorkspace).toHaveBeenCalledTimes(4);
        expect(refreshWorkspace.mock.calls.slice(2)).toEqual([
            ['ws-one', 'active-workspace-change'],
            ['ws-two', 'active-workspace-change'],
        ]);

        refresher.dispose();
        expect(refreshWorkspace).toHaveBeenCalledTimes(4);
        expect(clearIntervalFn).toHaveBeenCalledWith(intervalHandle);
    });

    it('preserves the interval loop when a background refresh fails', async () => {
        let now = 1000;
        const tracker = new ActiveWorkspaceTracker(10_000, () => now);
        const errors: unknown[] = [];
        const refreshWorkspace = vi.fn()
            .mockRejectedValueOnce(new Error('provider down'))
            .mockResolvedValue(undefined);
        let intervalCallback: (() => void) | undefined;
        const setIntervalFn = vi.fn((callback: () => void) => {
            intervalCallback = callback;
            return { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>;
        }) as unknown as typeof setInterval;
        const refresher = new ActiveWorkspaceBackgroundRefresher({
            tracker,
            refreshWorkspace,
            intervalMs: 1000,
            setIntervalFn,
            onRefreshError: (_workspaceId, _reason, error) => errors.push(error),
        });

        refresher.start();
        tracker.reportActiveWorkspace({ clientId: 'tab-a', workspaceId: 'ws-one' });
        await flushPromises();

        expect(errors).toHaveLength(1);
        expect(refreshWorkspace).toHaveBeenCalledTimes(1);

        now += 1000;
        intervalCallback?.();
        await flushPromises();

        expect(refreshWorkspace).toHaveBeenCalledTimes(2);
        expect(refreshWorkspace).toHaveBeenLastCalledWith('ws-one', 'interval');
        refresher.dispose();
    });
});
