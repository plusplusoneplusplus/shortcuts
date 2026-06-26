/**
 * Tests that turnSource metadata from loop/wakeup-triggered follow-ups
 * is correctly extracted from payload context and passed through to
 * executeFollowUpFn.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { QueuedTask, TurnSource } from '@plusplusoneplusplus/forge';
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

function makeFollowUpTask(context: Record<string, unknown>, overrides: Partial<QueuedTask> = {}): QueuedTask {
    return {
        id: 'task-1',
        type: 'chat',
        displayName: 'test',
        priority: 1,
        addedAt: new Date(),
        config: { model: undefined },
        payload: {
            kind: 'chat',
            prompt: 'Check status',
            processId: 'proc-123',
            mode: 'autopilot',
            context,
        } as any,
        ...overrides,
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
// Tests
// ============================================================================

describe('ProcessLifecycleRunner — turnSource propagation', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let runner: ProcessLifecycleRunner;

    beforeEach(() => {
        vi.clearAllMocks();
        store = createMockProcessStore();
        runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn());
    });

    it('extracts loop turnSource from payload context and passes to executeFollowUpFn', async () => {
        const opts = makeOpts();
        const task = makeFollowUpTask({
            source: 'loop',
            loopId: 'loop_abc123',
        });

        await runner.run(task, opts);

        expect(opts.executeFollowUpFn).toHaveBeenCalledOnce();
        const args = (opts.executeFollowUpFn as ReturnType<typeof vi.fn>).mock.calls[0];
        const turnSource: TurnSource = args[8];
        expect(turnSource).toEqual({ source: 'loop', loopId: 'loop_abc123' });
    });

    it('extracts wakeup turnSource from payload context and passes to executeFollowUpFn', async () => {
        const opts = makeOpts();
        const task = makeFollowUpTask({
            source: 'wakeup',
            wakeupId: 'wakeup_xyz789',
        });

        await runner.run(task, opts);

        expect(opts.executeFollowUpFn).toHaveBeenCalledOnce();
        const args = (opts.executeFollowUpFn as ReturnType<typeof vi.fn>).mock.calls[0];
        const turnSource: TurnSource = args[8];
        expect(turnSource).toEqual({ source: 'wakeup', wakeupId: 'wakeup_xyz789' });
    });

    it('extracts trigger turnSource from payload context and passes to executeFollowUpFn', async () => {
        const opts = makeOpts();
        const task = makeFollowUpTask({
            source: 'trigger',
            triggerId: 'trigger_abc123',
        });

        await runner.run(task, opts);

        expect(opts.executeFollowUpFn).toHaveBeenCalledOnce();
        const args = (opts.executeFollowUpFn as ReturnType<typeof vi.fn>).mock.calls[0];
        const turnSource: TurnSource = args[8];
        expect(turnSource).toEqual({ source: 'trigger', triggerId: 'trigger_abc123' });
    });

    it('passes undefined turnSource for normal follow-ups (no source in context)', async () => {
        const opts = makeOpts();
        const task = makeFollowUpTask({
            skills: ['impl'],
        });

        await runner.run(task, opts);

        expect(opts.executeFollowUpFn).toHaveBeenCalledOnce();
        const args = (opts.executeFollowUpFn as ReturnType<typeof vi.fn>).mock.calls[0];
        const turnSource = args[8];
        expect(turnSource).toBeUndefined();
    });

    it('passes undefined turnSource when context is undefined', async () => {
        const opts = makeOpts();
        const task: QueuedTask = {
            id: 'task-2',
            type: 'chat',
            displayName: 'test',
            priority: 1,
            addedAt: new Date(),
            config: { model: undefined },
            payload: {
                kind: 'chat',
                prompt: 'Hello',
                processId: 'proc-456',
                mode: 'ask',
            } as any,
        } as QueuedTask;

        await runner.run(task, opts);

        expect(opts.executeFollowUpFn).toHaveBeenCalledOnce();
        const args = (opts.executeFollowUpFn as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(args[8]).toBeUndefined();
    });

    it('does not include loopId in turnSource when source is wakeup', async () => {
        const opts = makeOpts();
        const task = makeFollowUpTask({
            source: 'wakeup',
            wakeupId: 'w1',
            loopId: undefined,
        });

        await runner.run(task, opts);

        const args = (opts.executeFollowUpFn as ReturnType<typeof vi.fn>).mock.calls[0];
        const turnSource: TurnSource = args[8];
        expect(turnSource).toEqual({ source: 'wakeup', wakeupId: 'w1' });
        expect(turnSource).not.toHaveProperty('loopId');
    });
});
