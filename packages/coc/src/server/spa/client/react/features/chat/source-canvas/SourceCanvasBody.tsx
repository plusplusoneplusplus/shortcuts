/**
 * SourceCanvasBody — renders loaded source-canvas content (AC-04 + AC-05).
 *
 * Markdown (`.md`/`.markdown`/`.mdx`, or a server `language` hint of 'markdown')
 * renders as formatted markdown via the shared markdown pipeline, with a toggle
 * to view the raw source. Every other file renders as syntax-highlighted source
 * with a line-number gutter (highlight.js), mirroring the `FilePreview` pattern.
 *
 * AC-05: when the reference carried a `:line` / `:start-end` suffix, the target
 * line(s) are highlighted and the first is auto-scrolled into view. Source rows
 * carry a 1-based `data-line` attribute; rendered markdown reuses the renderer's
 * own `.md-line[data-line]` rows. No line ref → the file opens at the top with
 * no highlight.
 */
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useMarkdownPreview } from '../../../hooks/ui/useMarkdownPreview';
import { getLanguageFromFileName, highlightBlock } from '../../git/hooks/useSyntaxHighlight';

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);

/** CSS class applied to highlighted line rows (styled in tailwind.css). */
const LINE_HIGHLIGHT_CLASS = 'source-canvas-line-highlight';

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

interface LineRange {
    /** 1-based inclusive start. */
    start: number;
    /** 1-based inclusive end (== start for a single line). */
    end: number;
}

/**
 * Resolve a `:line` / `:start-end` reference into a clamped 1-based inclusive
 * range, or `null` when no line was referenced (open at top, no highlight).
 */
function resolveLineRange(
    line: number | undefined,
    endLine: number | undefined,
    total: number,
): LineRange | null {
    if (!line || line < 1 || total < 1) {
        return null;
    }
    const start = Math.min(line, total);
    const end = endLine && endLine >= start ? Math.min(endLine, total) : start;
    return { start, end };
}

/** Scroll the first `[data-line="<line>"]` row in `containerRef` into view. */
function useScrollToLine(containerRef: RefObject<HTMLElement | null>, line: number | undefined, ready: unknown) {
    useEffect(() => {
        if (!line) { return; }
        const container = containerRef.current;
        if (!container) { return; }
        const target = container.querySelector(`[data-line="${line}"]`) as HTMLElement | null;
        if (!target) { return; }
        try {
            target.scrollIntoView({ block: 'center' });
        } catch {
            /* scrollIntoView unimplemented (e.g. jsdom) */
        }
        // `ready` is a render-completion signal (e.g. the markdown html string)
        // so the scroll runs only after the target rows exist in the DOM.
    }, [containerRef, line, ready]);
}

interface SourceLinesProps {
    content: string;
    /** highlight.js language name, or null for plain (still gutter'd) rendering. */
    language: string | null;
    /** Referenced line range to highlight + scroll to (AC-05), if any. */
    range?: LineRange | null;
}

/**
 * Syntax-highlighted (or plain) source with a line-number gutter. One row per
 * line, each tagged with `data-line` (1-based). Rows inside `range` get the
 * highlight class and the first is scrolled into view (AC-05).
 */
function SourceLines({ content, language, range }: SourceLinesProps) {
    const lines = toLines(content);
    const useHighlighting = !!language && lines.length <= MAX_HIGHLIGHT_LINES;
    const highlighted = useHighlighting ? highlightBlock(lines, language) : null;
    const gutterWidth = String(lines.length).length;
    const containerRef = useRef<HTMLDivElement>(null);
    useScrollToLine(containerRef, range?.start, content);

    return (
        <div
            ref={containerRef}
            className="source-canvas-lines p-1"
            role="table"
            data-testid="source-canvas-source"
        >
            {lines.map((lineText, i) => {
                const lineNo = i + 1;
                const isHighlighted = !!range && lineNo >= range.start && lineNo <= range.end;
                return (
                    <div
                        key={i}
                        className={`source-canvas-line flex${isHighlighted ? ` ${LINE_HIGHLIGHT_CLASS}` : ''}`}
                        role="row"
                        data-line={lineNo}
                        data-highlighted={isHighlighted ? 'true' : undefined}
                    >
                        <span
                            className="source-canvas-line-number select-none text-right pr-3 text-[#848484] text-xs font-mono"
                            style={{ minWidth: `${gutterWidth + 1}ch` }}
                            role="rowheader"
                        >
                            {lineNo}
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
                                {lineText || '\u200B'}
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

interface MarkdownCanvasViewProps {
    content: string;
    /** Referenced line range to highlight + scroll to (AC-05), if any. */
    range?: LineRange | null;
}

/**
 * Formatted markdown with a Rendered ⇄ Raw toggle. Rendered mode uses the
 * shared markdown pipeline (code highlighting, mermaid, copy buttons); raw mode
 * shows the unrendered source via the same line-gutter view as other files.
 *
 * When a line range is referenced (AC-05), rendered mode highlights the matching
 * `.md-line` rows the markdown renderer emits and scrolls the first into view;
 * raw mode delegates highlight + scroll to `SourceLines`.
 */
function MarkdownCanvasView({ content, range }: MarkdownCanvasViewProps) {
    const [raw, setRaw] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const { html } = useMarkdownPreview({
        content,
        containerRef,
        viewMode: 'review',
        stripFrontmatter: true,
    });

    // Highlight + scroll the referenced `.md-line` rows once the html is in the
    // DOM. The rows live inside dangerouslySetInnerHTML (not React-managed), so
    // we toggle the class imperatively and clean it up on change.
    useEffect(() => {
        const container = containerRef.current;
        if (raw || !container) { return undefined; }
        if (!range) { return undefined; }
        const rows = Array.from(container.querySelectorAll('.md-line')) as HTMLElement[];
        let firstHit: HTMLElement | null = null;
        for (const row of rows) {
            const n = Number(row.getAttribute('data-line'));
            const hit = Number.isFinite(n) && n >= range.start && n <= range.end;
            row.classList.toggle(LINE_HIGHLIGHT_CLASS, hit);
            if (hit && !firstHit) { firstHit = row; }
        }
        if (firstHit) {
            try {
                firstHit.scrollIntoView({ block: 'center' });
            } catch {
                /* scrollIntoView unimplemented (e.g. jsdom) */
            }
        }
        return () => {
            for (const row of rows) {
                row.classList.remove(LINE_HIGHLIGHT_CLASS);
            }
        };
    }, [html, raw, range?.start, range?.end]);

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
                    <SourceLines content={content} language="markdown" range={range} />
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
    /** Target (start) line to scroll to + highlight, when the ref carried one. */
    line?: number;
    /** End line of a highlighted range, when the ref carried `:start-end`. */
    endLine?: number;
}

/** Render the loaded canvas content: formatted markdown vs highlighted source. */
export function SourceCanvasBody({ fileName, content, language, line, endLine }: SourceCanvasBodyProps) {
    const range = resolveLineRange(line, endLine, toLines(content).length);
    if (isMarkdownFile(fileName, language)) {
        return <MarkdownCanvasView content={content} range={range} />;
    }
    return <SourceLines content={content} language={getLanguageFromFileName(fileName)} range={range} />;
}
