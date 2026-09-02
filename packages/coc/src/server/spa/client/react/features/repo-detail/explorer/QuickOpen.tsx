/**
 * QuickOpen — command-palette-style file finder dialog.
 *
 * Searches on the server, debounced, and renders only the top matches. The repo
 * path list never crosses the network — in a large repo that list is multiple
 * megabytes, and matching it on the render thread stalls typing.
 *
 * Portal-rendered to document.body.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import type { ExplorerSearchResult } from '@plusplusoneplusplus/coc-client';
import { cn } from '../../../ui/cn';
import { explorerApi } from './explorerApi';

/** Maximum results requested and rendered for a query. */
const RESULT_LIMIT = 50;

/**
 * How long typing must pause before a search is issued. Short enough to feel
 * immediate on a localhost round-trip, long enough that a fast typist issues one
 * request instead of one per character.
 */
const SEARCH_DEBOUNCE_MS = 40;

export interface QuickOpenProps {
    workspaceId: string;
    open: boolean;
    onClose: () => void;
    onFileSelect: (filePath: string) => void;
}

/**
 * Emphasise the characters at `indices` in `target`.
 *
 * The indices come from the scorer that produced the result, so the highlight
 * always shows the match the ranking was based on — re-deriving it here used to
 * let the two disagree.
 */
export function highlightMatches(target: string, indices: readonly number[]): (string | JSX.Element)[] {
    if (indices.length === 0) return [target];
    const marked = new Set(indices);
    const parts: (string | JSX.Element)[] = [];
    let buf = '';
    let keyIdx = 0;

    for (let i = 0; i < target.length; i++) {
        if (marked.has(i)) {
            if (buf) { parts.push(buf); buf = ''; }
            parts.push(<span key={keyIdx++} className="text-[#0078d4] dark:text-[#3794ff] font-semibold">{target[i]}</span>);
        } else {
            buf += target[i];
        }
    }
    if (buf) parts.push(buf);
    return parts;
}

/**
 * Split a result's match indices into the directory part and the file-name
 * part, rebased on each, so both segments highlight correctly.
 */
export function splitIndices(filePath: string, indices: readonly number[]): { dir: number[]; name: number[] } {
    const nameStart = filePath.length - fileName(filePath).length;
    const dir: number[] = [];
    const name: number[] = [];
    for (const index of indices) {
        if (index < dirName(filePath).length) dir.push(index);
        else if (index >= nameStart) name.push(index - nameStart);
    }
    return { dir, name };
}

function fileName(p: string): string {
    const idx = p.lastIndexOf('/');
    return idx < 0 ? p : p.slice(idx + 1);
}

function dirName(p: string): string {
    const idx = p.lastIndexOf('/');
    return idx < 0 ? '' : p.slice(0, idx);
}

export function QuickOpen({ workspaceId, open, onClose, onFileSelect }: QuickOpenProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<ExplorerSearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [highlightIndex, setHighlightIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Start each open from a clean slate; nothing is fetched until the first
    // keystroke, so opening the dialog costs no network at all.
    useEffect(() => {
        if (!open) return;
        setQuery('');
        setResults([]);
        setHighlightIndex(0);
    }, [open, workspaceId]);

    // Search on the server, debounced, one in-flight request at a time.
    useEffect(() => {
        if (!open) return;

        const trimmed = query.trim();
        if (!trimmed) {
            abortRef.current?.abort();
            setResults([]);
            setLoading(false);
            return;
        }

        debounceRef.current = setTimeout(() => {
            abortRef.current?.abort();
            const abort = new AbortController();
            abortRef.current = abort;
            setLoading(true);
            explorerApi.searchFiles(workspaceId, trimmed, { limit: RESULT_LIMIT, signal: abort.signal })
                .then(data => {
                    if (abort.signal.aborted) return;
                    setResults(data.results);
                })
                .catch(() => {
                    if (abort.signal.aborted) return;
                    setResults([]);
                })
                .finally(() => {
                    if (!abort.signal.aborted) setLoading(false);
                });
        }, SEARCH_DEBOUNCE_MS);

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
                handleSelect(results[highlightIndex].path);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    }, [results, highlightIndex, handleSelect, onClose]);

    if (!open) return null;

    const overlay = (
        <div
            className="fixed inset-0 z-[10002] flex justify-center"
            onClick={onClose}
            data-testid="quick-open-overlay"
        >
            {/* Dialog at top-center, matching the command palette placement. */}
            <div
                className={cn(
                    'mt-[10vh] w-[90vw] max-w-[600px] h-fit max-h-[60vh] flex flex-col',
                    'bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c]',
                    'rounded-md shadow-xl overflow-hidden',
                )}
                onClick={e => e.stopPropagation()}
                data-testid="quick-open-dialog"
            >
                {/* Search input */}
                <div className="flex items-center px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <span className="text-[#999] dark:text-[#888] mr-2 text-sm">🔍</span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Search files by name…"
                        className={cn(
                            'flex-1 bg-transparent text-sm text-[#1e1e1e] dark:text-[#cccccc]',
                            'outline-none border-none placeholder-[#999] dark:placeholder-[#888]',
                        )}
                        data-testid="quick-open-input"
                    />
                    {query && (
                        <button
                            className="text-[#999] hover:text-[#333] dark:hover:text-[#eee] text-sm ml-2"
                            onClick={() => setQuery('')}
                            data-testid="quick-open-clear"
                        >
                            ✕
                        </button>
                    )}
                </div>

                {/* Results list */}
                <div
                    ref={listRef}
                    className="flex-1 overflow-y-auto"
                    data-testid="quick-open-results"
                >
                    {/* Only blank out while the first search of a query is in
                        flight — once results exist they stay rendered, so typing
                        never flickers. */}
                    {loading && results.length === 0 ? (
                        <div className="flex items-center justify-center py-4 text-sm text-[#848484]">
                            Searching files…
                        </div>
                    ) : results.length === 0 ? (
                        <div className="flex items-center justify-center py-4 text-sm text-[#848484]" data-testid="quick-open-no-results">
                            No matching files
                        </div>
                    ) : (
                        results.map((result, idx) => {
                            const matched = splitIndices(result.path, result.indices ?? []);
                            return (
                                <div
                                    key={result.path}
                                    className={cn(
                                        'flex items-center px-3 py-1.5 cursor-pointer text-sm',
                                        idx === highlightIndex
                                            ? 'bg-[#0078d4]/10 dark:bg-[#0078d4]/20'
                                            : 'hover:bg-[#f5f5f5] dark:hover:bg-[#2a2d2e]',
                                    )}
                                    onClick={() => handleSelect(result.path)}
                                    onMouseEnter={() => setHighlightIndex(idx)}
                                    data-testid={`quick-open-item-${idx}`}
                                >
                                    <span className="text-xs mr-2 opacity-60">📄</span>
                                    <span className="font-medium text-[#1e1e1e] dark:text-[#cccccc] truncate">
                                        {highlightMatches(fileName(result.path), matched.name)}
                                    </span>
                                    {dirName(result.path) && (
                                        <span className="ml-2 text-xs text-[#848484] truncate flex-shrink-0">
                                            {highlightMatches(dirName(result.path), matched.dir)}
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
