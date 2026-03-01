/**
 * CommitList — single-select list of git commits for the left panel.
 *
 * Each row shows a selection indicator, short hash, subject, relative time,
 * and author. Clicking a row selects it and notifies the parent via onSelect.
 * Supports keyboard navigation with ↑/↓ and Enter.
 */

import { useEffect, useRef, useCallback } from 'react';
import { formatRelativeTime } from '../utils/format';

export interface GitCommitItem {
    hash: string;
    shortHash: string;
    subject: string;
    author: string;
    date: string;
    parentHashes: string[];
}

interface CommitListProps {
    title: string;
    commits: GitCommitItem[];
    selectedHash?: string | null;
    onSelect?: (commit: GitCommitItem) => void;
    loading?: boolean;
}

export function CommitList({ title, commits, selectedHash, onSelect, loading }: CommitListProps) {
    const listRef = useRef<HTMLDivElement>(null);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (!onSelect || commits.length === 0) return;
        const idx = commits.findIndex(c => c.hash === selectedHash);
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = idx < commits.length - 1 ? idx + 1 : idx;
            onSelect(commits[next]);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = idx > 0 ? idx - 1 : 0;
            onSelect(commits[prev]);
        }
    }, [commits, selectedHash, onSelect]);

    // Scroll selected row into view
    useEffect(() => {
        if (!selectedHash || !listRef.current) return;
        const el = listRef.current.querySelector(`[data-hash="${selectedHash}"]`);
        if (el) el.scrollIntoView({ block: 'nearest' });
    }, [selectedHash]);

    return (
        <div className="commit-list" data-testid={`commit-list-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[#616161] dark:text-[#999] px-4 py-2 bg-[#f5f5f5] dark:bg-[#252526] border-b border-[#e0e0e0] dark:border-[#3c3c3c] sticky top-0 z-10">
                {title} {!loading && `(${commits.length})`}
            </h3>
            {loading ? (
                <div className="px-4 py-3 text-xs text-[#848484]" data-testid="commit-list-loading">Loading commits...</div>
            ) : commits.length === 0 ? (
                <div className="px-4 py-3 text-xs text-[#848484]" data-testid="commit-list-empty">No commits</div>
            ) : (
                <div ref={listRef} role="listbox" tabIndex={0} onKeyDown={handleKeyDown} className="outline-none">
                    {commits.map(commit => {
                        const isSelected = commit.hash === selectedHash;
                        return (
                            <button
                                key={commit.hash}
                                role="option"
                                aria-selected={isSelected}
                                data-hash={commit.hash}
                                className={`commit-row w-full flex items-start gap-2 px-3 py-2 text-left transition-colors border-b border-[#e0e0e0] dark:border-[#3c3c3c] ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-[#f0f0f0] dark:hover:bg-[#2a2d2e]'}`}
                                onClick={() => onSelect?.(commit)}
                                data-testid={`commit-row-${commit.shortHash}`}
                            >
                                <span className="text-[10px] mt-0.5 flex-shrink-0">{isSelected ? '●' : '○'}</span>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono text-xs text-[#0078d4] dark:text-[#3794ff] flex-shrink-0">{commit.shortHash}</span>
                                        <span className="text-xs text-[#1e1e1e] dark:text-[#ccc] truncate">{commit.subject}</span>
                                    </div>
                                    <div className="text-[11px] text-[#848484] mt-0.5">
                                        {formatRelativeTime(commit.date)} · {commit.author}
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
