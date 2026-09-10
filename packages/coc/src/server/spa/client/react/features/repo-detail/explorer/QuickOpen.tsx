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
import type {
    ExplorerRepoGroupSearchResult,
    ExplorerSearchResult,
} from '@plusplusoneplusplus/coc-client';
import { cn } from '../../../ui/cn';
import { searchRepoGroupFiles } from '../../../repos/repoGroupService';
import { explorerApi } from './explorerApi';

/** Maximum results requested and rendered for a query. */
const RESULT_LIMIT = 50;

/**
 * How long typing must pause before a search is issued. Short enough to feel
 * immediate on a localhost round-trip, long enough that a fast typist issues one
 * request instead of one per character.
 */
const SEARCH_DEBOUNCE_MS = 40;

export type QuickOpenScope =
    | { kind: 'repo'; workspaceId: string }
    | { kind: 'repo-group'; groupId: string; groupName: string; liveRepoCount: number; baseUrl?: string };

export type QuickOpenResult = ExplorerSearchResult | ExplorerRepoGroupSearchResult;

export interface QuickOpenProps {
    scope: QuickOpenScope;
    open: boolean;
    onClose: () => void;
    /** Return false to keep the dialog open without changing its selection. */
    onFileSelect: (result: QuickOpenResult) => void | boolean | Promise<void | boolean>;
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

function isGroupResult(result: QuickOpenResult): result is ExplorerRepoGroupSearchResult {
    return 'workspaceId' in result;
}

export function QuickOpen({ scope, open, onClose, onFileSelect }: QuickOpenProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<QuickOpenResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [highlightIndex, setHighlightIndex] = useState(0);
    const [groupStatus, setGroupStatus] = useState<'complete' | 'partial' | 'failed' | 'no-searchable-members' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const requestIdRef = useRef(0);
    const scopeKey = scope.kind === 'repo' ? `repo:${scope.workspaceId}` : `group:${scope.groupId}:${scope.baseUrl ?? ''}`;

    // Start each open from a clean slate; nothing is fetched until the first
    // keystroke, so opening the dialog costs no network at all.
    useEffect(() => {
        if (!open) return;
        setQuery('');
        setResults([]);
        setHighlightIndex(0);
        setGroupStatus(null);
        setError(null);
    }, [open, scopeKey]);

    // Search on the server, debounced, one in-flight request at a time.
    useEffect(() => {
        const requestId = ++requestIdRef.current;
        if (!open) {
            abortRef.current?.abort();
            setError(null);
            setGroupStatus(null);
            return;
        }

        const trimmed = query.trim();
        if (!trimmed) {
            abortRef.current?.abort();
            setResults([]);
            setLoading(false);
            setError(null);
            setGroupStatus(null);
            return;
        }

        debounceRef.current = setTimeout(() => {
            abortRef.current?.abort();
            const abort = new AbortController();
            abortRef.current = abort;
            setLoading(true);
            setError(null);
            const searching = scope.kind === 'repo'
                ? explorerApi.searchFiles(scope.workspaceId, trimmed, { limit: RESULT_LIMIT, signal: abort.signal })
                : searchRepoGroupFiles(
                    scope.groupId,
                    trimmed,
                    { limit: RESULT_LIMIT, signal: abort.signal },
                    scope.baseUrl,
                );
            searching
                .then(data => {
                    if (abort.signal.aborted || requestId !== requestIdRef.current || !open) return;
                    if ('status' in data) {
                        setGroupStatus(data.status);
                        if (data.status === 'failed') {
                            setResults([]);
                            setError('Could not search this repo group.');
                            return;
                        }
                    }
                    setResults(data.results);
                })
                .catch(() => {
                    if (abort.signal.aborted || requestId !== requestIdRef.current || !open) return;
                    if (scope.kind === 'repo-group') {
                        setError('Could not search this repo group.');
                        setGroupStatus('failed');
                    } else {
                        setResults([]);
                    }
                })
                .finally(() => {
                    if (!abort.signal.aborted && requestId === requestIdRef.current) setLoading(false);
                });
        }, SEARCH_DEBOUNCE_MS);

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            if (abortRef.current) abortRef.current.abort();
        };
    }, [query, open, retry, scopeKey]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            if (abortRef.current) abortRef.current.abort();
        };
    }, []);

    // Auto-focus input when opened, then restore the prior focus on close.
    useEffect(() => {
        if (!open) return;
        const previous = document.activeElement as HTMLElement | null;
        requestAnimationFrame(() => inputRef.current?.focus());
        return () => previous?.focus();
    }, [open]);

    // Reset highlight when results change
    useEffect(() => {
        setHighlightIndex(0);
    }, [results]);

    // Scroll highlighted item into view
    useEffect(() => {
        const item = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[highlightIndex];
        item?.scrollIntoView({ block: 'nearest' });
    }, [highlightIndex]);

    const handleSelect = useCallback(async (result: QuickOpenResult) => {
        if (await onFileSelect(result) === false) return;
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
                void handleSelect(results[highlightIndex]);
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
                role="dialog"
                aria-modal="true"
                aria-label={scope.kind === 'repo-group' ? `Open file in ${scope.groupName}` : 'Open file'}
            >
                {scope.kind === 'repo-group' && (
                    <div className="px-3 pt-2 text-xs font-medium text-[#616161] dark:text-[#c8c8c8]">
                        Open file in {scope.groupName}
                    </div>
                )}
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
                    role="listbox"
                >
                    {groupStatus === 'partial' && (
                        <div className="px-3 py-1.5 text-xs text-[#8a6d1d] dark:text-[#cca700]" data-testid="quick-open-partial">
                            Some repositories could not be searched.
                        </div>
                    )}
                    {/* Only blank out while the first search of a query is in
                        flight — once results exist they stay rendered, so typing
                        never flickers. */}
                    {!query.trim() && scope.kind === 'repo-group' ? (
                        <div className="flex items-center justify-center py-4 text-sm text-[#848484]" data-testid="quick-open-empty-query">
                            Type to search across {scope.liveRepoCount} {scope.liveRepoCount === 1 ? 'repository' : 'repositories'}.
                        </div>
                    ) : loading && results.length === 0 ? (
                        <div className="flex items-center justify-center py-4 text-sm text-[#848484]">
                            Searching files…
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center gap-2 py-4 text-sm text-[#b42318] dark:text-[#f48771]" data-testid="quick-open-error">
                            <span>{error}</span>
                            <button
                                className="rounded border border-current px-2 py-0.5 text-xs"
                                onClick={() => setRetry(value => value + 1)}
                            >
                                Retry
                            </button>
                        </div>
                    ) : groupStatus === 'no-searchable-members' ? (
                        <div className="flex items-center justify-center py-4 text-sm text-[#848484]" data-testid="quick-open-no-members">
                            This repo group has no searchable repositories.
                        </div>
                    ) : results.length === 0 ? (
                        <div className="flex items-center justify-center py-4 text-sm text-[#848484]" data-testid="quick-open-no-results">
                            {scope.kind === 'repo-group' ? 'No files found in this repo group.' : 'No matching files'}
                        </div>
                    ) : (
                        results.map((result, idx) => {
                            const matched = splitIndices(result.path, result.indices ?? []);
                            return (
                                <div
                                    key={isGroupResult(result) ? `${result.workspaceId}:${result.path}` : result.path}
                                    className={cn(
                                        'flex items-center px-3 py-1.5 cursor-pointer text-sm',
                                        idx === highlightIndex
                                            ? 'bg-[#0078d4]/10 dark:bg-[#0078d4]/20'
                                            : 'hover:bg-[#f5f5f5] dark:hover:bg-[#2a2d2e]',
                                    )}
                                    onClick={() => void handleSelect(result)}
                                    onMouseEnter={() => setHighlightIndex(idx)}
                                    data-testid={`quick-open-item-${idx}`}
                                    role="option"
                                    aria-selected={idx === highlightIndex}
                                    aria-label={[
                                        fileName(result.path),
                                        dirName(result.path),
                                        isGroupResult(result) ? result.repoName : '',
                                    ].filter(Boolean).join(', ')}
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
                                    {isGroupResult(result) && (
                                        <span className="ml-auto rounded bg-[#e8e8e8] dark:bg-[#3c3c3c] px-1.5 py-0.5 text-[10px] text-[#555] dark:text-[#d4d4d4]" data-testid={`quick-open-repo-${idx}`}>
                                            {result.repoName}
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
