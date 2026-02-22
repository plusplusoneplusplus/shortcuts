/**
 * Tests for .wiki-body prose styles in tailwind.css and WikiComponent className.
 *
 * Validates that standard HTML element selectors are styled for wiki articles
 * rendered by marked.parse(), without breaking existing .markdown-body styles.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const cssPath = resolve(__dirname, '../../../src/server/spa/client/tailwind.css');
const css = readFileSync(cssPath, 'utf-8');

function extractBlock(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped + '\\s*\\{([^}]+)\\}');
    const m = css.match(re);
    return m ? m[1] : '';
}

function hasSelector(selector: string): boolean {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped + '\\s*\\{').test(css);
}

describe('.wiki-body prose styles', () => {
    it('defines .wiki-body base block', () => {
        const block = extractBlock('.wiki-body');
        expect(block).toContain('line-height');
        expect(block).toContain('word-break');
    });

    describe('heading styles', () => {
        it('styles h1 with font-size and border-bottom', () => {
            const block = extractBlock('.wiki-body h1');
            expect(block).toContain('font-size: 1.6rem');
            expect(block).toContain('font-weight: 700');
            expect(block).toContain('border-bottom');
        });

        it('styles h2 with font-size and border-bottom', () => {
            const block = extractBlock('.wiki-body h2');
            expect(block).toContain('font-size: 1.3rem');
            expect(block).toContain('border-bottom');
        });

        it('styles h3 with font-size', () => {
            const block = extractBlock('.wiki-body h3');
            expect(block).toContain('font-size: 1.1rem');
            expect(block).toContain('font-weight: 700');
        });

        it('styles h4-h6', () => {
            // These are in a comma-separated rule group
            expect(css).toContain('.wiki-body h4');
            expect(css).toContain('.wiki-body h5');
            expect(css).toContain('.wiki-body h6');
        });
    });

    describe('text element styles', () => {
        it('styles paragraphs', () => {
            const block = extractBlock('.wiki-body p');
            expect(block).toContain('margin');
        });

        it('styles unordered lists with disc', () => {
            const block = extractBlock('.wiki-body ul');
            expect(block).toContain('list-style: disc');
            expect(block).toContain('padding-left');
        });

        it('styles ordered lists with decimal', () => {
            const block = extractBlock('.wiki-body ol');
            expect(block).toContain('list-style: decimal');
        });

        it('styles list items', () => {
            const block = extractBlock('.wiki-body li');
            expect(block).toContain('margin');
        });

        it('styles links with color', () => {
            const block = extractBlock('.wiki-body a');
            expect(block).toContain('color: #0078d4');
        });

        it('styles strong as bold', () => {
            const block = extractBlock('.wiki-body strong');
            expect(block).toContain('font-weight: 700');
        });

        it('styles em as italic', () => {
            const block = extractBlock('.wiki-body em');
            expect(block).toContain('font-style: italic');
        });
    });

    describe('code styles', () => {
        it('styles inline code with background pill', () => {
            const block = extractBlock('.wiki-body code');
            expect(block).toContain('background');
            expect(block).toContain('border-radius');
            expect(block).toContain('font-family');
        });

        it('styles pre > code as code block', () => {
            const block = extractBlock('.wiki-body pre > code');
            expect(block).toContain('display: block');
            expect(block).toContain('overflow-x: auto');
            expect(block).toContain('padding');
        });
    });

    describe('blockquote styles', () => {
        it('styles blockquote with left border', () => {
            const block = extractBlock('.wiki-body blockquote');
            expect(block).toContain('border-left');
            expect(block).toContain('font-style: italic');
        });
    });

    describe('table styles', () => {
        it('styles table as full-width with collapsed borders', () => {
            const block = extractBlock('.wiki-body table');
            expect(block).toContain('width: 100%');
            expect(block).toContain('border-collapse: collapse');
        });

        it('styles th with background', () => {
            const block = extractBlock('.wiki-body th');
            expect(block).toContain('background');
            expect(block).toContain('font-weight: 600');
        });

        it('styles th and td with border and padding', () => {
            expect(hasSelector('.wiki-body td')).toBe(true);
            const block = extractBlock('.wiki-body th');
            expect(block).toBeTruthy();
        });
    });

    describe('hr styles', () => {
        it('styles hr with subtle border', () => {
            const block = extractBlock('.wiki-body hr');
            expect(block).toContain('border-top');
        });
    });

    describe('dark mode variants', () => {
        it('has dark heading color overrides', () => {
            // These are in comma-separated rule groups
            expect(css).toContain('.dark .wiki-body h1');
            expect(css).toContain('.dark .wiki-body h2');
        });

        it('has dark link color override', () => {
            const block = extractBlock('.dark .wiki-body a');
            expect(block).toContain('color: #7bbef3');
        });

        it('has dark code background override', () => {
            const block = extractBlock('.dark .wiki-body code');
            expect(block).toContain('background: #2d2d2d');
        });

        it('has dark pre > code background override', () => {
            const block = extractBlock('.dark .wiki-body pre > code');
            expect(block).toContain('background: #1e1e1e');
        });

        it('has dark blockquote overrides', () => {
            const block = extractBlock('.dark .wiki-body blockquote');
            expect(block).toContain('border-left-color: #3794ff');
        });

        it('has dark table overrides', () => {
            expect(css).toContain('.dark .wiki-body th');
            expect(css).toContain('.dark .wiki-body td');
        });

        it('has dark hr override', () => {
            const block = extractBlock('.dark .wiki-body hr');
            expect(block).toContain('border-top-color: #3c3c3c');
        });
    });
});

describe('.wiki-body does not break .markdown-body', () => {
    it('.markdown-body styles still exist', () => {
        expect(hasSelector('.markdown-body')).toBe(true);
        expect(hasSelector('.markdown-body .md-h1')).toBe(true);
        expect(hasSelector('.markdown-body .md-bold')).toBe(true);
        expect(hasSelector('.markdown-body .md-inline-code')).toBe(true);
        expect(hasSelector('.markdown-body .md-blockquote')).toBe(true);
        expect(hasSelector('.markdown-body .md-table')).toBe(true);
    });
});

describe('WikiComponent className', () => {
    it('uses wiki-body class on content div', () => {
        const tsxPath = resolve(
            __dirname,
            '../../../src/server/spa/client/react/wiki/WikiComponent.tsx',
        );
        const tsx = readFileSync(tsxPath, 'utf-8');
        expect(tsx).toContain('wiki-body');
        // Should also keep markdown-body for inherited base styles
        expect(tsx).toMatch(/wiki-body\s+markdown-body/);
    });
});
