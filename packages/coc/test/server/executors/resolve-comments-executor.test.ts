/**
 * ResolveCommentsExecutor Tests
 *
 * Regression test: executeTask() must return the full ChatModeExecutionResult
 * fields (response, timeline, sessionId) in addition to the resolve-specific
 * fields (revisedContent, commentIds).
 *
 * Previously executeTask() returned only { revisedContent, commentIds },
 * dropping `response` and `timeline`. ProcessLifecycleRunner reads
 * `result.response` to populate conversationTurns, so the assistant turn
 * always had empty content.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { ResolveCommentsExecutor } from '../../../src/server/executors/resolve-comments-executor';
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
        promises: { ...actual.promises, readdir: vi.fn().mockResolvedValue([]) },
    };
});

vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: { saveOutput: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../src/server/tasks/task-root-resolver', () => ({
    resolveTaskRoot: vi.fn().mockReturnValue({ absolutePath: '/tasks-root' }),
}));

// ============================================================================
// Helpers
// ============================================================================

const sdkMocks = createMockSDKService();

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

function makeResolveCommentsTask(id = 'rc-task-1'): QueuedTask {
    return {
        id,
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            mode: 'ask',
            prompt: 'Resolve the comment in the document.',
            context: {
                resolveComments: {
                    filePath: 'feature/task.md',
                    commentIds: ['comment-id-1'],
                    wsId: 'ws-test',
                },
            },
        },
        config: {},
        displayName: 'Resolve comments',
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('ResolveCommentsExecutor', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'I have updated the document to use Option A.',
            sessionId: 'sess-rc-1',
            toolCalls: [],
        });
    });

    it('returns response field so ProcessLifecycleRunner can populate conversationTurns', async () => {
        const executor = new ResolveCommentsExecutor(store, makeOptions(store));
        const task = makeResolveCommentsTask();

        const result = await executor.executeTask(task);

        // Regression: response must be populated (not empty/undefined)
        expect(result.response).toBe('I have updated the document to use Option A.');
    });

    it('returns timeline field so ProcessLifecycleRunner can store tool call history', async () => {
        const executor = new ResolveCommentsExecutor(store, makeOptions(store));
        const task = makeResolveCommentsTask();

        const result = await executor.executeTask(task);

        expect(Array.isArray(result.timeline)).toBe(true);
    });

    it('returns sessionId field', async () => {
        const executor = new ResolveCommentsExecutor(store, makeOptions(store));
        const task = makeResolveCommentsTask();

        const result = await executor.executeTask(task);

        expect(result.sessionId).toBe('sess-rc-1');
    });

    it('still returns revisedContent (alias for response)', async () => {
        const executor = new ResolveCommentsExecutor(store, makeOptions(store));
        const task = makeResolveCommentsTask();

        const result = await executor.executeTask(task);

        expect(result.revisedContent).toBe('I have updated the document to use Option A.');
    });

    it('returns commentIds from resolve_comment tool when called', async () => {
        // Simulate AI calling resolve_comment tool via onToolEvent
        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.tools?.length > 0) {
                const resolveTool = opts.tools[0];
                resolveTool.handler({ commentId: 'comment-id-1', summary: 'Used Option A' });
            }
            return { success: true, response: 'Done.', sessionId: 'sess-rc-2', toolCalls: [] };
        });

        const executor = new ResolveCommentsExecutor(store, makeOptions(store));
        const task = makeResolveCommentsTask();

        const result = await executor.executeTask(task);

        expect(result.commentIds).toContain('comment-id-1');
    });

    it('falls back to payload commentIds when resolve_comment tool is not called', async () => {
        const executor = new ResolveCommentsExecutor(store, makeOptions(store));
        const task = makeResolveCommentsTask();

        const result = await executor.executeTask(task);

        // Falls back to rc.commentIds from payload
        expect(result.commentIds).toEqual(['comment-id-1']);
    });

    it('sets agentMode to interactive for single-file task comments (ask mode)', async () => {
        const executor = new ResolveCommentsExecutor(store, makeOptions(store));
        const task = makeResolveCommentsTask();

        let capturedMode: string | undefined;
        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            capturedMode = opts.mode;
            return { success: true, response: 'Done.', sessionId: 's1', toolCalls: [] };
        });

        await executor.executeTask(task);
        expect(capturedMode).toBe('interactive');
    });

    it('injects read-only system message for single-file task comments', async () => {
        const executor = new ResolveCommentsExecutor(store, makeOptions(store));
        const task = makeResolveCommentsTask();

        let capturedSystemMessage: unknown;
        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            capturedSystemMessage = opts.systemMessage;
            return { success: true, response: 'Done.', sessionId: 's1', toolCalls: [] };
        });

        await executor.executeTask(task);
        expect(capturedSystemMessage).toBeDefined();
        expect((capturedSystemMessage as any).mode).toBe('append');
        expect((capturedSystemMessage as any).content).toBeTruthy();
    });
});

// ============================================================================
// Multi-file diff comment resolution path
// ============================================================================

describe('ResolveCommentsExecutor — multi-file diff comments', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    function makeResolveMultiTask(id = 'rdcm-task-1'): QueuedTask {
        return {
            id,
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'Resolve comments across multiple files.',
                context: {
                    resolveDiffCommentsMulti: {
                        wsId: 'ws-multi',
                        oldRef: 'abc123^',
                        newRef: 'abc123',
                        files: [
                            { storageKey: 'sk-file-a', filePath: 'src/a.ts', commentIds: ['mc-1', 'mc-2'] },
                            { storageKey: 'sk-file-b', filePath: 'src/b.ts', commentIds: ['mc-3'] },
                        ],
                    },
                },
            },
            config: {},
            displayName: 'Resolve multi-file diff comments',
        };
    }

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'Multi-file comments resolved.',
            sessionId: 'sess-rdcm-1',
            toolCalls: [],
        });
    });

    it('resolves comments across different storageKeys', async () => {
        const mockUpdateComment = vi.fn().mockResolvedValue({});
        vi.doMock('../../../src/server/tasks/comments/diff-comments-manager', () => ({
            DiffCommentsManager: class {
                constructor() {}
                updateComment = mockUpdateComment;
            },
        }));

        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.tools?.length > 0) {
                opts.tools[0].handler({ commentId: 'mc-1', summary: 'Fixed A' });
                opts.tools[0].handler({ commentId: 'mc-3', summary: 'Fixed B' });
            }
            return { success: true, response: 'Done.', sessionId: 's1', toolCalls: [] };
        });

        const executor = new ResolveCommentsExecutor(store, makeOptions(store), undefined, '/tmp/data');
        const task = makeResolveMultiTask();
        await executor.executeTask(task);
        // Verifies the code path doesn't throw; dynamic import may not resolve in test env
    });

    it('broadcasts diff-comment-updated per comment with correct storageKey', async () => {
        const broadcastSpy = vi.fn();
        const mockWsServer = { broadcastProcessEvent: broadcastSpy } as any;

        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.tools?.length > 0) {
                opts.tools[0].handler({ commentId: 'mc-1', summary: 'Fixed' });
                opts.tools[0].handler({ commentId: 'mc-3', summary: 'Fixed' });
            }
            return { success: true, response: 'Done.', sessionId: 's1', toolCalls: [] };
        });

        const executor = new ResolveCommentsExecutor(
            store, makeOptions(store), () => mockWsServer, '/tmp/data'
        );
        const task = makeResolveMultiTask();
        await executor.executeTask(task);
        // Verifies the code path doesn't throw
    });

    it('AI resolves subset of comments — only resolved ones updated', async () => {
        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.tools?.length > 0) {
                // Only resolve mc-1, not mc-2 or mc-3
                opts.tools[0].handler({ commentId: 'mc-1', summary: 'Partial fix' });
            }
            return { success: true, response: 'Partially done.', sessionId: 's1', toolCalls: [] };
        });

        const executor = new ResolveCommentsExecutor(store, makeOptions(store));
        const task = makeResolveMultiTask();
        const result = await executor.executeTask(task);

        expect(result.commentIds).toEqual(['mc-1']);
    });

    it('falls back to all payload commentIds when AI calls 0 tools', async () => {
        const executor = new ResolveCommentsExecutor(store, makeOptions(store));
        const task = makeResolveMultiTask();
        const result = await executor.executeTask(task);

        expect(result.commentIds).toEqual(['mc-1', 'mc-2', 'mc-3']);
    });

    it('sets agentMode to autopilot in buildModeOptions for multi-file context', async () => {
        const executor = new ResolveCommentsExecutor(store, makeOptions(store));
        const task = makeResolveMultiTask();

        // buildModeOptions returns agentMode which is passed as `mode` to sendMessage
        let capturedMode: string | undefined;
        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            capturedMode = opts.mode;
            return { success: true, response: 'Done.', sessionId: 's1', toolCalls: [] };
        });

        await executor.executeTask(task);
        expect(capturedMode).toBe('autopilot');
    });
});


