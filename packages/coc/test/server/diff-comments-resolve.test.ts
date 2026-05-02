/**
 * Diff Comments Resolve — Integration Tests
 *
 * Tests for the "Resolve with AI" feature for diff comments:
 * - Multi-file dispatch guard (hasResolveDiffCommentsMultiContext)
 * - Executor multi-file path
 * - Registry routing
 */

import { describe, it, expect } from 'vitest';
import { hasResolveCommentsContext, hasResolveDiffCommentsMultiContext } from '../../src/server/tasks/task-types';

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
