/**
 * CommitList — single-select list of git commits for the left panel.
 *
 * Each row shows a selection indicator, short hash, subject, relative time,
 * and author. Clicking a row selects it (expanding the file list inline) and
 * notifies the parent via onSelect. Hovering a row shows a tooltip with full
 * commit metadata after a 1000ms delay. Supports keyboard navigation with
 * ↑/↓ and Enter.
 *
 * This module is the interaction kernel: it owns the prop contract and wires
 * four focused pieces together. Selection transitions live in
 * `commitListSelection`, inline file expansion in `useCommitListExpansion`,
 * pointer/timer affordances in `useCommitListGestures`, and the two drag
 * systems in `useCommitListDragController`. Presentation lives in `CommitRow`,
 * `CommitRowBadges`, `CommitGroupSeparator`, `CommitExpandedFiles`, and
 * `CommitMobileSelectionBar`.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { CommitTooltip } from './CommitTooltip';
import { useCommitCommentTotals } from '../hooks/useCommitCommentTotals';
import { useFilesViewMode } from '../hooks/useFilesViewMode';
import { buildFixupGroups, FIXUP_GROUP_COLORS_LIGHT, FIXUP_GROUP_COLORS_DARK } from '../fixup-utils';
import type { FixupGroupMap } from '../fixup-utils';
import { isSessionContextAttachmentsEnabled } from '../../../utils/config';
import { isTouchOnly, type GitCommitItem } from './commitListTypes';
import {
    resolveSelectedSet,
    resolveFocusedHash,
    commitsInSet,
    computeKeyboardTargetIndex,
    computeRangeSelection,
    computeToggleSelection,
    computeAdditiveSelection,
} from './commitListSelection';
import { computeCommitGroups, buildCommitRowViewModel } from './commitRowViewModel';
import type { CommitGroup } from './commitRowViewModel';
import { useCommitListExpansion } from './useCommitListExpansion';
import { useCommitListGestures } from './useCommitListGestures';
import { useCommitListDragController } from './useCommitListDragController';
import { CommitRow, SwipeableCommitRow } from './CommitRow';
import { CommitGroupSeparator } from './CommitGroupSeparator';
import { CommitExpandedFiles } from './CommitExpandedFiles';
import { CommitMobileSelectionBar } from './CommitMobileSelectionBar';

export type { GitCommitItem } from './commitListTypes';
export { isTouchOnly } from './commitListTypes';

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

    // Flat/tree toggle for commit file lists (shared repo preference)
    const { mode: commitViewMode } = useFilesViewMode(workspaceId);

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

    const { expandedHash, fileCache, filesLoading, fileCommentMap, toggleExpansion } =
        useCommitListExpansion(workspaceId, initialExpandedHash);

    const gestures = useCommitListGestures({ touchOnly, onCommitContextMenu });

    const drag = useCommitListDragController({
        commits,
        selectedHashes,
        workspaceId,
        unpushedCount,
        sessionContextDragEnabled,
        onReorder,
    });

    const selectedCommitList = useMemo(
        () => commitsInSet(commits, resolveSelectedSet(selectedHashes, selectedHash)),
        [commits, selectedHash, selectedHashes],
    );

    const clearMobileSelection = useCallback(() => {
        onMobileSelectingChange?.(false);
        setAnchorHash(null);
        onMultiSelect?.([]);
    }, [onMultiSelect, onMobileSelectingChange]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (commits.length === 0) return;
        if (!onSelect && !onMultiSelect) return;
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const focusedHash = resolveFocusedHash(selectedHash, selectedHashes);
        const idx = focusedHash ? commits.findIndex(c => c.hash === focusedHash) : -1;
        const targetIdx = computeKeyboardTargetIndex(commits.length, idx, e.key === 'ArrowDown' ? 'down' : 'up');
        if (targetIdx === null) return;
        const target = commits[targetIdx];
        if (e.shiftKey && onMultiSelect) {
            onMultiSelect(computeAdditiveSelection(commits, resolveSelectedSet(selectedHashes, selectedHash), target));
        } else if (onSelect) {
            onSelect(target);
        }
    }, [commits, selectedHash, selectedHashes, onSelect, onMultiSelect]);

    // Scroll selected row into view
    useEffect(() => {
        if (!selectedHash || !listRef.current) return;
        const el = listRef.current.querySelector(`[data-hash="${selectedHash}"]`);
        if (el) el.scrollIntoView({ block: 'nearest' });
    }, [selectedHash]);

    /** Mobile tap / swipe-right toggle: flip membership and exit the mode when it empties. */
    const applyToggleSelection = useCallback((commit: GitCommitItem) => {
        if (!onMultiSelect) return;
        const result = computeToggleSelection(commits, resolveSelectedSet(selectedHashes, selectedHash), commit);
        if (result.isEmpty) onMobileSelectingChange?.(false);
        setAnchorHash(result.anchorHash);
        onMultiSelect(result.selected);
    }, [commits, onMultiSelect, onMobileSelectingChange, selectedHash, selectedHashes]);

    const handleCommitClick = useCallback((commit: GitCommitItem, e: React.MouseEvent) => {
        // A long press already opened the context menu — swallow the trailing click.
        if (gestures.consumeLongPressClick(commit.hash)) return;

        if (isMobileSelecting && onMultiSelect) {
            applyToggleSelection(commit);
            return;
        }

        const isCtrl = e.ctrlKey || e.metaKey;
        const isShift = e.shiftKey;

        if (isCtrl && onMultiSelect) {
            const result = computeToggleSelection(commits, resolveSelectedSet(selectedHashes, selectedHash), commit);
            onMultiSelect(result.selected);
            setAnchorHash(commit.hash);
            return;
        }

        if (isShift && onMultiSelect && anchorHash) {
            onMultiSelect(computeRangeSelection(commits, anchorHash, commit));
            return;
        }

        // Plain click: single select
        onSelect?.(commit);
        setAnchorHash(commit.hash);
        toggleExpansion(commit);
    }, [onSelect, onMultiSelect, selectedHashes, selectedHash, anchorHash, commits, isMobileSelecting, gestures, applyToggleSelection, toggleExpansion]);

    const handleMobileSelectionActions = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const firstSelectedCommit = selectedCommitList[0];
        if (!firstSelectedCommit) return;
        gestures.openContextMenuFromElement(e.currentTarget, firstSelectedCommit.hash);
    }, [gestures, selectedCommitList]);

    const handleSwipeRight = useCallback((rowId: string) => {
        if (!onMultiSelect) return;
        const commit = commits.find(c => c.hash === rowId);
        if (!commit) return;
        if (!isMobileSelecting) {
            // Enter multi-select mode with this commit
            onMobileSelectingChange?.(true);
            setAnchorHash(commit.hash);
            onMultiSelect([commit]);
            return;
        }
        applyToggleSelection(commit);
    }, [commits, isMobileSelecting, onMultiSelect, onMobileSelectingChange, applyToggleSelection]);

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

    const { hoveredCommit, tooltipAnchorRect } = gestures;

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
                        <CommitMobileSelectionBar
                            selectedCount={selectedCommitList.length}
                            onClear={clearMobileSelection}
                            onActions={handleMobileSelectionActions}
                        />
                    )}
                    {commits.map((commit, index) => {
                        const group = commitGroupsByStart.get(index);
                        const sessionContextPayload = drag.buildContextPayload(commit);
                        const isDragOver = drag.dragOverIndex === index && drag.dragIndex !== index;
                        const vm = buildCommitRowViewModel({
                            commit,
                            index,
                            commitCount: commits.length,
                            selectedHash,
                            selectedHashes,
                            unpushedCount,
                            group,
                            hasGroupAtNextIndex: commitGroupsByStart.has(index + 1),
                            fixupGroups,
                            groupColors,
                            commentCount: commitTotals.get(commit.hash)?.open ?? 0,
                            classifiedHashes,
                        });
                        // Reorder is offered only for commits that have not been pushed yet.
                        const canDrag = reorderable && vm.isUnpushed;

                        const rowContent = (
                            <CommitRow
                                commit={commit}
                                index={index}
                                vm={vm}
                                touchOnly={touchOnly}
                                isMobileSelecting={isMobileSelecting}
                                canDrag={canDrag}
                                sessionContextPayload={sessionContextPayload}
                                handleCommitClick={handleCommitClick}
                                handleCommitContextDragStart={drag.handleCommitContextDragStart}
                                handleReorderDragStart={drag.handleReorderDragStart}
                                handleRowMouseEnter={gestures.handleRowMouseEnter}
                                handleRowMouseLeave={gestures.handleRowMouseLeave}
                                mobileLongPress={gestures.mobileLongPress}
                                longPressCommitHashRef={gestures.longPressCommitHashRef}
                                handleCommitOverflowTouchStart={gestures.handleCommitOverflowTouchStart}
                                handleCommitOverflowTouchEnd={gestures.handleCommitOverflowTouchEnd}
                                onCommitContextMenu={onCommitContextMenu}
                                onDoubleClick={onDoubleClick}
                            />
                        );

                        return (
                            <div
                                key={commit.hash}
                                className={`relative ${drag.dragIndex === index ? 'opacity-40' : isDragOver ? 'border-t-2 border-t-[#007acc]' : ''}`}
                                {...drag.getReorderDropProps(index, canDrag)}
                            >
                                {group && <CommitGroupSeparator group={group} />}
                                {touchOnly && onCommitContextMenu ? (
                                    <SwipeableCommitRow
                                        commitHash={commit.hash}
                                        shortHash={commit.shortHash}
                                        activeRowId={gestures.swipeActiveRowId}
                                        onReveal={gestures.handleSwipeReveal}
                                        onClose={gestures.handleSwipeClose}
                                        onSwipeRight={handleSwipeRight}
                                        onSwipeDetected={gestures.handleSwipeDetected}
                                        onSwipeAction={onSwipeAction}
                                        disabled={isMobileSelecting}
                                    >
                                        {rowContent}
                                    </SwipeableCommitRow>
                                ) : rowContent}
                                {/* Expanded file list */}
                                {commit.hash === expandedHash && (
                                    <CommitExpandedFiles
                                        commit={commit}
                                        files={fileCache[commit.hash]}
                                        isFilesLoading={filesLoading === commit.hash}
                                        viewMode={commitViewMode}
                                        selectedFile={selectedFile}
                                        onFileSelect={onFileSelect}
                                        fileCommentMap={fileCommentMap}
                                        repoRoot={repoRoot}
                                    />
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
                        onMouseEnter={gestures.handleTooltipMouseEnter}
                        onMouseLeave={gestures.handleTooltipMouseLeave}
                        fixupEntry={hovFixupEntry}
                        targetGroup={hovTargetGroup}
                        groupColor={hovGroupColor}
                    />
                );
            })()}
        </div>
    );
}
