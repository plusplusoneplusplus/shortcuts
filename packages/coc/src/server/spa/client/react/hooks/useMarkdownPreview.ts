/**
 * useMarkdownPreview — shared hook for rendering markdown content with
 * highlight.js syntax highlighting and mermaid diagram support.
 *
 * Used by both TaskPreview and FilePreview to avoid duplicating the
 * render → hljs → mermaid pipeline.
 */

import { useEffect } from 'react';
import { renderMarkdownToHtml, type RenderOptions } from '../../markdown-renderer';
import { useMermaid } from './useMermaid';

export interface UseMarkdownPreviewOptions extends RenderOptions {
    /** Raw markdown content to render. */
    content: string;
    /** Ref to the container element that holds the rendered HTML. */
    containerRef: React.RefObject<HTMLElement | null>;
    /** Whether the content is still loading (skip rendering). */
    loading?: boolean;
}

export interface UseMarkdownPreviewResult {
    /** Rendered HTML string ready for dangerouslySetInnerHTML. */
    html: string;
}

/**
 * Render markdown to HTML and apply post-render enhancements (hljs, mermaid).
 */
export function useMarkdownPreview({
    content,
    containerRef,
    loading,
    ...renderOptions
}: UseMarkdownPreviewOptions): UseMarkdownPreviewResult {
    const html = !loading && content
        ? renderMarkdownToHtml(content, renderOptions)
        : '';

    // Trigger highlight.js after HTML is rendered into the DOM
    useEffect(() => {
        if (!html || !containerRef.current) return;
        const hljs = (window as any).hljs;
        if (hljs) {
            containerRef.current.querySelectorAll('pre code').forEach((block: Element) => {
                hljs.highlightElement(block);
            });
        }
    }, [html, containerRef]);

    // Mermaid diagram rendering
    useMermaid(containerRef);

    return { html };
}
