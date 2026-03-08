/**
 * QuickOpen — VS Code-style Ctrl+P file finder dialog.
 * Fetches all files from the repo recursively and provides fuzzy matching
 * with keyboard navigation. Portal-rendered to document.body.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { fetchApi } from '../../hooks/useApi';
import { cn } from '../../shared/cn';

export interface QuickOpenProps {
    workspaceId: string;
    open: boolean;
    onClose: () => void;
    onFileSelect: (filePath: string) => void;
}

/** Simple fuzzy match: all characters of the query must appear in order. */
export function fuzzyMatch(query: string, target: string): { match: boolean; score: number } {
    const q = query.toLowerCase();
    const t = target.toLowerCase();
    if (!q) return { match: true, score: 0 };

    let qi = 0;
    let score = 0;
    let prevMatchIdx = -1;

    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        if (t[ti] === q[qi]) {
            // Bonus for consecutive matches
            if (ti === prevMatchIdx + 1) score += 2;
            // Bonus for matching at start or after separator
            if (ti === 0 || t[ti - 1] === '/' || t[ti - 1] === '\\' || t[ti - 1] === '.' || t[ti - 1] === '-' || t[ti - 1] === '_') {
                score += 3;
            }
            score += 1;
            prevMatchIdx = ti;
            qi++;
        }
    }

    if (qi < q.length) return { match: false, score: 0 };
    // Bonus for shorter targets (more specific matches rank higher)
    score += Math.max(0, 50 - target.length);
    return { match: true, score };
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

const MAX_VISIBLE = 50;

export function QuickOpen({ workspaceId, open, onClose, onFileSelect }: QuickOpenProps) {
    const [query, setQuery] = useState('');
    const [allFiles, setAllFiles] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [highlightIndex, setHighlightIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Fetch all files when opened
    useEffect(() => {
        if (!open) return;
        setQuery('');
        setHighlightIndex(0);
        setLoading(true);
        fetchApi(`/repos/${encodeURIComponent(workspaceId)}/files`)
            .then((data: { files: string[]; truncated: boolean }) => {
                setAllFiles(data.files);
            })
            .catch(() => {
                setAllFiles([]);
            })
            .finally(() => setLoading(false));
    }, [open, workspaceId]);

    // Auto-focus input when opened
    useEffect(() => {
        if (open) {
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    }, [open]);

    // Filtered + scored results
    const results = useMemo(() => {
        if (!query.trim()) return allFiles.slice(0, MAX_VISIBLE);
        const scored: { path: string; score: number }[] = [];
        for (const f of allFiles) {
            const m = fuzzyMatch(query, f);
            if (m.match) scored.push({ path: f, score: m.score });
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, MAX_VISIBLE).map(s => s.path);
    }, [allFiles, query]);

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
            {/* Dialog at top-center, like VS Code */}
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
                    {loading ? (
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
                    {allFiles.length > 0 && <span>{allFiles.length} files</span>}
                </div>
            </div>
        </div>
    );

    return ReactDOM.createPortal(overlay, document.body);
}
