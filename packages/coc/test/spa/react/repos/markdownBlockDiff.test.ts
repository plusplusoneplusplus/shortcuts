/**
 * Tests for the block-level markdown diff behind the Rendered diff mode.
 */

import { describe, it, expect } from 'vitest';
import { diffMarkdownBlocks, splitMarkdownBlocks } from '../../../../src/server/spa/client/react/features/git/diff/markdownBlockDiff';

describe('splitMarkdownBlocks', () => {
    it('splits paragraphs, headings, list items, tables, and fenced code', () => {
        const md = [
            '# Title',
            'Intro line one',
            'intro line two',
            '',
            '- one',
            '  continued',
            '- two',
            '1. first',
            '',
            '| a | b |',
            '|---|---|',
            '| 1 | 2 |',
            '',
            '```ts',
            'const x = 1;',
            '',
            '# not a heading',
            '```',
            'After code',
        ].join('\r\n');
        expect(splitMarkdownBlocks(md)).toEqual([
            '# Title',
            'Intro line one\nintro line two',
            '- one\n  continued',
            '- two',
            '1. first',
            '| a | b |\n|---|---|\n| 1 | 2 |',
            '```ts\nconst x = 1;\n\n# not a heading\n```',
            'After code',
        ]);
    });

    it('keeps an unclosed fence as one block', () => {
        expect(splitMarkdownBlocks('text\n~~~\na\n\nb')).toEqual(['text', '~~~\na\n\nb']);
    });

    it('returns no blocks for empty text', () => {
        expect(splitMarkdownBlocks('')).toEqual([]);
    });
});

describe('diffMarkdownBlocks', () => {
    it('marks unchanged, added, and removed blocks', () => {
        expect(diffMarkdownBlocks('# A\n\nkeep\n\ngone', '# A\n\nkeep\n\nnew')).toEqual([
            { type: 'unchanged', text: '# A' },
            { type: 'unchanged', text: 'keep' },
            { type: 'removed', text: 'gone' },
            { type: 'added', text: 'new' },
        ]);
    });

    it('shows a changed block as removed base then added head', () => {
        expect(diffMarkdownBlocks('para one\n\nend', 'para 1\n\nend')).toEqual([
            { type: 'removed', text: 'para one' },
            { type: 'added', text: 'para 1' },
            { type: 'unchanged', text: 'end' },
        ]);
    });

    it('marks a single added list item', () => {
        expect(diffMarkdownBlocks('- a\n- c', '- a\n- b\n- c')).toEqual([
            { type: 'unchanged', text: '- a' },
            { type: 'added', text: '- b' },
            { type: 'unchanged', text: '- c' },
        ]);
    });

    it('treats every block of an added file as added', () => {
        expect(diffMarkdownBlocks('', '# New\n\nbody').map(b => b.type)).toEqual(['added', 'added']);
    });

    it('treats every block of a deleted file as removed, rendered from base', () => {
        expect(diffMarkdownBlocks('# Old\n\nbody', '')).toEqual([
            { type: 'removed', text: '# Old' },
            { type: 'removed', text: 'body' },
        ]);
    });

    it('ignores trailing whitespace and line-ending differences', () => {
        expect(diffMarkdownBlocks('a  \r\nb', 'a\nb').every(b => b.type === 'unchanged')).toBe(true);
    });
});
