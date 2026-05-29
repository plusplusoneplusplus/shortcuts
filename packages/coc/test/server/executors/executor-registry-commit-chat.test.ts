/**
 * Executor Registry — Commit Chat Routing Tests
 *
 * Verifies that tasks with commit chat context are routed to the
 * CommitChatExecutor instead of the default ChatExecutor.
 */

import { describe, it, expect, vi } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { ExecutorRegistry } from '../../../src/server/executors/executor-registry';
import { CommitChatExecutor } from '../../../src/server/executors/commit-chat-executor';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn().mockReturnValue(false),
        promises: {
            ...actual.promises,
            readdir: vi.fn().mockResolvedValue([]),
        },
    };
});

vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/server/tasks/task-root-resolver', () => ({
    resolveTaskRoot: vi.fn().mockReturnValue({ absolutePath: '/tasks-root' }),
}));

vi.mock('../../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: {
        saveOutput: vi.fn().mockResolvedValue(undefined),
    },
}));

// ============================================================================
// Helpers
// ============================================================================

const sdkMocks = createMockSDKService();

function createRegistry() {
    const store = createMockProcessStore();
    const registry = new ExecutorRegistry(store, {
        approvePermissions: true,
        aiService: sdkMocks.service as any,
        dataDir: '/data',
        defaultTimeoutMs: 30_000,
        followUpSuggestions: { enabled: false, count: 3 },
        resolveSkillConfig: vi.fn().mockResolvedValue({}),
        resolveWorkspaceIdForPath: vi.fn().mockResolvedValue('ws-1'),
        onTitleNeeded: vi.fn(),
        getWsServer: () => undefined,
    });
    return { store, registry };
}

function makeCommitChatTask(): QueuedTask {
    return {
        id: 'task-cc-1',
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            mode: 'ask',
            prompt: 'Review this commit',
            workspaceId: 'ws-1',
            context: {
                commitChat: {
                    commitHash: 'abc123',
                    commitMessage: 'feat: something',
                },
            },
        },
        config: {},
        displayName: 'Review commit',
    };
}

function makePlainChatTask(): QueuedTask {
    return {
        id: 'task-plain-1',
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            mode: 'ask',
            prompt: 'Hello',
        },
        config: {},
        displayName: 'Hello',
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('ExecutorRegistry — commit chat routing', () => {
    it('dispatches commit chat tasks to CommitChatExecutor', async () => {
        const { registry } = createRegistry();
        const task = makeCommitChatTask();

        // Spy on CommitChatExecutor.prototype.execute to verify routing
        const executeSpy = vi.spyOn(CommitChatExecutor.prototype, 'execute').mockResolvedValue({
            response: 'review done',
            timeline: [],
        });

        await registry.dispatch(task, 'Review this commit');

        expect(executeSpy).toHaveBeenCalledOnce();
        executeSpy.mockRestore();
    });

    it('does NOT route plain chat tasks to CommitChatExecutor', async () => {
        const { registry } = createRegistry();
        const task = makePlainChatTask();

        const commitChatSpy = vi.spyOn(CommitChatExecutor.prototype, 'execute');

        // This will fail because sdkMocks doesn't have full setup,
        // but we're only checking routing — wrap in try/catch
        try {
            await registry.dispatch(task, 'Hello');
        } catch {
            // Expected — we only care about routing
        }

        expect(commitChatSpy).not.toHaveBeenCalled();
        commitChatSpy.mockRestore();
    });

    it('commit chat tasks are routed before mode-based resolution', async () => {
        const { registry } = createRegistry();
        // Create a commit chat task with plan mode — should still go to CommitChatExecutor
        const task = makeCommitChatTask();
        (task.payload as any).mode = 'plan';

        const executeSpy = vi.spyOn(CommitChatExecutor.prototype, 'execute').mockResolvedValue({
            response: 'done',
            timeline: [],
        });

        await registry.dispatch(task, 'Review');

        expect(executeSpy).toHaveBeenCalledOnce();
        executeSpy.mockRestore();
    });
});
