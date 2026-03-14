/**
 * Shared SPA markdown renderer.
 *
 * Delegates to pipeline-core's rendering and parsing functions so that
 * both the task preview (tasks.ts) and process detail (detail.ts) use
 * the same, richer markdown rendering pipeline.
 */

import {
    // Parsing
    parseCodeBlocks,
    parseMermaidBlocks,
    parseTables,
    // Block renderers
    renderCodeBlock,
    renderTable,
    renderMermaidContainer,
    // Types
    type CodeBlock,
    type ParsedTable,
} from '@plusplusoneplusplus/pipeline-core/editor/parsing';

import {
    // Line-level rendering
    applyMarkdownHighlighting,
    applySourceModeHighlighting,
    // Comment highlight helpers
    getHighlightColumnsForLine,
    applyCommentHighlightToRange,
} from '@plusplusoneplusplus/pipeline-core/editor/rendering';

import type { CommentSelection } from '@plusplusoneplusplus/pipeline-core/editor/types';

// highlight.js is loaded via CDN; declared globally in the HTML template.
declare const hljs: {
    highlight: (code: string, options: { language: string }) => { value: string };
    highlightAuto: (code: string, languages?: string[]) => { value: string; language: string };
};

export interface RenderCommentInfo {
    id: string;
    selection: CommentSelection;
    status: 'open' | 'resolved';
}

export interface RenderOptions {
    /** Strip YAML frontmatter (```---\n...\n---```) from the beginning. */
    stripFrontmatter?: boolean;
    /** Comments to inject as highlights into rendered lines. */
    comments?: RenderCommentInfo[];
}

/**
 * Convert markdown content to HTML using pipeline-core's rendering primitives.
 *
 * Handles code blocks (with hljs syntax highlighting when available), tables,
 * mermaid diagram containers, headings with anchor IDs, lists, blockquotes,
 * inline formatting, and horizontal rules.
 */
export function renderMarkdownToHtml(content: string, options?: RenderOptions): string {
    if (!content) return '';

    let text = content;

    // Optionally strip YAML frontmatter
    if (options?.stripFrontmatter) {
        text = text.replace(/^---\n[\s\S]*?\n---\n*/, '');
    }

    // -- Pre-parse structural blocks so we can replace them in-place --------
    const codeBlocks = parseCodeBlocks(text);
    const mermaidBlocks = parseMermaidBlocks(text);
    const tables = parseTables(text);

    // Build a set of line ranges that are owned by structural blocks
    // (1-based, inclusive start, exclusive end for tables — inclusive end for code/mermaid)
    const blockRanges = buildBlockRanges(codeBlocks, mermaidBlocks, tables);

    // Build the highlight callback for code blocks
    const highlightFn = buildHighlightFn();

    // -- Render pre-parsed blocks to HTML -----------------------------------
    // Build mermaid set first so we can exclude them from code blocks
    const mermaidStartLines = new Set(mermaidBlocks.map(b => b.startLine));

    const codeBlockHtml = new Map<number, string>();
    for (const block of codeBlocks) {
        if (!mermaidStartLines.has(block.startLine)) {
            codeBlockHtml.set(block.startLine, renderCodeBlock(block, {
                highlight: highlightFn,
                showLineNumbers: true,
                showCopyButton: true,
                showLanguageLabel: true,
                collapsible: true,
                defaultExpanded: true,
            }));
        }
    }

    const mermaidHtml = new Map<number, string>();
    for (const block of mermaidBlocks) {
        mermaidHtml.set(block.startLine, renderMermaidContainer(block));
    }

    const tableHtml = new Map<number, string>();
    for (const table of tables) {
        const html = renderTable(table, { formatCell: applyInlineMarkdownFromLine });
        const markdown = reconstructTableMarkdown(table);
        // Inject copy-as-markdown button into the container div
        const btnHtml = '<button class="md-table-copy-btn" title="Copy as Markdown" data-table-markdown="' +
            escapeAttr(markdown) + '">⧉ Copy</button>';
        // Insert button just before the closing </div>
        tableHtml.set(table.startLine, html.replace(/<\/div>$/, btnHtml + '</div>'));
    }

    // -- Line-by-line rendering ---------------------------------------------
    const lines = text.split('\n');
    const htmlParts: string[] = [];
    let inCodeBlock = false;
    let codeBlockLang: string | null = null;

    // Pre-compute line → comments map for highlight injection
    const commentsByLine = new Map<number, RenderCommentInfo[]>();
    if (options?.comments) {
        for (const c of options.comments) {
            for (let ln = c.selection.startLine; ln <= c.selection.endLine; ln++) {
                const arr = commentsByLine.get(ln) || [];
                arr.push(c);
                commentsByLine.set(ln, arr);
            }
        }
    }

    for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1; // 1-based

        // If this line starts a pre-parsed block, emit its rendered HTML and skip
        if (codeBlockHtml.has(lineNum)) {
            htmlParts.push(codeBlockHtml.get(lineNum)!);
            // Skip all lines belonging to this block
            const block = codeBlocks.find(b => b.startLine === lineNum)!;
            i = block.endLine - 1; // -1 because the loop increments
            inCodeBlock = false;
            codeBlockLang = null;
            continue;
        }
        if (mermaidHtml.has(lineNum)) {
            htmlParts.push(mermaidHtml.get(lineNum)!);
            const block = mermaidBlocks.find(b => b.startLine === lineNum)!;
            i = block.endLine - 1;
            inCodeBlock = false;
            codeBlockLang = null;
            continue;
        }
        if (tableHtml.has(lineNum)) {
            htmlParts.push(tableHtml.get(lineNum)!);
            const table = tables.find(t => t.startLine === lineNum)!;
            i = table.endLine - 2; // endLine is exclusive for tables
            continue;
        }

        // Skip lines that belong to a structural block but aren't the start line
        if (isInsideBlock(lineNum, blockRanges)) {
            continue;
        }

        // Regular line-level rendering
        const result = applyMarkdownHighlighting(lines[i], lineNum, inCodeBlock, codeBlockLang);
        inCodeBlock = result.inCodeBlock;
        codeBlockLang = result.codeBlockLang;

        // Apply comment highlights for this line
        let lineContent = result.html;
        const lineComments = commentsByLine.get(lineNum);
        if (lineComments) {
            const plainLine = lines[i];
            // Apply in reverse column order so indices remain valid
            const sorted = [...lineComments].sort(
                (a, b) => b.selection.startColumn - a.selection.startColumn
            );
            for (const c of sorted) {
                const { startCol, endCol } = getHighlightColumnsForLine(
                    c.selection, lineNum, plainLine.length
                );
                const statusClass = c.status === 'resolved' ? 'resolved' : '';
                lineContent = applyCommentHighlightToRange(
                    lineContent, plainLine, startCol, endCol, c.id, statusClass
                );
            }
        }

        // Wrap the line in a div for consistent structure
        let lineHtml = '<div class="md-line" data-line="' + lineNum + '"';
        if (result.anchorId) {
            lineHtml += ' id="' + result.anchorId + '"';
        }
        lineHtml += '>' + lineContent + '</div>';
        htmlParts.push(lineHtml);
    }

    return htmlParts.join('\n');
}

/**
 * Convert markdown content to a source-mode HTML view with per-line syntax
 * highlighting and line-number gutters.
 *
 * Each line is wrapped in a `source-line` div with a `data-line` attribute
 * (1-based) and two child spans: `line-number` and `line-content`.
 * Empty lines render as `<br>` inside the `line-content` span.
 */
export function renderSourceModeToHtml(content: string): string {
    if (!content) return '';

    // Normalize Windows line endings so that \r does not produce extra blank
    // lines or misaligned data-line numbers.
    const text = content.replace(/\r\n/g, '\n');
    const lines = text.split('\n');

    let inCodeBlock = false;
    const htmlParts: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        const result = applySourceModeHighlighting(lines[i], inCodeBlock);
        inCodeBlock = result.inCodeBlock;

        const lineContent = result.html === '' ? '<br>' : result.html;
        htmlParts.push(
            `<div class="source-line" data-line="${lineNum}">` +
            `<span class="line-number">${lineNum}</span>` +
            `<span class="line-content">${lineContent}</span>` +
            `</div>`
        );
    }

    return '<div class="source-mode-body">' + htmlParts.join('') + '</div>';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BlockRange {
    start: number; // inclusive, 1-based
    end: number;   // inclusive, 1-based
}

function buildBlockRanges(
    codeBlocks: CodeBlock[],
    mermaidBlocks: CodeBlock[],
    tables: ParsedTable[],
): BlockRange[] {
    const ranges: BlockRange[] = [];
    for (const b of codeBlocks) {
        ranges.push({ start: b.startLine, end: b.endLine });
    }
    for (const b of mermaidBlocks) {
        ranges.push({ start: b.startLine, end: b.endLine });
    }
    for (const t of tables) {
        ranges.push({ start: t.startLine, end: t.endLine - 1 }); // endLine is exclusive
    }
    return ranges;
}

function isInsideBlock(lineNum: number, ranges: BlockRange[]): boolean {
    return ranges.some(r => lineNum >= r.start && lineNum <= r.end);
}

/**
 * Build an hljs highlight callback if the library is available at runtime.
 */
function buildHighlightFn(): ((code: string, language: string) => string) | undefined {
    if (typeof hljs === 'undefined') return undefined;

    return (code: string, language: string): string => {
        try {
            if (language && language !== 'plaintext') {
                return hljs.highlight(code, { language }).value;
            }
            return hljs.highlightAuto(code).value;
        } catch {
            // Fallback to un-highlighted code (already escaped by renderCodeBlock)
            return code;
        }
    };
}

/**
 * A thin wrapper around `applyMarkdownHighlighting` for use as a table cell
 * formatter: processes a single line of text and returns the inner HTML.
 */
function applyInlineMarkdownFromLine(text: string): string {
    const result = applyMarkdownHighlighting(text, 0, false, null);
    return result.html;
}

/**
 * Reconstruct the original markdown source from a `ParsedTable`.
 */
export function reconstructTableMarkdown(table: ParsedTable): string {
    const lines: string[] = [];

    // Header row
    lines.push('| ' + table.headers.join(' | ') + ' |');

    // Separator row with alignments
    const sep = table.alignments.map(a => {
        if (a === 'center') return ':---:';
        if (a === 'right') return '---:';
        return '---';
    });
    lines.push('| ' + sep.join(' | ') + ' |');

    // Body rows
    for (const row of table.rows) {
        lines.push('| ' + row.join(' | ') + ' |');
    }

    return lines.join('\n');
}

/**
 * Escape a string for safe use in an HTML attribute value (double-quoted).
 */
function escapeAttr(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '&#10;');
}
