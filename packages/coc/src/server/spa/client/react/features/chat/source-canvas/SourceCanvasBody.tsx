/**
 * SourceCanvasBody — renders loaded source-canvas content (AC-04).
 *
 * Markdown (`.md`/`.markdown`/`.mdx`, or a server `language` hint of 'markdown')
 * renders as formatted markdown via the shared markdown pipeline, with a toggle
 * to view the raw source. Every other file renders as syntax-highlighted source
 * with a line-number gutter (highlight.js), mirroring the `FilePreview` pattern.
 *
 * Each source row carries a 1-based `data-line` attribute so the line jump +
 * highlight slice (AC-05) can scroll to and highlight referenced lines without
 * re-rendering.
 */
import { useRef, useState } from 'react';
import { useMarkdownPreview } from '../../../hooks/ui/useMarkdownPreview';
import { getLanguageFromFileName, highlightBlock } from '../../git/hooks/useSyntaxHighlight';

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);

/**
 * Cap on lines we run through highlight.js. Larger than the hover-tooltip cap
 * (this is a dedicated reading surface) but still bounded so a huge file falls
 * back to plain — but still gutter'd — line rendering instead of stalling.
 */
const MAX_HIGHLIGHT_LINES = 5000;

/** A `.md`/`.markdown`/`.mdx` extension OR a server language hint of markdown. */
function isMarkdownFile(fileName: string, language?: string): boolean {
    if (language && MARKDOWN_EXTENSIONS.has(language)) {
        return true;
    }
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    return MARKDOWN_EXTENSIONS.has(ext);
}

/** Split file text into display lines, dropping a single trailing newline. */
function toLines(content: string): string[] {
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
}

interface SourceLinesProps {
    content: string;
    /** highlight.js language name, or null for plain (still gutter'd) rendering. */
    language: string | null;
}

/**
 * Syntax-highlighted (or plain) source with a line-number gutter. One row per
 * line, each tagged with `data-line` (1-based) for AC-05's scroll + highlight.
 */
function SourceLines({ content, language }: SourceLinesProps) {
    const lines = toLines(content);
    const useHighlighting = !!language && lines.length <= MAX_HIGHLIGHT_LINES;
    const highlighted = useHighlighting ? highlightBlock(lines, language) : null;
    const gutterWidth = String(lines.length).length;

    return (
        <div className="source-canvas-lines p-1" role="table" data-testid="source-canvas-source">
            {lines.map((line, i) => (
                <div
                    key={i}
                    className="source-canvas-line flex"
                    role="row"
                    data-line={i + 1}
                >
                    <span
                        className="source-canvas-line-number select-none text-right pr-3 text-[#848484] text-xs font-mono"
                        style={{ minWidth: `${gutterWidth + 1}ch` }}
                        role="rowheader"
                    >
                        {i + 1}
                    </span>
                    {highlighted ? (
                        <span
                            className="source-canvas-line-content text-xs font-mono text-[#1e1e1e] dark:text-[#d4d4d4] hljs"
                            style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', flex: 1, minWidth: 0 }}
                            dangerouslySetInnerHTML={{ __html: highlighted[i] || '\u200B' }}
                        />
                    ) : (
                        <span
                            className="source-canvas-line-content text-xs font-mono text-[#1e1e1e] dark:text-[#d4d4d4]"
                            style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', flex: 1, minWidth: 0 }}
                        >
                            {line || '\u200B'}
                        </span>
                    )}
                </div>
            ))}
        </div>
    );
}

interface MarkdownCanvasViewProps {
    content: string;
}

/**
 * Formatted markdown with a Rendered ⇄ Raw toggle. Rendered mode uses the
 * shared markdown pipeline (code highlighting, mermaid, copy buttons); raw mode
 * shows the unrendered source via the same line-gutter view as other files.
 */
function MarkdownCanvasView({ content }: MarkdownCanvasViewProps) {
    const [raw, setRaw] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const { html } = useMarkdownPreview({
        content,
        containerRef,
        viewMode: 'review',
        stripFrontmatter: true,
    });

    return (
        <div className="flex flex-col h-full min-h-0" data-testid="source-canvas-markdown-view">
            <div className="shrink-0 flex items-center justify-end px-2 py-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <button
                    type="button"
                    data-testid="source-canvas-md-toggle"
                    onClick={() => setRaw((v) => !v)}
                    aria-pressed={raw}
                    className="text-xs px-2 py-0.5 rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                >
                    {raw ? 'Rendered' : 'Raw'}
                </button>
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
                {raw ? (
                    <SourceLines content={content} language="markdown" />
                ) : (
                    <div
                        ref={containerRef}
                        className="markdown-body text-sm p-4 text-[#1e1e1e] dark:text-[#cccccc]"
                        data-testid="source-canvas-markdown"
                        dangerouslySetInnerHTML={{ __html: html }}
                    />
                )}
            </div>
        </div>
    );
}

export interface SourceCanvasBodyProps {
    /** File name (used to detect markdown + derive the highlight language). */
    fileName: string;
    /** Full file text. */
    content: string;
    /** Optional server-reported language hint (helps detect markdown). */
    language?: string;
}

/** Render the loaded canvas content: formatted markdown vs highlighted source. */
export function SourceCanvasBody({ fileName, content, language }: SourceCanvasBodyProps) {
    if (isMarkdownFile(fileName, language)) {
        return <MarkdownCanvasView content={content} />;
    }
    return <SourceLines content={content} language={getLanguageFromFileName(fileName)} />;
}
