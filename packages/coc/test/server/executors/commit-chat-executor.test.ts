/**
 * Commit Chat Executor Tests
 *
 * Unit tests for the CommitChatExecutor class:
 * - buildModeOptions injects add_diff_comment tool
 * - System message construction (read-only + memory + auto-folder)
 * - Parent hash resolution
 * - Prompt suffix injection
 * - Standard chat tools (follow-ups, search-conversations)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { READ_ONLY_SYSTEM_MESSAGE } from '@plusplusoneplusplus/forge';
import { CommitChatExecutor } from '../../../src/server/executors/commit-chat-executor';
import { SOURCE_LOCATION_MARKDOWN_LINK_SYSTEM_MESSAGE } from '../../../src/server/executors/prompt-builder';
import type { ChatModeExecutorOptions } from '../../../src/server/executors/chat-base-executor';
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
            mkdir: vi.fn().mockResolvedValue(undefined),
        },
    };
});

vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

const mockResolveTaskRoot = vi.fn().mockReturnValue({ absolutePath: '/tasks-root' });
vi.mock('../../../src/server/tasks/task-root-resolver', () => ({
    resolveTaskRoot: (...args: any[]) => mockResolveTaskRoot(...args),
}));

vi.mock('../../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: {
        saveOutput: vi.fn().mockResolvedValue(undefined),
    },
}));

// Stub the one git command the executor runs. `importOriginal` + spread rather
// than a bare object: forge's git entry point is imported for real elsewhere in
// this graph, and a stub module would leave those imports undefined.
vi.mock('@plusplusoneplusplus/forge/git', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge/git')>();
    return { ...actual, execGitAsync: vi.fn() };
});

// Mock DiffCommentsManager
vi.mock('../../../src/server/tasks/comments/diff-comments-manager', () => ({
    DiffCommentsManager: class {
        addComment = vi.fn().mockResolvedValue({ id: 'c1' });
        hashContext = vi.fn().mockReturnValue('abc'.repeat(21) + 'a');
    },
}));

// Mock the add-diff-comment-tool factory
vi.mock('../../../src/server/llm-tools/add-diff-comment-tool', () => ({
    createAddDiffCommentTool: vi.fn().mockReturnValue({
        tool: {
            name: 'add_diff_comment',
            handler: vi.fn(),
            description: 'mock',
            parameters: {},
        },
        getAddedComments: vi.fn().mockReturnValue([]),
    }),
}));

// ============================================================================
// Helpers
// ============================================================================

const sdkMocks = createMockSDKService();

// Re-import the mocked runner for assertions
let mockExecGitAsync: ReturnType<typeof vi.fn>;

function makeOptions(
    store: ReturnType<typeof createMockProcessStore>,
    overrides?: Partial<ChatModeExecutorOptions>,
): ChatModeExecutorOptions {
    return {
        aiService: sdkMocks.service as any,
        defaultTimeoutMs: 30_000,
        followUpSuggestions: { enabled: false, count: 3 },
        resolveSkillConfig: vi.fn().mockResolvedValue({ skillDirectories: undefined, disabledSkills: undefined }),
        resolveWorkspaceIdForPath: vi.fn().mockResolvedValue('ws-id'),
        ...overrides,
    };
}

function makeCommitChatTask(id = 'task-1'): QueuedTask {
    return {
        id,
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            mode: 'ask',
            prompt: 'Review this commit',
            workspaceId: 'ws-1',
            workingDirectory: '/repo',
            context: {
                commitChat: {
                    commitHash: 'abc123',
                    commitMessage: 'feat: add new feature',
                },
            },
        },
        config: {},
        displayName: 'Review commit',
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('CommitChatExecutor', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        sdkMocks.resetAll();
        // Get reference to the mocked function
        const gitModule = await import('@plusplusoneplusplus/forge/git');
        mockExecGitAsync = gitModule.execGitAsync as unknown as ReturnType<typeof vi.fn>;
        mockExecGitAsync.mockResolvedValue('parent123');
    });

    describe('execute()', () => {
        it('sends message to AI with interactive mode', async () => {
            const store = createMockProcessStore();
            const executor = new CommitChatExecutor(store, makeOptions(store), undefined, '/data');
            const task = makeCommitChatTask();

            await executor.execute(task, 'Review this commit');

            expect(sdkMocks.service.sendMessage).toHaveBeenCalledOnce();
            const callArgs = sdkMocks.service.sendMessage.mock.calls[0][0];
            expect(callArgs.mode).toBe('interactive');
        });

        it('includes system message with READ_ONLY_SYSTEM_MESSAGE', async () => {
            const store = createMockProcessStore();
            const executor = new CommitChatExecutor(store, makeOptions(store), undefined, '/data');
            const task = makeCommitChatTask();

            await executor.execute(task, 'Review this commit');

            const callArgs = sdkMocks.service.sendMessage.mock.calls[0][0];
            expect(callArgs.systemMessage).toBeDefined();
            expect(callArgs.systemMessage.content).toContain(READ_ONLY_SYSTEM_MESSAGE);
            expect(callArgs.systemMessage.content).toContain(SOURCE_LOCATION_MARKDOWN_LINK_SYSTEM_MESSAGE);
        });

        it('omits the plan save-location block while keeping the other blocks', async () => {
            const store = createMockProcessStore();
            const executor = new CommitChatExecutor(store, makeOptions(store), undefined, '/data');
            const task = makeCommitChatTask();

            await executor.execute(task, 'Review this commit');

            const content = sdkMocks.service.sendMessage.mock.calls[0][0].systemMessage?.content ?? '';
            expect(content).not.toContain('Save location');
            expect(content).not.toContain('.plan.md');
            expect(content).toContain(READ_ONLY_SYSTEM_MESSAGE);
            expect(content).toContain(SOURCE_LOCATION_MARKDOWN_LINK_SYSTEM_MESSAGE);
        });

        it('injects add_diff_comment tool when context is complete', async () => {
            const store = createMockProcessStore();
            const executor = new CommitChatExecutor(store, makeOptions(store), undefined, '/data');
            const task = makeCommitChatTask();

            await executor.execute(task, 'Review this commit');

            const callArgs = sdkMocks.service.sendMessage.mock.calls[0][0];
            expect(callArgs.tools).toBeDefined();
            const toolNames = callArgs.tools.map((t: any) => t.name);
            expect(toolNames).toContain('add_diff_comment');
        });

        it('routes tool usage prose into systemMessage (not user prompt)', async () => {
            const store = createMockProcessStore();
            const executor = new CommitChatExecutor(store, makeOptions(store), undefined, '/data');
            const task = makeCommitChatTask();

            await executor.execute(task, 'Review this commit');

            const callArgs = sdkMocks.service.sendMessage.mock.calls[0][0];
            // After the refactor: tool guidance lives in systemMessage,
            // not stapled to every user prompt.
            expect(callArgs.prompt).not.toContain('add_diff_comment');
            const systemContent = callArgs.systemMessage?.content ?? '';
            expect(systemContent).toContain('add_diff_comment');
            expect(systemContent).toContain('diff review panel');
        });

        it('returns response from AI SDK', async () => {
            const store = createMockProcessStore();
            const executor = new CommitChatExecutor(store, makeOptions(store), undefined, '/data');
            const task = makeCommitChatTask();

            const result = await executor.execute(task, 'Review this commit');

            expect(result.response).toBeDefined();
        });
    });

    describe('parent hash resolution', () => {
        it('hands the resolved parent to the diff-comment tool', async () => {
            const store = createMockProcessStore();
            const executor = new CommitChatExecutor(store, makeOptions(store), undefined, '/data');
            const task = makeCommitChatTask();

            await executor.execute(task, 'Review');

            const { createAddDiffCommentTool } = await import('../../../src/server/llm-tools/add-diff-comment-tool');
            expect(createAddDiffCommentTool).toHaveBeenCalledWith(
                expect.objectContaining({ parentHash: 'parent123' }),
            );
        });

        it('handles merge commits by using first parent', async () => {
            mockExecGitAsync.mockResolvedValue('parent1 parent2');
            const store = createMockProcessStore();
            const executor = new CommitChatExecutor(store, makeOptions(store), undefined, '/data');
            const task = makeCommitChatTask();

            await executor.execute(task, 'Review');

            // Should call createAddDiffCommentTool with first parent
            const { createAddDiffCommentTool } = await import('../../../src/server/llm-tools/add-diff-comment-tool');
            expect(createAddDiffCommentTool).toHaveBeenCalledWith(
                expect.objectContaining({ parentHash: 'parent1' }),
            );
        });

        it('handles initial commit gracefully (no parent)', async () => {
            mockExecGitAsync.mockResolvedValue('');
            const store = createMockProcessStore();
            const executor = new CommitChatExecutor(store, makeOptions(store), undefined, '/data');
            const task = makeCommitChatTask();

            // Should not throw
            await executor.execute(task, 'Review');
        });

        it('handles git command failure gracefully', async () => {
            mockExecGitAsync.mockRejectedValue(new Error('git log --pretty=%P -n1 abc123 failed: '));
            const store = createMockProcessStore();
            const executor = new CommitChatExecutor(store, makeOptions(store), undefined, '/data');
            const task = makeCommitChatTask();

            // Should not throw — parentHash defaults to empty
            await executor.execute(task, 'Review');
        });
    });

    describe('without complete context', () => {
        it('skips tool injection when dataDir is missing', async () => {
            const store = createMockProcessStore();
            const executor = new CommitChatExecutor(store, makeOptions(store), undefined, undefined);
            const task = makeCommitChatTask();

            await executor.execute(task, 'Review');

            const callArgs = sdkMocks.service.sendMessage.mock.calls[0][0];
            const toolNames = (callArgs.tools || []).map((t: any) => t.name);
            expect(toolNames).not.toContain('add_diff_comment');
        });

        it('skips tool injection when workspaceId is missing', async () => {
            const store = createMockProcessStore();
            const executor = new CommitChatExecutor(store, makeOptions(store), undefined, '/data');
            const task = makeCommitChatTask();
            (task.payload as any).workspaceId = undefined;

            await executor.execute(task, 'Review');

            const callArgs = sdkMocks.service.sendMessage.mock.calls[0][0];
            const toolNames = (callArgs.tools || []).map((t: any) => t.name);
            expect(toolNames).not.toContain('add_diff_comment');
        });
    });

    describe('follow-up suggestions', () => {
        it('includes follow-up tools when enabled', async () => {
            const store = createMockProcessStore();
            const options = makeOptions(store, { followUpSuggestions: { enabled: true, count: 3 } });
            const executor = new CommitChatExecutor(store, options, undefined, '/data');
            const task = makeCommitChatTask();

            await executor.execute(task, 'Review');

            const callArgs = sdkMocks.service.sendMessage.mock.calls[0][0];
            const toolNames = callArgs.tools.map((t: any) => t.name);
            expect(toolNames).toContain('suggest_follow_ups');
        });
    });
});
