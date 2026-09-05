/**
 * MarkdownFileView — formatted markdown with a Rendered ⇄ Raw toggle. A line
 * range highlights the renderer's `.md-line` rows in rendered mode, and is
 * delegated to Monaco in raw mode. The `source-canvas-*` test ids are
 * historical: the chat canvas is still the only host that enables this view.
 */
import { useEffect, useRef, useState } from 'react';
import { useMarkdownPreview } from '../../hooks/ui/useMarkdownPreview';
import { MonacoFileEditor } from './MonacoFileEditor';
import type { LineRange } from './types';

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);

/** CSS class applied to highlighted line rows (styled in tailwind.css). */
const LINE_HIGHLIGHT_CLASS = 'source-canvas-line-highlight';

/** A `.md`/`.markdown`/`.mdx` extension OR a server language hint of markdown. */
export function isMarkdownFile(fileName: string, language?: string): boolean {
    if (language && MARKDOWN_EXTENSIONS.has(language)) {
        return true;
    }
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    return MARKDOWN_EXTENSIONS.has(ext);
}

export interface MarkdownFileViewProps {
    content: string;
    /** Referenced line range to highlight + scroll to, if any. */
    range?: LineRange | null;
    /** Test id for the raw-mode Monaco container. */
    codeTestId?: string;
}

export function MarkdownFileView({ content, range, codeTestId }: MarkdownFileViewProps) {
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
            {/* Raw mode: Monaco owns the scrolling, so the host must not also
                scroll. Rendered mode keeps its own overflow-auto. */}
            <div className={`flex-1 min-h-0 ${raw ? 'overflow-hidden' : 'overflow-auto'}`}>
                {raw ? (
                    <div className="h-full w-full min-h-0" data-testid={codeTestId}>
                        <MonacoFileEditor
                            value={content}
                            language="markdown"
                            readOnly
                            highlightRange={range ?? null}
                        />
                    </div>
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
