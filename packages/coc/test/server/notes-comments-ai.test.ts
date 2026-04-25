import { describe, it, expect } from 'vitest';
import { buildNotesBatchResolvePrompt } from '../../src/server/notes-comments-ai';
import type { CommentThread, TextAnchor, Comment } from '../../src/server/notes-comments-types';

describe('buildNotesBatchResolvePrompt', () => {
    const createComment = (id: string, content: string, createdAt: string): Comment => ({
        id,
        content,
        createdAt,
    });

    const createAnchor = (quotedText: string, prefix = '', suffix = ''): TextAnchor => ({
        quotedText,
        prefix,
        suffix,
    });

    const createThread = (
        id: string,
        status: 'open' | 'resolved',
        quotedText: string,
        comments: Comment[],
        createdAt: string,
    ): CommentThread => ({
        id,
        status,
        createdAt,
        anchor: createAnchor(quotedText),
        comments,
    });

    it('includes only open threads', () => {
        const threads: CommentThread[] = [
            createThread(
                'thread-1',
                'open',
                'Open comment text',
                [createComment('c1', 'This is open', '2024-01-01T10:00:00Z')],
                '2024-01-01T10:00:00Z',
            ),
            createThread(
                'thread-2',
                'resolved',
                'Resolved comment text',
                [createComment('c2', 'This is resolved', '2024-01-01T11:00:00Z')],
                '2024-01-01T11:00:00Z',
            ),
        ];

        const prompt = buildNotesBatchResolvePrompt(threads, 'test.md', 'Document content');

        expect(prompt).toContain('Open comment text');
        expect(prompt).not.toContain('Resolved comment text');
    });

    it('formats anchor text correctly', () => {
        const threads: CommentThread[] = [
            {
                id: 'thread-1',
                status: 'open',
                createdAt: '2024-01-01T10:00:00Z',
                anchor: {
                    quotedText: 'The key insight',
                    prefix: 'This is ',
                    suffix: ' for the project',
                },
                comments: [createComment('c1', 'Fix this', '2024-01-01T10:00:00Z')],
            },
        ];

        const prompt = buildNotesBatchResolvePrompt(threads, 'test.md', 'Document content');

        expect(prompt).toContain('The key insight');
        expect(prompt).toContain('**Context before:** …This is');
        expect(prompt).toContain('**Context after:**  for the project…');
    });

    it('includes first comment content', () => {
        const threads: CommentThread[] = [
            createThread(
                'thread-1',
                'open',
                'quoted text',
                [createComment('c1', 'First comment with important feedback', '2024-01-01T10:00:00Z')],
                '2024-01-01T10:00:00Z',
            ),
        ];

        const prompt = buildNotesBatchResolvePrompt(threads, 'test.md', 'Document content');

        expect(prompt).toContain('First comment with important feedback');
    });

    it('includes follow-up replies', () => {
        const threads: CommentThread[] = [
            {
                id: 'thread-1',
                status: 'open',
                createdAt: '2024-01-01T10:00:00Z',
                anchor: createAnchor('quoted text'),
                comments: [
                    createComment('c1', 'Initial comment', '2024-01-01T10:00:00Z'),
                    createComment('c2', 'Follow-up reply', '2024-01-01T11:00:00Z'),
                    createComment('c3', 'Another reply', '2024-01-01T12:00:00Z'),
                ],
            },
        ];

        const prompt = buildNotesBatchResolvePrompt(threads, 'test.md', 'Document content');

        expect(prompt).toContain('Initial comment');
        expect(prompt).toContain('Replies:');
        expect(prompt).toContain('> Follow-up reply');
        expect(prompt).toContain('> Another reply');
    });

    it('includes document content', () => {
        const documentContent = '# My Note\n\nThis is the document content with multiple lines.\n\nEnd of document.';
        const threads: CommentThread[] = [];

        const prompt = buildNotesBatchResolvePrompt(threads, 'test.md', documentContent);

        expect(prompt).toContain('### Current Document Content');
        expect(prompt).toContain('```markdown');
        expect(prompt).toContain('# My Note');
        expect(prompt).toContain('This is the document content with multiple lines.');
    });

    it('includes user context when provided', () => {
        const threads: CommentThread[] = [];
        const userContext = 'Please focus on clarity and conciseness.';

        const prompt = buildNotesBatchResolvePrompt(
            threads,
            'test.md',
            'Document content',
            userContext,
        );

        expect(prompt).toContain('## Additional Context from User');
        expect(prompt).toContain('Please focus on clarity and conciseness.');
    });

    it('omits user context when not provided', () => {
        const threads: CommentThread[] = [];

        const prompt = buildNotesBatchResolvePrompt(threads, 'test.md', 'Document content');

        expect(prompt).not.toContain('## Additional Context from User');
    });

    it('omits user context when empty string', () => {
        const threads: CommentThread[] = [];

        const prompt = buildNotesBatchResolvePrompt(threads, 'test.md', 'Document content', '   ');

        expect(prompt).not.toContain('## Additional Context from User');
    });

    it('returns structured prompt with instructions', () => {
        const threads: CommentThread[] = [];

        const prompt = buildNotesBatchResolvePrompt(threads, 'test.md', 'Document content');

        expect(prompt).toContain('# Document Revision Request');
        expect(prompt).toContain('Please review and address the following comments in this note.');
        expect(prompt).toContain('# Instructions');
        expect(prompt).toContain('For each comment above, modify the corresponding section in the document');
        expect(prompt).toContain('resolve_comment');
        expect(prompt).toContain('Preserve the overall document structure and formatting');
    });

    it('handles empty threads array', () => {
        const threads: CommentThread[] = [];

        const prompt = buildNotesBatchResolvePrompt(threads, 'test.md', 'Document content');

        expect(prompt).toContain('# Document Revision Request');
        expect(prompt).toContain('### Current Document Content');
        expect(prompt).toContain('# Instructions');
        // Should not have comment sections
        expect(prompt).not.toContain('### Comment 1');
    });

    it('sorts threads by createdAt', () => {
        const threads: CommentThread[] = [
            createThread(
                'thread-3',
                'open',
                'Third comment',
                [createComment('c3', 'Latest', '2024-01-03T10:00:00Z')],
                '2024-01-03T10:00:00Z',
            ),
            createThread(
                'thread-1',
                'open',
                'First comment',
                [createComment('c1', 'Earliest', '2024-01-01T10:00:00Z')],
                '2024-01-01T10:00:00Z',
            ),
            createThread(
                'thread-2',
                'open',
                'Second comment',
                [createComment('c2', 'Middle', '2024-01-02T10:00:00Z')],
                '2024-01-02T10:00:00Z',
            ),
        ];

        const prompt = buildNotesBatchResolvePrompt(threads, 'test.md', 'Document content');

        // Find indices of comments in prompt
        const firstIdx = prompt.indexOf('First comment');
        const secondIdx = prompt.indexOf('Second comment');
        const thirdIdx = prompt.indexOf('Third comment');

        expect(firstIdx).toBeLessThan(secondIdx);
        expect(secondIdx).toBeLessThan(thirdIdx);
    });

    it('includes file path in prompt', () => {
        const threads: CommentThread[] = [];
        const notePath = 'docs/my-feature.md';

        const prompt = buildNotesBatchResolvePrompt(threads, notePath, 'Document content');

        expect(prompt).toContain(`## File: ${notePath}`);
    });

    it('includes thread ID in comment blocks', () => {
        const threads: CommentThread[] = [
            createThread(
                'unique-thread-id-123',
                'open',
                'quoted text',
                [createComment('c1', 'Comment text', '2024-01-01T10:00:00Z')],
                '2024-01-01T10:00:00Z',
            ),
        ];

        const prompt = buildNotesBatchResolvePrompt(threads, 'test.md', 'Document content');

        expect(prompt).toContain('**Thread ID:** `unique-thread-id-123`');
    });

    it('handles anchor with only quotedText', () => {
        const threads: CommentThread[] = [
            {
                id: 'thread-1',
                status: 'open',
                createdAt: '2024-01-01T10:00:00Z',
                anchor: {
                    quotedText: 'Just the quoted text',
                    prefix: '',
                    suffix: '',
                },
                comments: [createComment('c1', 'Comment', '2024-01-01T10:00:00Z')],
            },
        ];

        const prompt = buildNotesBatchResolvePrompt(threads, 'test.md', 'Document content');

        expect(prompt).toContain('Just the quoted text');
        expect(prompt).not.toContain('Context before:');
        expect(prompt).not.toContain('Context after:');
    });

    it('filters empty replies in follow-ups', () => {
        const threads: CommentThread[] = [
            {
                id: 'thread-1',
                status: 'open',
                createdAt: '2024-01-01T10:00:00Z',
                anchor: createAnchor('quoted text'),
                comments: [
                    createComment('c1', 'Initial comment', '2024-01-01T10:00:00Z'),
                    createComment('c2', '', '2024-01-01T11:00:00Z'),
                    createComment('c3', '   ', '2024-01-01T12:00:00Z'),
                    createComment('c4', 'Valid reply', '2024-01-01T13:00:00Z'),
                ],
            },
        ];

        const prompt = buildNotesBatchResolvePrompt(threads, 'test.md', 'Document content');

        expect(prompt).toContain('Initial comment');
        expect(prompt).toContain('Replies:');
        expect(prompt).toContain('> Valid reply');
        // Should not have quotes for empty replies
        const replySection = prompt.split('**Replies:**')[1];
        const replyLines = replySection.split('\n').filter(line => line.trim().startsWith('>'));
        expect(replyLines.length).toBe(1);
    });

    it('numbers comments correctly with multiple threads', () => {
        const threads: CommentThread[] = [
            createThread(
                'thread-1',
                'open',
                'First',
                [createComment('c1', 'Comment 1', '2024-01-01T10:00:00Z')],
                '2024-01-01T10:00:00Z',
            ),
            createThread(
                'thread-2',
                'open',
                'Second',
                [createComment('c2', 'Comment 2', '2024-01-01T11:00:00Z')],
                '2024-01-01T11:00:00Z',
            ),
            createThread(
                'thread-3',
                'open',
                'Third',
                [createComment('c3', 'Comment 3', '2024-01-01T12:00:00Z')],
                '2024-01-01T12:00:00Z',
            ),
        ];

        const prompt = buildNotesBatchResolvePrompt(threads, 'test.md', 'Document content');

        expect(prompt).toContain('### Comment 1');
        expect(prompt).toContain('### Comment 2');
        expect(prompt).toContain('### Comment 3');
    });
});
