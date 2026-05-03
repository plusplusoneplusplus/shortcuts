import { describe, expect, it } from 'vitest';
import {
    composeMarkdownWithFrontMatter,
    getFrontMatterFieldCount,
    parseNoteFrontMatter,
} from '../../../../src/server/spa/client/react/features/notes/editor/noteFrontMatter';

describe('noteFrontMatter', () => {
    it('parses valid top-of-file YAML front matter and separates the body', () => {
        const result = parseNoteFrontMatter([
            '---',
            'title: Batch selection notes',
            'tags:',
            '  - pull-requests',
            '  - ui',
            'reviewed: true',
            'related:',
            '  issue: 123',
            '  area: notes',
            '---',
            '',
            '# Body',
        ].join('\n'));

        expect(result.kind).toBe('valid');
        if (result.kind !== 'valid') throw new Error('expected valid front matter');
        expect(result.frontMatter.raw).toBe([
            '---',
            'title: Batch selection notes',
            'tags:',
            '  - pull-requests',
            '  - ui',
            'reviewed: true',
            'related:',
            '  issue: 123',
            '  area: notes',
            '---',
        ].join('\n'));
        expect(result.frontMatter.body).toBe('# Body');
        expect(result.frontMatter.data.title).toBe('Batch selection notes');
        expect(result.frontMatter.data.reviewed).toBe(true);
        expect(getFrontMatterFieldCount(result.frontMatter)).toBe(4);
    });

    it('preserves the original front matter block when composing a rich-mode save', () => {
        const result = parseNoteFrontMatter('---\ntitle: Original\n---\n\n# Old body');
        expect(result.kind).toBe('valid');
        if (result.kind !== 'valid') throw new Error('expected valid front matter');

        expect(composeMarkdownWithFrontMatter(result.frontMatter, '# New body\n')).toBe(
            '---\ntitle: Original\n---\n\n# New body\n',
        );
    });

    it('keeps an empty rich body as metadata-only markdown', () => {
        const result = parseNoteFrontMatter('---\ntitle: Original\n---\n\n# Body');
        expect(result.kind).toBe('valid');
        if (result.kind !== 'valid') throw new Error('expected valid front matter');

        expect(composeMarkdownWithFrontMatter(result.frontMatter, '')).toBe('---\ntitle: Original\n---\n');
    });

    it('does not classify a leading horizontal rule without a closing delimiter as front matter', () => {
        expect(parseNoteFrontMatter('---\n# Heading').kind).toBe('none');
    });

    it('reports invalid YAML without hiding the source block', () => {
        const result = parseNoteFrontMatter('---\ntitle: [broken\n---\n# Body');
        expect(result.kind).toBe('invalid');
    });

    it('wraps valid non-object YAML as a generic value field', () => {
        const result = parseNoteFrontMatter('---\n- one\n- two\n---\n# Body');
        expect(result.kind).toBe('valid');
        if (result.kind !== 'valid') throw new Error('expected valid front matter');
        expect(result.frontMatter.data.value).toEqual(['one', 'two']);
        expect(getFrontMatterFieldCount(result.frontMatter)).toBe(1);
    });
});
