import { describe, expect, it, vi } from 'vitest';
import { DreamIdleScheduler } from '../../src/server/dreams/dream-idle-scheduler';
import type { DreamIdleCheckResult } from '../../src/server/dreams/dream-runner';

async function flushPromises(): Promise<void> {
    for (let i = 0; i < 5; i += 1) {
        await Promise.resolve();
    }
    await new Promise<void>(resolve => setImmediate(resolve));
}

function idleCheckResult(isIdle: boolean, reason = 'not idle'): DreamIdleCheckResult {
    return {
        isIdle,
        reasons: isIdle ? [] : [reason],
        queuedTaskCount: 0,
        runningTaskCount: 0,
        activeStreamingChatProcessIds: [],
        minIdleMs: 60_000,
    };
}

describe('DreamIdleScheduler', () => {
    it('does nothing while the global Dreams gate is disabled', async () => {
        const checkIdleReadiness = vi.fn().mockResolvedValue(idleCheckResult(false));
        const enqueueIdleRun = vi.fn().mockResolvedValue({ id: 'task-1' });
        const scheduler = new DreamIdleScheduler({
            getWorkspaceIds: () => ['ws-one'],
            getDreamsEnabled: () => false,
            getWorkspaceDreamsEnabled: () => true,
            checkIdleReadiness,
            enqueueIdleRun,
            setIntervalFn: vi.fn(() => ({ unref: vi.fn() }) as unknown as ReturnType<typeof setInterval>) as unknown as typeof setInterval,
        });

        scheduler.start();
        await flushPromises();

        expect(checkIdleReadiness).not.toHaveBeenCalled();
        expect(enqueueIdleRun).not.toHaveBeenCalled();
        scheduler.dispose();
    });

    it('runs only workspace-opted-in idle checks with the configured policy', async () => {
        const checkIdleReadiness = vi.fn().mockResolvedValue(idleCheckResult(false));
        const enqueueIdleRun = vi.fn().mockResolvedValue({ id: 'task-1' });
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
            checkIdleReadiness,
            enqueueIdleRun,
            setIntervalFn: vi.fn(() => ({ unref: vi.fn() }) as unknown as ReturnType<typeof setInterval>) as unknown as typeof setInterval,
        });

        scheduler.start();
        await flushPromises();

        expect(checkIdleReadiness).toHaveBeenCalledTimes(1);
        expect(checkIdleReadiness).toHaveBeenCalledWith('ws-two', {
            minIdleMs: 123_000,
            confidenceThreshold: 0.92,
            maxCandidates: 3,
            conversationLimit: 5,
            timeoutMs: 30_000,
        });
        expect(enqueueIdleRun).not.toHaveBeenCalled();
        scheduler.dispose();
    });

    it('enqueues an idle dream run when the quiet window is satisfied', async () => {
        const checkIdleReadiness = vi.fn().mockResolvedValue(idleCheckResult(true));
        const enqueueIdleRun = vi.fn().mockResolvedValue({ id: 'dream-task-1', type: 'dream-run' });
        const onRunResult = vi.fn();
        const scheduler = new DreamIdleScheduler({
            getWorkspaceIds: () => ['ws-one'],
            getDreamsEnabled: () => true,
            getWorkspaceDreamsEnabled: () => true,
            checkIdleReadiness,
            enqueueIdleRun,
            onRunResult,
            setIntervalFn: vi.fn(() => ({ unref: vi.fn() }) as unknown as ReturnType<typeof setInterval>) as unknown as typeof setInterval,
        });

        scheduler.start();
        await flushPromises();

        expect(checkIdleReadiness).toHaveBeenCalledWith('ws-one', {});
        expect(enqueueIdleRun).toHaveBeenCalledWith('ws-one', {});
        expect(onRunResult).toHaveBeenCalledWith('ws-one', 'startup', expect.objectContaining({
            started: true,
            task: expect.objectContaining({ id: 'dream-task-1' }),
        }));
        scheduler.dispose();
    });

    it('skips a workspace while a previous idle run is still in flight', async () => {
        let intervalCallback: (() => void) | undefined;
        const setIntervalFn = vi.fn((callback: () => void) => {
            intervalCallback = callback;
            return { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>;
        }) as unknown as typeof setInterval;
        let resolveCheck: ((value: DreamIdleCheckResult) => void) | undefined;
        const checkIdleReadiness = vi.fn(() => new Promise<DreamIdleCheckResult>(resolve => {
            resolveCheck = resolve;
        }));
        const enqueueIdleRun = vi.fn().mockResolvedValue({ id: 'task-1' });
        const scheduler = new DreamIdleScheduler({
            getWorkspaceIds: () => ['ws-one'],
            getDreamsEnabled: () => true,
            getWorkspaceDreamsEnabled: () => true,
            checkIdleReadiness,
            enqueueIdleRun,
            setIntervalFn,
        });

        scheduler.start();
        await flushPromises();
        expect(checkIdleReadiness).toHaveBeenCalledTimes(1);

        intervalCallback?.();
        await flushPromises();
        expect(checkIdleReadiness).toHaveBeenCalledTimes(1);

        resolveCheck?.(idleCheckResult(false, 'quiet window not satisfied'));
        await flushPromises();
        intervalCallback?.();
        await flushPromises();
        expect(checkIdleReadiness).toHaveBeenCalledTimes(2);
        scheduler.dispose();
    });
});
