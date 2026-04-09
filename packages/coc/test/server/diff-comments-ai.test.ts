import { describe, it, expect } from 'vitest';
import {
    buildMultiFileBatchResolvePrompt,
    renderCommentBlock,
    buildDiffEnrichedPrompt,
    buildDiffAIPrompt,
    DEFAULT_AI_COMMANDS,
} from '../../src/server/diff-comments-ai';
import type { DiffComment } from '@plusplusoneplusplus/forge';

function makeDiffComment(overrides: Partial<DiffComment> = {}): DiffComment {
    return {
        id: 'c1',
        context: {
            repositoryId: 'repo1',
            filePath: 'src/app.ts',
            oldRef: 'abc123^',
            newRef: 'abc123',
        },
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
        comment: 'This should be a let',
        status: 'open',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        ...overrides,
    } as DiffComment;
}

describe('renderCommentBlock', () => {
    it('renders basic comment fields', () => {
        const comment = makeDiffComment({ id: 'c10', selectedText: 'let x', comment: 'Use const' });
        const block = renderCommentBlock(comment, 0);

        expect(block).toContain('### Comment 1');
        expect(block).toContain('`c10`');
        expect(block).toContain('"let x"');
        expect(block).toContain('"Use const"');
    });

    it('includes diff line number when present', () => {
        const comment = makeDiffComment({ selection: { diffLineStart: 42, diffLineEnd: 44, side: 'right', oldLineStart: 0, oldLineEnd: 0, newLineStart: 0, newLineEnd: 0, startColumn: 0, endColumn: 0 } as DiffComment['selection'] });
        const block = renderCommentBlock(comment, 2);

        expect(block).toContain('### Comment 3 (Diff line 42)');
    });

    it('includes author, tags, aiResponse, and replies', () => {
        const comment = makeDiffComment({
            author: 'alice',
            tags: ['bug', 'p1'],
            aiResponse: 'Looks fine',
            replies: [{ text: 'Thanks', author: 'bob', createdAt: '2024-01-01' }],
        });
        const block = renderCommentBlock(comment, 0);

        expect(block).toContain('**Author**: alice');
        expect(block).toContain('bug, p1');
        expect(block).toContain('Looks fine');
        expect(block).toContain('bob: Thanks');
    });
});

describe('buildMultiFileBatchResolvePrompt', () => {
    it('generates prompt with multiple files', () => {
        const entries = [
            {
                filePath: 'src/a.ts',
                comments: [makeDiffComment({ id: 'a1', comment: 'Fix A' })],
            },
            {
                filePath: 'src/b.ts',
                comments: [makeDiffComment({ id: 'b1', comment: 'Fix B' })],
            },
        ];
        const result = buildMultiFileBatchResolvePrompt(entries, 'abc^', 'abc');

        expect(result).toContain('### File 1: `src/a.ts`');
        expect(result).toContain('### File 2: `src/b.ts`');
        expect(result).toContain('`a1`');
        expect(result).toContain('`b1`');
    });

    it('generates prompt with single file', () => {
        const entries = [
            {
                filePath: 'src/only.ts',
                comments: [makeDiffComment({ id: 'o1' })],
            },
        ];
        const result = buildMultiFileBatchResolvePrompt(entries, 'ref1', 'ref2');

        expect(result).toContain('### File 1: `src/only.ts`');
        expect(result).toContain('`o1`');
        expect(result).not.toContain('### File 2');
    });

    it('filters to open comments only', () => {
        const entries = [
            {
                filePath: 'src/x.ts',
                comments: [
                    makeDiffComment({ id: 'open1', status: 'open' }),
                    makeDiffComment({ id: 'resolved1', status: 'resolved' }),
                ],
            },
        ];
        const result = buildMultiFileBatchResolvePrompt(entries, 'a', 'b');

        expect(result).toContain('`open1`');
        expect(result).not.toContain('`resolved1`');
    });

    it('returns empty string when no open comments', () => {
        const entries = [
            {
                filePath: 'src/x.ts',
                comments: [makeDiffComment({ id: 'r1', status: 'resolved' })],
            },
        ];
        const result = buildMultiFileBatchResolvePrompt(entries, 'a', 'b');
        expect(result).toBe('');
    });

    it('includes oldRef/newRef in prompt', () => {
        const entries = [
            {
                filePath: 'src/x.ts',
                comments: [makeDiffComment()],
            },
        ];
        const result = buildMultiFileBatchResolvePrompt(entries, 'deadbeef^', 'deadbeef');

        expect(result).toContain('`deadbeef^`');
        expect(result).toContain('`deadbeef`');
        expect(result).toContain('deadbeef^` to `deadbeef`');
    });

    it('does NOT include diff content', () => {
        const entries = [
            {
                filePath: 'src/x.ts',
                comments: [makeDiffComment()],
            },
        ];
        const result = buildMultiFileBatchResolvePrompt(entries, 'a', 'b');

        expect(result).not.toContain('```diff');
        expect(result).not.toContain('Diff Content');
    });

    it('includes cross-file instruction', () => {
        const entries = [
            {
                filePath: 'src/x.ts',
                comments: [makeDiffComment()],
            },
        ];
        const result = buildMultiFileBatchResolvePrompt(entries, 'a', 'b');

        expect(result).toContain('cross-file relationships');
        expect(result).toContain('resolve_comment(commentId, summary)');
    });

    it('skips files with only resolved comments', () => {
        const entries = [
            {
                filePath: 'src/all-resolved.ts',
                comments: [makeDiffComment({ id: 'r1', status: 'resolved' })],
            },
            {
                filePath: 'src/has-open.ts',
                comments: [makeDiffComment({ id: 'o1', status: 'open' })],
            },
        ];
        const result = buildMultiFileBatchResolvePrompt(entries, 'a', 'b');

        expect(result).not.toContain('all-resolved.ts');
        expect(result).toContain('has-open.ts');
        expect(result).toContain('### File 1: `src/has-open.ts`');
    });

    it('appends userContext when provided', () => {
        const entries = [
            {
                filePath: 'src/a.ts',
                comments: [makeDiffComment({ id: 'a1' })],
            },
        ];
        const result = buildMultiFileBatchResolvePrompt(entries, 'a', 'b', 'Use the error handling pattern');
        expect(result).toContain('## Additional Context from User');
        expect(result).toContain('Use the error handling pattern');
    });

    it('does not include user context section when userContext is empty', () => {
        const entries = [
            {
                filePath: 'src/a.ts',
                comments: [makeDiffComment({ id: 'a1' })],
            },
        ];
        const result = buildMultiFileBatchResolvePrompt(entries, 'a', 'b', '');
        expect(result).not.toContain('Additional Context from User');
    });

    it('does not include user context section when userContext is undefined', () => {
        const entries = [
            {
                filePath: 'src/a.ts',
                comments: [makeDiffComment({ id: 'a1' })],
            },
        ];
        const result = buildMultiFileBatchResolvePrompt(entries, 'a', 'b');
        expect(result).not.toContain('Additional Context from User');
    });
});

describe('buildDiffEnrichedPrompt', () => {
    const clarifyCmd = DEFAULT_AI_COMMANDS.find(c => c.id === 'clarify')!;
    const customCmd = DEFAULT_AI_COMMANDS.find(c => c.id === 'custom')!;

    it('uses command.prompt as template when command.isCustomInput is falsy', () => {
        const comment = makeDiffComment();
        const result = buildDiffEnrichedPrompt(clarifyCmd, comment, undefined);
        expect(result).toContain('clarify the following snippet');
    });

    it('uses command.prompt when isCustomInput is true but customQuestion is undefined', () => {
        const comment = makeDiffComment();
        const result = buildDiffEnrichedPrompt(customCmd, comment, undefined);
        expect(result).toContain(customCmd.prompt);
    });

    it('uses command.prompt when isCustomInput is true but customQuestion is empty string', () => {
        const comment = makeDiffComment();
        const result = buildDiffEnrichedPrompt(customCmd, comment, '');
        expect(result).toContain(customCmd.prompt);
    });

    it('uses customQuestion as template when isCustomInput is true and customQuestion is non-empty', () => {
        const comment = makeDiffComment();
        const result = buildDiffEnrichedPrompt(customCmd, comment, 'What does this function return?');
        expect(result).toContain('What does this function return?');
        expect(result).not.toContain(customCmd.prompt);
    });

    it('always contains diff context suffix', () => {
        const comment = makeDiffComment();
        const result = buildDiffEnrichedPrompt(clarifyCmd, comment, undefined);
        expect(result).toContain('Diff context: src/app.ts (abc123^ → abc123)');
    });

    it('contains user comment line when comment.comment is non-empty', () => {
        const comment = makeDiffComment({ comment: 'This should be a let' });
        const result = buildDiffEnrichedPrompt(clarifyCmd, comment, undefined);
        expect(result).toContain('User comment: "This should be a let"');
    });

    it('does not contain user comment line when comment.comment is empty string', () => {
        const comment = makeDiffComment({ comment: '' });
        const result = buildDiffEnrichedPrompt(clarifyCmd, comment, undefined);
        expect(result).not.toContain('User comment:');
    });

    it('does not contain user comment line when comment.comment is undefined', () => {
        const comment = makeDiffComment({ comment: undefined });
        const result = buildDiffEnrichedPrompt(clarifyCmd, comment, undefined);
        expect(result).not.toContain('User comment:');
    });

    it('includes selectedText and filePath from buildPromptFromContext', () => {
        const comment = makeDiffComment({ selectedText: 'const x = 1;' });
        const result = buildDiffEnrichedPrompt(clarifyCmd, comment, undefined);
        expect(result).toContain('"const x = 1;"');
        expect(result).toContain('in the file src/app.ts');
    });
});

describe('buildDiffAIPrompt', () => {
    it('starts with the fixed context header', () => {
        const comment = makeDiffComment();
        const result = buildDiffAIPrompt(comment, 'Why?');
        expect(result).toContain('Context: The user is reviewing a git diff.');
    });

    it('contains the file path', () => {
        const comment = makeDiffComment();
        const result = buildDiffAIPrompt(comment, 'Why?');
        expect(result).toContain('File: src/app.ts');
    });

    it('contains the diff range', () => {
        const comment = makeDiffComment();
        const result = buildDiffAIPrompt(comment, 'Why?');
        expect(result).toContain('Diff range: abc123^ → abc123');
    });

    it('includes selected-text block when selectedText is present', () => {
        const comment = makeDiffComment({ selectedText: 'const x = 1;' });
        const result = buildDiffAIPrompt(comment, 'Explain');
        expect(result).toContain('They selected the following text from the diff:\n---\nconst x = 1;\n---');
    });

    it('omits selected-text block when selectedText is undefined', () => {
        const comment = makeDiffComment({ selectedText: undefined });
        const result = buildDiffAIPrompt(comment, 'Explain');
        expect(result).not.toContain('They selected the following text from the diff:');
    });

    it('omits selected-text block when selectedText is empty string', () => {
        const comment = makeDiffComment({ selectedText: '' });
        const result = buildDiffAIPrompt(comment, 'Explain');
        expect(result).not.toContain('They selected the following text from the diff:');
    });

    it('includes comment block when comment.comment is present', () => {
        const comment = makeDiffComment({ comment: 'This should be a let' });
        const result = buildDiffAIPrompt(comment, 'Explain');
        expect(result).toContain('Their comment says: "This should be a let"');
    });

    it('omits comment block when comment.comment is undefined', () => {
        const comment = makeDiffComment({ comment: undefined });
        const result = buildDiffAIPrompt(comment, 'Explain');
        expect(result).not.toContain('Their comment says:');
    });

    it('omits comment block when comment.comment is empty string', () => {
        const comment = makeDiffComment({ comment: '' });
        const result = buildDiffAIPrompt(comment, 'Explain');
        expect(result).not.toContain('Their comment says:');
    });

    it('ends with question and actionable response instruction', () => {
        const comment = makeDiffComment();
        const result = buildDiffAIPrompt(comment, 'Is this correct?');
        expect(result).toContain('Question: Is this correct?\n\nProvide a clear, actionable response.');
    });

    it('includes both selected-text and comment blocks when both are set', () => {
        const comment = makeDiffComment({ selectedText: 'let y = 2;', comment: 'Use const' });
        const result = buildDiffAIPrompt(comment, 'Fix it');
        expect(result).toContain('They selected the following text from the diff:\n---\nlet y = 2;\n---');
        expect(result).toContain('Their comment says: "Use const"');
    });

    it('omits both blocks when both fields are unset', () => {
        const comment = makeDiffComment({ selectedText: undefined, comment: undefined });
        const result = buildDiffAIPrompt(comment, 'Summarize');
        expect(result).not.toContain('They selected the following text from the diff:');
        expect(result).not.toContain('Their comment says:');
    });
});
