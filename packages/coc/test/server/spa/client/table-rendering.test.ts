/**
 * Tests for table rendering in the CoC SPA markdown renderer.
 *
 * Covers table HTML output, alignment, copy-as-markdown button,
 * edge cases, and non-regression for non-table content.
 */

import { describe, it, expect } from 'vitest';
import { renderMarkdownToHtml, reconstructTableMarkdown } from '../../../../src/server/spa/client/markdown-renderer';
import type { ParsedTable } from '@plusplusoneplusplus/pipeline-core/editor/parsing';

// ---------------------------------------------------------------------------
// Basic table rendering
// ---------------------------------------------------------------------------
describe('table rendering', () => {
    describe('basic tables', () => {
        it('renders a 2-column table as HTML <table>', () => {
            const md = '| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('<table class="md-table"');
            expect(html).toContain('<thead>');
            expect(html).toContain('<tbody>');
            expect(html).toContain('<th');
            expect(html).toContain('<td');
            expect(html).toContain('Name');
            expect(html).toContain('Age');
            expect(html).toContain('Alice');
            expect(html).toContain('30');
            expect(html).toContain('Bob');
            expect(html).toContain('25');
        });

        it('wraps table in md-table-container div', () => {
            const md = '| A | B |\n| --- | --- |\n| 1 | 2 |';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('md-table-container');
        });

        it('renders a single-row table', () => {
            const md = '| Header |\n| --- |\n| Value |';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('md-table');
            expect(html).toContain('Header');
            expect(html).toContain('Value');
        });

        it('renders a table with many columns', () => {
            const md = '| A | B | C | D | E |\n| --- | --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 | 5 |';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('md-table');
            for (const col of ['A', 'B', 'C', 'D', 'E']) {
                expect(html).toContain(col);
            }
        });

        it('renders header row distinct from body rows (thead/tbody)', () => {
            const md = '| H1 | H2 |\n| --- | --- |\n| D1 | D2 |';
            const html = renderMarkdownToHtml(md);

            // Headers in <thead>, body in <tbody>
            const theadMatch = html.match(/<thead>([\s\S]*?)<\/thead>/);
            const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/);

            expect(theadMatch).not.toBeNull();
            expect(tbodyMatch).not.toBeNull();
            expect(theadMatch![1]).toContain('H1');
            expect(theadMatch![1]).toContain('H2');
            expect(tbodyMatch![1]).toContain('D1');
            expect(tbodyMatch![1]).toContain('D2');
        });
    });

    // -----------------------------------------------------------------------
    // Alignment
    // -----------------------------------------------------------------------
    describe('column alignment', () => {
        it('applies left alignment by default', () => {
            const md = '| Col |\n| --- |\n| val |';
            const html = renderMarkdownToHtml(md);

            // Left alignment is default, so no explicit align class
            expect(html).not.toContain('align-center');
            expect(html).not.toContain('align-right');
        });

        it('applies center alignment from :---: separator', () => {
            const md = '| Center |\n| :---: |\n| val |';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('align-center');
        });

        it('applies right alignment from ---: separator', () => {
            const md = '| Right |\n| ---: |\n| val |';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('align-right');
        });

        it('handles mixed alignments across columns', () => {
            const md = '| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('align-center');
            expect(html).toContain('align-right');
        });
    });

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------
    describe('edge cases', () => {
        it('handles empty cells', () => {
            const md = '| A | B |\n| --- | --- |\n|  | data |\n| data |  |';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('md-table');
            expect(html).toContain('data');
        });

        it('handles cells with inline code', () => {
            const md = '| Name | Code |\n| --- | --- |\n| test | `value` |';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('md-table');
            expect(html).toContain('value');
        });

        it('handles cells with bold/italic text', () => {
            const md = '| Style |\n| --- |\n| **bold** |\n| *italic* |';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('md-table');
            expect(html).toContain('bold');
            expect(html).toContain('italic');
        });

        it('handles a table with rows shorter than headers (fills empty cells)', () => {
            const md = '| A | B | C |\n| --- | --- | --- |\n| 1 |';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('md-table');
            // Should contain empty <td> cells to fill up to header count
            const tdCount = (html.match(/<td/g) || []).length;
            expect(tdCount).toBeGreaterThanOrEqual(1);
        });

        it('handles multiple tables in one document', () => {
            const md = [
                '| T1 |', '| --- |', '| a |',
                '', 'Some text', '',
                '| T2 |', '| --- |', '| b |',
            ].join('\n');
            const html = renderMarkdownToHtml(md);

            const tableCount = (html.match(/md-table-container/g) || []).length;
            expect(tableCount).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Copy-as-markdown button
    // -----------------------------------------------------------------------
    describe('copy-as-markdown button', () => {
        it('includes a copy button in the table container', () => {
            const md = '| A | B |\n| --- | --- |\n| 1 | 2 |';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('md-table-copy-btn');
            expect(html).toContain('data-table-markdown');
        });

        it('stores the reconstructed markdown in data-table-markdown attribute', () => {
            const md = '| Name | Value |\n| --- | --- |\n| foo | bar |';
            const html = renderMarkdownToHtml(md);

            // The data attribute should contain the table markdown (escaped)
            expect(html).toContain('data-table-markdown=');
            expect(html).toContain('Name');
            expect(html).toContain('Value');
        });

        it('copy button has correct title attribute', () => {
            const md = '| X |\n| --- |\n| y |';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('title="Copy as Markdown"');
        });
    });

    // -----------------------------------------------------------------------
    // reconstructTableMarkdown
    // -----------------------------------------------------------------------
    describe('reconstructTableMarkdown', () => {
        it('reconstructs a basic table', () => {
            const table: ParsedTable = {
                startLine: 1,
                endLine: 4,
                headers: ['A', 'B'],
                alignments: ['left', 'left'],
                rows: [['1', '2']],
                id: 'table-1',
            };
            const md = reconstructTableMarkdown(table);

            expect(md).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
        });

        it('reconstructs alignment markers', () => {
            const table: ParsedTable = {
                startLine: 1,
                endLine: 4,
                headers: ['Left', 'Center', 'Right'],
                alignments: ['left', 'center', 'right'],
                rows: [['a', 'b', 'c']],
                id: 'table-1',
            };
            const md = reconstructTableMarkdown(table);

            expect(md).toContain('| --- | :---: | ---: |');
        });

        it('handles multiple body rows', () => {
            const table: ParsedTable = {
                startLine: 1,
                endLine: 6,
                headers: ['X'],
                alignments: ['left'],
                rows: [['1'], ['2'], ['3']],
                id: 'table-1',
            };
            const md = reconstructTableMarkdown(table);
            const lines = md.split('\n');

            expect(lines).toHaveLength(5); // header + separator + 3 rows
            expect(lines[2]).toBe('| 1 |');
            expect(lines[3]).toBe('| 2 |');
            expect(lines[4]).toBe('| 3 |');
        });

        it('handles empty cell values', () => {
            const table: ParsedTable = {
                startLine: 1,
                endLine: 4,
                headers: ['A', 'B'],
                alignments: ['left', 'left'],
                rows: [['', 'val']],
                id: 'table-1',
            };
            const md = reconstructTableMarkdown(table);

            expect(md).toContain('|  | val |');
        });
    });

    // -----------------------------------------------------------------------
    // Non-regression: non-table content unaffected
    // -----------------------------------------------------------------------
    describe('non-regression', () => {
        it('renders non-table content normally alongside tables', () => {
            const md = [
                '# Heading',
                '',
                '| Col |',
                '| --- |',
                '| val |',
                '',
                'Paragraph text',
            ].join('\n');
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('md-h1');
            expect(html).toContain('md-table');
            expect(html).toContain('Paragraph text');
        });

        it('does not add table classes to non-table pipe characters', () => {
            const md = 'This line has a | pipe character';
            const html = renderMarkdownToHtml(md);

            expect(html).not.toContain('md-table');
        });

        it('code blocks are not affected by table rendering', () => {
            const md = '```\n| not | a | table |\n```';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('code-block');
            // Should NOT be treated as a table
            expect(html).not.toContain('md-table');
        });
    });
});
