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
} from '@plusplusoneplusplus/pipeline-core/editor/rendering';

// highlight.js is loaded via CDN; declared globally in the HTML template.
declare const hljs: {
    highlight: (code: string, options: { language: string }) => { value: string };
    highlightAuto: (code: string, languages?: string[]) => { value: string; language: string };
};

export interface RenderOptions {
    /** Strip YAML frontmatter (```---\n...\n---```) from the beginning. */
    stripFrontmatter?: boolean;
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
            codeBlockHtml.set(block.startLine, renderCodeBlock(block, { highlight: highlightFn }));
        }
    }

    const mermaidHtml = new Map<number, string>();
    for (const block of mermaidBlocks) {
        mermaidHtml.set(block.startLine, renderMermaidContainer(block));
    }

    const tableHtml = new Map<number, string>();
    for (const table of tables) {
        tableHtml.set(table.startLine, renderTable(table, { formatCell: applyInlineMarkdownFromLine }));
    }

    // -- Line-by-line rendering ---------------------------------------------
    const lines = text.split('\n');
    const htmlParts: string[] = [];
    let inCodeBlock = false;
    let codeBlockLang: string | null = null;

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

        // Wrap the line in a div for consistent structure
        let lineHtml = '<div class="md-line" data-line="' + lineNum + '"';
        if (result.anchorId) {
            lineHtml += ' id="' + result.anchorId + '"';
        }
        lineHtml += '>' + result.html + '</div>';
        htmlParts.push(lineHtml);
    }

    return htmlParts.join('\n');
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
