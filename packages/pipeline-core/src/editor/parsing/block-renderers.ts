/**
 * Block renderers — pure HTML string generation
 *
 * These functions take parsed markdown structures and produce HTML strings.
 * They have no DOM, state, or VS Code dependencies, making them suitable
 * for server-side rendering in both the VS Code webview and the CoC SPA.
 */

import { escapeHtml } from '../rendering/markdown-renderer';
import { CodeBlock, ParsedTable } from './markdown-parser';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Options for table rendering
 */
export interface TableRenderOptions {
    /** Custom cell content formatter (e.g., inline markdown). Defaults to `escapeHtml`. */
    formatCell?: (text: string) => string;
}

/**
 * Options for code block rendering
 */
export interface CodeBlockRenderOptions {
    /** Syntax highlighter callback. Receives raw code and language, returns HTML.
     *  When omitted the code is HTML-escaped as plain text. */
    highlight?: (code: string, language: string) => string;
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

/**
 * Render a `ParsedTable` as an HTML `<table>` string.
 *
 * The output intentionally mirrors the CSS class names used by the
 * review-editor webview so that the same stylesheet works for both
 * the VS Code extension and the CoC SPA.
 */
export function renderTable(table: ParsedTable, options?: TableRenderOptions): string {
    const fmt = options?.formatCell ?? escapeHtml;

    let html = '<div class="md-table-container" data-start-line="' + table.startLine +
               '" data-end-line="' + (table.endLine - 1) + '" data-table-id="' + table.id + '">';
    html += '<table class="md-table">';

    // Header
    const headerLineNum = table.startLine;
    html += '<thead><tr data-line="' + headerLineNum + '">';
    table.headers.forEach((header, i) => {
        const align = table.alignments[i] || 'left';
        const alignClass = align !== 'left' ? ' align-' + align : '';
        html += '<th class="table-cell' + alignClass + '">' + fmt(header) + '</th>';
    });
    html += '</tr></thead>';

    // Body
    html += '<tbody>';
    table.rows.forEach((row, rowIndex) => {
        const rowLineNum = table.startLine + 2 + rowIndex;
        html += '<tr data-line="' + rowLineNum + '">';
        row.forEach((cell, i) => {
            const align = table.alignments[i] || 'left';
            const alignClass = align !== 'left' ? ' align-' + align : '';
            html += '<td class="table-cell' + alignClass + '">' + fmt(cell) + '</td>';
        });
        // Fill empty cells if row is shorter than header
        for (let j = row.length; j < table.headers.length; j++) {
            html += '<td class="table-cell"></td>';
        }
        html += '</tr>';
    });
    html += '</tbody>';

    html += '</table></div>';
    return html;
}

/**
 * Render a `CodeBlock` as an HTML `<pre><code>` string.
 *
 * Pass an optional `highlight` callback to apply syntax highlighting;
 * without it the code content is HTML-escaped.
 */
export function renderCodeBlock(block: CodeBlock, options?: CodeBlockRenderOptions): string {
    const normalizedCode = block.code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    let highlightedCode: string;
    if (options?.highlight) {
        highlightedCode = options.highlight(normalizedCode, block.language);
    } else {
        highlightedCode = escapeHtml(normalizedCode);
    }

    const lineCount = normalizedCode.split('\n').length;

    return '<div class="code-block" data-start-line="' + block.startLine +
        '" data-end-line="' + block.endLine + '" data-block-id="' + block.id + '">' +
        '<div class="code-block-header">' +
        '<span class="code-language">' + escapeHtml(block.language) + '</span>' +
        '<span class="code-line-count">(' + lineCount + ' line' + (lineCount !== 1 ? 's' : '') + ')</span>' +
        '</div>' +
        '<pre class="code-block-content"><code class="hljs language-' + block.language + '">' +
        highlightedCode + '</code></pre>' +
        '</div>';
}

/**
 * Render a mermaid `CodeBlock` as an HTML container with a loading placeholder.
 *
 * The actual diagram rendering must happen client-side (via mermaid.js);
 * this function only produces the static container markup.
 */
export function renderMermaidContainer(block: CodeBlock): string {
    const lineCount = block.code.split('\n').length;

    return '<div class="mermaid-container" data-start-line="' + block.startLine +
        '" data-end-line="' + block.endLine + '" data-mermaid-id="' + block.id + '">' +
        '<div class="mermaid-header">' +
        '<span class="mermaid-label">Mermaid Diagram</span>' +
        '<span class="mermaid-line-count">(' + lineCount + ' line' + (lineCount !== 1 ? 's' : '') + ')</span>' +
        '</div>' +
        '<div class="mermaid-content">' +
        '<div class="mermaid-preview mermaid-loading">Loading diagram...</div>' +
        '<div class="mermaid-source" style="display: none;"><code>' + escapeHtml(block.code) + '</code></div>' +
        '</div>' +
        '</div>';
}
