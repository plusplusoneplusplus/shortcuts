/**
 * Tests for task-comments-ai.ts prompt builders.
 */

import { describe, it, expect } from 'vitest';
import { buildBatchResolvePrompt } from '../../src/server/task-comments-ai';
import type { TaskComment } from '../../src/server/task-comments-manager';

function makeComment(overrides: Partial<TaskComment> = {}): TaskComment {
    return {
        id: 'c1',
        filePath: 'docs/readme.md',
        selection: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 20 },
        selectedText: 'Some text',
        comment: 'Fix this',
        status: 'open',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        replies: [],
        ...overrides,
    } as TaskComment;
}

describe('buildBatchResolvePrompt', () => {
    it('builds a prompt with open comments', () => {
        const comments = [makeComment({ id: 'c1', comment: 'Fix this typo' })];
        const result = buildBatchResolvePrompt(comments, '/abs/docs/readme.md', 'docs/readme.md');
        expect(result).toContain('Document Revision Request');
        expect(result).toContain('docs/readme.md');
        expect(result).toContain('Fix this typo');
        expect(result).toContain('`c1`');
    });

    it('filters out resolved comments', () => {
        const comments = [
            makeComment({ id: 'c1', status: 'open' }),
            makeComment({ id: 'c2', status: 'resolved' }),
        ];
        const result = buildBatchResolvePrompt(comments, '/abs/file.md', 'file.md');
        expect(result).toContain('`c1`');
        expect(result).not.toContain('`c2`');
    });

    it('appends userContext when provided', () => {
        const comments = [makeComment()];
        const result = buildBatchResolvePrompt(comments, '/abs/file.md', 'file.md', 'Preserve backward compatibility');
        expect(result).toContain('## Additional Context from User');
        expect(result).toContain('Preserve backward compatibility');
    });

    it('does not include user context section when userContext is empty', () => {
        const comments = [makeComment()];
        const result = buildBatchResolvePrompt(comments, '/abs/file.md', 'file.md', '');
        expect(result).not.toContain('Additional Context from User');
    });

    it('does not include user context section when userContext is undefined', () => {
        const comments = [makeComment()];
        const result = buildBatchResolvePrompt(comments, '/abs/file.md', 'file.md');
        expect(result).not.toContain('Additional Context from User');
    });

    it('trims whitespace-only userContext', () => {
        const comments = [makeComment()];
        const result = buildBatchResolvePrompt(comments, '/abs/file.md', 'file.md', '   ');
        expect(result).not.toContain('Additional Context from User');
    });

    it('includes resolve_comment tool instruction', () => {
        const comments = [makeComment()];
        const result = buildBatchResolvePrompt(comments, '/abs/file.md', 'file.md');
        expect(result).toContain('resolve_comment');
    });

    it('embeds document content when documentContent is provided', () => {
        const comments = [makeComment({ id: 'c1', comment: 'Rewrite intro' })];
        const docContent = '# Plan\n\n## Objective\nDo something great\n\n## Steps\n- Step 1\n- Step 2';
        const result = buildBatchResolvePrompt(comments, '__wi-plan__/abc', '__wi-plan__/abc', undefined, docContent);
        expect(result).toContain('### Current Document Content');
        expect(result).toContain(docContent);
        expect(result).not.toContain('Read it using your tools');
    });

    it('falls back to read-from-disk instruction when documentContent is not provided', () => {
        const comments = [makeComment()];
        const result = buildBatchResolvePrompt(comments, '/abs/file.md', 'file.md');
        expect(result).toContain('Read it using your tools');
        expect(result).not.toContain('### Current Document Content');
    });

    it('falls back to read-from-disk instruction when documentContent is empty string', () => {
        const comments = [makeComment()];
        const result = buildBatchResolvePrompt(comments, '/abs/file.md', 'file.md', undefined, '');
        expect(result).toContain('Read it using your tools');
        expect(result).not.toContain('### Current Document Content');
    });

    it('userContext comes after instructions', () => {
        const comments = [makeComment()];
        const result = buildBatchResolvePrompt(comments, '/abs/file.md', 'file.md', 'My extra context');
        const instructionsIdx = result.indexOf('# Instructions');
        const contextIdx = result.indexOf('## Additional Context from User');
        expect(instructionsIdx).toBeGreaterThan(-1);
        expect(contextIdx).toBeGreaterThan(instructionsIdx);
    });
});
