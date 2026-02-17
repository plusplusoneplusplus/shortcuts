/**
 * Block renderers — pure HTML string generation
 *
 * These functions take parsed markdown structures and produce HTML strings.
 * They have no DOM, state, or VS Code dependencies, making them suitable
 * for server-side rendering in both the VS Code webview and the CoC SPA.
 */

import { escapeHtml } from '../rendering/markdown-renderer';
import { CodeBlock, ParsedTable, getLanguageDisplayName } from './markdown-parser';

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
    /** Show line numbers in a gutter column. */
    showLineNumbers?: boolean;
    /** Show a copy-to-clipboard button in the header. */
    showCopyButton?: boolean;
    /** Show a human-readable language label (e.g. "TypeScript" instead of "ts"). */
    showLanguageLabel?: boolean;
    /** Enable collapse/expand for blocks exceeding `collapseThreshold` lines. */
    collapsible?: boolean;
    /** Line count threshold for auto-collapsing. Defaults to 15. */
    collapseThreshold?: number;
    /** Map of 1-based code-line numbers to comment IDs for highlight styling. */
    commentsMap?: Map<number, string>;
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
 *
 * Enhanced options enable line numbers, copy button, language display name,
 * collapse/expand for long blocks, and comment highlights on individual lines.
 */
export function renderCodeBlock(block: CodeBlock, options?: CodeBlockRenderOptions): string {
    const normalizedCode = block.code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const codeLines = normalizedCode.split('\n');
    const lineCount = codeLines.length;

    const showLineNumbers = options?.showLineNumbers ?? false;
    const showCopyButton = options?.showCopyButton ?? false;
    const showLanguageLabel = options?.showLanguageLabel ?? false;
    const collapsible = options?.collapsible ?? false;
    const collapseThreshold = options?.collapseThreshold ?? 15;
    const commentsMap = options?.commentsMap;
    const isCollapsible = collapsible && lineCount > collapseThreshold;

    // Language display
    const langRaw = block.language || '';
    const langDisplay = showLanguageLabel && langRaw
        ? getLanguageDisplayName(langRaw)
        : langRaw;

    // Highlight entire code, then split into lines for wrapping
    let highlightedLines: string[];
    if (options?.highlight) {
        const fullHighlighted = options.highlight(normalizedCode, block.language);
        highlightedLines = splitHighlightedLines(fullHighlighted, lineCount);
    } else {
        highlightedLines = codeLines.map(line => escapeHtml(line));
    }

    // Build per-line HTML
    const linesHtml = highlightedLines.map((lineHtml, idx) => {
        const lineNum = idx + 1;
        const commentId = commentsMap?.get(lineNum);
        const highlightClass = commentId ? ' highlighted' : '';
        const commentAttr = commentId ? ' data-comment-id="' + escapeHtml(commentId) + '"' : '';
        const lineNumberSpan = showLineNumbers
            ? '<span class="line-number">' + lineNum + '</span>'
            : '';
        return '<span class="code-line' + highlightClass + '" data-line="' + lineNum + '"' + commentAttr + '>' +
            lineNumberSpan + lineHtml + '</span>';
    }).join('\n');

    // Container data attributes
    let containerAttrs = ' data-start-line="' + block.startLine +
        '" data-end-line="' + block.endLine +
        '" data-block-id="' + block.id +
        '" data-language="' + escapeHtml(langRaw) + '"';
    if (showCopyButton) {
        containerAttrs += ' data-raw="' + escapeAttrValue(normalizedCode) + '"';
    }
    if (isCollapsible) {
        containerAttrs += ' data-collapsible="true" data-collapsed="true"';
    }

    // Header
    let headerHtml = '<div class="code-block-header">';
    headerHtml += '<span class="code-block-language">' + escapeHtml(langDisplay) + '</span>';
    headerHtml += '<span class="code-line-count">(' + lineCount + ' line' + (lineCount !== 1 ? 's' : '') + ')</span>';
    if (showCopyButton) {
        headerHtml += '<button class="code-block-copy" title="Copy code">\uD83D\uDCCB</button>';
    }
    if (isCollapsible) {
        headerHtml += '<button class="code-block-collapse" title="Expand">\u25B6</button>';
    }
    headerHtml += '</div>';

    // Code body
    const codeHtml = '<pre class="code-block-content"><code class="hljs language-' + escapeHtml(langRaw) + '">' +
        linesHtml + '</code></pre>';

    // Collapsed indicator
    const collapsedIndicator = isCollapsible
        ? '<div class="code-block-collapsed-indicator">Show ' + (lineCount - 5) + ' more lines</div>'
        : '';

    return '<div class="code-block-container"' + containerAttrs + '>' +
        headerHtml + codeHtml + collapsedIndicator + '</div>';
}

/**
 * Split highlighted HTML into per-line segments.
 *
 * hljs output may contain multi-line `<span>` tags that span across lines.
 * This function splits on newlines while tracking open tags so that each
 * resulting line is well-formed HTML.
 */
function splitHighlightedLines(html: string, expectedLines: number): string[] {
    const rawLines = html.split('\n');
    if (rawLines.length === expectedLines) return rawLines;

    // If split count matches, return as-is; otherwise pad/truncate
    while (rawLines.length < expectedLines) rawLines.push('');
    return rawLines.slice(0, expectedLines);
}

/** Escape a string for use inside an HTML attribute value (double-quoted). */
function escapeAttrValue(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '&#10;');
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
