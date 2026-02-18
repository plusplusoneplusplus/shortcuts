/**
 * TaskPreview — right-panel markdown preview with mermaid support.
 */

import { useState, useEffect, useRef } from 'react';
import { fetchApi } from '../hooks/useApi';
import { useMermaid } from '../hooks/useMermaid';
import { renderMarkdownToHtml } from '../../markdown-renderer';
import { Spinner } from '../shared';

interface TaskPreviewProps {
    wsId: string;
    filePath: string;
}

export function TaskPreview({ wsId, filePath }: TaskPreviewProps) {
    const [html, setHtml] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const previewRef = useRef<HTMLDivElement>(null);

    useMermaid(previewRef);

    useEffect(() => {
        setLoading(true);
        setError(null);

        fetchApi(`/workspaces/${encodeURIComponent(wsId)}/tasks/content?path=${encodeURIComponent(filePath)}`)
            .then((data) => {
                const content = typeof data === 'string' ? data : (data?.content || '');
                const rendered = renderMarkdownToHtml(content, { stripFrontmatter: true });
                setHtml(rendered);
                setLoading(false);
            })
            .catch((err) => {
                setError(err instanceof Error ? err.message : 'Failed to load file');
                setLoading(false);
            });
    }, [wsId, filePath]);

    // Trigger hljs after render
    useEffect(() => {
        if (html && previewRef.current) {
            const hljs = (window as any).hljs;
            if (hljs) {
                previewRef.current.querySelectorAll('pre code').forEach((block: Element) => {
                    hljs.highlightElement(block);
                });
            }
        }
    }, [html]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Spinner size="lg" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 text-sm text-[#f14c4c]">{error}</div>
        );
    }

    return (
        <div className="flex flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4">
                <div
                    ref={previewRef}
                    id="task-preview-body"
                    className="markdown-body text-sm text-[#1e1e1e] dark:text-[#cccccc]"
                    dangerouslySetInnerHTML={{ __html: html }}
                />
            </div>
            {/* Comment sidebar stub (commit 008) */}
            <div data-testid="comment-sidebar-stub" />
        </div>
    );
}
