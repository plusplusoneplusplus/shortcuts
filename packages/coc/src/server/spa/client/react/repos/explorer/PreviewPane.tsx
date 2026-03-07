/**
 * PreviewPane — renders file content with syntax highlighting, markdown rendering,
 * image display, and binary/empty file handling.
 *
 * Fetches blob content from the API and supports loading/error/retry states.
 * Cancels in-flight requests when the file path changes.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchApi } from '../../hooks/useApi';
import { Spinner, Button } from '../../shared';
import { renderMarkdownToHtml } from '../../../markdown-renderer';
import { getLanguageFromFileName, highlightLine, escapeHtml } from '../useSyntaxHighlight';

export interface PreviewPaneProps {
    repoId: string;
    /** Relative path from repo root, e.g. "src/index.ts" */
    filePath: string;
    /** File name for language detection, e.g. "index.ts" */
    fileName: string;
    /** Called when the user clicks the close button */
    onClose?: () => void;
}

interface BlobResponse {
    content: string;
    encoding: 'utf-8' | 'base64';
    mimeType: string;
}

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);
const MAX_PREVIEW_SIZE = 512 * 1024; // 512 KB

function isMarkdownFile(fileName: string): boolean {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    return MARKDOWN_EXTENSIONS.has(ext);
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} bytes`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Breadcrumb-style path header with close button. */
function PathHeader({ filePath, fileName, onClose }: { filePath: string; fileName: string; onClose?: () => void }) {
    const segments = filePath.split('/');
    return (
        <div
            className="flex items-center gap-1 px-4 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526] min-h-[36px]"
            data-testid="preview-header"
        >
            <div className="flex-1 flex items-center gap-1 text-xs font-mono text-[#616161] dark:text-[#999] overflow-hidden">
                {segments.map((seg, i) => (
                    <span key={i} className="flex items-center gap-1 min-w-0">
                        {i > 0 && <span className="text-[#848484] flex-shrink-0">/</span>}
                        <span className={i === segments.length - 1 ? 'font-semibold text-[#1e1e1e] dark:text-[#cccccc] truncate' : 'truncate'}>
                            {seg}
                        </span>
                    </span>
                ))}
            </div>
            {onClose && (
                <button
                    className="flex-shrink-0 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-sm px-1 transition-colors"
                    onClick={onClose}
                    title="Close preview"
                    data-testid="preview-close-btn"
                >
                    ×
                </button>
            )}
        </div>
    );
}

export function PreviewPane({ repoId, filePath, fileName, onClose }: PreviewPaneProps) {
    const [blob, setBlob] = useState<BlobResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const markdownRef = useRef<HTMLDivElement>(null);

    // Fetch blob on mount or path change; cancel in-flight on change
    useEffect(() => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setLoading(true);
        setError(null);
        setBlob(null);

        fetchApi(
            `/api/repos/${encodeURIComponent(repoId)}/blob?path=${encodeURIComponent(filePath)}`,
            { signal: controller.signal },
        )
            .then((data: BlobResponse) => {
                if (!controller.signal.aborted) setBlob(data);
            })
            .catch((err: Error) => {
                if (!controller.signal.aborted) {
                    setError(err.message || 'Failed to load file');
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });

        return () => controller.abort();
    }, [repoId, filePath]);

    const doRetry = () => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setLoading(true);
        setError(null);
        setBlob(null);
        fetchApi(
            `/api/repos/${encodeURIComponent(repoId)}/blob?path=${encodeURIComponent(filePath)}`,
            { signal: controller.signal },
        )
            .then((data: BlobResponse) => {
                if (!controller.signal.aborted) setBlob(data);
            })
            .catch((err: Error) => {
                if (!controller.signal.aborted) {
                    setError(err.message || 'Failed to load file');
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
    };

    // Post-render hljs on markdown code blocks
    useEffect(() => {
        if (!blob || !markdownRef.current || !isMarkdownFile(fileName)) return;
        const hljs = (window as Window & { hljs?: { highlightElement: (block: Element) => void } }).hljs;
        if (!hljs) return;
        markdownRef.current.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    }, [blob, fileName]);

    const isImage = blob?.encoding === 'base64' && blob.mimeType.startsWith('image/');
    const isBinary = blob?.encoding === 'base64' && !isImage;
    const isOversized = blob?.encoding === 'utf-8' && blob.content.length > MAX_PREVIEW_SIZE;

    const displayContent = useMemo(() => {
        if (!blob || blob.encoding !== 'utf-8') return '';
        if (isOversized) return blob.content.slice(0, MAX_PREVIEW_SIZE);
        return blob.content;
    }, [blob, isOversized]);

    const syntaxLanguage = useMemo(
        () => getLanguageFromFileName(fileName),
        [fileName],
    );

    const markdownHtml = useMemo(() => {
        if (!blob || blob.encoding !== 'utf-8' || !isMarkdownFile(fileName)) return null;
        return renderMarkdownToHtml(displayContent, { stripFrontmatter: true });
    }, [blob, displayContent, fileName]);

    const lines = useMemo(
        () => displayContent.split('\n'),
        [displayContent],
    );

    const gutterWidth = useMemo(
        () => String(lines.length).length + 1,
        [lines.length],
    );

    return (
        <div className="flex flex-col h-full overflow-hidden" data-testid="preview-pane">
            <PathHeader filePath={filePath} fileName={fileName} onClose={onClose} />

            <div className="flex-1 overflow-auto" data-testid="preview-body">
                {loading ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-xs text-[#848484]" data-testid="preview-loading">
                        <Spinner size="sm" /> Loading {fileName}…
                    </div>
                ) : error ? (
                    <div className="flex items-center gap-2 px-4 py-4" data-testid="preview-error">
                        <span className="text-xs text-[#d32f2f] dark:text-[#f48771]">{error}</span>
                        <Button variant="secondary" size="sm" onClick={doRetry} data-testid="preview-retry-btn">Retry</Button>
                    </div>
                ) : blob && blob.encoding === 'utf-8' && blob.content === '' ? (
                    <div className="flex items-center justify-center py-8 text-sm text-[#848484] italic" data-testid="preview-empty">
                        (empty file)
                    </div>
                ) : isImage ? (
                    <div className="flex items-center justify-center p-4" data-testid="preview-image">
                        <img
                            src={`data:${blob!.mimeType};base64,${blob!.content}`}
                            alt={fileName}
                            className="max-w-full max-h-[80vh] object-contain"
                        />
                    </div>
                ) : isBinary ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-8 text-sm text-[#848484]" data-testid="preview-binary">
                        <span className="text-2xl">📄</span>
                        <span>Binary file — {formatFileSize(blob!.content.length)} bytes</span>
                    </div>
                ) : markdownHtml !== null ? (
                    <div className="px-4 py-3">
                        {isOversized && (
                            <div className="mb-3 px-3 py-2 rounded bg-[#fff3cd] dark:bg-[#664d03] text-xs text-[#856404] dark:text-[#ffc107]" data-testid="preview-truncated-banner">
                                File too large to preview (showing first 512 KB)
                            </div>
                        )}
                        <div
                            ref={markdownRef}
                            className="markdown-body text-sm text-[#1e1e1e] dark:text-[#cccccc]"
                            data-testid="preview-markdown"
                            dangerouslySetInnerHTML={{ __html: markdownHtml }}
                        />
                    </div>
                ) : blob ? (
                    <div className="px-4 py-3">
                        {isOversized && (
                            <div className="mb-3 px-3 py-2 rounded bg-[#fff3cd] dark:bg-[#664d03] text-xs text-[#856404] dark:text-[#ffc107]" data-testid="preview-truncated-banner">
                                File too large to preview (showing first 512 KB)
                            </div>
                        )}
                        <div className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e]" data-testid="preview-code">
                            {lines.map((line, i) => (
                                <div key={i} className="flex" data-testid="preview-code-line">
                                    <span
                                        className="select-none text-right px-3 py-1 text-xs font-mono text-[#848484] border-r border-[#f0f0f0] dark:border-[#2d2d2d] bg-[#fafafa] dark:bg-[#252526]"
                                        style={{ minWidth: `${gutterWidth}ch` }}
                                    >
                                        {i + 1}
                                    </span>
                                    <span
                                        className="flex-1 min-w-0 px-3 py-1 text-xs font-mono text-[#1e1e1e] dark:text-[#d4d4d4]"
                                        style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                                        dangerouslySetInnerHTML={{ __html: highlightLine(line || ' ', syntaxLanguage) || '&nbsp;' }}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
