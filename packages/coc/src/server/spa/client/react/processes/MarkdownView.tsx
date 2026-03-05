/**
 * MarkdownView — renders pre-rendered HTML and triggers hljs highlighting.
 * Replaces markdown-renderer.ts pattern for React usage.
 *
 * When `sectionMarkdown` is provided, H2/H3 headings get a per-section
 * copy button that appears on hover.
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
    /** Per-section markdown slices — when present, section copy buttons are shown. */
    sectionMarkdown?: MarkdownSectionData[];
    /** When true, section copy buttons are hidden (e.g. during streaming). */
    hideSectionCopy?: boolean;
}

export function MarkdownView({ html, sectionMarkdown, hideSectionCopy }: MarkdownViewProps) {
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

    // Build portal targets for section copy buttons after each render.
    useEffect(() => {
        if (!containerRef.current || !sectionMarkdown || sectionMarkdown.length === 0 || hideSectionCopy) {
            setHeadingPortals([]);
            return;
        }

        const headings = containerRef.current.querySelectorAll('h2, h3');
        const portals: { element: HTMLElement; markdown: string; key: string }[] = [];

        // Match DOM headings to sectionMarkdown entries that have a heading (level > 0).
        const sectionsWithHeading = sectionMarkdown.filter(s => s.level > 0);
        headings.forEach((headingEl, i) => {
            if (i < sectionsWithHeading.length) {
                const sec = sectionsWithHeading[i];
                const md = sec.heading + (sec.body ? '\n' + sec.body : '');

                // Ensure the heading element is position-relative for the absolute button.
                const el = headingEl as HTMLElement;
                el.style.position = 'relative';
                el.classList.add('group/section');

                portals.push({ element: el, markdown: md, key: `sec-${i}` });
            }
        });

        setHeadingPortals(portals);
    }, [html, sectionMarkdown, hideSectionCopy]);

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
