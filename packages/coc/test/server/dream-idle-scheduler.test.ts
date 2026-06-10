import { describe, expect, it, vi } from 'vitest';
import { DreamIdleScheduler } from '../../src/server/dreams/dream-idle-scheduler';
import type { DreamIdleRunResult } from '../../src/server/dreams/dream-runner';

async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

function skippedResult(reason = 'not idle'): DreamIdleRunResult {
    return {
        started: false,
        reason,
        idle: {
            isIdle: false,
            reasons: [reason],
            queuedTaskCount: 0,
            runningTaskCount: 0,
            activeStreamingChatProcessIds: [],
            minIdleMs: 60_000,
        },
    };
}

describe('DreamIdleScheduler', () => {
    it('does nothing while the global Dreams gate is disabled', async () => {
        const runIdle = vi.fn().mockResolvedValue(skippedResult());
        const scheduler = new DreamIdleScheduler({
            getWorkspaceIds: () => ['ws-one'],
            getDreamsEnabled: () => false,
            getWorkspaceDreamsEnabled: () => true,
            runIdle,
            setIntervalFn: vi.fn(() => ({ unref: vi.fn() }) as unknown as ReturnType<typeof setInterval>) as unknown as typeof setInterval,
        });

        scheduler.start();
        await flushPromises();

        expect(runIdle).not.toHaveBeenCalled();
        scheduler.dispose();
    });

    it('runs only workspace-opted-in idle checks with the configured policy', async () => {
        const runIdle = vi.fn().mockResolvedValue(skippedResult());
        const scheduler = new DreamIdleScheduler({
            getWorkspaceIds: () => ['ws-one', 'ws-two'],
            getDreamsEnabled: () => true,
            getWorkspaceDreamsEnabled: (workspaceId) => workspaceId === 'ws-two',
            getRunOptions: () => ({
                minIdleMs: 123_000,
                confidenceThreshold: 0.92,
                maxCandidates: 3,
                conversationLimit: 5,
                timeoutMs: 30_000,
            }),
            runIdle,
            setIntervalFn: vi.fn(() => ({ unref: vi.fn() }) as unknown as ReturnType<typeof setInterval>) as unknown as typeof setInterval,
        });

        scheduler.start();
        await flushPromises();

        expect(runIdle).toHaveBeenCalledTimes(1);
        expect(runIdle).toHaveBeenCalledWith('ws-two', {
            minIdleMs: 123_000,
            confidenceThreshold: 0.92,
            maxCandidates: 3,
            conversationLimit: 5,
            timeoutMs: 30_000,
        });
        scheduler.dispose();
    });

    it('skips a workspace while a previous idle run is still in flight', async () => {
        let intervalCallback: (() => void) | undefined;
        const setIntervalFn = vi.fn((callback: () => void) => {
            intervalCallback = callback;
            return { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>;
        }) as unknown as typeof setInterval;
        let resolveRun: ((value: DreamIdleRunResult) => void) | undefined;
        const runIdle = vi.fn(() => new Promise<DreamIdleRunResult>(resolve => {
            resolveRun = resolve;
        }));
        const scheduler = new DreamIdleScheduler({
            getWorkspaceIds: () => ['ws-one'],
            getDreamsEnabled: () => true,
            getWorkspaceDreamsEnabled: () => true,
            runIdle,
            setIntervalFn,
        });

        scheduler.start();
        await flushPromises();
        expect(runIdle).toHaveBeenCalledTimes(1);

        intervalCallback?.();
        await flushPromises();
        expect(runIdle).toHaveBeenCalledTimes(1);

        resolveRun?.(skippedResult('quiet window not satisfied'));
        await flushPromises();
        intervalCallback?.();
        await flushPromises();
        expect(runIdle).toHaveBeenCalledTimes(2);
        scheduler.dispose();
    });
});
