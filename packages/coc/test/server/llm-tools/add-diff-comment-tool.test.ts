/**
 * Add Diff Comment Tool Tests
 *
 * Unit tests for the createAddDiffCommentTool factory.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AddDiffCommentDeps } from '../../../src/server/llm-tools/add-diff-comment-tool';
import { createAddDiffCommentTool } from '../../../src/server/llm-tools/add-diff-comment-tool';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../../src/server/llm-tools/diff-line-mapper', () => ({
    getFileDiff: vi.fn().mockReturnValue(`diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 import { foo } from './foo';
-import { bar } from './bar';
+import { bar } from './bar-v2';
+import { baz } from './baz';
 export function main() {}
`),
    parseUnifiedDiff: vi.fn().mockReturnValue([
        { index: 0, type: 'hunk-header', content: '@@ -1,3 +1,4 @@' },
        { index: 1, type: 'context', content: "import { foo } from './foo';", oldLine: 1, newLine: 1 },
        { index: 2, type: 'removed', content: "import { bar } from './bar';", oldLine: 2 },
        { index: 3, type: 'added', content: "import { bar } from './bar-v2';", newLine: 2 },
        { index: 4, type: 'added', content: "import { baz } from './baz';", newLine: 3 },
        { index: 5, type: 'context', content: 'export function main() {}', oldLine: 3, newLine: 4 },
    ]),
    mapLinesToDiffIndices: vi.fn().mockReturnValue({
        diffLineStart: 3,
        diffLineEnd: 4,
        side: 'added',
        newLineStart: 2,
        newLineEnd: 3,
    }),
    extractTextFromDiffLines: vi.fn().mockReturnValue("import { bar } from './bar-v2';\nimport { baz } from './baz';"),
}));

const invocationStub = {
    sessionId: 'session-1',
    toolCallId: 'call-1',
    toolName: 'add_diff_comment',
    arguments: {},
};

function createMockDeps(overrides?: Partial<AddDiffCommentDeps>): AddDiffCommentDeps {
    return {
        manager: {
            addComment: vi.fn().mockResolvedValue({
                id: 'comment-uuid-1',
                context: { repositoryId: 'ws-1', filePath: 'src/index.ts', oldRef: 'abc123^', newRef: 'abc123' },
                selection: { diffLineStart: 3, diffLineEnd: 4, side: 'added', startColumn: 0, endColumn: 0 },
                selectedText: "import { bar } from './bar-v2';",
                comment: 'Consider renaming',
                status: 'open',
                author: 'AI',
                tags: ['general'],
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
            }),
            hashContext: vi.fn().mockReturnValue('deadbeef'.repeat(8)),
        } as any,
        workspaceId: 'ws-1',
        commitHash: 'abc123',
        parentHash: 'abc122',
        workingDirectory: '/repo',
        getWsServer: vi.fn().mockReturnValue({
            broadcastProcessEvent: vi.fn(),
        }),
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('createAddDiffCommentTool', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns a valid Tool shape', () => {
        const deps = createMockDeps();
        const { tool } = createAddDiffCommentTool(deps);

        expect(tool.name).toBe('add_diff_comment');
        expect(typeof tool.handler).toBe('function');
        expect(tool.description).toBeDefined();
        expect(tool.parameters).toBeDefined();

        const params = tool.parameters as any;
        expect(params.required).toContain('filePath');
        expect(params.required).toContain('lineStart');
        expect(params.required).toContain('side');
        expect(params.required).toContain('comment');
        expect(params.properties.category.enum).toEqual(['bug', 'question', 'suggestion', 'praise', 'nitpick', 'general']);
    });

    it('handler calls manager.addComment with correct shape', async () => {
        const deps = createMockDeps();
        const { tool } = createAddDiffCommentTool(deps);

        const result = await tool.handler(
            {
                filePath: 'src/index.ts',
                lineStart: 2,
                lineEnd: 3,
                side: 'added',
                comment: 'Consider renaming this import',
            },
            invocationStub,
        );

        expect(result).toEqual({
            success: true,
            commentId: 'comment-uuid-1',
            filePath: 'src/index.ts',
        });

        expect(deps.manager.addComment).toHaveBeenCalledOnce();
        const [wsId, context, commentData] = (deps.manager.addComment as any).mock.calls[0];
        expect(wsId).toBe('ws-1');
        expect(context.repositoryId).toBe('ws-1');
        expect(context.filePath).toBe('src/index.ts');
        expect(context.oldRef).toBe('abc123^');
        expect(context.newRef).toBe('abc123');
        expect(commentData.author).toBe('AI');
        expect(commentData.status).toBe('open');
    });

    it('handler broadcasts WebSocket event', async () => {
        const deps = createMockDeps();
        const { tool } = createAddDiffCommentTool(deps);
        const broadcastSpy = deps.getWsServer!()!.broadcastProcessEvent;

        await tool.handler(
            {
                filePath: 'src/index.ts',
                lineStart: 2,
                side: 'added',
                comment: 'Review this',
            },
            invocationStub,
        );

        expect(broadcastSpy).toHaveBeenCalledOnce();
        expect(broadcastSpy).toHaveBeenCalledWith({
            type: 'diff-comment-updated',
            action: 'added',
            workspaceId: 'ws-1',
            storageKey: 'deadbeef'.repeat(8),
            comment: expect.objectContaining({ id: 'comment-uuid-1' }),
        });
    });

    it('handler defaults category to "general"', async () => {
        const deps = createMockDeps();
        const { tool } = createAddDiffCommentTool(deps);

        await tool.handler(
            {
                filePath: 'src/index.ts',
                lineStart: 2,
                side: 'added',
                comment: 'Note this',
            },
            invocationStub,
        );

        const commentData = (deps.manager.addComment as any).mock.calls[0][2];
        expect(commentData.tags).toEqual(['general']);
    });

    it('handler uses provided category', async () => {
        const deps = createMockDeps();
        const { tool } = createAddDiffCommentTool(deps);

        await tool.handler(
            {
                filePath: 'src/index.ts',
                lineStart: 2,
                side: 'added',
                comment: 'This is a bug',
                category: 'bug',
            },
            invocationStub,
        );

        const commentData = (deps.manager.addComment as any).mock.calls[0][2];
        expect(commentData.tags).toEqual(['bug']);
    });

    it('handler auto-extracts selectedText when omitted', async () => {
        const deps = createMockDeps();
        const { tool } = createAddDiffCommentTool(deps);

        await tool.handler(
            {
                filePath: 'src/index.ts',
                lineStart: 2,
                lineEnd: 3,
                side: 'added',
                comment: 'Review these imports',
            },
            invocationStub,
        );

        const commentData = (deps.manager.addComment as any).mock.calls[0][2];
        expect(commentData.selectedText).toBe("import { bar } from './bar-v2';\nimport { baz } from './baz';");
    });

    it('handler uses provided selectedText', async () => {
        const deps = createMockDeps();
        const { tool } = createAddDiffCommentTool(deps);

        await tool.handler(
            {
                filePath: 'src/index.ts',
                lineStart: 2,
                side: 'added',
                comment: 'Review',
                selectedText: 'custom selected text',
            },
            invocationStub,
        );

        const commentData = (deps.manager.addComment as any).mock.calls[0][2];
        expect(commentData.selectedText).toBe('custom selected text');
    });

    it('tracks added comments for post-execution summary', async () => {
        const deps = createMockDeps();
        const { tool, getAddedComments } = createAddDiffCommentTool(deps);

        expect(getAddedComments()).toEqual([]);

        await tool.handler(
            {
                filePath: 'src/index.ts',
                lineStart: 2,
                side: 'added',
                comment: 'First comment',
                category: 'bug',
            },
            invocationStub,
        );

        const added = getAddedComments();
        expect(added).toHaveLength(1);
        expect(added[0]).toEqual({
            commentId: 'comment-uuid-1',
            filePath: 'src/index.ts',
            lineStart: 2,
            lineEnd: 2,
            category: 'bug',
        });
    });

    it('multiple calls accumulate in getAddedComments', async () => {
        const deps = createMockDeps();
        const { tool, getAddedComments } = createAddDiffCommentTool(deps);

        await tool.handler(
            { filePath: 'src/a.ts', lineStart: 1, side: 'added', comment: 'c1' },
            invocationStub,
        );
        await tool.handler(
            { filePath: 'src/b.ts', lineStart: 5, side: 'removed', comment: 'c2' },
            invocationStub,
        );

        expect(getAddedComments()).toHaveLength(2);
    });

    it('getAddedComments returns a copy', async () => {
        const deps = createMockDeps();
        const { tool, getAddedComments } = createAddDiffCommentTool(deps);

        await tool.handler(
            { filePath: 'src/a.ts', lineStart: 1, side: 'added', comment: 'c1' },
            invocationStub,
        );

        const copy = getAddedComments();
        copy.pop();

        expect(getAddedComments()).toHaveLength(1);
    });

    it('separate invocations are isolated', async () => {
        const deps1 = createMockDeps();
        const deps2 = createMockDeps();
        const tool1 = createAddDiffCommentTool(deps1);
        const tool2 = createAddDiffCommentTool(deps2);

        await tool1.tool.handler(
            { filePath: 'src/a.ts', lineStart: 1, side: 'added', comment: 'c1' },
            invocationStub,
        );

        expect(tool1.getAddedComments()).toHaveLength(1);
        expect(tool2.getAddedComments()).toHaveLength(0);
    });

    it('handler returns error for missing diff', async () => {
        const { parseUnifiedDiff } = await import('../../../src/server/llm-tools/diff-line-mapper');
        (parseUnifiedDiff as any).mockReturnValueOnce([]);

        const deps = createMockDeps();
        const { tool } = createAddDiffCommentTool(deps);

        const result = await tool.handler(
            { filePath: 'binary.png', lineStart: 1, side: 'added', comment: 'c1' },
            invocationStub,
        );

        expect(result).toEqual({
            success: false,
            error: expect.stringContaining('No diff content'),
        });
    });

    it('handler returns error when mapper throws', async () => {
        const { mapLinesToDiffIndices } = await import('../../../src/server/llm-tools/diff-line-mapper');
        (mapLinesToDiffIndices as any).mockImplementationOnce(() => {
            throw new Error('Lines 999–999 (added) not found in any diff hunk');
        });

        const deps = createMockDeps();
        const { tool } = createAddDiffCommentTool(deps);

        const result = await tool.handler(
            { filePath: 'src/index.ts', lineStart: 999, side: 'added', comment: 'c1' },
            invocationStub,
        );

        expect(result).toEqual({
            success: false,
            error: expect.stringContaining('not found'),
        });
    });

    it('handler works when getWsServer returns undefined', async () => {
        const deps = createMockDeps({ getWsServer: () => undefined });
        const { tool } = createAddDiffCommentTool(deps);

        const result = await tool.handler(
            { filePath: 'src/index.ts', lineStart: 2, side: 'added', comment: 'c1' },
            invocationStub,
        );

        expect(result).toEqual({ success: true, commentId: 'comment-uuid-1', filePath: 'src/index.ts' });
    });

    it('handler works when getWsServer is not provided', async () => {
        const deps = createMockDeps({ getWsServer: undefined });
        const { tool } = createAddDiffCommentTool(deps);

        const result = await tool.handler(
            { filePath: 'src/index.ts', lineStart: 2, side: 'added', comment: 'c1' },
            invocationStub,
        );

        expect(result).toEqual({ success: true, commentId: 'comment-uuid-1', filePath: 'src/index.ts' });
    });
});
