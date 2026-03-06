/**
 * MarkdownView — renders pre-rendered HTML and triggers hljs highlighting.
 * Replaces markdown-renderer.ts pattern for React usage.
 *
 * When `sectionMarkdown` is provided and there are H2/H3 headings, a single
 * copy button is placed on the first heading to copy the entire article.
 */

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CopySectionBtn } from './CopySectionBtn';

export interface MarkdownSectionData {
    heading: string;
    level: number;
    body: string;
}

interface MarkdownViewProps {
    html: string;
    /** Per-section markdown slices — when present, a copy button is shown on the first heading. */
    sectionMarkdown?: MarkdownSectionData[];
    /** Full article markdown — when provided, the copy button copies this instead of joining sections. */
    fullMarkdown?: string;
    /** When true, section copy buttons are hidden (e.g. during streaming). */
    hideSectionCopy?: boolean;
}

export function MarkdownView({ html, sectionMarkdown, fullMarkdown, hideSectionCopy }: MarkdownViewProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [headingPortals, setHeadingPortals] = React.useState<
        { element: HTMLElement; markdown: string; key: string }[]
    >([]);

    useEffect(() => {
        const hljs = (window as any).hljs;
        if (hljs && containerRef.current) {
            containerRef.current.querySelectorAll('pre code').forEach((block: Element) => {
                hljs.highlightElement(block);
            });
        }
    }, [html]);

    // Build a single portal on the first H2/H3 heading to copy the full article.
    useEffect(() => {
        if (!containerRef.current || !sectionMarkdown || sectionMarkdown.length === 0 || hideSectionCopy) {
            setHeadingPortals([]);
            return;
        }

        const headings = containerRef.current.querySelectorAll('h2, h3');
        if (headings.length === 0) {
            setHeadingPortals([]);
            return;
        }

        const sectionsWithHeading = sectionMarkdown.filter(s => s.level > 0);
        const fullText = fullMarkdown ?? sectionsWithHeading
            .map(s => s.heading + (s.body ? '\n' + s.body : ''))
            .join('\n\n');

        const firstEl = headings[0] as HTMLElement;
        firstEl.style.position = 'relative';
        firstEl.classList.add('group/section');

        setHeadingPortals([{ element: firstEl, markdown: fullText, key: 'article-copy' }]);
    }, [html, sectionMarkdown, fullMarkdown, hideSectionCopy]);

    return (
        <>
            <div
                ref={containerRef}
                className="markdown-body text-sm text-[#1e1e1e] dark:text-[#cccccc]"
                dangerouslySetInnerHTML={{ __html: html }}
            />
            {headingPortals.map(p =>
                createPortal(
                    <CopySectionBtn key={p.key} sectionMarkdown={p.markdown} />,
                    p.element
                )
            )}
        </>
    );
}
