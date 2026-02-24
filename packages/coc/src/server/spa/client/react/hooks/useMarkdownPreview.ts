/**
 * useMarkdownPreview — shared hook for rendering markdown content with
 * highlight.js syntax highlighting and mermaid diagram support.
 *
 * Used by both TaskPreview and FilePreview to avoid duplicating the
 * render → hljs → mermaid pipeline.
 */

import { useEffect } from 'react';
import { renderMarkdownToHtml, renderSourceModeToHtml, type RenderOptions } from '../../markdown-renderer';
import { useMermaid } from './useMermaid';
import { useCodeBlockActions } from './useCodeBlockActions';

export interface UseMarkdownPreviewOptions extends RenderOptions {
    /** Raw markdown content to render. */
    content: string;
    /** Ref to the container element that holds the rendered HTML. */
    containerRef: React.RefObject<HTMLElement | null>;
    /** Whether the content is still loading (skip rendering). */
    loading?: boolean;
    /**
     * Controls which rendering pipeline is used.
     * - 'review' (default): full pipeline — renderMarkdownToHtml, hljs, mermaid, code-block handlers
     * - 'source': lightweight source view — renderSourceModeToHtml only, no post-render effects
     */
    viewMode?: 'review' | 'source';
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
    viewMode,
    ...renderOptions
}: UseMarkdownPreviewOptions): UseMarkdownPreviewResult {
    const isSourceMode = viewMode === 'source';

    const html = !loading && content
        ? isSourceMode
            ? renderSourceModeToHtml(content)
            : renderMarkdownToHtml(content, renderOptions)
        : '';

    // Trigger highlight.js on code blocks NOT already rendered by renderCodeBlock.
    // renderCodeBlock applies hljs.highlight() at render time and wraps lines in
    // .code-line spans with .line-number gutters. Calling hljs.highlightElement()
    // on those blocks would replace the innerHTML and destroy that structure.
    useEffect(() => {
        if (!html || !containerRef.current || isSourceMode) return;
        const hljs = (window as any).hljs;
        if (hljs) {
            containerRef.current.querySelectorAll('pre code').forEach((block: Element) => {
                if (block.closest('.code-block-container')) return;
                hljs.highlightElement(block);
            });
        }
    }, [html, containerRef]);

    // Mermaid diagram rendering — pass a null ref in source mode to suppress
    // mermaid without conditionally calling the hook (Rules of Hooks).
    const mermaidRef = isSourceMode ? { current: null } : containerRef;
    useMermaid(mermaidRef);

    // Code block copy/collapse/expand handlers
    useCodeBlockActions(containerRef, [html]);

    return { html };
}
