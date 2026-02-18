/**
 * FilePreview — hover tooltip that shows file content on mouse enter.
 * Wraps children and renders a portal tooltip with cached file preview.
 *
 * For markdown files, renders using the shared markdown pipeline.
 * For other files, uses row-based line rendering with word wrap.
 */

import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import ReactDOM from 'react-dom';
import { useApp } from '../context/AppContext';
import { getApiBase } from '../utils/config';
import { renderMarkdownToHtml } from '../../markdown-renderer';
import { Spinner } from './Spinner';
import { cn } from './cn';

interface FilePreviewResponse {
    path: string;
    fileName: string;
    lines: string[];
    totalLines: number;
    truncated: boolean;
    language: string;
}

interface CacheEntry {
    data: FilePreviewResponse | null;
    error: string | null;
    timestamp: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 50;

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);

function isMarkdownFile(fileName: string, language: string): boolean {
    if (MARKDOWN_EXTENSIONS.has(language)) return true;
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    return MARKDOWN_EXTENSIONS.has(ext);
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export interface FilePreviewProps {
    filePath: string;
    wsId?: string;
    children: ReactNode;
}

export function FilePreview({ filePath, wsId, children }: FilePreviewProps) {
    const { state } = useApp();
    const [visible, setVisible] = useState(false);
    const [loading, setLoading] = useState(false);
    const [preview, setPreview] = useState<FilePreviewResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pos, setPos] = useState({ top: 0, left: 0 });

    const triggerRef = useRef<HTMLSpanElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const resolveWsId = useCallback((): string | null => {
        if (wsId) return wsId;
        // Longest-prefix match on workspace rootPath
        let best: { id: string; len: number } | null = null;
        for (const ws of state.workspaces) {
            if (ws.rootPath && filePath.startsWith(ws.rootPath)) {
                const len = ws.rootPath.length;
                if (!best || len > best.len) best = { id: ws.id, len };
            }
        }
        return best?.id ?? state.workspaces[0]?.id ?? null;
    }, [wsId, filePath, state.workspaces]);

    const fetchPreview = useCallback(async () => {
        const cache = cacheRef.current;
        const cached = cache.get(filePath);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
            setPreview(cached.data);
            setError(cached.error);
            return;
        }

        const resolvedWsId = resolveWsId();
        if (!resolvedWsId) {
            setError('No workspace available');
            return;
        }

        setLoading(true);
        try {
            const params = new URLSearchParams({ path: filePath });
            const url = `${getApiBase()}/workspaces/${encodeURIComponent(resolvedWsId)}/files/preview?${params}`;
            const res = await fetch(url);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `HTTP ${res.status}`);
            }
            const data: FilePreviewResponse = await res.json();
            // Evict oldest if at capacity
            if (cache.size >= MAX_CACHE_ENTRIES) {
                const oldest = cache.keys().next().value;
                if (oldest) cache.delete(oldest);
            }
            cache.set(filePath, { data, error: null, timestamp: Date.now() });
            setPreview(data);
            setError(null);
        } catch (err: any) {
            const msg = err.message || 'Failed to load preview';
            cacheRef.current.set(filePath, { data: null, error: msg, timestamp: Date.now() });
            setError(msg);
            setPreview(null);
        } finally {
            setLoading(false);
        }
    }, [filePath, resolveWsId]);

    const handleMouseEnter = useCallback(() => {
        if (hideTimerRef.current) {
            clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
        }
        const el = triggerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        let left = rect.left;
        let top = rect.bottom + 6;
        const tipWidth = 500;
        const tipMaxHeight = 350;
        if (left + tipWidth > window.innerWidth - 16) left = window.innerWidth - tipWidth - 16;
        if (left < 8) left = 8;
        if (top + tipMaxHeight > window.innerHeight - 16) {
            top = rect.top - tipMaxHeight - 6;
            if (top < 8) top = 8;
        }
        setPos({ top, left });
        setVisible(true);
        fetchPreview();
    }, [fetchPreview]);

    const handleMouseLeave = useCallback(() => {
        hideTimerRef.current = setTimeout(() => setVisible(false), 200);
    }, []);

    const handleTooltipEnter = useCallback(() => {
        if (hideTimerRef.current) {
            clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
        }
    }, []);

    const handleTooltipLeave = useCallback(() => {
        hideTimerRef.current = setTimeout(() => setVisible(false), 200);
    }, []);

    // Apply hljs highlighting for markdown preview
    useEffect(() => {
        if (!preview || !contentRef.current) return;
        if (!isMarkdownFile(preview.fileName, preview.language)) return;
        const hljs = (window as any).hljs;
        if (hljs) {
            contentRef.current.querySelectorAll('pre code').forEach((block: Element) => {
                hljs.highlightElement(block);
            });
        }
    }, [preview]);

    const renderContent = () => {
        if (!preview) return null;

        if (isMarkdownFile(preview.fileName, preview.language)) {
            const mdContent = preview.lines.join('\n');
            const html = renderMarkdownToHtml(mdContent, { stripFrontmatter: true });
            return (
                <div
                    ref={contentRef}
                    className="markdown-body text-xs p-3 text-[#1e1e1e] dark:text-[#cccccc]"
                    dangerouslySetInnerHTML={{ __html: html }}
                />
            );
        }

        const gutterWidth = String(preview.lines.length).length;
        return (
            <div className="file-preview-lines p-1" role="table">
                {preview.lines.map((line, i) => (
                    <div key={i} className="file-preview-line flex" role="row">
                        <span
                            className="file-preview-line-number select-none text-right pr-3 text-[#848484] text-xs font-mono"
                            style={{ minWidth: `${gutterWidth + 1}ch` }}
                            role="rowheader"
                        >
                            {i + 1}
                        </span>
                        <span
                            className="file-preview-line-content text-xs font-mono text-[#1e1e1e] dark:text-[#d4d4d4]"
                            style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', flex: 1, minWidth: 0 }}
                        >
                            {line || '\u200B'}
                        </span>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <>
            <span
                ref={triggerRef}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                {children}
            </span>
            {visible && ReactDOM.createPortal(
                <div
                    className="fixed z-50 w-[500px] max-h-[350px] overflow-auto rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-xl"
                    style={{ top: pos.top, left: pos.left }}
                    onMouseEnter={handleTooltipEnter}
                    onMouseLeave={handleTooltipLeave}
                >
                    {loading && (
                        <div className="flex items-center gap-2 p-3 text-xs text-[#848484]">
                            <Spinner size="sm" /> Loading…
                        </div>
                    )}
                    {error && !loading && (
                        <div className="p-3 text-xs text-[#848484]">Preview unavailable</div>
                    )}
                    {preview && !loading && (
                        <>
                            <div className="flex items-center justify-between px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                                <span className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc] truncate">{preview.fileName}</span>
                                <span className="text-[10px] text-[#848484]">
                                    {preview.lines.length} lines{preview.truncated ? ` (${preview.totalLines} total)` : ''}
                                </span>
                            </div>
                            {renderContent()}
                        </>
                    )}
                </div>,
                document.body
            )}
        </>
    );
}
