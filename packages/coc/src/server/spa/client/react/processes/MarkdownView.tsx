/**
 * MarkdownView — renders pre-rendered HTML and triggers hljs highlighting.
 * Replaces markdown-renderer.ts pattern for React usage.
 */

import { useEffect, useRef } from 'react';

interface MarkdownViewProps {
    html: string;
}

export function MarkdownView({ html }: MarkdownViewProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const hljs = (window as any).hljs;
        if (hljs && containerRef.current) {
            containerRef.current.querySelectorAll('pre code').forEach((block: Element) => {
                hljs.highlightElement(block);
            });
        }
    }, [html]);

    return (
        <div
            ref={containerRef}
            className="markdown-body text-sm text-[#1e1e1e] dark:text-[#cccccc]"
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}
