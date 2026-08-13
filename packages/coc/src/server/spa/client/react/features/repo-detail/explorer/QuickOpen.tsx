/**
 * QuickOpen — command-palette-style file finder dialog.
 * Fetches the repo's path list once per open and fuzzy-matches in the browser,
 * so keystrokes cost no network round-trip.
 * Portal-rendered to document.body.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom';
import { cn } from '../../../ui/cn';
import { rankFuzzyMatches } from '../../../../../../shared/fuzzy-file-score';
import { explorerApi } from './explorerApi';

/** Maximum results rendered for a query. */
const RESULT_LIMIT = 50;

export interface QuickOpenProps {
    workspaceId: string;
    open: boolean;
    onClose: () => void;
    onFileSelect: (filePath: string) => void;
}

/** Highlight matched characters in the file path. */
export function highlightFuzzy(query: string, target: string): (string | JSX.Element)[] {
    if (!query) return [target];
    const q = query.toLowerCase();
    const parts: (string | JSX.Element)[] = [];
    let qi = 0;
    let buf = '';
    let keyIdx = 0;

    for (let ti = 0; ti < target.length; ti++) {
        if (qi < q.length && target[ti].toLowerCase() === q[qi]) {
            if (buf) { parts.push(buf); buf = ''; }
            parts.push(<span key={keyIdx++} className="text-[#0078d4] dark:text-[#3794ff] font-semibold">{target[ti]}</span>);
            qi++;
        } else {
            buf += target[ti];
        }
    }
    if (buf) parts.push(buf);
    return parts;
}

/** Extract file name from a path. */
function fileName(p: string): string {
    const idx = p.lastIndexOf('/');
    return idx < 0 ? p : p.slice(idx + 1);
}

/** Extract directory portion from a path. */
function dirName(p: string): string {
    const idx = p.lastIndexOf('/');
    return idx < 0 ? '' : p.slice(0, idx);
}

export function QuickOpen({ workspaceId, open, onClose, onFileSelect }: QuickOpenProps) {
    const [query, setQuery] = useState('');
    const [allFiles, setAllFiles] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [highlightIndex, setHighlightIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);

    // Fetch the path list once per open, then match locally on every keystroke.
    // The server caches this listing, so reopening is cheap.
    useEffect(() => {
        if (!open) return;
        setQuery('');
        setHighlightIndex(0);

        const abort = new AbortController();
        abortRef.current = abort;
        setLoading(true);
        explorerApi.listFiles(workspaceId, { signal: abort.signal })
            .then((data: { files: string[]; truncated: boolean }) => {
                if (abort.signal.aborted) return;
                setAllFiles(data.files);
            })
            .catch(() => {
                if (abort.signal.aborted) return;
                setAllFiles([]);
            })
            .finally(() => {
                if (!abort.signal.aborted) setLoading(false);
            });

        return () => abort.abort();
    }, [open, workspaceId]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (abortRef.current) abortRef.current.abort();
        };
    }, []);

    const results = useMemo(() => {
        const trimmed = query.trim();
        if (!trimmed) return [];
        return rankFuzzyMatches(trimmed, allFiles, RESULT_LIMIT).map(m => m.path);
    }, [query, allFiles]);

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
                    {/* Only blank out while the very first list is loading — once
                        results exist they stay rendered, so typing never flickers. */}
                    {loading && results.length === 0 && allFiles.length === 0 ? (
                        <div className="flex items-center justify-center py-4 text-sm text-[#848484]">
                            Loading files…
                        </div>
                    ) : results.length === 0 ? (
                        <div className="flex items-center justify-center py-4 text-sm text-[#848484]" data-testid="quick-open-no-results">
                            No matching files
                        </div>
                    ) : (
                        results.map((filePath, idx) => (
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
                                data-testid={`quick-open-item-${idx}`}
                            >
                                <span className="text-xs mr-2 opacity-60">📄</span>
                                <span className="font-medium text-[#1e1e1e] dark:text-[#cccccc] truncate">
                                    {highlightFuzzy(query, fileName(filePath))}
                                </span>
                                {dirName(filePath) && (
                                    <span className="ml-2 text-xs text-[#848484] truncate flex-shrink-0">
                                        {dirName(filePath)}
                                    </span>
                                )}
                            </div>
                        ))
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
