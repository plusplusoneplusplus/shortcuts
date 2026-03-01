/**
 * Resolve Comment Tool Tests
 *
 * Unit tests for the createResolveCommentTool factory.
 */

import { describe, it, expect } from 'vitest';
import { createResolveCommentTool } from '../../src/server/resolve-comment-tool';

// Minimal invocation stub for handler calls
const invocationStub = {
    sessionId: 'session-1',
    toolCallId: 'call-1',
    toolName: 'resolve_comment',
    arguments: {},
};

describe('createResolveCommentTool', () => {
    it('returns a valid Tool shape', () => {
        const { tool } = createResolveCommentTool();

        expect(tool.name).toBe('resolve_comment');
        expect(typeof tool.handler).toBe('function');
        expect(tool.description).toBeDefined();
        expect(tool.parameters).toEqual({
            type: 'object',
            properties: {
                commentId: { type: 'string', description: expect.any(String) },
                summary: { type: 'string', description: expect.any(String) },
            },
            required: ['commentId', 'summary'],
        });
    });

    it('handler records resolved IDs', () => {
        const { tool, getResolvedIds } = createResolveCommentTool();

        const result = tool.handler({ commentId: 'c1', summary: 'fixed typo' }, invocationStub);

        expect(result).toEqual({ resolved: true, commentId: 'c1' });
        expect(getResolvedIds()).toEqual(['c1']);
    });

    it('multiple calls accumulate', () => {
        const { tool, getResolvedIds } = createResolveCommentTool();

        tool.handler({ commentId: 'c1', summary: 'fix 1' }, invocationStub);
        tool.handler({ commentId: 'c2', summary: 'fix 2' }, invocationStub);
        tool.handler({ commentId: 'c3', summary: 'fix 3' }, invocationStub);

        expect(getResolvedIds()).toEqual(['c1', 'c2', 'c3']);
    });

    it('duplicate calls deduplicate (Map semantics)', () => {
        const { tool, getResolvedIds, getResolutions } = createResolveCommentTool();

        tool.handler({ commentId: 'c1', summary: 'first attempt' }, invocationStub);
        tool.handler({ commentId: 'c1', summary: 'second attempt' }, invocationStub);

        expect(getResolvedIds()).toHaveLength(1);
        expect(getResolvedIds()).toEqual(['c1']);
        // The summary should be updated to the latest call
        expect(getResolutions().get('c1')).toBe('second attempt');
    });

    it('separate invocations are isolated', () => {
        const tool1 = createResolveCommentTool();
        const tool2 = createResolveCommentTool();

        tool1.tool.handler({ commentId: 'c1', summary: 'fix 1' }, invocationStub);

        expect(tool1.getResolvedIds()).toEqual(['c1']);
        expect(tool2.getResolvedIds()).toEqual([]);
    });

    it('getResolutions returns a Map of commentId → summary', () => {
        const { tool, getResolutions } = createResolveCommentTool();

        tool.handler({ commentId: 'c1', summary: 'fixed typo' }, invocationStub);
        tool.handler({ commentId: 'c2', summary: 'reworded section' }, invocationStub);

        const resolutions = getResolutions();
        expect(resolutions).toBeInstanceOf(Map);
        expect(resolutions.size).toBe(2);
        expect(resolutions.get('c1')).toBe('fixed typo');
        expect(resolutions.get('c2')).toBe('reworded section');
    });

    it('getResolutions returns a copy (mutations do not affect internal state)', () => {
        const { tool, getResolutions, getResolvedIds } = createResolveCommentTool();

        tool.handler({ commentId: 'c1', summary: 'fix' }, invocationStub);
        const copy = getResolutions();
        copy.delete('c1');

        // Original state should be unaffected
        expect(getResolvedIds()).toEqual(['c1']);
    });
});
