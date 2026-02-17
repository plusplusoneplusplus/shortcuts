import { describe, it, expect } from 'vitest';
import {
    generateAnchorId,
    parseHeadings,
    findSectionEndLine,
    buildSectionMap,
    getHeadingLevel,
    getHeadingAnchorId,
    HeadingInfo
} from '../../../src/editor/rendering/heading-parser';

describe('generateAnchorId', () => {
    it('generates lowercase hyphenated ID', () => {
        expect(generateAnchorId('Hello World')).toBe('hello-world');
    });

    it('removes special characters', () => {
        expect(generateAnchorId('Section (1): Overview!')).toBe('section-1-overview');
    });

    it('handles empty input', () => {
        expect(generateAnchorId('')).toBe('');
    });

    it('handles markdown formatting', () => {
        expect(generateAnchorId('**Bold** heading')).toBe('bold-heading');
    });
});

describe('parseHeadings', () => {
    it('parses headings from markdown content', () => {
        const content = '# Title\n\nSome text\n\n## Section 1\n\n### Subsection';
        const headings = parseHeadings(content);
        expect(headings).toHaveLength(3);
        expect(headings[0]).toEqual({
            lineNum: 1, level: 1, text: 'Title', anchorId: 'title'
        });
        expect(headings[1]).toEqual({
            lineNum: 5, level: 2, text: 'Section 1', anchorId: 'section-1'
        });
        expect(headings[2]).toEqual({
            lineNum: 7, level: 3, text: 'Subsection', anchorId: 'subsection'
        });
    });

    it('skips headings inside code blocks', () => {
        const content = '# Real\n```\n# Not a heading\n```\n## Also Real';
        const headings = parseHeadings(content);
        expect(headings).toHaveLength(2);
        expect(headings[0].text).toBe('Real');
        expect(headings[1].text).toBe('Also Real');
    });

    it('handles empty content', () => {
        expect(parseHeadings('')).toHaveLength(0);
    });

    it('handles Windows line endings', () => {
        const content = '# Title\r\n\r\n## Section\r\n';
        const headings = parseHeadings(content);
        expect(headings).toHaveLength(2);
    });

    it('handles all heading levels', () => {
        const content = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6';
        const headings = parseHeadings(content);
        expect(headings).toHaveLength(6);
        for (let i = 0; i < 6; i++) {
            expect(headings[i].level).toBe(i + 1);
        }
    });

    it('handles indented code fences', () => {
        const content = '# Before\n   ```\n# Inside\n   ```\n# After';
        const headings = parseHeadings(content);
        expect(headings).toHaveLength(2);
        expect(headings[0].text).toBe('Before');
        expect(headings[1].text).toBe('After');
    });
});

describe('findSectionEndLine', () => {
    it('finds end at next same-level heading', () => {
        const headings: HeadingInfo[] = [
            { lineNum: 1, level: 2, anchorId: 'a', text: 'A' },
            { lineNum: 5, level: 2, anchorId: 'b', text: 'B' }
        ];
        expect(findSectionEndLine(headings, 0, 10)).toBe(4);
    });

    it('finds end at next higher-level heading', () => {
        const headings: HeadingInfo[] = [
            { lineNum: 1, level: 2, anchorId: 'a', text: 'A' },
            { lineNum: 3, level: 3, anchorId: 'b', text: 'B' },
            { lineNum: 8, level: 1, anchorId: 'c', text: 'C' }
        ];
        expect(findSectionEndLine(headings, 0, 10)).toBe(7);
    });

    it('extends to end of document when no next heading', () => {
        const headings: HeadingInfo[] = [
            { lineNum: 1, level: 1, anchorId: 'a', text: 'A' }
        ];
        expect(findSectionEndLine(headings, 0, 20)).toBe(20);
    });

    it('sub-section ends before parent sibling', () => {
        const headings: HeadingInfo[] = [
            { lineNum: 1, level: 2, anchorId: 'a', text: 'A' },
            { lineNum: 3, level: 3, anchorId: 'sub', text: 'Sub' },
            { lineNum: 7, level: 2, anchorId: 'b', text: 'B' }
        ];
        expect(findSectionEndLine(headings, 1, 10)).toBe(6);
    });
});

describe('buildSectionMap', () => {
    it('builds section map from content', () => {
        const content = '# Title\n\nText\n\n## Section\n\nMore text';
        const map = buildSectionMap(content);
        expect(map.get('title')).toEqual({ startLine: 1, endLine: 7 });
        expect(map.get('section')).toEqual({ startLine: 5, endLine: 7 });
    });

    it('handles duplicate anchor IDs', () => {
        const content = '## Same\n\nText\n\n## Same\n\nMore';
        const map = buildSectionMap(content);
        expect(map.has('same')).toBe(true);
        expect(map.has('same-1')).toBe(true);
    });

    it('returns empty map for content without headings', () => {
        expect(buildSectionMap('no headings here')).toEqual(new Map());
    });
});

describe('getHeadingLevel', () => {
    it('returns correct level for headings', () => {
        expect(getHeadingLevel('# H1')).toBe(1);
        expect(getHeadingLevel('## H2')).toBe(2);
        expect(getHeadingLevel('###### H6')).toBe(6);
    });

    it('returns 0 for non-heading lines', () => {
        expect(getHeadingLevel('Not a heading')).toBe(0);
        expect(getHeadingLevel('')).toBe(0);
        expect(getHeadingLevel('#no space')).toBe(0);
    });
});

describe('getHeadingAnchorId', () => {
    it('returns anchor ID from heading line', () => {
        expect(getHeadingAnchorId('## My Section')).toBe('my-section');
    });

    it('returns empty string for non-heading', () => {
        expect(getHeadingAnchorId('not a heading')).toBe('');
    });
});
