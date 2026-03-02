/**
 * CommitList — single-select list of git commits for the left panel.
 *
 * Each row shows a selection indicator, short hash, subject, relative time,
 * and author. Clicking a row selects it (expanding the file list inline) and
 * notifies the parent via onSelect. Hovering a row shows a tooltip with full
 * commit metadata after a 250ms delay. Supports keyboard navigation with
 * ↑/↓ and Enter.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchApi } from '../hooks/useApi';
import { formatRelativeTime } from '../utils/format';
import { CommitTooltip } from './CommitTooltip';

export interface GitCommitItem {
    hash: string;
    shortHash: string;
    subject: string;
    author: string;
    date: string;
    parentHashes: string[];
    body?: string;
}

interface FileChange {
    status: string;
    path: string;
}

const STATUS_COLORS: Record<string, string> = {
    A: 'text-[#16825d]',
    M: 'text-[#0078d4]',
    D: 'text-[#d32f2f]',
};

const STATUS_LABELS: Record<string, string> = {
    A: 'Added',
    M: 'Modified',
    D: 'Deleted',
    R: 'Renamed',
    C: 'Copied',
    T: 'Type changed',
};

interface CommitListProps {
    title: string;
    commits: GitCommitItem[];
    selectedHash?: string | null;
    onSelect?: (commit: GitCommitItem) => void;
    onFileSelect?: (hash: string, filePath: string) => void;
    workspaceId?: string;
    loading?: boolean;
    defaultCollapsed?: boolean;
    showEmpty?: boolean;
    emptyMessage?: string;
}

export function CommitList({ title, commits, selectedHash, onSelect, onFileSelect, workspaceId, loading, defaultCollapsed = false, showEmpty = false, emptyMessage }: CommitListProps) {
    const [collapsed, setCollapsed] = useState(defaultCollapsed);
    const listRef = useRef<HTMLDivElement>(null);
    // Expanded file list state: hash -> files (cached)
    const [expandedHash, setExpandedHash] = useState<string | null>(null);
    const [fileCache, setFileCache] = useState<Record<string, FileChange[]>>({});
    const [filesLoading, setFilesLoading] = useState<string | null>(null);
    // Hover tooltip state
    const [hoveredCommit, setHoveredCommit] = useState<GitCommitItem | null>(null);
    const [tooltipAnchorRect, setTooltipAnchorRect] = useState<DOMRect | null>(null);
    const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    // Expand/collapse file list and fetch files on first expand
    const handleCommitClick = useCallback((commit: GitCommitItem) => {
        onSelect?.(commit);
        if (expandedHash === commit.hash) {
            setExpandedHash(null);
        } else {
            setExpandedHash(commit.hash);
            if (!fileCache[commit.hash] && workspaceId) {
                setFilesLoading(commit.hash);
                fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${commit.hash}/files`)
                    .then(data => {
                        setFileCache(prev => ({ ...prev, [commit.hash]: data.files || [] }));
                    })
                    .catch(() => {
                        setFileCache(prev => ({ ...prev, [commit.hash]: [] }));
                    })
                    .finally(() => setFilesLoading(null));
            }
        }
    }, [expandedHash, fileCache, workspaceId, onSelect]);

    // Hover tooltip handlers with 250ms delay
    const handleRowMouseEnter = useCallback((commit: GitCommitItem, e: React.MouseEvent) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        hoverTimerRef.current = setTimeout(() => {
            setHoveredCommit(commit);
            setTooltipAnchorRect(rect);
        }, 250);
    }, []);

    const handleRowMouseLeave = useCallback(() => {
        if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
        }
        // Delay hiding so mouse can move onto the tooltip without it disappearing
        hideTimerRef.current = setTimeout(() => {
            setHoveredCommit(null);
            setTooltipAnchorRect(null);
        }, 150);
    }, []);

    const handleTooltipMouseEnter = useCallback(() => {
        if (hideTimerRef.current) {
            clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
        }
    }, []);

    const handleTooltipMouseLeave = useCallback(() => {
        setHoveredCommit(null);
        setTooltipAnchorRect(null);
    }, []);

    // Clean up timers on unmount
    useEffect(() => {
        return () => {
            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
            if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        };
    }, []);

    const isEmpty = !loading && commits.length === 0;
    const isDimmed = isEmpty;
    const titleTestId = `commit-list-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    return (
        <div className="commit-list" data-testid={titleTestId}>
            <button
                className="w-full text-left flex items-center gap-1 text-xs font-semibold uppercase tracking-wide px-4 py-2 bg-[#f5f5f5] dark:bg-[#252526] border-b border-[#e0e0e0] dark:border-[#3c3c3c] sticky top-0 z-10 cursor-pointer hover:bg-[#ececec] dark:hover:bg-[#2a2d2e] transition-colors"
                onClick={() => setCollapsed(prev => !prev)}
                data-testid={`${titleTestId}-toggle`}
            >
                <span className="text-[10px] text-[#848484] flex-shrink-0">
                    {collapsed ? '▶' : '▼'}
                </span>
                <span className={isDimmed ? 'text-[#848484]' : 'text-[#616161] dark:text-[#999]'}>
                    {title} {!loading && `(${commits.length})`}
                </span>
            </button>
            {!collapsed && (
                <>
                    {loading ? (
                        <div className="px-4 py-3 text-xs text-[#848484]" data-testid="commit-list-loading">Loading commits...</div>
                    ) : isEmpty ? (
                        showEmpty ? (
                            <div className="px-4 py-3 text-xs text-[#848484] italic" data-testid="commit-list-empty">
                                {emptyMessage || 'No commits'}
                            </div>
                        ) : (
                            <div className="px-4 py-3 text-xs text-[#848484]" data-testid="commit-list-empty">No commits</div>
                        )
                    ) : (
                <div ref={listRef} role="listbox" tabIndex={0} onKeyDown={handleKeyDown} className="outline-none">
                    {commits.map(commit => {
                        const isSelected = commit.hash === selectedHash;
                        const isExpanded = commit.hash === expandedHash;
                        const files = fileCache[commit.hash];
                        const isFilesLoading = filesLoading === commit.hash;
                        return (
                            <div key={commit.hash}>
                                <button
                                    role="option"
                                    aria-selected={isSelected}
                                    data-hash={commit.hash}
                                    className={`commit-row w-full flex items-start gap-2 px-3 py-2 text-left transition-colors border-b border-[#e0e0e0] dark:border-[#3c3c3c] ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-[#f0f0f0] dark:hover:bg-[#2a2d2e]'}`}
                                    onClick={() => handleCommitClick(commit)}
                                    onMouseEnter={(e) => handleRowMouseEnter(commit, e)}
                                    onMouseLeave={handleRowMouseLeave}
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
                                {/* Expanded file list */}
                                {isExpanded && (
                                    <div className="pl-8 pr-3 py-1 bg-[#f8f8f8] dark:bg-[#1e1e1e] border-b border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid={`commit-files-${commit.shortHash}`}>
                                        {isFilesLoading ? (
                                            <div className="text-[11px] text-[#848484] py-1" data-testid="commit-files-loading">Loading files...</div>
                                        ) : files && files.length > 0 ? (
                                            <div className="flex flex-col gap-0.5" data-testid="commit-file-list">
                                                {files.map((f, i) => (
                                                    <button
                                                        key={i}
                                                        className="flex items-center gap-2 text-[11px] py-0.5 px-1 rounded hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e] text-left w-full transition-colors"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onFileSelect?.(commit.hash, f.path);
                                                        }}
                                                        data-testid={`commit-file-${i}`}
                                                    >
                                                        <span
                                                            className={`font-mono font-bold w-3 text-center flex-shrink-0 ${STATUS_COLORS[f.status] || 'text-[#848484]'}`}
                                                            title={STATUS_LABELS[f.status] || f.status}
                                                        >
                                                            {f.status}
                                                        </span>
                                                        <span className="font-mono text-[#1e1e1e] dark:text-[#ccc] truncate">{f.path}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        ) : files ? (
                                            <div className="text-[11px] text-[#848484] py-1">No files changed</div>
                                        ) : null}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
                    )}
                </>
            )}
            {/* Hover tooltip */}
            {hoveredCommit && tooltipAnchorRect && (
                <CommitTooltip commit={hoveredCommit} anchorRect={tooltipAnchorRect} onMouseEnter={handleTooltipMouseEnter} onMouseLeave={handleTooltipMouseLeave} />
            )}
        </div>
    );
}
