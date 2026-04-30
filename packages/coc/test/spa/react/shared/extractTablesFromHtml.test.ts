/**
 * Tests for extractTablesFromHtml — DOM extraction utility that scrapes
 * rendered tables for interactive upgrade.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import {
    extractTablesFromHtml,
    MIN_ROWS,
    MIN_COLS,
    type ExtractedTable,
} from '../../../../src/server/spa/client/react/shared/extractTablesFromHtml';

function makeTable(opts: {
    headers: string[];
    rows: string[][];
    alignments?: string[];
    markdown?: string;
    tableId?: string;
    insideCodeBlock?: boolean;
    /** When true, emit a bare `<table>` (marked output) instead of a forge-wrapped table. */
    bare?: boolean;
}): string {
    const { headers, rows, alignments, markdown, tableId, insideCodeBlock, bare } = opts;
    const tid = tableId ?? 'test-table';

    let html = '';
    if (!bare) {
        html += `<div class="md-table-container" data-table-id="${tid}">`;
    }
    html += '<table class="md-table"><thead><tr>';
    headers.forEach((h, i) => {
        const align = alignments?.[i] ?? '';
        const cls = align === 'center' ? ' align-center' : align === 'right' ? ' align-right' : '';
        html += `<th class="table-cell${cls}">${h}</th>`;
    });
    html += '</tr></thead><tbody>';
    rows.forEach(row => {
        html += '<tr>';
        row.forEach(cell => { html += `<td class="table-cell">${cell}</td>`; });
        html += '</tr>';
    });
    html += '</tbody></table>';

    if (markdown && !bare) {
        const escaped = markdown
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '&#10;');
        html += `<button class="md-table-copy-btn" data-table-markdown="${escaped}">⧉ Copy</button>`;
    }
    if (!bare) {
        html += '</div>';
    }

    if (insideCodeBlock) {
        return `<div class="code-block-container">${html}</div>`;
    }
    return html;
}

/**
 * Build a bare `<table>` with inline `style="text-align: ..."` on header
 * cells — mimicking `marked` library output.
 */
function makeMarkedTable(opts: {
    headers: string[];
    rows: string[][];
    alignments?: ('left' | 'center' | 'right')[];
}): string {
    const { headers, rows, alignments } = opts;
    let html = '<table><thead><tr>';
    headers.forEach((h, i) => {
        const align = alignments?.[i] ?? 'left';
        const style = align !== 'left' ? ` style="text-align: ${align}"` : '';
        html += `<th${style}>${h}</th>`;
    });
    html += '</tr></thead><tbody>';
    rows.forEach(row => {
        html += '<tr>';
        row.forEach((cell, i) => {
            const align = alignments?.[i] ?? 'left';
            const style = align !== 'left' ? ` style="text-align: ${align}"` : '';
            html += `<td${style}>${cell}</td>`;
        });
        html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
}

function createContainer(innerHTML: string): HTMLElement {
    const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="root">${innerHTML}</div></body></html>`);
    return dom.window.document.getElementById('root')!;
}

// Generate enough rows to meet MIN_ROWS threshold
function generateRows(count: number, cols: number = 2): string[][] {
    return Array.from({ length: count }, (_, i) =>
        Array.from({ length: cols }, (_, j) => `r${i}c${j}`)
    );
}

describe('extractTablesFromHtml', () => {
    describe('eligibility', () => {
        it('extracts a table with enough rows and columns', () => {
            const rows = generateRows(MIN_ROWS, MIN_COLS);
            const html = makeTable({ headers: ['A', 'B'], rows });
            const container = createContainer(html);

            const result = extractTablesFromHtml(container);
            expect(result).toHaveLength(1);
            expect(result[0].data.headers).toEqual(['A', 'B']);
            expect(result[0].data.rows).toHaveLength(MIN_ROWS);
        });

        it('skips a table with fewer than MIN_ROWS rows', () => {
            const rows = generateRows(MIN_ROWS - 1, MIN_COLS);
            const html = makeTable({ headers: ['A', 'B'], rows });
            const container = createContainer(html);

            expect(extractTablesFromHtml(container)).toHaveLength(0);
        });

        it('skips a table with fewer than MIN_COLS columns', () => {
            const rows = generateRows(MIN_ROWS, 1);
            const html = makeTable({ headers: ['A'], rows });
            const container = createContainer(html);

            expect(extractTablesFromHtml(container)).toHaveLength(0);
        });

        it('skips a table inside a code block', () => {
            const rows = generateRows(MIN_ROWS, MIN_COLS);
            const html = makeTable({ headers: ['A', 'B'], rows, insideCodeBlock: true });
            const container = createContainer(html);

            expect(extractTablesFromHtml(container)).toHaveLength(0);
        });
    });

    describe('data extraction', () => {
        it('extracts header innerHTML', () => {
            const rows = generateRows(MIN_ROWS);
            const html = makeTable({ headers: ['<strong>Name</strong>', 'Value'], rows });
            const container = createContainer(html);

            const result = extractTablesFromHtml(container);
            expect(result[0].data.headers[0]).toBe('<strong>Name</strong>');
            expect(result[0].data.headers[1]).toBe('Value');
        });

        it('extracts row cell innerHTML', () => {
            const rows = [
                ['<code>foo</code>', 'bar'],
                ...generateRows(MIN_ROWS - 1),
            ];
            const html = makeTable({ headers: ['A', 'B'], rows });
            const container = createContainer(html);

            const result = extractTablesFromHtml(container);
            expect(result[0].data.rows[0][0]).toBe('<code>foo</code>');
            expect(result[0].data.rows[0][1]).toBe('bar');
        });

        it('extracts alignments from CSS classes', () => {
            const rows = generateRows(MIN_ROWS, 3);
            const html = makeTable({
                headers: ['Left', 'Center', 'Right'],
                rows,
                alignments: ['left', 'center', 'right'],
            });
            const container = createContainer(html);

            const result = extractTablesFromHtml(container);
            expect(result[0].data.alignments).toEqual(['left', 'center', 'right']);
        });

        it('recovers original markdown from copy button', () => {
            const rows = generateRows(MIN_ROWS);
            const markdown = '| A | B |\n| --- | --- |\n| r0c0 | r0c1 |';
            const html = makeTable({ headers: ['A', 'B'], rows, markdown });
            const container = createContainer(html);

            const result = extractTablesFromHtml(container);
            expect(result[0].data.originalMarkdown).toBe(markdown);
        });

        it('returns empty originalMarkdown when no copy button', () => {
            const rows = generateRows(MIN_ROWS);
            const html = makeTable({ headers: ['A', 'B'], rows });
            const container = createContainer(html);

            const result = extractTablesFromHtml(container);
            expect(result[0].data.originalMarkdown).toBe('');
        });
    });

    describe('multiple tables', () => {
        it('extracts multiple eligible tables', () => {
            const rows = generateRows(MIN_ROWS);
            const html1 = makeTable({ headers: ['X', 'Y'], rows, tableId: 't1' });
            const html2 = makeTable({ headers: ['P', 'Q'], rows, tableId: 't2' });
            const container = createContainer(html1 + '<p>separator</p>' + html2);

            const result = extractTablesFromHtml(container);
            expect(result).toHaveLength(2);
            expect(result[0].data.headers).toEqual(['X', 'Y']);
            expect(result[1].data.headers).toEqual(['P', 'Q']);
        });

        it('skips ineligible tables but extracts eligible ones', () => {
            const bigRows = generateRows(MIN_ROWS);
            const smallRows = generateRows(2);
            const html1 = makeTable({ headers: ['A', 'B'], rows: bigRows, tableId: 't1' });
            const html2 = makeTable({ headers: ['C', 'D'], rows: smallRows, tableId: 't2' });
            const container = createContainer(html1 + html2);

            const result = extractTablesFromHtml(container);
            expect(result).toHaveLength(1);
            expect(result[0].data.headers).toEqual(['A', 'B']);
        });
    });

    describe('container element reference', () => {
        it('provides a reference to the original container element', () => {
            const rows = generateRows(MIN_ROWS);
            const html = makeTable({ headers: ['A', 'B'], rows, tableId: 'my-table' });
            const container = createContainer(html);

            const result = extractTablesFromHtml(container);
            expect(result[0].containerEl).toBeDefined();
            expect(result[0].containerEl.getAttribute('data-table-id')).toBe('my-table');
        });
    });

    // -----------------------------------------------------------------------
    // Bare <table> (marked library output)
    // -----------------------------------------------------------------------
    describe('bare tables (marked output)', () => {
        it('extracts a bare table with enough rows and columns', () => {
            const rows = generateRows(MIN_ROWS, MIN_COLS);
            const html = makeMarkedTable({ headers: ['A', 'B'], rows });
            const container = createContainer(html);

            const result = extractTablesFromHtml(container);
            expect(result).toHaveLength(1);
            expect(result[0].data.headers).toEqual(['A', 'B']);
            expect(result[0].data.rows).toHaveLength(MIN_ROWS);
        });

        it('skips bare tables that are too small', () => {
            const rows = generateRows(MIN_ROWS - 1, MIN_COLS);
            const html = makeMarkedTable({ headers: ['A', 'B'], rows });
            const container = createContainer(html);

            expect(extractTablesFromHtml(container)).toHaveLength(0);
        });

        it('infers alignment from inline style attributes', () => {
            const rows = generateRows(MIN_ROWS, 3);
            const html = makeMarkedTable({
                headers: ['Left', 'Center', 'Right'],
                rows,
                alignments: ['left', 'center', 'right'],
            });
            const container = createContainer(html);

            const result = extractTablesFromHtml(container);
            expect(result[0].data.alignments).toEqual(['left', 'center', 'right']);
        });

        it('reconstructs markdown for bare tables (no copy button)', () => {
            const rows = [['Alice', '90'], ['Bob', '85'], ['Charlie', '95'], ['Diana', '70'], ['Eve', '88']];
            const html = makeMarkedTable({ headers: ['Name', 'Score'], rows });
            const container = createContainer(html);

            const result = extractTablesFromHtml(container);
            expect(result[0].data.originalMarkdown).toContain('| Name | Score |');
            expect(result[0].data.originalMarkdown).toContain('| --- | --- |');
            expect(result[0].data.originalMarkdown).toContain('| Alice | 90 |');
        });

        it('uses the table element itself as containerEl for bare tables', () => {
            const rows = generateRows(MIN_ROWS);
            const html = makeMarkedTable({ headers: ['X', 'Y'], rows });
            const container = createContainer(html);

            const result = extractTablesFromHtml(container);
            expect(result[0].containerEl.tagName).toBe('TABLE');
        });

        it('handles a mix of forge-wrapped and bare tables', () => {
            const rows = generateRows(MIN_ROWS);
            const forgeHtml = makeTable({ headers: ['A', 'B'], rows, tableId: 'forge-t' });
            const bareHtml = makeMarkedTable({ headers: ['X', 'Y'], rows });
            const container = createContainer(forgeHtml + '<p>text</p>' + bareHtml);

            const result = extractTablesFromHtml(container);
            expect(result).toHaveLength(2);
            expect(result[0].data.headers).toEqual(['A', 'B']);
            expect(result[1].data.headers).toEqual(['X', 'Y']);
        });

        it('does not double-count forge-wrapped tables in bare pass', () => {
            const rows = generateRows(MIN_ROWS);
            const html = makeTable({ headers: ['A', 'B'], rows });
            const container = createContainer(html);

            const result = extractTablesFromHtml(container);
            expect(result).toHaveLength(1);
        });
    });
});
