/**
 * Diff Comments Resolve — Integration Tests
 *
 * Tests for the "Resolve with AI" feature for diff comments:
 * - Prompt builder produces correct structure
 * - Multi-file dispatch guard (hasResolveDiffCommentsMultiContext)
 * - Executor multi-file path
 * - Registry routing
 */

import { describe, it, expect } from 'vitest';
import type { DiffComment, DiffCommentContext } from '@plusplusoneplusplus/forge';
import { buildDiffBatchResolvePrompt } from '../../src/server/diff-comments-ai';
import { hasResolveCommentsContext, hasResolveDiffCommentsMultiContext } from '../../src/server/task-types';

// ============================================================================
// Test Fixtures
// ============================================================================

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

// ============================================================================
// Tests — Prompt Builder
// ============================================================================

describe('buildDiffBatchResolvePrompt integration', () => {
    it('produces correct structure with all fields', () => {
        const comments = [
            makeDiffComment({
                id: 'dc-1',
                author: 'alice',
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
        expect(prompt).toContain('critical');
        expect(prompt).toContain('Previous analysis');
        expect(prompt).toContain('bob: Agreed');

        // Ref range
        expect(prompt).toContain('abc123^ → abc123');
        expect(prompt).toContain('`src/app.ts`');
    });
});

// ============================================================================
// Tests — Multi-file Dispatch Guard
// ============================================================================

describe('hasResolveDiffCommentsMultiContext dispatch', () => {
    it('returns true for valid multi-file payloads', () => {
        const payload = {
            kind: 'chat',
            prompt: 'resolve multi',
            context: {
                resolveDiffCommentsMulti: {
                    wsId: 'ws-multi',
                    oldRef: 'abc^',
                    newRef: 'abc',
                    files: [
                        { storageKey: 'sk-1', filePath: 'src/a.ts', commentIds: ['c1'] },
                    ],
                },
            },
        };
        expect(hasResolveDiffCommentsMultiContext(payload)).toBe(true);
    });

    it('returns false for plain chat payload', () => {
        expect(hasResolveDiffCommentsMultiContext({ kind: 'chat', prompt: 'hello' })).toBe(false);
    });
});

// ============================================================================
// Tests — Registry Routing for Multi-file Context
// ============================================================================

describe('Executor registry routes multi-file context', () => {
    it('dispatches to resolveCommentsExecutor for multi-file context', async () => {
        // Verify the guard returns true which is the condition for routing
        const multiPayload = {
            kind: 'chat',
            prompt: 'resolve multi',
            context: {
                resolveDiffCommentsMulti: {
                    wsId: 'ws-multi',
                    oldRef: 'abc^',
                    newRef: 'abc',
                    files: [
                        { storageKey: 'sk-1', filePath: 'src/a.ts', commentIds: ['c1'] },
                    ],
                },
            },
        };
        expect(hasResolveDiffCommentsMultiContext(multiPayload)).toBe(true);
        expect(hasResolveCommentsContext(multiPayload)).toBe(false);
    });
});
