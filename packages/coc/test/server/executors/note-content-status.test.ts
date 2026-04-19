/**
 * Tests for note-chat-executor transparency types and helpers.
 *
 * Covers:
 * - resolveNoteContentStatus for all status variants
 * - buildNoteContextBlock truncation with NOTE_CONTENT_CHAR_LIMIT
 * - NOTE_CONTENT_CHAR_LIMIT constant value
 */

import { describe, it, expect } from 'vitest';
import {
    NOTE_CONTENT_CHAR_LIMIT,
    resolveNoteContentStatus,
    buildNoteContextBlock,
} from '../../../src/server/executors/note-chat-executor';

describe('NOTE_CONTENT_CHAR_LIMIT', () => {
    it('is 8000', () => {
        expect(NOTE_CONTENT_CHAR_LIMIT).toBe(8000);
    });
});

describe('resolveNoteContentStatus', () => {
    it('returns not-found when content is undefined', () => {
        const result = resolveNoteContentStatus(undefined);
        expect(result).toEqual({
            status: 'not-found',
            charLimit: 8000,
        });
    });

    it('returns empty when content is empty string', () => {
        const result = resolveNoteContentStatus('');
        expect(result).toEqual({
            status: 'empty',
            charLimit: 8000,
            originalLength: 0,
        });
    });

    it('returns attached when content is within limit', () => {
        const content = 'Hello world';
        const result = resolveNoteContentStatus(content);
        expect(result).toEqual({
            status: 'attached',
            charLimit: 8000,
            originalLength: content.length,
        });
    });

    it('returns attached at exactly the limit', () => {
        const content = 'x'.repeat(8000);
        const result = resolveNoteContentStatus(content);
        expect(result).toEqual({
            status: 'attached',
            charLimit: 8000,
            originalLength: 8000,
        });
    });

    it('returns truncated when content exceeds limit', () => {
        const content = 'x'.repeat(8001);
        const result = resolveNoteContentStatus(content);
        expect(result).toEqual({
            status: 'truncated',
            charLimit: 8000,
            originalLength: 8001,
        });
    });

    it('returns truncated with correct originalLength for large content', () => {
        const content = 'x'.repeat(50000);
        const result = resolveNoteContentStatus(content);
        expect(result.status).toBe('truncated');
        expect(result.originalLength).toBe(50000);
    });
});

describe('buildNoteContextBlock', () => {
    it('includes title and path in the block', () => {
        const block = buildNoteContextBlock('notes/test.md', 'Test Note', 'Some content');
        expect(block).toContain('Title: Test Note');
        expect(block).toContain('Path: notes/test.md');
    });

    it('includes full content when within limit', () => {
        const content = 'Hello, this is the note content.';
        const block = buildNoteContextBlock('a.md', 'A', content);
        expect(block).toContain(content);
        expect(block).not.toContain('(content truncated)');
    });

    it('truncates content exceeding the limit', () => {
        const content = 'x'.repeat(9000);
        const block = buildNoteContextBlock('a.md', 'A', content);
        expect(block).toContain('(content truncated)');
        // The truncated block should contain exactly NOTE_CONTENT_CHAR_LIMIT chars of content
        const contentInBlock = block.split('\n\n').slice(1).join('\n\n');
        expect(contentInBlock).toContain('x'.repeat(8000));
    });

    it('wraps content in <note_context> tags', () => {
        const block = buildNoteContextBlock('a.md', 'A', 'body');
        expect(block).toContain('<note_context>');
        expect(block).toContain('</note_context>');
    });

    it('does not truncate at exactly the limit', () => {
        const content = 'x'.repeat(8000);
        const block = buildNoteContextBlock('a.md', 'A', content);
        expect(block).not.toContain('(content truncated)');
    });
});
