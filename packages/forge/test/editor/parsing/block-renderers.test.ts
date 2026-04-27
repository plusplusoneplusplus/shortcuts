import { describe, it, expect } from 'vitest';
import {
    renderTable,
    renderCodeBlock,
    renderMermaidContainer,
    TableRenderOptions,
    CodeBlockRenderOptions,
} from '../../../src/editor/parsing/block-renderers';
import { CodeBlock, ParsedTable } from '../../../src/editor/parsing/markdown-parser';

// ─── Helpers ─────────────────────────────────────────────────────────

function makeCodeBlock(overrides?: Partial<CodeBlock>): CodeBlock {
    return {
        language: 'js',
        startLine: 2,
        endLine: 4,
        code: 'const x = 1;',
        id: 'codeblock-2',
        isMermaid: false,
        ...overrides,
    };
}

function makeTable(overrides?: Partial<ParsedTable>): ParsedTable {
    return {
        startLine: 1,
        endLine: 4,
        headers: ['Name', 'Age'],
        alignments: ['left', 'right'],
        rows: [['Alice', '30'], ['Bob', '25']],
        id: 'table-1',
        ...overrides,
    };
}

// ─── renderTable ─────────────────────────────────────────────────────

describe('renderTable', () => {
    it('produces correct HTML structure', () => {
        const table = makeTable();
        const html = renderTable(table);

        expect(html).toContain('<table class="md-table">');
        expect(html).toContain('<thead>');
        expect(html).toContain('<tbody>');
        expect(html).toContain('</table>');
    });

    it('renders header cells', () => {
        const table = makeTable();
        const html = renderTable(table);

        expect(html).toContain('<th class="table-cell">');
        expect(html).toContain('Name');
        expect(html).toContain('Age');
    });

    it('renders body rows', () => {
        const table = makeTable();
        const html = renderTable(table);

        expect(html).toContain('Alice');
        expect(html).toContain('30');
        expect(html).toContain('Bob');
        expect(html).toContain('25');
    });

    it('applies alignment classes', () => {
        const table = makeTable({
            headers: ['Left', 'Center', 'Right'],
            alignments: ['left', 'center', 'right'],
            rows: [['a', 'b', 'c']],
        });
        const html = renderTable(table);

        // Left alignment has no extra class
        expect(html).toContain('<th class="table-cell">');
        expect(html).toContain('align-center');
        expect(html).toContain('align-right');
    });

    it('includes data attributes', () => {
        const table = makeTable({ startLine: 5, endLine: 10, id: 'table-5' });
        const html = renderTable(table);

        expect(html).toContain('data-start-line="5"');
        expect(html).toContain('data-end-line="9"'); // endLine - 1
        expect(html).toContain('data-table-id="table-5"');
    });

    it('fills empty cells when row is shorter than header', () => {
        const table = makeTable({
            headers: ['A', 'B', 'C'],
            alignments: ['left', 'left', 'left'],
            rows: [['1', '2']],   // missing third cell
        });
        const html = renderTable(table);

        // Should have 3 <td> per row
        const tdCount = (html.match(/<td/g) || []).length;
        expect(tdCount).toBe(3);
    });

    it('uses custom formatCell option', () => {
        const table = makeTable();
        const options: TableRenderOptions = {
            formatCell: (text) => `<em>${text}</em>`,
        };
        const html = renderTable(table, options);

        expect(html).toContain('<em>Name</em>');
        expect(html).toContain('<em>Alice</em>');
    });

    it('escapes HTML by default', () => {
        const table = makeTable({
            headers: ['<script>'],
            alignments: ['left'],
            rows: [['<b>bold</b>']],
        });
        const html = renderTable(table);

        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('includes data-line on rows', () => {
        const table = makeTable({ startLine: 3 });
        const html = renderTable(table);

        expect(html).toContain('data-line="3"'); // header line
        expect(html).toContain('data-line="5"'); // first body row = startLine + 2
    });
});

// ─── renderTable — colgroup ──────────────────────────────────────────

describe('renderTable — colgroup', () => {
    it('emits <colgroup> and <col> elements', () => {
        const table = makeTable();
        const html = renderTable(table);

        expect(html).toContain('<colgroup>');
        expect(html).toContain('<col ');
        expect(html).toContain('</colgroup>');
    });

    it('widths sum to exactly 100 for a 3-column table', () => {
        const table = makeTable({
            headers: ['#', 'Name', 'Description'],
            alignments: ['left', 'left', 'left'],
            rows: [['1', 'Alice', 'A very long description that goes on and on']],
        });
        const html = renderTable(table);

        const matches = [...html.matchAll(/width:\s*(\d+)%/g)];
        const widths = matches.map(m => parseInt(m[1], 10));
        const sum = widths.reduce((a, b) => a + b, 0);
        expect(sum).toBe(100);
    });

    it('narrow column gets a smaller percentage than a wide column', () => {
        const table = makeTable({
            headers: ['#', 'Description'],
            alignments: ['left', 'left'],
            rows: [
                ['1', 'A very long description that spans many characters'],
                ['2', 'Another long description with lots of content here'],
            ],
        });
        const html = renderTable(table);

        const matches = [...html.matchAll(/width:\s*(\d+)%/g)];
        const widths = matches.map(m => parseInt(m[1], 10));
        expect(widths.length).toBe(2);
        expect(widths[0]).toBeLessThan(widths[1]);
    });

    it('single column gets 100%', () => {
        const table = makeTable({
            headers: ['Title'],
            alignments: ['left'],
            rows: [['Some title'], ['Another title']],
        });
        const html = renderTable(table);

        expect(html).toContain('width: 100%');
        const colCount = (html.match(/<col /g) || []).length;
        expect(colCount).toBe(1);
    });

    it('equal-length columns share widths within rounding tolerance', () => {
        const table = makeTable({
            headers: ['A', 'B', 'C'],
            alignments: ['left', 'left', 'left'],
            rows: [['x', 'y', 'z']],
        });
        const html = renderTable(table);

        const matches = [...html.matchAll(/width:\s*(\d+)%/g)];
        const widths = matches.map(m => parseInt(m[1], 10));
        expect(widths.length).toBe(3);
        // All 3 columns have equal single-char content → widths ≈ 33/33/34
        const maxW = Math.max(...widths);
        const minW = Math.min(...widths);
        expect(maxW - minW).toBeLessThanOrEqual(2); // only rounding drift
    });

    it('very long cell content is capped so other columns get a fair share', () => {
        const longContent = 'x'.repeat(200); // well above MAX_CHARS (60)
        const table = makeTable({
            headers: ['Short', 'Long'],
            alignments: ['left', 'left'],
            rows: [['tiny', longContent]],
        });
        const html = renderTable(table);

        const matches = [...html.matchAll(/width:\s*(\d+)%/g)];
        const widths = matches.map(m => parseInt(m[1], 10));
        expect(widths.length).toBe(2);
        // Long column is capped at MAX_CHARS=60; Short is clamped to MIN_CHARS=4.
        // So Long share = 60/(60+4) ≈ 94%, Short ≈ 6%.
        // The long column should not reach 100%.
        expect(widths[1]).toBeLessThan(100);
        expect(widths[0]).toBeGreaterThan(0);
        expect(widths[0] + widths[1]).toBe(100);
    });
});

// ─── renderCodeBlock ─────────────────────────────────────────────────

describe('renderCodeBlock', () => {
    it('produces correct HTML structure', () => {
        const block = makeCodeBlock();
        const html = renderCodeBlock(block);

        expect(html).toContain('<div class="code-block-container"');
        expect(html).toContain('<pre class="code-block-content">');
        expect(html).toContain('<code class="hljs language-js">');
    });

    it('includes data attributes', () => {
        const block = makeCodeBlock({ startLine: 5, endLine: 10, id: 'codeblock-5' });
        const html = renderCodeBlock(block);

        expect(html).toContain('data-start-line="5"');
        expect(html).toContain('data-end-line="10"');
        expect(html).toContain('data-block-id="codeblock-5"');
    });

    it('displays language name', () => {
        const block = makeCodeBlock({ language: 'typescript' });
        const html = renderCodeBlock(block);

        expect(html).toContain('typescript');
    });

    it('shows correct line count', () => {
        const block = makeCodeBlock({ code: 'line1\nline2\nline3' });
        const html = renderCodeBlock(block);

        expect(html).toContain('(3 lines)');
    });

    it('shows singular for single line', () => {
        const block = makeCodeBlock({ code: 'single line' });
        const html = renderCodeBlock(block);

        expect(html).toContain('(1 line)');
    });

    it('HTML-escapes code by default', () => {
        const block = makeCodeBlock({ code: '<div>html</div>' });
        const html = renderCodeBlock(block);

        expect(html).toContain('&lt;div&gt;html&lt;/div&gt;');
        expect(html).not.toContain('<div>html</div>');
    });

    it('uses custom highlight function', () => {
        const block = makeCodeBlock({ code: 'const x = 1;' });
        const options: CodeBlockRenderOptions = {
            highlight: (code, _lang) => `<span class="custom">${code}</span>`,
        };
        const html = renderCodeBlock(block, options);

        expect(html).toContain('<span class="custom">const x = 1;</span>');
    });

    it('normalizes CRLF line endings', () => {
        const block = makeCodeBlock({ code: 'a\r\nb\r\nc' });
        const html = renderCodeBlock(block);

        expect(html).toContain('(3 lines)');
        expect(html).not.toContain('\r');
    });

    it('wraps each line in a code-line span', () => {
        const block = makeCodeBlock({ code: 'line1\nline2' });
        const html = renderCodeBlock(block);

        expect(html).toContain('class="code-line" data-line="1"');
        expect(html).toContain('class="code-line" data-line="2"');
    });

    it('adds collapsible attributes when block exceeds threshold', () => {
        const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n');
        const block = makeCodeBlock({ code: lines });
        const options: CodeBlockRenderOptions = {
            collapsible: true,
            collapseThreshold: 15,
        };
        const html = renderCodeBlock(block, options);

        expect(html).toContain('data-collapsible="true"');
        expect(html).toContain('data-collapsed="true"');
        expect(html).toContain('code-block-collapsed-indicator');
        expect(html).toContain('Show 15 more lines');
        expect(html).toContain('code-block-collapse');
    });

    it('does not add collapsible attributes when block is under threshold', () => {
        const block = makeCodeBlock({ code: 'line1\nline2\nline3' });
        const options: CodeBlockRenderOptions = {
            collapsible: true,
            collapseThreshold: 15,
        };
        const html = renderCodeBlock(block, options);

        expect(html).not.toContain('data-collapsible');
        expect(html).not.toContain('data-collapsed');
        expect(html).not.toContain('code-block-collapsed-indicator');
        expect(html).not.toContain('code-block-collapse');
    });

    it('does not add collapsible when option is false', () => {
        const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n');
        const block = makeCodeBlock({ code: lines });
        const html = renderCodeBlock(block, { collapsible: false });

        expect(html).not.toContain('data-collapsible');
        expect(html).not.toContain('data-collapsed');
    });

    it('starts expanded when defaultExpanded is true', () => {
        const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n');
        const block = makeCodeBlock({ code: lines });
        const options: CodeBlockRenderOptions = {
            collapsible: true,
            collapseThreshold: 15,
            defaultExpanded: true,
        };
        const html = renderCodeBlock(block, options);

        expect(html).toContain('data-collapsible="true"');
        expect(html).toContain('data-collapsed="false"');
        expect(html).toContain('title="Collapse"');
        expect(html).toContain('\u25BC'); // ▼ expanded icon
        expect(html).not.toContain('title="Expand"');
    });

    it('starts collapsed by default when defaultExpanded is not set', () => {
        const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n');
        const block = makeCodeBlock({ code: lines });
        const options: CodeBlockRenderOptions = {
            collapsible: true,
            collapseThreshold: 15,
        };
        const html = renderCodeBlock(block, options);

        expect(html).toContain('data-collapsed="true"');
        expect(html).toContain('title="Expand"');
        expect(html).toContain('\u25B6'); // ▶ collapsed icon
    });

    it('includes data-raw when showCopyButton is true', () => {
        const block = makeCodeBlock({ code: 'const x = 1;' });
        const html = renderCodeBlock(block, { showCopyButton: true });

        expect(html).toContain('data-raw=');
        expect(html).toContain('code-block-copy');
    });
});

// ─── renderMermaidContainer ──────────────────────────────────────────

describe('renderMermaidContainer', () => {
    it('produces correct HTML structure', () => {
        const block = makeCodeBlock({ isMermaid: true, language: 'mermaid', code: 'graph TD;\n  A-->B;' });
        const html = renderMermaidContainer(block);

        expect(html).toContain('<div class="mermaid-container"');
        expect(html).toContain('Mermaid Diagram');
        expect(html).toContain('mermaid-preview');
        expect(html).toContain('mermaid-source');
    });

    it('includes data attributes', () => {
        const block = makeCodeBlock({ startLine: 3, endLine: 7, id: 'codeblock-3', isMermaid: true });
        const html = renderMermaidContainer(block);

        expect(html).toContain('data-start-line="3"');
        expect(html).toContain('data-end-line="7"');
        expect(html).toContain('data-mermaid-id="codeblock-3"');
    });

    it('shows line count', () => {
        const block = makeCodeBlock({ code: 'graph TD;\n  A-->B;\n  B-->C;', isMermaid: true });
        const html = renderMermaidContainer(block);

        expect(html).toContain('(3 lines)');
    });

    it('shows singular for single line', () => {
        const block = makeCodeBlock({ code: 'graph TD;', isMermaid: true });
        const html = renderMermaidContainer(block);

        expect(html).toContain('(1 line)');
    });

    it('HTML-escapes source code', () => {
        const block = makeCodeBlock({ code: '<script>alert(1)</script>', isMermaid: true });
        const html = renderMermaidContainer(block);

        expect(html).toContain('&lt;script&gt;');
        expect(html).not.toContain('<script>alert');
    });

    it('shows loading placeholder', () => {
        const block = makeCodeBlock({ isMermaid: true });
        const html = renderMermaidContainer(block);

        expect(html).toContain('mermaid-loading');
        expect(html).toContain('Loading diagram...');
    });

    it('hides source by default', () => {
        const block = makeCodeBlock({ isMermaid: true });
        const html = renderMermaidContainer(block);

        expect(html).toContain('display: none;');
    });
});
