/**
 * MarkdownView — renders pre-rendered HTML and triggers hljs highlighting.
 * Replaces markdown-renderer.ts pattern for React usage.
 *
 * When `sectionMarkdown` is provided and there are H2/H3 headings, a single
 * copy button is placed on the first heading to copy the entire article.
 *
 * Tables with ≥ 5 rows and ≥ 2 columns are progressively upgraded to
 * interactive TanStack Table instances with sort, filter, pagination, and
 * numeric aggregation (sum/avg). The original static table is hidden but
 * kept in the DOM for snapshot copy and accessibility fallback.
 *
 * Excalidraw diagram placeholders (`.md-excalidraw-embed`) are mounted as
 * interactive preview canvases via React portals.
 */

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CopySectionBtn } from '../ui/CopySectionBtn';
import { useMermaid } from '../hooks/ui/useMermaid';
import { extractTablesFromHtml, type ExtractedTable } from './extractTablesFromHtml';
import { InteractiveTable } from './InteractiveTable';
import { ExcalidrawPreview } from './ExcalidrawPreview';
import { mountHtmlEmbeds } from './htmlEmbedMount';
import { mountMapEmbeds } from './mapEmbedMount';
import { SHOW_EXCALIDRAW_DIAGRAMS } from '../featureFlags';

export interface MarkdownSectionData {
    heading: string;
    level: number;
    body: string;
}

export interface MarkdownViewProps {
    html: string;
    /** Per-section markdown slices — when present, a copy button is shown on the first heading. */
    sectionMarkdown?: MarkdownSectionData[];
    /** Full article markdown — when provided, the copy button copies this instead of joining sections. */
    fullMarkdown?: string;
    /** When true, section copy buttons are hidden (e.g. during streaming). */
    hideSectionCopy?: boolean;
}

interface ExcalidrawPortal {
    mountEl: HTMLElement;
    workspaceId: string;
    canvasId: string;
    key: string;
}

export function MarkdownView({ html, sectionMarkdown, fullMarkdown, hideSectionCopy }: MarkdownViewProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [headingPortals, setHeadingPortals] = React.useState<
        { element: HTMLElement; markdown: string; key: string }[]
    >([]);
    const [tablePortals, setTablePortals] = React.useState<
        { mountEl: HTMLElement; table: ExtractedTable; key: string }[]
    >([]);
    const [excalidrawPortals, setExcalidrawPortals] = React.useState<ExcalidrawPortal[]>([]);

    useMermaid(containerRef, html);

    useEffect(() => {
        const hljs = (window as any).hljs;
        if (hljs && containerRef.current) {
            containerRef.current.querySelectorAll('pre code').forEach((block: Element) => {
                hljs.highlightElement(block);
            });
        }
        if (!hideSectionCopy) {
            mountHtmlEmbeds(containerRef.current);
            mountMapEmbeds(containerRef.current);
        }
    }, [html, hideSectionCopy]);

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

    // Upgrade eligible static tables to interactive TanStack Table instances.
    useEffect(() => {
        if (!containerRef.current || hideSectionCopy) {
            setTablePortals([]);
            return;
        }

        const extracted = extractTablesFromHtml(containerRef.current);
        if (extracted.length === 0) {
            setTablePortals([]);
            return;
        }

        const portals: typeof tablePortals = [];
        for (let i = 0; i < extracted.length; i++) {
            const ex = extracted[i];
            const tableId = ex.containerEl.getAttribute('data-table-id') ?? String(i);

            // Check if we already inserted a mount node (re-render guard)
            const existingMount = ex.containerEl.parentElement?.querySelector(
                `.interactive-table-mount[data-for-table="${tableId}"]`,
            );
            if (existingMount) {
                portals.push({ mountEl: existingMount as HTMLElement, table: ex, key: tableId });
                continue;
            }

            // Create a mount node before the container and hide the original
            const mountEl = document.createElement('div');
            mountEl.className = 'interactive-table-mount';
            mountEl.setAttribute('data-for-table', tableId);
            ex.containerEl.parentElement?.insertBefore(mountEl, ex.containerEl);
            ex.containerEl.style.display = 'none';

            portals.push({ mountEl, table: ex, key: tableId });
        }

        setTablePortals(portals);

        // Cleanup: restore original tables when effect re-runs
        return () => {
            for (const { mountEl, table } of portals) {
                table.containerEl.style.display = '';
                mountEl.remove();
            }
        };
    }, [html, hideSectionCopy]);

    // Mount Excalidraw diagram preview canvases on placeholder divs.
    useEffect(() => {
        if (!SHOW_EXCALIDRAW_DIAGRAMS || !containerRef.current || hideSectionCopy) {
            setExcalidrawPortals([]);
            return;
        }

        const placeholders = Array.from(
            containerRef.current.querySelectorAll<HTMLElement>('.md-excalidraw-embed'),
        );
        if (placeholders.length === 0) {
            setExcalidrawPortals([]);
            return;
        }

        const portals: ExcalidrawPortal[] = [];
        for (let i = 0; i < placeholders.length; i++) {
            const el = placeholders[i];
            const wsId = el.dataset.wsId;
            // Diagrams are canvases now — render from the canvas store via data-canvas-id.
            // Legacy excalidraw:// embeds (data-diagram-path only) point at the removed
            // /api/diagrams endpoint, so they are intentionally not mounted.
            const canvasId = el.dataset.canvasId;
            if (!wsId || !canvasId) continue;

            const embedKey = `excalidraw-${wsId}-${canvasId}-${i}`;

            // Re-render guard
            const existingMount = el.querySelector('.excalidraw-preview-mount');
            if (existingMount) {
                portals.push({
                    mountEl: existingMount as HTMLElement,
                    workspaceId: wsId,
                    canvasId,
                    key: embedKey,
                });
                continue;
            }

            const mountEl = document.createElement('div');
            mountEl.className = 'excalidraw-preview-mount';
            el.appendChild(mountEl);

            portals.push({ mountEl, workspaceId: wsId, canvasId, key: embedKey });
        }

        setExcalidrawPortals(portals);

        return () => {
            for (const { mountEl } of portals) {
                mountEl.remove();
            }
        };
    }, [html, hideSectionCopy]);

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
            {tablePortals.map(({ mountEl, table, key }) =>
                createPortal(
                    <InteractiveTable
                        key={key}
                        tableKey={key}
                        {...table.data}
                    />,
                    mountEl
                )
            )}
            {excalidrawPortals.map(({ mountEl, workspaceId, canvasId, key }) =>
                createPortal(
                    <ExcalidrawPreview
                        key={key}
                        workspaceId={workspaceId}
                        canvasId={canvasId}
                    />,
                    mountEl
                )
            )}
        </>
    );
}
