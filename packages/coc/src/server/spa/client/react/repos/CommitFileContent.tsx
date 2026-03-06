/**
 * CommitFileContent — right-panel view for the full content of a single file in a commit.
 *
 * Markdown files render as markdown; all other files render as line-numbered source.
 * Deleted files fall back to the first parent on the server so their last content remains visible.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchApi } from '../hooks/useApi';
import { Spinner, Button } from '../shared';
import { renderMarkdownToHtml } from '../../markdown-renderer';
import { getLanguageFromFileName, highlightLine } from './useSyntaxHighlight';

interface CommitFileContentResponse {
    path: string;
    fileName: string;
    lines: string[];
    totalLines: number;
    truncated: boolean;
    language: string;
    resolvedRef: string;
}

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);

function isMarkdownFile(fileName: string, language: string): boolean {
    if (MARKDOWN_EXTENSIONS.has(language.toLowerCase())) {
        return true;
    }
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    return MARKDOWN_EXTENSIONS.has(ext);
}

export interface CommitFileContentProps {
    workspaceId: string;
    hash: string;
    filePath: string;
}

export function CommitFileContent({ workspaceId, hash, filePath }: CommitFileContentProps) {
    const [content, setContent] = useState<CommitFileContentResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const markdownRef = useRef<HTMLDivElement>(null);

    const contentUrl = `/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${hash}/files/${encodeURIComponent(filePath)}/content`;

    useEffect(() => {
        setLoading(true);
        setError(null);
        setContent(null);
        fetchApi(contentUrl)
            .then((data) => setContent(data))
            .catch((err) => setError(err.message || 'Failed to load file content'))
            .finally(() => setLoading(false));
    }, [contentUrl]);

    useEffect(() => {
        if (!content || !markdownRef.current || !isMarkdownFile(content.fileName, content.language)) {
            return;
        }

        const hljs = (window as Window & { hljs?: { highlightElement: (block: Element) => void } }).hljs;
        if (!hljs) {
            return;
        }

        markdownRef.current.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    }, [content]);

    const syntaxLanguage = useMemo(
        () => getLanguageFromFileName(content?.fileName) ?? null,
        [content?.fileName],
    );

    const markdownHtml = useMemo(() => {
        if (!content || !isMarkdownFile(content.fileName, content.language)) {
            return null;
        }
        return renderMarkdownToHtml(content.lines.join('\n'), { stripFrontmatter: true });
    }, [content]);

    return (
        <div className="commit-file-content flex flex-col h-full overflow-hidden" data-testid="commit-file-content">
            <div
                className="px-4 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526] flex items-center justify-between gap-3"
                data-testid="commit-file-path"
            >
                <span className="text-xs font-mono text-[#616161] dark:text-[#999] break-all">{filePath}</span>
                {content && content.resolvedRef !== `${hash}:${filePath}` ? (
                    <span className="text-[10px] text-[#848484] whitespace-nowrap" data-testid="commit-file-fallback-badge">
                        Showing parent version
                    </span>
                ) : null}
            </div>

            <div className="flex-1 overflow-auto px-4 py-3" data-testid="commit-file-content-body">
                {loading ? (
                    <div className="flex items-center gap-2 text-xs text-[#848484]" data-testid="commit-file-content-loading">
                        <Spinner size="sm" /> Loading file...
                    </div>
                ) : error ? (
                    <div className="flex items-center gap-2" data-testid="commit-file-content-error">
                        <span className="text-xs text-[#d32f2f] dark:text-[#f48771]">{error}</span>
                        <Button variant="secondary" size="sm" onClick={() => {
                            setLoading(true);
                            setError(null);
                            fetchApi(contentUrl)
                                .then((data) => setContent(data))
                                .catch((err) => setError(err.message || 'Failed to load file content'))
                                .finally(() => setLoading(false));
                        }}>Retry</Button>
                    </div>
                ) : content && markdownHtml !== null ? (
                    <div
                        ref={markdownRef}
                        className="markdown-body text-sm text-[#1e1e1e] dark:text-[#cccccc]"
                        data-testid="commit-file-markdown"
                        dangerouslySetInnerHTML={{ __html: markdownHtml }}
                    />
                ) : content ? (
                    <div className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e]" data-testid="commit-file-code">
                        {content.lines.map((line, index) => (
                            <div key={index} className="flex border-b last:border-b-0 border-[#f0f0f0] dark:border-[#2d2d2d]" data-testid="commit-file-code-line">
                                <span
                                    className="select-none text-right px-3 py-1 text-xs font-mono text-[#848484] border-r border-[#f0f0f0] dark:border-[#2d2d2d] bg-[#fafafa] dark:bg-[#252526]"
                                    style={{ minWidth: `${String(content.totalLines).length + 2}ch` }}
                                >
                                    {index + 1}
                                </span>
                                <span
                                    className="flex-1 min-w-0 px-3 py-1 text-xs font-mono text-[#1e1e1e] dark:text-[#d4d4d4]"
                                    style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                                    dangerouslySetInnerHTML={{ __html: highlightLine(line || ' ', syntaxLanguage) || '&nbsp;' }}
                                />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-xs text-[#848484]" data-testid="commit-file-content-empty">(empty file)</div>
                )}
            </div>
        </div>
    );
}
