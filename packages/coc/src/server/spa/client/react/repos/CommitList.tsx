/**
 * CommitList — single-select list of git commits for the left panel.
 *
 * Each row shows a selection indicator, short hash, subject, relative time,
 * and author. Clicking a row selects it (expanding the file list inline) and
 * notifies the parent via onSelect. Hovering a row shows a tooltip with full
 * commit metadata after a 1000ms delay. Supports keyboard navigation with
 * ↑/↓ and Enter.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { fetchApi } from '../hooks/useApi';
import { formatRelativeTime } from '../utils/format';
import { CommitTooltip } from './CommitTooltip';
import { buildFileTree, compactFolders, FileTreeView, FlatFileList } from './FileTree';
import type { FileChange } from './FileTree';
import { useFileCommentCounts } from '../hooks/useFileCommentCounts';
import { useCommitCommentTotals } from '../hooks/useCommitCommentTotals';
import { computeDiffCommentKey } from '../../diff-comment-utils';
import { useFilesViewMode } from '../hooks/useFilesViewMode';
import { buildFixupGroups, FIXUP_GROUP_COLORS_LIGHT, FIXUP_GROUP_COLORS_DARK } from './fixup-utils';
import type { FixupGroupMap } from './fixup-utils';

export interface GitCommitItem {
    hash: string;
    shortHash: string;
    subject: string;
    author: string;
    authorEmail?: string;
    date: string;
    parentHashes: string[];
    body?: string;
}

// Returns true on touch-only devices where hover events are unreliable (iOS, Android).
// Uses CSS `(hover: none)` which matches devices with no fine pointer (mouse/trackpad).
const isTouchOnly = (): boolean =>
    typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

interface CommitListProps {
    title: string;
    commits: GitCommitItem[];
    selectedHash?: string | null;
    /** When provided, drives multi-select highlighting; supersedes selectedHash. */
    selectedHashes?: ReadonlySet<string>;
    /** Fires on Ctrl/Cmd+click or Shift+click with the full new selection. */
    onMultiSelect?: (commits: GitCommitItem[]) => void;
    /** When set, highlights the matching file row under the matching commit. */
    selectedFile?: { hash: string; filePath: string } | null;
    /** When set on first render (deep-link scenario), auto-expands the matching commit once. */
    initialExpandedHash?: string | null;
    onSelect?: (commit: GitCommitItem) => void;
    onFileSelect?: (hash: string, filePath: string) => void;
    onCommitContextMenu?: (e: React.MouseEvent, commitHash: string) => void;
    workspaceId?: string;
    loading?: boolean;
    defaultCollapsed?: boolean;
    showEmpty?: boolean;
    emptyMessage?: string;
    unpushedCount?: number;
    /** Enable drag-and-drop reordering for unpushed commits. */
    reorderable?: boolean;
    /** Called when commits are reordered via drag-and-drop. Receives new order (display order). */
    onReorder?: (newOrder: GitCommitItem[]) => void;
}

export function CommitList({ title, commits, selectedHash, selectedHashes, onMultiSelect, selectedFile, initialExpandedHash, onSelect, onFileSelect, onCommitContextMenu, workspaceId, loading, defaultCollapsed = false, showEmpty = false, emptyMessage, unpushedCount = 0, reorderable = false, onReorder }: CommitListProps) {
    const [collapsed, setCollapsed] = useState(defaultCollapsed);
    const listRef = useRef<HTMLDivElement>(null);
    const [anchorHash, setAnchorHash] = useState<string | null>(null);
    // Expanded file list state: hash -> files (cached)
    const [expandedHash, setExpandedHash] = useState<string | null>(null);
    const [fileCache, setFileCache] = useState<Record<string, FileChange[]>>({});
    const [filesLoading, setFilesLoading] = useState<string | null>(null);
    // Track whether we've already performed the one-time deep-link auto-expansion
    const hasAutoExpanded = useRef(false);
    // Hover tooltip state
    const [hoveredCommit, setHoveredCommit] = useState<GitCommitItem | null>(null);
    const [tooltipAnchorRect, setTooltipAnchorRect] = useState<DOMRect | null>(null);
    const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Drag-and-drop reorder state
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

    // Flat/tree toggle for commit file lists (shared repo preference)
    const { mode: commitViewMode, setMode: setCommitViewMode } = useFilesViewMode(workspaceId);

    // Fetch active comment countsfor the currently expanded commit
    const commentCounts = useFileCommentCounts(
        workspaceId ?? '',
        expandedHash ? `${expandedHash}^` : null,
        expandedHash,
    );
    const [fileCommentMap, setFileCommentMap] = useState<Map<string, number>>(new Map());

    // Fetch per-commit total comment counts for all visible commits
    const commitTotals = useCommitCommentTotals(
        workspaceId ?? '',
        commits.map(c => c.hash),
    );

    // Build fixup group map for visual grouping
    const fixupGroups: FixupGroupMap = useMemo(() => buildFixupGroups(commits), [commits]);

    // Detect dark mode for color palette selection
    const isDarkMode = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const groupColors = isDarkMode ? FIXUP_GROUP_COLORS_DARK : FIXUP_GROUP_COLORS_LIGHT;

    // Pre-compute storageKey → count lookup keyed by filePath for render-time access
    useEffect(() => {
        if (commentCounts.size === 0 || !expandedHash) {
            setFileCommentMap(new Map());
            return;
        }
        const files = fileCache[expandedHash] ?? [];
        if (files.length === 0) {
            setFileCommentMap(new Map());
            return;
        }
        let cancelled = false;
        const oldRef = `${expandedHash}^`;
        const computeMap = async () => {
            const map = new Map<string, number>();
            for (const file of files) {
                const key = await computeDiffCommentKey(workspaceId ?? '', oldRef, expandedHash, file.path);
                const count = commentCounts.get(key) ?? 0;
                if (count > 0) map.set(file.path, count);
            }
            if (!cancelled) setFileCommentMap(map);
        };
        void computeMap();
        return () => { cancelled = true; };
    }, [fileCache, expandedHash, commentCounts, workspaceId]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (commits.length === 0) return;
        if (!onSelect && !onMultiSelect) return;
        const focusedHash = selectedHash ?? (selectedHashes && selectedHashes.size > 0 ? [...selectedHashes][selectedHashes.size - 1] : null);
        const idx = focusedHash ? commits.findIndex(c => c.hash === focusedHash) : -1;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = idx < commits.length - 1 ? idx + 1 : Math.max(0, idx);
            if (e.shiftKey && onMultiSelect) {
                const currentSet = selectedHashes ?? (selectedHash ? new Set([selectedHash]) : new Set<string>());
                const newSet = new Set(currentSet);
                newSet.add(commits[next].hash);
                onMultiSelect(commits.filter(c => newSet.has(c.hash)));
            } else if (onSelect) {
                onSelect(commits[next]);
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = idx > 0 ? idx - 1 : 0;
            if (e.shiftKey && onMultiSelect) {
                const currentSet = selectedHashes ?? (selectedHash ? new Set([selectedHash]) : new Set<string>());
                const newSet = new Set(currentSet);
                newSet.add(commits[prev].hash);
                onMultiSelect(commits.filter(c => newSet.has(c.hash)));
            } else if (onSelect) {
                onSelect(commits[prev]);
            }
        }
    }, [commits, selectedHash, selectedHashes, onSelect, onMultiSelect]);

    // Scroll selected row into view
    useEffect(() => {
        if (!selectedHash || !listRef.current) return;
        const el = listRef.current.querySelector(`[data-hash="${selectedHash}"]`);
        if (el) el.scrollIntoView({ block: 'nearest' });
    }, [selectedHash]);

    // Deep-link: auto-expand the initially-selected commit once when its hash is first available
    useEffect(() => {
        if (!initialExpandedHash || hasAutoExpanded.current) return;
        hasAutoExpanded.current = true;
        setExpandedHash(initialExpandedHash);
        if (workspaceId) {
            setFilesLoading(initialExpandedHash);
            fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${initialExpandedHash}/files`)
                .then(data => {
                    setFileCache(prev => ({ ...prev, [initialExpandedHash]: data.files || [] }));
                })
                .catch(() => {
                    setFileCache(prev => ({ ...prev, [initialExpandedHash]: [] }));
                })
                .finally(() => setFilesLoading(null));
        }
    }, [initialExpandedHash, workspaceId]);

    // Expand/collapse file list and fetch files on first expand
    const handleCommitClick = useCallback((commit: GitCommitItem, e: React.MouseEvent) => {
        const isCtrl = e.ctrlKey || e.metaKey;
        const isShift = e.shiftKey;

        if (isCtrl && onMultiSelect) {
            // Toggle this commit in the current multi-selection
            const currentSet = selectedHashes ?? (selectedHash ? new Set([selectedHash]) : new Set<string>());
            const newSet = new Set(currentSet);
            if (newSet.has(commit.hash)) {
                newSet.delete(commit.hash);
            } else {
                newSet.add(commit.hash);
            }
            onMultiSelect(commits.filter(c => newSet.has(c.hash)));
            setAnchorHash(commit.hash);
            return;
        }

        if (isShift && onMultiSelect && anchorHash) {
            // Extend selection range from anchor to this commit
            const anchorIdx = commits.findIndex(c => c.hash === anchorHash);
            const targetIdx = commits.findIndex(c => c.hash === commit.hash);
            if (anchorIdx !== -1 && targetIdx !== -1) {
                const [start, end] = anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
                onMultiSelect(commits.slice(start, end + 1));
            } else {
                onMultiSelect([commit]);
            }
            return;
        }

        // Plain click: single select
        onSelect?.(commit);
        setAnchorHash(commit.hash);
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
    }, [expandedHash, fileCache, workspaceId, onSelect, onMultiSelect, selectedHashes, selectedHash, anchorHash, commits]);

    // Hover tooltip handlers with 1000ms delay
    const handleRowMouseEnter = useCallback((commit: GitCommitItem, e: React.MouseEvent) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        hoverTimerRef.current = setTimeout(() => {
            setHoveredCommit(commit);
            setTooltipAnchorRect(rect);
        }, 1000);
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

    // Drag-and-drop handlers for commit reordering
    const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
        setDragIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverIndex(index);
    }, []);

    const handleDragEnd = useCallback(() => {
        setDragIndex(null);
        setDragOverIndex(null);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent, dropIndex: number) => {
        e.preventDefault();
        if (dragIndex === null || dragIndex === dropIndex) {
            setDragIndex(null);
            setDragOverIndex(null);
            return;
        }
        // Only reorder within unpushed commits
        if (dragIndex >= unpushedCount || dropIndex >= unpushedCount) {
            setDragIndex(null);
            setDragOverIndex(null);
            return;
        }
        const newCommits = [...commits];
        const [moved] = newCommits.splice(dragIndex, 1);
        newCommits.splice(dropIndex, 0, moved);
        onReorder?.(newCommits);
        setDragIndex(null);
        setDragOverIndex(null);
    }, [dragIndex, commits, unpushedCount, onReorder]);

    // Dismiss tooltip on touch start (handles hybrid devices that switch from mouse to touch)
    useEffect(() => {
        const onTouchStart = () => {
            if (hoverTimerRef.current) {
                clearTimeout(hoverTimerRef.current);
                hoverTimerRef.current = null;
            }
            setHoveredCommit(null);
            setTooltipAnchorRect(null);
        };
        document.addEventListener('touchstart', onTouchStart, { passive: true });
        return () => document.removeEventListener('touchstart', onTouchStart);
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
                    {commits.map((commit, index) => {
                        const isSelected = selectedHashes
                            ? selectedHashes.has(commit.hash)
                            : commit.hash === selectedHash;
                        const isExpanded = commit.hash === expandedHash;
                        const files = fileCache[commit.hash];
                        const isFilesLoading = filesLoading === commit.hash;
                        const isUnpushed = unpushedCount > 0 && index < unpushedCount;
                        const showSeparator = unpushedCount > 0 && index === unpushedCount;
                        const canDrag = reorderable && isUnpushed;
                        const isDragOver = dragOverIndex === index && dragIndex !== index;

                        // Fixup group visual treatment
                        const fixupEntry = fixupGroups.fixupEntries.get(commit.hash);
                        const targetGroup = fixupGroups.targetGroups.get(commit.hash);
                        const isFixup = !!fixupEntry;
                        const hasFixups = !!targetGroup;
                        const groupColor = fixupEntry
                            ? groupColors[fixupEntry.colorSlot]
                            : targetGroup
                                ? groupColors[targetGroup.colorSlot]
                                : undefined;

                        return (
                            <div
                                key={commit.hash}
                                draggable={canDrag}
                                onDragStart={canDrag ? (e) => handleDragStart(e, index) : undefined}
                                onDragOver={canDrag ? (e) => handleDragOver(e, index) : undefined}
                                onDrop={canDrag ? (e) => handleDrop(e, index) : undefined}
                                onDragEnd={canDrag ? handleDragEnd : undefined}
                                className={dragIndex === index ? 'opacity-40' : isDragOver ? 'border-t-2 border-t-[#007acc]' : ''}
                            >
                                {showSeparator && (
                                    <div
                                        className="px-3 py-1 text-[11px] text-[#f57c00] dark:text-[#ffb74d] border-b border-t border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fff8f0] dark:bg-[#2a1f00] flex items-center gap-1"
                                        data-testid="unpushed-separator"
                                        aria-label={`${unpushedCount} unpushed commit${unpushedCount !== 1 ? 's' : ''}`}
                                    >
                                        ↑ {unpushedCount} unpushed
                                    </div>
                                )}
                                <button
                                    role="option"
                                    aria-selected={isSelected}
                                    data-hash={commit.hash}
                                    className={`commit-row w-full flex items-start gap-2 px-3 py-2 text-left transition-colors border-b border-[#e0e0e0] dark:border-[#3c3c3c] ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-[#f0f0f0] dark:hover:bg-[#2a2d2e]'}${isFixup ? ' opacity-70' : ''}`}
                                    onClick={(e) => handleCommitClick(commit, e)}
                                    onMouseEnter={isTouchOnly() ? undefined : (e) => handleRowMouseEnter(commit, e)}
                                    onMouseLeave={isTouchOnly() ? undefined : handleRowMouseLeave}
                                    onContextMenu={(e) => { if (e.shiftKey) return; e.preventDefault(); e.stopPropagation(); onCommitContextMenu?.(e, commit.hash); }}
                                    data-testid={`commit-row-${commit.shortHash}`}
                                    data-fixup-type={fixupEntry?.type}
                                    data-fixup-target={fixupEntry?.targetHash}
                                >
                                    {canDrag && (
                                        <span className="text-[10px] mt-0.5 flex-shrink-0 cursor-grab text-[#848484] hover:text-[#333] dark:hover:text-[#ccc]" title="Drag to reorder">⠿</span>
                                    )}
                                    <span
                                        className="text-[10px] mt-0.5 flex-shrink-0"
                                        style={groupColor ? { color: groupColor } : undefined}
                                        data-testid={groupColor ? `fixup-dot-${commit.shortHash}` : undefined}
                                    >
                                        {isUnpushed ? '●' : '○'}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start gap-2">
                                            <span className={`font-mono text-xs flex-shrink-0 ${isUnpushed ? 'text-[#f57c00] dark:text-[#ffb74d]' : 'text-[#0078d4] dark:text-[#3794ff]'}`}>{commit.shortHash}</span>
                                            {/* Fixup pill badge */}
                                            {fixupEntry && (
                                                <span
                                                    className="text-[10px] font-bold px-1.5 py-0 rounded-full leading-[18px] flex-shrink-0"
                                                    style={{ backgroundColor: groupColor, color: '#fff' }}
                                                    title={`${fixupEntry.type} for ${fixupEntry.targetHash.substring(0, 7)} — ${fixupEntry.displaySubject}`}
                                                    data-testid={`fixup-pill-${commit.shortHash}`}
                                                >
                                                    {fixupEntry.pillLabel}
                                                </span>
                                            )}
                                            {(() => {
                                                const ct = commitTotals.get(commit.hash);
                                                const openCount = ct?.open ?? 0;
                                                const resolvedCount = ct?.resolved ?? 0;
                                                return (
                                                    <>
                                                        {resolvedCount > 0 && (
                                                            <span
                                                                className="text-xs text-green-600 dark:text-green-400 flex-shrink-0"
                                                                title={`${resolvedCount} resolved comment${resolvedCount > 1 ? 's' : ''}`}
                                                                data-testid={`commit-resolved-badge-${commit.hash}`}
                                                            >
                                                                ✅{resolvedCount}
                                                            </span>
                                                        )}
                                                        {openCount > 0 && (
                                                            <span
                                                                className="text-xs text-[#848484] flex-shrink-0"
                                                                title={`${openCount} active comment${openCount > 1 ? 's' : ''}`}
                                                                data-testid={`commit-comment-badge-${commit.hash}`}
                                                            >
                                                                💬{openCount}
                                                            </span>
                                                        )}
                                                    </>
                                                );
                                            })()}
                                            <span className="text-xs text-[#1e1e1e] dark:text-[#ccc] break-words min-w-0">
                                                {isFixup ? fixupEntry!.displaySubject : commit.subject}
                                            </span>
                                            {/* Target commit fixup count */}
                                            {hasFixups && (
                                                <span
                                                    className="text-[10px] flex-shrink-0 ml-auto whitespace-nowrap"
                                                    style={{ color: groupColor }}
                                                    title={`Fixups: ${targetGroup!.fixupHashes.map(h => h.substring(0, 7)).join(', ')}`}
                                                    data-testid={`fixup-count-${commit.shortHash}`}
                                                >
                                                    ×{targetGroup!.fixupHashes.length} fix
                                                </span>
                                            )}
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
                                            <>
                                                {commitViewMode === 'tree' ? (
                                                    <FileTreeView
                                                        nodes={compactFolders(buildFileTree(files))}
                                                        commitHash={commit.hash}
                                                        selectedFile={selectedFile}
                                                        onFileSelect={onFileSelect}
                                                        fileCommentMap={fileCommentMap}
                                                    />
                                                ) : (
                                                    <FlatFileList
                                                        files={files}
                                                        onFileSelect={(filePath) => onFileSelect?.(commit.hash, filePath)}
                                                        selectedFilePath={selectedFile?.hash === commit.hash ? selectedFile?.filePath : null}
                                                        fileCommentMap={fileCommentMap}
                                                        commentBadgeTestIdPrefix="commit-file-comment-badge"
                                                        fileTestIdPrefix="commit-file"
                                                    />
                                                )}
                                            </>
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
            {hoveredCommit && tooltipAnchorRect && (() => {
                const hovFixupEntry = fixupGroups.fixupEntries.get(hoveredCommit.hash);
                const hovTargetGroup = fixupGroups.targetGroups.get(hoveredCommit.hash);
                const hovGroupColor = hovFixupEntry
                    ? groupColors[hovFixupEntry.colorSlot]
                    : hovTargetGroup
                        ? groupColors[hovTargetGroup.colorSlot]
                        : undefined;
                return (
                    <CommitTooltip
                        commit={hoveredCommit}
                        anchorRect={tooltipAnchorRect}
                        onMouseEnter={handleTooltipMouseEnter}
                        onMouseLeave={handleTooltipMouseLeave}
                        fixupEntry={hovFixupEntry}
                        targetGroup={hovTargetGroup}
                        groupColor={hovGroupColor}
                    />
                );
            })()}
        </div>
    );
}
