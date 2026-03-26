/**
 * ProcessLifecycleRunner — initial-prompt memory recording tests.
 *
 * Verifies that `recordUserMessage` is called for manual user chats
 * and skipped for scheduled, workflow, and script tasks.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { ProcessLifecycleRunner } from '../../../src/server/executors/process-lifecycle-runner';
import type { LifecycleRunnerOptions } from '../../../src/server/executors/process-lifecycle-runner';
import { createMockProcessStore } from '../helpers/mock-process-store';

// ============================================================================
// Mocks
// ============================================================================

const mockRecordUserMessage = vi.fn();
vi.mock('../../../src/server/memory/conversation-recorder', () => ({
    recordUserMessage: (...args: any[]) => mockRecordUserMessage(...args),
}));

// Stub image-store to avoid temp-file side effects
vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

// Stub output-file-manager to avoid disk writes
vi.mock('../../../src/server/output-file-manager', () => ({
    OutputFileManager: { saveOutput: vi.fn().mockResolvedValue(undefined) },
}));

// ============================================================================
// Helpers
// ============================================================================

function makeTask(overrides: Partial<QueuedTask> = {}): QueuedTask {
    return {
        id: 'task-1',
        type: 'chat',
        displayName: 'test',
        priority: 1,
        addedAt: new Date(),
        config: { model: undefined },
        payload: {
            kind: 'chat',
            prompt: 'Hello world',
            workspaceId: 'ws-abc',
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

describe('ProcessLifecycleRunner — initial prompt memory recording', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let runner: ProcessLifecycleRunner;

    beforeEach(() => {
        vi.clearAllMocks();
        store = createMockProcessStore();
        runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn());
    });

    it('records the initial prompt for a manual chat task', async () => {
        const task = makeTask();
        await runner.run(task, makeOpts());

        expect(mockRecordUserMessage).toHaveBeenCalledOnce();
        expect(mockRecordUserMessage).toHaveBeenCalledWith('/data-dir', 'ws-abc', 'Hello world');
    });

    it('skips recording when task.type is run-workflow', async () => {
        const task = makeTask({
            type: 'run-workflow',
            payload: {
                kind: 'run-workflow',
                workflowPath: '/wf.yaml',
                prompt: 'run this',
                workspaceId: 'ws-abc',
            } as any,
        });
        await runner.run(task, makeOpts());

        expect(mockRecordUserMessage).not.toHaveBeenCalled();
    });

    it('skips recording when task.type is run-script', async () => {
        const task = makeTask({
            type: 'run-script',
            payload: {
                kind: 'run-script',
                scriptPath: '/script.sh',
                prompt: 'run this',
                workspaceId: 'ws-abc',
            } as any,
        });
        await runner.run(task, makeOpts());

        expect(mockRecordUserMessage).not.toHaveBeenCalled();
    });

    it('skips recording for scheduled chat runs', async () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                prompt: 'scheduled prompt',
                workspaceId: 'ws-abc',
                context: { scheduleId: 'sched-1' },
            } as any,
        });
        await runner.run(task, makeOpts());

        expect(mockRecordUserMessage).not.toHaveBeenCalled();
    });

    it('skips recording when dataDir is undefined', async () => {
        const noDataDirRunner = new ProcessLifecycleRunner(store as any, undefined, vi.fn());
        const task = makeTask();
        await noDataDirRunner.run(task, makeOpts());

        expect(mockRecordUserMessage).not.toHaveBeenCalled();
    });

    it('skips recording when workspaceId is empty', async () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                prompt: 'Hello',
                workspaceId: '',
            } as any,
        });
        await runner.run(task, makeOpts());

        expect(mockRecordUserMessage).not.toHaveBeenCalled();
    });

    it('does not block execution if recordUserMessage throws', async () => {
        mockRecordUserMessage.mockImplementation(() => { throw new Error('disk full'); });

        const task = makeTask();
        const result = await runner.run(task, makeOpts());

        expect(result.success).toBe(true);
    });
});
