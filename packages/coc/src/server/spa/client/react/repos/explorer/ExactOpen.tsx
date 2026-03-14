/**
 * ExactOpen — Ctrl+O file opener with exact/prefix filename matching.
 * Debounces keystrokes and delegates search to the server-side /search endpoint.
 * Portal-rendered to document.body.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import { fetchApi } from '../../hooks/useApi';
import { cn } from '../../shared/cn';

export interface ExactOpenProps {
    workspaceId: string;
    open: boolean;
    onClose: () => void;
    onFileSelect: (filePath: string) => void;
}

/** Extract file name from a path. */
export function fileName(p: string): string {
    const idx = p.lastIndexOf('/');
    return idx < 0 ? p : p.slice(idx + 1);
}

/** Extract directory portion from a path. */
function dirName(p: string): string {
    const idx = p.lastIndexOf('/');
    return idx < 0 ? '' : p.slice(0, idx);
}

/**
 * Exact-match filter: exact basename match ranks first, prefix match second.
 * Returns 2 for exact, 1 for prefix, 0 for no match.
 */
export function exactMatchScore(query: string, filePath: string): 0 | 1 | 2 {
    if (!query) return 1;
    const q = query.toLowerCase();
    const base = fileName(filePath).toLowerCase();
    if (base === q) return 2;
    if (base.startsWith(q)) return 1;
    return 0;
}

export function ExactOpen({ workspaceId, open, onClose, onFileSelect }: ExactOpenProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [highlightIndex, setHighlightIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    // Reset state when dialog opens — no initial fetch
    useEffect(() => {
        if (!open) return;
        setQuery('');
        setResults([]);
        setHighlightIndex(0);
        setLoading(false);
    }, [open]);

    // Debounced server-side search on query change
    useEffect(() => {
        if (!open) return;

        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (abortRef.current) abortRef.current.abort();

        if (!query.trim()) {
            setResults([]);
            setLoading(false);
            return;
        }

        debounceRef.current = setTimeout(() => {
            const abort = new AbortController();
            abortRef.current = abort;
            setLoading(true);
            fetchApi(`/repos/${encodeURIComponent(workspaceId)}/search?q=${encodeURIComponent(query)}&limit=50`)
                .then((data: { results: { path: string; score: number }[]; truncated: boolean }) => {
                    if (abort.signal.aborted) return;
                    setResults(data.results.map(r => r.path));
                })
                .catch(() => {
                    if (abort.signal.aborted) return;
                    setResults([]);
                })
                .finally(() => {
                    if (!abort.signal.aborted) setLoading(false);
                });
        }, 200);

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [query, open, workspaceId]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            if (abortRef.current) abortRef.current.abort();
        };
    }, []);

    // Auto-focus input when opened
    useEffect(() => {
        if (open) {
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    }, [open]);

    // Reset highlight when results change
    useEffect(() => {
        setHighlightIndex(0);
    }, [results]);

    // Scroll highlighted item into view
    useEffect(() => {
        const item = listRef.current?.children[highlightIndex] as HTMLElement | undefined;
        item?.scrollIntoView({ block: 'nearest' });
    }, [highlightIndex]);

    const handleSelect = useCallback((filePath: string) => {
        onFileSelect(filePath);
        onClose();
    }, [onFileSelect, onClose]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightIndex(i => Math.min(i + 1, results.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightIndex(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (results[highlightIndex]) {
                handleSelect(results[highlightIndex]);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    }, [results, highlightIndex, handleSelect, onClose]);

    if (!open) return null;

    const hasExactMatch = query.trim()
        ? results.some(f => fileName(f).toLowerCase() === query.trim().toLowerCase())
        : false;

    const overlay = (
        <div
            className="fixed inset-0 z-[10002] flex justify-center"
            onClick={onClose}
            data-testid="exact-open-overlay"
        >
            {/* Dialog at top-center, like VS Code */}
            <div
                className={cn(
                    'mt-[10vh] w-[90vw] max-w-[600px] h-fit max-h-[60vh] flex flex-col',
                    'bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c]',
                    'rounded-md shadow-xl overflow-hidden',
                )}
                onClick={e => e.stopPropagation()}
                data-testid="exact-open-dialog"
            >
                {/* Header label */}
                <div className="px-3 pt-2 pb-0">
                    <span className="text-[10px] text-[#848484] uppercase tracking-wide">Open File (Exact Match)</span>
                </div>

                {/* Search input */}
                <div className="flex items-center px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <span className="text-[#999] dark:text-[#888] mr-2 text-sm">🎯</span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Type exact filename…"
                        className={cn(
                            'flex-1 bg-transparent text-sm text-[#1e1e1e] dark:text-[#cccccc]',
                            'outline-none border-none placeholder-[#999] dark:placeholder-[#888]',
                        )}
                        data-testid="exact-open-input"
                    />
                    {query && (
                        <button
                            className="text-[#999] hover:text-[#333] dark:hover:text-[#eee] text-sm ml-2"
                            onClick={() => setQuery('')}
                            data-testid="exact-open-clear"
                        >
                            ✕
                        </button>
                    )}
                    {hasExactMatch && (
                        <span className="text-[10px] text-[#4caf50] ml-2" data-testid="exact-open-exact-badge">
                            exact
                        </span>
                    )}
                </div>

                {/* Results list */}
                <div
                    ref={listRef}
                    className="flex-1 overflow-y-auto"
                    data-testid="exact-open-results"
                >
                    {loading ? (
                        <div className="flex items-center justify-center py-4 text-sm text-[#848484]">
                            Loading files…
                        </div>
                    ) : results.length === 0 ? (
                        <div className="flex items-center justify-center py-4 text-sm text-[#848484]" data-testid="exact-open-no-results">
                            No exact match
                        </div>
                    ) : (
                        results.map((filePath, idx) => {
                            const isExact = query.trim()
                                ? fileName(filePath).toLowerCase() === query.trim().toLowerCase()
                                : false;
                            return (
                                <div
                                    key={filePath}
                                    className={cn(
                                        'flex items-center px-3 py-1.5 cursor-pointer text-sm',
                                        idx === highlightIndex
                                            ? 'bg-[#0078d4]/10 dark:bg-[#0078d4]/20'
                                            : 'hover:bg-[#f5f5f5] dark:hover:bg-[#2a2d2e]',
                                    )}
                                    onClick={() => handleSelect(filePath)}
                                    onMouseEnter={() => setHighlightIndex(idx)}
                                    data-testid={`exact-open-item-${idx}`}
                                >
                                    <span className="text-xs mr-2 opacity-60">📄</span>
                                    <span className={cn(
                                        'font-medium truncate',
                                        isExact
                                            ? 'text-[#0078d4] dark:text-[#3794ff]'
                                            : 'text-[#1e1e1e] dark:text-[#cccccc]',
                                    )}>
                                        {fileName(filePath)}
                                    </span>
                                    {dirName(filePath) && (
                                        <span className="ml-2 text-xs text-[#848484] truncate flex-shrink-0">
                                            {dirName(filePath)}
                                        </span>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Footer hint */}
                <div className="flex items-center justify-between px-3 py-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c] text-[10px] text-[#848484]">
                    <span>↑↓ navigate · ↵ open · esc close</span>
                    {results.length > 0 && <span>{results.length} results</span>}
                </div>
            </div>
        </div>
    );

    return ReactDOM.createPortal(overlay, document.body);
}
