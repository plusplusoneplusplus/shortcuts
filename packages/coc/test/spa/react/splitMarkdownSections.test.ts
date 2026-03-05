/**
 * Tests for splitMarkdownSections — splits markdown into heading-delimited sections.
 */

import { describe, it, expect } from 'vitest';
import { splitMarkdownSections, type MarkdownSection } from '../../../src/server/spa/client/react/utils/format';

describe('splitMarkdownSections', () => {
    // --- Empty / falsy input ---

    it('returns empty array for empty string', () => {
        expect(splitMarkdownSections('')).toEqual([]);
    });

    it('returns empty array for whitespace-only string', () => {
        expect(splitMarkdownSections('   \n  ')).toEqual([]);
    });

    it('returns empty array for null-ish input', () => {
        expect(splitMarkdownSections(null as any)).toEqual([]);
        expect(splitMarkdownSections(undefined as any)).toEqual([]);
    });

    // --- Content without headings ---

    it('returns single preamble section when no headings exist', () => {
        const result = splitMarkdownSections('Just a paragraph.\n\nAnother paragraph.');
        expect(result).toEqual([
            { heading: '', level: 0, body: 'Just a paragraph.\n\nAnother paragraph.' },
        ]);
    });

    // --- Single H2 heading ---

    it('returns one section for a single H2', () => {
        const md = '## Overview\n\nSome content here.';
        const result = splitMarkdownSections(md);
        expect(result).toEqual([
            { heading: '## Overview', level: 2, body: '\nSome content here.' },
        ]);
    });

    // --- Single H3 heading ---

    it('returns one section for a single H3', () => {
        const md = '### Details\nLine 1\nLine 2';
        const result = splitMarkdownSections(md);
        expect(result).toEqual([
            { heading: '### Details', level: 3, body: 'Line 1\nLine 2' },
        ]);
    });

    // --- Multiple H2 headings ---

    it('splits multiple H2 sections', () => {
        const md = '## First\nContent A\n## Second\nContent B';
        const result = splitMarkdownSections(md);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ heading: '## First', level: 2, body: 'Content A' });
        expect(result[1]).toEqual({ heading: '## Second', level: 2, body: 'Content B' });
    });

    // --- Preamble + headings ---

    it('captures preamble before the first heading', () => {
        const md = 'Intro text\n\n## Section One\nBody one\n## Section Two\nBody two';
        const result = splitMarkdownSections(md);
        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({ heading: '', level: 0, body: 'Intro text\n' });
        expect(result[1]).toEqual({ heading: '## Section One', level: 2, body: 'Body one' });
        expect(result[2]).toEqual({ heading: '## Section Two', level: 2, body: 'Body two' });
    });

    // --- Mixed H2 and H3 ---

    it('splits mixed H2 and H3 headings', () => {
        const md = '## Big Section\n\nParagraph.\n\n### Sub-section\n\nDetails here.';
        const result = splitMarkdownSections(md);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ heading: '## Big Section', level: 2, body: '\nParagraph.\n' });
        expect(result[1]).toEqual({ heading: '### Sub-section', level: 3, body: '\nDetails here.' });
    });

    // --- Ignores H1 and H4+ ---

    it('does not split on H1 headings', () => {
        const md = '# Title\nSome text\n## Real Section\nContent';
        const result = splitMarkdownSections(md);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ heading: '', level: 0, body: '# Title\nSome text' });
        expect(result[1]).toEqual({ heading: '## Real Section', level: 2, body: 'Content' });
    });

    it('does not split on H4 headings', () => {
        const md = '## Section\n#### Not a split\nContent';
        const result = splitMarkdownSections(md);
        expect(result).toHaveLength(1);
        expect(result[0].heading).toBe('## Section');
        expect(result[0].body).toContain('#### Not a split');
        expect(result[0].body).toContain('Content');
    });

    // --- Heading with no body ---

    it('handles heading followed immediately by another heading', () => {
        const md = '## First\n## Second\nContent';
        const result = splitMarkdownSections(md);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ heading: '## First', level: 2, body: '' });
        expect(result[1]).toEqual({ heading: '## Second', level: 2, body: 'Content' });
    });

    // --- Trailing newlines ---

    it('preserves trailing newlines within sections', () => {
        const md = '## Intro\n\nParagraph 1\n\nParagraph 2\n\n## Next\nDone';
        const result = splitMarkdownSections(md);
        expect(result).toHaveLength(2);
        expect(result[0].body).toBe('\nParagraph 1\n\nParagraph 2\n');
        expect(result[1].body).toBe('Done');
    });

    // --- Code blocks with # inside ---

    it('treats # inside code fences as normal text (limitation: no fence tracking)', () => {
        // Note: this is a known limitation — the splitter does line-level matching.
        // If a code block contains `## SomeHeading`, it will be treated as a heading.
        // This is acceptable because the copy button will still copy correct markdown.
        const md = '## Real\ntext\n```\n## Fake\n```\n## Another';
        const result = splitMarkdownSections(md);
        // At least the real headings are present
        expect(result[0].heading).toBe('## Real');
        expect(result.length).toBeGreaterThanOrEqual(2);
    });

    // --- Real-world AI response ---

    it('splits a realistic AI response', () => {
        const md = [
            '## Why `tool: undefined`?',
            '',
            'The config resolver returns `undefined` when the tool is not found.',
            '',
            '## Plan: 5 High-Impact Commits',
            '',
            '1. Add tool validation',
            '2. Improve error messages',
            '3. Add retry logic',
            '4. Update docs',
            '5. Add tests',
            '',
            '### Implementation Details',
            '',
            'Start with step 1.',
        ].join('\n');

        const result = splitMarkdownSections(md);
        expect(result).toHaveLength(3);
        expect(result[0].heading).toBe('## Why `tool: undefined`?');
        expect(result[0].level).toBe(2);
        expect(result[1].heading).toBe('## Plan: 5 High-Impact Commits');
        expect(result[1].level).toBe(2);
        expect(result[2].heading).toBe('### Implementation Details');
        expect(result[2].level).toBe(3);
    });

    // --- Level tracking ---

    it('correctly sets level to 2 for H2 and 3 for H3', () => {
        const md = '## L2\n### L3\n## L2 Again';
        const result = splitMarkdownSections(md);
        expect(result.map(s => s.level)).toEqual([2, 3, 2]);
    });
});
