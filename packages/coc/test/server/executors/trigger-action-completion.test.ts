/**
 * ProcessLifecycleRunner — trigger-action completion wiring.
 *
 * Covers the wiring contract that the queue-executor-bridge implements for
 * trigger-originated follow-ups (AC-01/AC-03):
 *   - on follow-up success → onTriggerActionComplete(triggerId, true)
 *   - on follow-up failure → onTriggerActionComplete(triggerId, false)
 *   - non-trigger follow-ups (loop, wakeup, normal chat) → not invoked
 *   - errors from the callback do not mask the follow-up's outcome
 *
 * This is the seam that clears a trigger's in-flight suppression guard once its
 * fix turn finishes, allowing the next failing CI transition to fire again.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { ProcessLifecycleRunner } from '../../../src/server/executors/process-lifecycle-runner';
import type { LifecycleRunnerOptions } from '../../../src/server/executors/process-lifecycle-runner';
import { createMockProcessStore } from '../helpers/mock-process-store';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: { saveOutput: vi.fn().mockResolvedValue(undefined) },
}));

// ============================================================================
// Helpers
// ============================================================================

function makeFollowUpTask(context: Record<string, unknown> | undefined): QueuedTask {
    return {
        id: 'task-1',
        type: 'chat',
        displayName: 'test',
        priority: 1,
        addedAt: new Date(),
        config: { model: undefined },
        payload: {
            kind: 'chat',
            prompt: 'Fix the failing CI',
            processId: 'queue_proc_abc',
            mode: 'autopilot',
            ...(context !== undefined ? { context } : {}),
        } as any,
    } as QueuedTask;
}

function makeOpts(overrides: Partial<LifecycleRunnerOptions> = {}): LifecycleRunnerOptions {
    return {
        cancelledTasks: new Set<string>(),
        executeFollowUpFn: vi.fn().mockResolvedValue(undefined),
        executeByTypeFn: vi.fn().mockResolvedValue({ response: 'done' }),
        getWorkingDirectoryFn: vi.fn().mockReturnValue('/tmp'),
        ...overrides,
    };
}

// ============================================================================
// Wiring tests: onTriggerActionComplete invocation
// ============================================================================

describe('ProcessLifecycleRunner — onTriggerActionComplete wiring', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let runner: ProcessLifecycleRunner;

    beforeEach(() => {
        vi.clearAllMocks();
        store = createMockProcessStore();
        runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn());
    });

    it('invokes onTriggerActionComplete(triggerId, true) after a successful trigger follow-up', async () => {
        const onTriggerActionComplete = vi.fn().mockResolvedValue(undefined);
        const opts = makeOpts({ onTriggerActionComplete });
        const task = makeFollowUpTask({ source: 'trigger', triggerId: 'trigger_abc' });

        const result = await runner.run(task, opts);

        expect(result.success).toBe(true);
        expect(onTriggerActionComplete).toHaveBeenCalledOnce();
        expect(onTriggerActionComplete).toHaveBeenCalledWith('trigger_abc', true);
    });

    it('invokes onTriggerActionComplete(triggerId, false) after a failed trigger follow-up', async () => {
        const onTriggerActionComplete = vi.fn().mockResolvedValue(undefined);
        const executeFollowUpFn = vi.fn().mockRejectedValue(new Error('boom'));
        const opts = makeOpts({ onTriggerActionComplete, executeFollowUpFn });
        const task = makeFollowUpTask({ source: 'trigger', triggerId: 'trigger_abc' });

        const result = await runner.run(task, opts);

        expect(result.success).toBe(false);
        expect(onTriggerActionComplete).toHaveBeenCalledOnce();
        expect(onTriggerActionComplete).toHaveBeenCalledWith('trigger_abc', false);
    });

    it('does not invoke onTriggerActionComplete for loop follow-ups', async () => {
        const onTriggerActionComplete = vi.fn().mockResolvedValue(undefined);
        const opts = makeOpts({ onTriggerActionComplete });
        const task = makeFollowUpTask({ source: 'loop', loopId: 'loop_1' });

        await runner.run(task, opts);

        expect(onTriggerActionComplete).not.toHaveBeenCalled();
    });

    it('does not invoke onTriggerActionComplete for wakeup follow-ups', async () => {
        const onTriggerActionComplete = vi.fn().mockResolvedValue(undefined);
        const opts = makeOpts({ onTriggerActionComplete });
        const task = makeFollowUpTask({ source: 'wakeup', wakeupId: 'wakeup_1' });

        await runner.run(task, opts);

        expect(onTriggerActionComplete).not.toHaveBeenCalled();
    });

    it('does not invoke onTriggerActionComplete for normal follow-ups (no source in context)', async () => {
        const onTriggerActionComplete = vi.fn().mockResolvedValue(undefined);
        const opts = makeOpts({ onTriggerActionComplete });
        const task = makeFollowUpTask({ skills: ['impl'] });

        await runner.run(task, opts);

        expect(onTriggerActionComplete).not.toHaveBeenCalled();
    });

    it('does not invoke onTriggerActionComplete when context is undefined', async () => {
        const onTriggerActionComplete = vi.fn().mockResolvedValue(undefined);
        const opts = makeOpts({ onTriggerActionComplete });
        const task = makeFollowUpTask(undefined);

        await runner.run(task, opts);

        expect(onTriggerActionComplete).not.toHaveBeenCalled();
    });

    it('does not invoke onTriggerActionComplete when source is trigger but triggerId is missing', async () => {
        const onTriggerActionComplete = vi.fn().mockResolvedValue(undefined);
        const opts = makeOpts({ onTriggerActionComplete });
        const task = makeFollowUpTask({ source: 'trigger' });

        await runner.run(task, opts);

        expect(onTriggerActionComplete).not.toHaveBeenCalled();
    });

    it('still returns success=true when onTriggerActionComplete throws after a successful follow-up', async () => {
        const onTriggerActionComplete = vi.fn().mockRejectedValue(new Error('bookkeeping failure'));
        const opts = makeOpts({ onTriggerActionComplete });
        const task = makeFollowUpTask({ source: 'trigger', triggerId: 'trigger_abc' });

        const result = await runner.run(task, opts);

        // Bookkeeping errors must not mask the actual follow-up outcome.
        expect(result.success).toBe(true);
        expect(onTriggerActionComplete).toHaveBeenCalledWith('trigger_abc', true);
    });

    it('drains pending messages before invoking onTriggerActionComplete', async () => {
        const order: string[] = [];
        const onDrainPendingMessages = vi.fn(async () => { order.push('drain'); });
        const onTriggerActionComplete = vi.fn(async () => { order.push('trigger-complete'); });
        const opts = makeOpts({ onDrainPendingMessages, onTriggerActionComplete });
        const task = makeFollowUpTask({ source: 'trigger', triggerId: 'trigger_abc' });

        await runner.run(task, opts);

        expect(order).toEqual(['drain', 'trigger-complete']);
    });
});
