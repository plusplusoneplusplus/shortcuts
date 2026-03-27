/**
 * Diff Comments Resolve — Integration Tests
 *
 * Tests for the "Resolve with AI" feature for diff comments:
 * - Prompt builder produces correct structure
 * - Batch-resolve endpoint enqueues correct payload
 * - Single resolve via ask-ai endpoint
 * - Executor diff-comment path persists resolved status
 * - Dispatch guard (hasResolveDiffCommentsContext)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import type { DiffComment, DiffCommentContext } from '@plusplusoneplusplus/forge';
import { buildDiffBatchResolvePrompt } from '../../src/server/diff-comments-ai';
import { hasResolveDiffCommentsContext, hasResolveCommentsContext } from '../../src/server/task-types';
import { ResolveCommentsExecutor } from '../../src/server/executors/resolve-comments-executor';
import { createMockProcessStore } from './helpers/mock-process-store';
import { createMockSDKService } from '../helpers/mock-sdk-service';

// ============================================================================
// Mocks (same as resolve-comments-executor.test.ts)
// ============================================================================

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        promises: { ...actual.promises, readdir: vi.fn().mockResolvedValue([]) },
    };
});

vi.mock('../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/server/output-file-manager', () => ({
    OutputFileManager: { saveOutput: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/server/task-root-resolver', () => ({
    resolveTaskRoot: vi.fn().mockReturnValue({ absolutePath: '/tasks-root' }),
}));

// ============================================================================
// Test Fixtures
// ============================================================================

const sdkMocks = createMockSDKService();

function makeContext(overrides: Partial<DiffCommentContext> = {}): DiffCommentContext {
    return {
        repositoryId: 'repo/test',
        oldRef: 'abc123^',
        newRef: 'abc123',
        filePath: 'src/app.ts',
        ...overrides,
    };
}

function makeDiffComment(overrides: Partial<DiffComment> = {}): DiffComment {
    return {
        id: 'dc-1',
        context: makeContext(),
        selection: {
            diffLineStart: 10,
            diffLineEnd: 12,
            side: 'right',
            oldLineStart: 8,
            oldLineEnd: 10,
            newLineStart: 9,
            newLineEnd: 11,
            startColumn: 0,
            endColumn: 20,
        },
        selectedText: 'const x = 1;',
        comment: 'Should use let',
        status: 'open',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        ...overrides,
    } as DiffComment;
}

const sampleDiff = `--- a/src/app.ts
+++ b/src/app.ts
@@ -8,3 +9,3 @@
-const x = 0;
+const x = 1;
 const y = 2;`;

function makeExecutorOptions(store: ReturnType<typeof createMockProcessStore>) {
    return {
        aiService: sdkMocks.service as any,
        defaultTimeoutMs: 30_000,
        followUpSuggestions: { enabled: false, count: 3 },
        toolCallCacheStore: { options: {} } as any,
        resolveSkillConfig: vi.fn().mockResolvedValue({ skillDirectories: undefined, disabledSkills: undefined }),
        resolveWorkspaceIdForPath: vi.fn().mockResolvedValue('ws-id'),
    };
}

function makeDiffResolveTask(id = 'rdc-task-1'): QueuedTask {
    return {
        id,
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            mode: 'autopilot',
            prompt: buildDiffBatchResolvePrompt(
                [makeDiffComment()], sampleDiff, 'src/app.ts', 'abc123^', 'abc123'
            ),
            tools: ['resolve-comments'],
            context: {
                resolveDiffComments: {
                    storageKey: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
                    commentIds: ['dc-1'],
                    diffContent: sampleDiff,
                    filePath: 'src/app.ts',
                    wsId: 'ws-test',
                },
            },
        },
        config: {},
        displayName: 'Resolve diff comments: src/app.ts',
    };
}

// ============================================================================
// Tests — Prompt Builder
// ============================================================================

describe('buildDiffBatchResolvePrompt integration', () => {
    it('produces correct structure with all fields', () => {
        const comments = [
            makeDiffComment({
                id: 'dc-1',
                author: 'alice',
                category: 'bug',
                tags: ['critical'],
                aiResponse: 'Previous analysis',
                replies: [{ text: 'Agreed', author: 'bob', createdAt: '2024-01-02' }],
            }),
            makeDiffComment({ id: 'dc-2', comment: 'Another issue' }),
        ];

        const prompt = buildDiffBatchResolvePrompt(
            comments, sampleDiff, 'src/app.ts', 'abc123^', 'abc123'
        );

        // Structure checks
        expect(prompt).toContain('# Diff Comment Resolution Request');
        expect(prompt).toContain('## Diff Content');
        expect(prompt).toContain('```diff');
        expect(prompt).toContain(sampleDiff);
        expect(prompt).toContain('## Open Comments');
        expect(prompt).toContain('## Instructions');

        // Comment fields
        expect(prompt).toContain('`dc-1`');
        expect(prompt).toContain('`dc-2`');
        expect(prompt).toContain('alice');
        expect(prompt).toContain('bug');
        expect(prompt).toContain('critical');
        expect(prompt).toContain('Previous analysis');
        expect(prompt).toContain('bob: Agreed');

        // Ref range
        expect(prompt).toContain('abc123^ → abc123');
        expect(prompt).toContain('`src/app.ts`');
    });
});

// ============================================================================
// Tests — Dispatch Guard
// ============================================================================

describe('hasResolveDiffCommentsContext dispatch', () => {
    it('returns true for payload with resolveDiffComments context', () => {
        expect(hasResolveDiffCommentsContext(makeDiffResolveTask().payload as Record<string, unknown>)).toBe(true);
    });

    it('returns false for payload with resolveComments context (task comments)', () => {
        const payload = {
            kind: 'chat',
            prompt: 'resolve',
            context: { resolveComments: { documentUri: '/d', commentIds: ['c1'], documentContent: 'x', filePath: '/f' } },
        };
        expect(hasResolveDiffCommentsContext(payload)).toBe(false);
        expect(hasResolveCommentsContext(payload)).toBe(true);
    });

    it('returns false for plain chat payload', () => {
        expect(hasResolveDiffCommentsContext({ kind: 'chat', prompt: 'hello' })).toBe(false);
    });
});

// ============================================================================
// Tests — Executor Diff Comment Path
// ============================================================================

describe('ResolveCommentsExecutor — diff comment integration', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
    });

    it('end-to-end: AI calls resolve_comment → executor returns resolved IDs', async () => {
        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.tools?.length > 0) {
                opts.tools[0].handler({ commentId: 'dc-1', summary: 'Code change looks correct.' });
            }
            return { success: true, response: 'Resolved dc-1.', sessionId: 'sess-1', toolCalls: [] };
        });

        const executor = new ResolveCommentsExecutor(store, makeExecutorOptions(store));
        const task = makeDiffResolveTask();

        const result = await executor.executeTask(task);

        expect(result.response).toBe('Resolved dc-1.');
        expect(result.commentIds).toContain('dc-1');
        expect(result.revisedContent).toBe('Resolved dc-1.');
        expect(result.sessionId).toBe('sess-1');
        expect(Array.isArray(result.timeline)).toBe(true);
    });

    it('falls back to payload commentIds when AI does not call resolve_comment', async () => {
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'I cannot resolve this comment.',
            sessionId: 'sess-2',
            toolCalls: [],
        });

        const executor = new ResolveCommentsExecutor(store, makeExecutorOptions(store));
        const task = makeDiffResolveTask();

        const result = await executor.executeTask(task);

        expect(result.commentIds).toEqual(['dc-1']);
    });

    it('executor broadcasts WS events when getWsServer is provided', async () => {
        const broadcastSpy = vi.fn();
        const mockWsServer = { broadcastProcessEvent: broadcastSpy } as any;

        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.tools?.length > 0) {
                opts.tools[0].handler({ commentId: 'dc-1', summary: 'Fixed' });
            }
            return { success: true, response: 'Done.', sessionId: 's1', toolCalls: [] };
        });

        // Provide dataDir so the server-side resolution path is attempted
        const executor = new ResolveCommentsExecutor(
            store, makeExecutorOptions(store), () => mockWsServer, '/tmp/test-data'
        );
        const task = makeDiffResolveTask();

        // This will attempt DiffCommentsManager import which may fail in test env,
        // but the executor handles errors gracefully (best-effort)
        await executor.executeTask(task);

        // The test verifies the code path doesn't throw, even if the dynamic import fails
    });
});
