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
import { getSpaCocClient } from '../../../api/cocClient';
import { formatRelativeTime } from '../../../utils/format';
import { CommitTooltip } from './CommitTooltip';
import { buildFileTree, compactFolders, FileTreeView, FlatFileList } from '../diff/FileTree';
import type { FileChange } from '../diff/FileTree';
import { useFileCommentCounts } from '../hooks/useFileCommentCounts';
import { useCommitCommentTotals } from '../hooks/useCommitCommentTotals';
import { computeDiffCommentKey } from '../../../../comments/diff-comment-utils';
import { useFilesViewMode } from '../hooks/useFilesViewMode';
import { buildFixupGroups, FIXUP_GROUP_COLORS_LIGHT, FIXUP_GROUP_COLORS_DARK } from '../fixup-utils';
import type { FixupGroupMap } from '../fixup-utils';
import { useLongPress } from '../../../hooks/ui/useLongPress';
import { useSwipeReveal, SWIPE_LEFT_MAX, SWIPE_DETECT_THRESHOLD } from '../../../hooks/ui/useSwipeReveal';
import { createGitCommitContextDragPayload, type GitCommitContextDragPayload, writePointerContextDragData } from '../../chat/sessionContextDrag';
import { isSessionContextAttachmentsEnabled } from '../../../utils/config';

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
export const isTouchOnly = (): boolean =>
    typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

// Deterministic-color palette used for author avatar badges.
const AVATAR_PALETTE: ReadonlyArray<{ bg: string; fg: string }> = [
    { bg: 'linear-gradient(135deg, #6366f1, #3730a3)', fg: '#fff' },
    { bg: 'linear-gradient(135deg, #1a7f37, #14532d)', fg: '#fff' },
    { bg: 'linear-gradient(135deg, #cf222e, #7f1d1d)', fg: '#fff' },
    { bg: 'linear-gradient(135deg, #f59e0b, #b45309)', fg: '#fff' },
    { bg: 'linear-gradient(135deg, #06b6d4, #155e75)', fg: '#fff' },
    { bg: 'linear-gradient(135deg, #8b5cf6, #5b21b6)', fg: '#fff' },
    { bg: 'linear-gradient(135deg, #ec4899, #9d174d)', fg: '#fff' },
    { bg: 'linear-gradient(135deg, #0078d4, #0050b3)', fg: '#fff' },
];

function getAuthorInitials(name: string): string {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return '?';
    const parts = trimmed.split(/[\s/_\-.]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return trimmed.slice(0, 2).toUpperCase();
}

function getAuthorPalette(name: string): { bg: string; fg: string } {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

interface CommitGroup {
    label: string;
    isUnpushed: boolean;
    startIdx: number;
    count: number;
}

/** Group commits into Unpushed / Today / Yesterday / This week / This month / Older. */
function computeCommitGroups(commits: GitCommitItem[], unpushedCount: number): CommitGroup[] {
    const groups: CommitGroup[] = [];
    if (unpushedCount > 0) {
        groups.push({ label: 'Unpushed', isUnpushed: true, startIdx: 0, count: Math.min(unpushedCount, commits.length) });
    }
    const startOfToday = (() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    })();
    const startOfYesterday = startOfToday - 86_400_000;
    const weekStart = startOfToday - 7 * 86_400_000;
    const monthStart = startOfToday - 30 * 86_400_000;

    let lastLabel: string | null = null;
    let groupStart = unpushedCount;
    for (let i = unpushedCount; i < commits.length; i++) {
        const parsed = new Date(commits[i].date).getTime();
        let label: string;
        if (!Number.isFinite(parsed)) label = 'Older';
        else if (parsed >= startOfToday) label = 'Today';
        else if (parsed >= startOfYesterday) label = 'Yesterday';
        else if (parsed >= weekStart) label = 'This week';
        else if (parsed >= monthStart) label = 'This month';
        else label = 'Older';
        if (label !== lastLabel) {
            if (lastLabel !== null) {
                groups.push({ label: lastLabel, isUnpushed: false, startIdx: groupStart, count: i - groupStart });
            }
            lastLabel = label;
            groupStart = i;
        }
    }
    if (lastLabel !== null) {
        groups.push({ label: lastLabel, isUnpushed: false, startIdx: groupStart, count: commits.length - groupStart });
    }
    return groups;
}

/** Wrapper component that adds swipe-to-reveal gesture to a commit row. */
function SwipeableCommitRow({ commitHash, shortHash, activeRowId, onReveal, onClose, onSwipeRight, onSwipeDetected, onSwipeAction, disabled, children }: {
    commitHash: string;
    shortHash: string;
    activeRowId: string | null;
    onReveal: (rowId: string) => void;
    onClose: () => void;
    onSwipeRight?: (rowId: string) => void;
    onSwipeDetected?: () => void;
    onSwipeAction?: (action: 'review' | 'ask-ai' | 'more', commitHash: string) => void;
    disabled?: boolean;
    children: React.ReactNode;
}) {
    const { translateX, isSwiping, handlers } = useSwipeReveal({
        rowId: commitHash,
        activeRowId,
        onReveal,
        onClose,
        onSwipeRight,
        onSwipeDetected,
        disabled,
    });

    const showActions = translateX < -SWIPE_DETECT_THRESHOLD;

    return (
        <div className="relative overflow-hidden" data-testid={`commit-swipe-container-${shortHash}`}>
            {/* Action buttons revealed behind the row */}
            {showActions && (
                <div
                    className="absolute inset-y-0 right-0 flex items-stretch z-0"
                    style={{ width: `${SWIPE_LEFT_MAX}px` }}
                    data-testid={`commit-swipe-actions-${shortHash}`}
                >
                    <button
                        type="button"
                        className="flex-1 flex items-center justify-center text-white text-[11px] font-medium"
                        style={{ backgroundColor: '#0078d4' }}
                        onClick={() => onSwipeAction?.('review', commitHash)}
                        data-testid={`commit-swipe-review-${shortHash}`}
                    >
                        Review
                    </button>
                    <button
                        type="button"
                        className="flex-1 flex items-center justify-center text-white text-[11px] font-medium"
                        style={{ backgroundColor: '#8250df' }}
                        onClick={() => onSwipeAction?.('ask-ai', commitHash)}
                        data-testid={`commit-swipe-ask-ai-${shortHash}`}
                    >
                        Ask AI
                    </button>
                    <button
                        type="button"
                        className="flex-1 flex items-center justify-center text-white text-[11px] font-medium rounded-r"
                        style={{ backgroundColor: '#616161' }}
                        onClick={() => onSwipeAction?.('more', commitHash)}
                        data-testid={`commit-swipe-more-${shortHash}`}
                    >
                        ⋮
                    </button>
                </div>
            )}
            {/* Row content — slides left/right */}
            <div
                className="relative z-10 bg-white dark:bg-[#1e1e1e]"
                style={{
                    transform: `translateX(${translateX}px)`,
                    transition: isSwiping ? 'none' : 'transform 0.25s ease-out',
                }}
                {...handlers}
            >
                {children}
            </div>
        </div>
    );
}

export interface CommitListProps {
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
    /** Repo root path for "Copy Absolute Path" context menu action on file rows. */
    repoRoot?: string;
    /** Whether mobile multi-select mode is active (lifted to parent). */
    isMobileSelecting?: boolean;
    /** Called when mobile multi-select mode changes. */
    onMobileSelectingChange?: (selecting: boolean) => void;
    /** Called when swipe-left action buttons are tapped (Review, Ask AI). */
    onSwipeAction?: (action: 'review' | 'ask-ai' | 'more', commitHash: string) => void;
    /** Set of commit hashes that have a stored classification result. When provided, a ✓ badge is shown. */
    classifiedHashes?: ReadonlySet<string>;
    /** Called when a commit row is double-clicked. Opens the commit in a pop-out window. */
    onDoubleClick?: (commit: GitCommitItem) => void;
}

export function CommitList({ title, commits, selectedHash, selectedHashes, onMultiSelect, selectedFile, initialExpandedHash, onSelect, onFileSelect, onCommitContextMenu, workspaceId, loading, defaultCollapsed = false, showEmpty = false, emptyMessage, unpushedCount = 0, reorderable = false, onReorder, repoRoot, isMobileSelecting = false, onMobileSelectingChange, onSwipeAction, classifiedHashes, onDoubleClick }: CommitListProps) {
    const [collapsed, setCollapsed] = useState(defaultCollapsed);
    const listRef = useRef<HTMLDivElement>(null);
    const [anchorHash, setAnchorHash] = useState<string | null>(null);
    const longPressCommitHashRef = useRef<string | null>(null);
    const suppressLongPressClickHashRef = useRef<string | null>(null);
    // Swipe reveal state: which row is currently swiped open
    const [swipeActiveRowId, setSwipeActiveRowId] = useState<string | null>(null);
    const swipeCancelLongPressRef = useRef(false);
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
    const touchOnly = isTouchOnly();
    const sessionContextDragEnabled = isSessionContextAttachmentsEnabled();

    const selectedCommitList = useMemo(() => {
        const currentSet = selectedHashes ?? (selectedHash ? new Set([selectedHash]) : new Set<string>());
        return commits.filter(c => currentSet.has(c.hash));
    }, [commits, selectedHash, selectedHashes]);

    const clearMobileSelection = useCallback(() => {
        onMobileSelectingChange?.(false);
        setAnchorHash(null);
        onMultiSelect?.([]);
    }, [onMultiSelect, onMobileSelectingChange]);

    const createSyntheticContextMenuEvent = useCallback((element: HTMLElement): React.MouseEvent => {
        const rect = element.getBoundingClientRect();
        return {
            clientX: rect.left,
            clientY: rect.bottom,
            preventDefault: () => {},
            stopPropagation: () => {},
        } as React.MouseEvent;
    }, []);

    const openContextMenuFromElement = useCallback((element: HTMLElement, commitHash: string) => {
        onCommitContextMenu?.(createSyntheticContextMenuEvent(element), commitHash);
    }, [createSyntheticContextMenuEvent, onCommitContextMenu]);

    const mobileLongPress = useLongPress((x: number, y: number) => {
        if (!touchOnly) return;
        const hash = longPressCommitHashRef.current;
        if (!hash) return;
        suppressLongPressClickHashRef.current = hash;
        // Open context menu at the touch coordinates (same as desktop right-click)
        onCommitContextMenu?.({
            clientX: x,
            clientY: y,
            preventDefault: () => {},
            stopPropagation: () => {},
        } as React.MouseEvent, hash);
    }, { cancelSignal: swipeCancelLongPressRef.current });

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
            getSpaCocClient().git.listCommitFiles(workspaceId, initialExpandedHash)
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
        const didLongPress = mobileLongPress.didLongPress();
        if (didLongPress && suppressLongPressClickHashRef.current === commit.hash) {
            suppressLongPressClickHashRef.current = null;
            return;
        }
        if (didLongPress) {
            suppressLongPressClickHashRef.current = null;
        }

        if (isMobileSelecting && onMultiSelect) {
            const currentSet = selectedHashes ?? (selectedHash ? new Set([selectedHash]) : new Set<string>());
            const newSet = new Set(currentSet);
            if (newSet.has(commit.hash)) {
                newSet.delete(commit.hash);
            } else {
                newSet.add(commit.hash);
            }
            if (newSet.size === 0) {
                onMobileSelectingChange?.(false);
                setAnchorHash(null);
            } else {
                setAnchorHash(commit.hash);
            }
            onMultiSelect(commits.filter(c => newSet.has(c.hash)));
            return;
        }

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
                getSpaCocClient().git.listCommitFiles(workspaceId, commit.hash)
                    .then(data => {
                        setFileCache(prev => ({ ...prev, [commit.hash]: data.files || [] }));
                    })
                    .catch(() => {
                        setFileCache(prev => ({ ...prev, [commit.hash]: [] }));
                    })
                    .finally(() => setFilesLoading(null));
            }
        }
    }, [expandedHash, fileCache, workspaceId, onSelect, onMultiSelect, selectedHashes, selectedHash, anchorHash, commits, isMobileSelecting, mobileLongPress, onMobileSelectingChange]);

    const handleMobileSelectionActions = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const firstSelectedCommit = selectedCommitList[0];
        if (!firstSelectedCommit) return;
        openContextMenuFromElement(e.currentTarget, firstSelectedCommit.hash);
    }, [openContextMenuFromElement, selectedCommitList]);

    const handleCommitOverflowTouchStart = useCallback((e: React.TouchEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleCommitOverflowTouchEnd = useCallback((e: React.TouchEvent<HTMLButtonElement>, commitHash: string) => {
        e.preventDefault();
        e.stopPropagation();
        openContextMenuFromElement(e.currentTarget, commitHash);
    }, [openContextMenuFromElement]);

    // Swipe reveal handlers
    const handleSwipeReveal = useCallback((rowId: string) => {
        setSwipeActiveRowId(rowId);
    }, []);

    const handleSwipeClose = useCallback(() => {
        setSwipeActiveRowId(null);
    }, []);

    const handleSwipeRight = useCallback((rowId: string) => {
        if (!onMultiSelect) return;
        const commit = commits.find(c => c.hash === rowId);
        if (!commit) return;
        if (!isMobileSelecting) {
            // Enter multi-select mode with this commit
            onMobileSelectingChange?.(true);
            setAnchorHash(commit.hash);
            onMultiSelect([commit]);
        } else {
            // Toggle this commit in/out of selection
            const currentSet = selectedHashes ?? (selectedHash ? new Set([selectedHash]) : new Set<string>());
            const newSet = new Set(currentSet);
            if (newSet.has(commit.hash)) {
                newSet.delete(commit.hash);
            } else {
                newSet.add(commit.hash);
            }
            if (newSet.size === 0) {
                onMobileSelectingChange?.(false);
                setAnchorHash(null);
            }
            onMultiSelect(commits.filter(c => newSet.has(c.hash)));
        }
    }, [commits, isMobileSelecting, onMultiSelect, onMobileSelectingChange, selectedHash, selectedHashes]);

    const handleSwipeDetected = useCallback(() => {
        swipeCancelLongPressRef.current = true;
        // Reset after a tick so the useLongPress hook picks up the signal
        setTimeout(() => { swipeCancelLongPressRef.current = false; }, 0);
    }, []);

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
    const handleReorderDragStart = useCallback((e: React.DragEvent, index: number) => {
        e.stopPropagation();
        setDragIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
    }, []);

    const handleCommitContextDragStart = useCallback((e: React.DragEvent, sessionContextPayload: GitCommitContextDragPayload) => {
        e.stopPropagation();
        writePointerContextDragData(e.dataTransfer, sessionContextPayload);
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
        if (dragIndex === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverIndex(index);
    }, [dragIndex]);

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

    // Map { startIdx -> CommitGroup } so we can render a date-group separator
    // right before the first commit of each group at zero scan cost per row.
    const commitGroupsByStart = useMemo(() => {
        const map = new Map<number, CommitGroup>();
        for (const g of computeCommitGroups(commits, unpushedCount)) {
            map.set(g.startIdx, g);
        }
        return map;
    }, [commits, unpushedCount]);

    return (
        <div className="commit-list" data-testid={titleTestId}>
            <button
                className="w-full text-left flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.07em] px-3 py-1 bg-[#f5f5f5] dark:bg-[#252526] border-b border-[#e0e0e0] dark:border-[#3c3c3c] sticky top-0 z-10 cursor-pointer hover:bg-[#ececec] dark:hover:bg-[#2a2d2e] transition-colors"
                onClick={() => setCollapsed(prev => !prev)}
                data-testid={`${titleTestId}-toggle`}
            >
                <span className="text-[9px] text-[#848484] flex-shrink-0">
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
                <div
                    ref={listRef}
                    role="listbox"
                    tabIndex={0}
                    onKeyDown={handleKeyDown}
                    onClick={(e) => {
                        if (isMobileSelecting && e.target === e.currentTarget) {
                            clearMobileSelection();
                        }
                    }}
                    className="outline-none"
                >
                    {isMobileSelecting && selectedCommitList.length > 0 && (
                        <div
                            className="flex items-center gap-2 px-3 py-2 bg-[#f0f9ff] dark:bg-[#1a2733] border-b border-[#e0e0e0] dark:border-[#3c3c3c] sticky top-0 z-20"
                            data-testid="commit-mobile-selection-bar"
                        >
                            <button
                                type="button"
                                className="w-7 h-7 rounded text-sm text-[#616161] dark:text-[#ccc] hover:bg-[#dbeafe] dark:hover:bg-[#243447]"
                                aria-label="Clear commit selection"
                                onClick={clearMobileSelection}
                                data-testid="commit-mobile-selection-cancel"
                            >
                                ✕
                            </button>
                            <span className="text-xs font-medium text-[#1e1e1e] dark:text-[#ccc]" data-testid="commit-mobile-selection-count">
                                {selectedCommitList.length} selected
                            </span>
                            <button
                                type="button"
                                className="ml-auto px-2.5 py-1.5 rounded text-xs font-medium text-[#0078d4] dark:text-[#3794ff] hover:bg-[#dbeafe] dark:hover:bg-[#243447]"
                                onClick={handleMobileSelectionActions}
                                data-testid="commit-mobile-selection-actions"
                            >
                                ⋮ Actions
                            </button>
                        </div>
                    )}
                    {commits.map((commit, index) => {
                        const isSelected = selectedHashes
                            ? selectedHashes.has(commit.hash)
                            : commit.hash === selectedHash;
                        const isExpanded = commit.hash === expandedHash;
                        const files = fileCache[commit.hash];
                        const isFilesLoading = filesLoading === commit.hash;
                        const isUnpushed = unpushedCount > 0 && index < unpushedCount;
                        const isMerge = (commit.parentHashes?.length ?? 0) > 1;
                        const group = commitGroupsByStart.get(index);
                        const canDrag = reorderable && isUnpushed;
                        const sessionContextPayload = sessionContextDragEnabled && workspaceId
                            ? createGitCommitContextDragPayload(commit, { activeWorkspaceId: workspaceId })
                            : null;
                        const isContextDragSource = !!sessionContextPayload;
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
                        const commentCount = commitTotals.get(commit.hash)?.open ?? 0;
                        const palette = getAuthorPalette(commit.author);
                        const initials = getAuthorInitials(commit.author);
                        const isLastInGroup = group
                            ? index === group.startIdx + group.count - 1
                            : index === commits.length - 1 || commitGroupsByStart.has(index + 1);

                        return (
                            <div
                                key={commit.hash}
                                className={`relative ${dragIndex === index ? 'opacity-40' : isDragOver ? 'border-t-2 border-t-[#007acc]' : ''}`}
                                onDragOver={canDrag ? (e) => handleDragOver(e, index) : undefined}
                                onDrop={canDrag ? (e) => handleDrop(e, index) : undefined}
                                onDragEnd={canDrag ? handleDragEnd : undefined}
                            >
                                {group && group.isUnpushed && (
                                    <div
                                        className="px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-[#f57c00] dark:text-[#ffb74d] border-b border-t border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fff8f0] dark:bg-[#2a1f00] flex items-center gap-1.5 sticky top-[26px] z-[1]"
                                        data-testid="unpushed-separator"
                                        aria-label={`${group.count} unpushed commit${group.count !== 1 ? 's' : ''}`}
                                    >
                                        <span aria-hidden="true">↑</span>
                                        Unpushed · {group.count} commit{group.count !== 1 ? 's' : ''}
                                    </div>
                                )}
                                {group && !group.isUnpushed && (
                                    <div
                                        className="px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-[#616161] dark:text-[#999] border-b border-t border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#1f1f1f] flex items-center sticky top-[26px] z-[1]"
                                        data-testid={`commit-date-group-${group.label.toLowerCase().replace(/\s+/g, '-')}`}
                                    >
                                        {group.label} · {group.count} commit{group.count !== 1 ? 's' : ''}
                                    </div>
                                )}
                                {(() => {
                                    const rowContent = (
                                        <>
                                        <button
                                            role="option"
                                            aria-selected={isSelected}
                                            data-hash={commit.hash}
                                            className={`commit-row w-full grid grid-cols-[14px_minmax(0,1fr)_auto] items-start gap-2 px-3 py-1.5 text-left transition-colors border-b border-[#e0e0e0] dark:border-[#3c3c3c] ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20 shadow-[inset_3px_0_0_#0078d4] dark:shadow-[inset_3px_0_0_#3794ff]' : 'hover:bg-[#f0f0f0] dark:hover:bg-[#2a2d2e]'}${isFixup ? ' opacity-70' : ''}${isContextDragSource ? ' cursor-grab active:cursor-grabbing hover:ring-1 hover:ring-sky-300 dark:hover:ring-sky-700' : ''}`}
                                            onClick={(e) => handleCommitClick(commit, e)}
                                            onDoubleClick={() => onDoubleClick?.(commit)}
                                            draggable={isContextDragSource}
                                            onDragStart={sessionContextPayload ? (e) => handleCommitContextDragStart(e, sessionContextPayload) : undefined}
                                            onMouseEnter={isTouchOnly() ? undefined : (e) => handleRowMouseEnter(commit, e)}
                                            onMouseLeave={isTouchOnly() ? undefined : handleRowMouseLeave}
                                            onTouchStart={touchOnly && onCommitContextMenu ? (e) => { longPressCommitHashRef.current = commit.hash; mobileLongPress.onTouchStart(e); } : undefined}
                                            onTouchEnd={touchOnly && onCommitContextMenu ? mobileLongPress.onTouchEnd : undefined}
                                            onTouchMove={touchOnly && onCommitContextMenu ? mobileLongPress.onTouchMove : undefined}
                                            onContextMenu={(e) => { if (e.shiftKey) return; e.preventDefault(); e.stopPropagation(); onCommitContextMenu?.(e, commit.hash); }}
                                            data-testid={`commit-row-${commit.shortHash}`}
                                            data-session-context-source={isContextDragSource ? 'true' : undefined}
                                            data-session-context-kind={isContextDragSource ? 'commit' : undefined}
                                            data-fixup-type={fixupEntry?.type}
                                            data-fixup-target={fixupEntry?.targetHash}
                                            title={sessionContextPayload ? `${sessionContextPayload.label} - drag to attach as commit context` : undefined}
                                        >
                                    {/* Graph column: dot + connector line down to the next commit */}
                                    <span className="flex flex-col items-center self-stretch pt-1 leading-none">
                                        <span
                                            className={`text-[10px] flex-shrink-0 ${isUnpushed ? 'text-[#f57c00] dark:text-[#ffb74d]' : isMerge ? 'text-[#8250df] dark:text-[#a371f7]' : 'text-[#0078d4] dark:text-[#3794ff]'}`}
                                            style={groupColor ? { color: groupColor } : undefined}
                                            data-testid={groupColor ? `fixup-dot-${commit.shortHash}` : undefined}
                                            aria-hidden="true"
                                        >
                                            {isUnpushed ? '●' : '○'}
                                        </span>
                                        {!isLastInGroup && (
                                            <span className="flex-1 w-px bg-[#e0e0e0] dark:bg-[#3c3c3c] mt-0.5" aria-hidden="true" />
                                        )}
                                    </span>

                                    {/* Body column: subject (line 1) + meta (line 2) */}
                                    <span className="min-w-0 flex flex-col gap-0.5">
                                        <span className="flex items-start gap-1.5 min-w-0">
                                            {canDrag && (
                                                <span
                                                    className="text-[10px] flex-shrink-0 cursor-grab text-[#848484] hover:text-[#333] dark:hover:text-[#ccc]"
                                                    title="Drag to reorder"
                                                    aria-hidden="true"
                                                    draggable={canDrag}
                                                    onDragStart={(e) => handleReorderDragStart(e, index)}
                                                    data-testid={`commit-reorder-handle-${commit.shortHash}`}
                                                >
                                                    ⠿
                                                </span>
                                            )}
                                            {isMobileSelecting && (
                                                <span
                                                    className="text-[13px] flex-shrink-0 text-[#0078d4] dark:text-[#3794ff]"
                                                    aria-hidden="true"
                                                    data-testid={`commit-mobile-select-indicator-${commit.shortHash}`}
                                                >
                                                    {isSelected ? '☑' : '☐'}
                                                </span>
                                            )}
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
                                            <span className="text-xs font-semibold text-[#1e1e1e] dark:text-[#ccc] break-words min-w-0 leading-snug">
                                                {isFixup ? fixupEntry!.displaySubject : commit.subject}
                                            </span>
                                        </span>
                                        <span className="flex items-center gap-1.5 text-[11px] text-[#848484] dark:text-[#9d9d9d] min-w-0">
                                            <span className={`font-mono ${isUnpushed ? 'text-[#f57c00] dark:text-[#ffb74d]' : 'text-[#0078d4] dark:text-[#3794ff]'}`}>{commit.shortHash}</span>
                                            <span
                                                className="inline-flex items-center justify-center w-[14px] h-[14px] rounded-full text-[8px] font-semibold flex-shrink-0"
                                                style={{ background: palette.bg, color: palette.fg }}
                                                aria-hidden="true"
                                            >
                                                {initials}
                                            </span>
                                            <span className="truncate">{commit.author}</span>
                                            <span className="whitespace-nowrap">· {formatRelativeTime(commit.date)}</span>
                                        </span>
                                    </span>

                                    {/* Right column: per-commit mini-flags (comments, fixup count, merge, unpushed) */}
                                    <span className="flex items-center gap-1 flex-shrink-0 self-center">
                                        {commentCount > 0 && (
                                            <span
                                                className="inline-flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-semibold border border-[#0078d4]/30 dark:border-[#3794ff]/35 bg-[#ddf4ff] dark:bg-[#3794ff]/15 text-[#0078d4] dark:text-[#3794ff] tabular-nums"
                                                title={`${commentCount} active comment${commentCount > 1 ? 's' : ''}`}
                                                data-testid={`commit-comment-badge-${commit.hash}`}
                                            >
                                                {commentCount}
                                            </span>
                                        )}
                                        {hasFixups && (
                                            <span
                                                className="inline-flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-semibold border border-[#f5d9a1] bg-[#fff8c5] dark:bg-[#9a6700]/25 text-[#9a6700] dark:text-[#ffb74d] tabular-nums whitespace-nowrap"
                                                style={{ color: groupColor }}
                                                title={`Fixups: ${targetGroup!.fixupHashes.map(h => h.substring(0, 7)).join(', ')}`}
                                                data-testid={`fixup-count-${commit.shortHash}`}
                                            >
                                                ×{targetGroup!.fixupHashes.length} fix
                                            </span>
                                        )}
                                        {isMerge && (
                                            <span
                                                className="inline-flex items-center justify-center w-[15px] h-[15px] rounded-full text-[9px] font-semibold border border-[#8250df]/30 dark:border-[#a371f7]/35 bg-[#f3e8ff] dark:bg-[#a371f7]/15 text-[#8250df] dark:text-[#a371f7]"
                                                title="Merge commit"
                                                data-testid={`commit-merge-flag-${commit.shortHash}`}
                                                aria-label="Merge commit"
                                            >
                                                M
                                            </span>
                                        )}
                                        {isUnpushed && (
                                            <span
                                                className="inline-flex items-center justify-center w-[15px] h-[15px] rounded-full text-[9px] font-semibold border border-[#f5d9a1] bg-[#fff8c5] dark:bg-[#9a6700]/25 text-[#9a6700] dark:text-[#ffb74d]"
                                                title="Unpushed commit"
                                                data-testid={`commit-unpushed-flag-${commit.shortHash}`}
                                                aria-label="Unpushed commit"
                                            >
                                                ↑
                                            </span>
                                        )}
                                        {classifiedHashes?.has(commit.hash) && (
                                            <span
                                                className="inline-flex items-center justify-center w-[15px] h-[15px] rounded-full text-[9px] font-semibold border border-[#a7f3d0]/60 bg-[#d1fae5] dark:bg-[#064e3b]/25 text-[#047857] dark:text-[#34d399]"
                                                title="Diff classified"
                                                data-testid={`commit-classified-flag-${commit.shortHash}`}
                                                aria-label="Diff classified"
                                            >
                                                ✓
                                            </span>
                                        )}
                                    </span>
                                </button>
                                {touchOnly && !isMobileSelecting && onCommitContextMenu && (
                                    <button
                                        type="button"
                                        className="absolute right-2 top-1.5 w-9 h-9 rounded text-sm text-[#616161] dark:text-[#ccc] bg-[#f0f0f0]/60 dark:bg-[#333]/60 hover:bg-[#e8e8e8] dark:hover:bg-[#333] touch-manipulation flex items-center justify-center"
                                        aria-label={`Open actions for commit ${commit.shortHash}`}
                                        onTouchStart={handleCommitOverflowTouchStart}
                                        onTouchEnd={(e) => handleCommitOverflowTouchEnd(e, commit.hash)}
                                        data-testid={`commit-mobile-actions-${commit.shortHash}`}
                                    >
                                        ⋮
                                    </button>
                                )}
                                </>
                                    );

                                    if (touchOnly && onCommitContextMenu) {
                                        return (
                                            <SwipeableCommitRow
                                                commitHash={commit.hash}
                                                shortHash={commit.shortHash}
                                                activeRowId={swipeActiveRowId}
                                                onReveal={handleSwipeReveal}
                                                onClose={handleSwipeClose}
                                                onSwipeRight={handleSwipeRight}
                                                onSwipeDetected={handleSwipeDetected}
                                                onSwipeAction={onSwipeAction}
                                                disabled={isMobileSelecting}
                                            >
                                                {rowContent}
                                            </SwipeableCommitRow>
                                        );
                                    }
                                    return rowContent;
                                })()}
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
                                                        repoRoot={repoRoot}
                                                    />
                                                ) : (
                                                    <FlatFileList
                                                        files={files}
                                                        onFileSelect={(filePath) => onFileSelect?.(commit.hash, filePath)}
                                                        selectedFilePath={selectedFile?.hash === commit.hash ? selectedFile?.filePath : null}
                                                        fileCommentMap={fileCommentMap}
                                                        commentBadgeTestIdPrefix="commit-file-comment-badge"
                                                        fileTestIdPrefix="commit-file"
                                                        repoRoot={repoRoot}
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
