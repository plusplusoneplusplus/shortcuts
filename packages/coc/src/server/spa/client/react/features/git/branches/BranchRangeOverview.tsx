/**
 * BranchRangeOverview — right-panel view for branch-range mode.
 *
 * Shows a draggable split panel with BranchCommitStrip (top) and
 * BranchAllFilesDiff (bottom), plus resize/drag state and branch
 * comment count fetching.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getSpaCocClient } from '../../../api/cocClient';
import { BranchCommitStrip } from './BranchCommitStrip';
import { BranchAllFilesDiff } from './BranchAllFilesDiff';
import type { BranchRangeFile } from './BranchAllFilesDiff';
import type { DiffComment } from '../../../../comments/diff-comment-types';
import type { GitCommitItem } from '../commits/CommitList';
import type { BranchRangeInfo } from './BranchChanges';
import { useGitReviewPopOut, gitReviewBranchPopOutKey } from '../../../contexts/GitReviewPopOutContext';
import { buildGitBranchRangePopOutUrl } from '../../../layout/Router';
import { createGitRangeContextDragPayload } from '../../chat/sessionContextDrag';
import { lookupCloneBaseUrl } from '../../../repos/cloneRegistry';
import { isSessionContextAttachmentsEnabled } from '../../../utils/config';

const RANGE_STORAGE_KEY = 'coc.branchRangeOverview.upperHeight';
const DEFAULT_UPPER_HEIGHT = 160;
const MIN_UPPER_HEIGHT = 80;

function loadUpperHeight(): number {
    try {
        const stored = localStorage.getItem(RANGE_STORAGE_KEY);
        if (stored !== null) {
            const parsed = Number(stored);
            if (Number.isFinite(parsed) && parsed >= MIN_UPPER_HEIGHT) return parsed;
        }
    } catch { /* ignore */ }
    return DEFAULT_UPPER_HEIGHT;
}

export interface BranchRangeOverviewProps {
    workspaceId: string;
    range: BranchRangeInfo;
    commits?: GitCommitItem[];
    files?: BranchRangeFile[];
    unpushedCount?: number;
    onFileSelect?: (filePath: string) => void;
    onAllCommentsClick?: () => void;
    onAskAI?: () => void;
    isPopOut?: boolean;
    /** When set, scrolls the file list to the given file. */
    scrollToFilePath?: string | null;
}

export function BranchRangeOverview({ workspaceId, range, commits: rangeCommits, files: rangeFiles, unpushedCount, onFileSelect, onAllCommentsClick, onAskAI, isPopOut, scrollToFilePath }: BranchRangeOverviewProps) {
    const [upperHeight, setUpperHeight] = useState(loadUpperHeight);
    const [isDragging, setIsDragging] = useState(false);
    const [branchCommentCount, setBranchCommentCount] = useState(0);
    const rangeContainerRef = useRef<HTMLDivElement>(null);
    const startYRef = useRef(0);
    const startHeightRef = useRef(0);
    const { markPoppedOut } = useGitReviewPopOut();
    const sessionContextPayload = isSessionContextAttachmentsEnabled()
        ? createGitRangeContextDragPayload(range, { activeWorkspaceId: workspaceId })
        : null;

    const handlePopOut = useCallback(() => {
        const url = buildGitBranchRangePopOutUrl(workspaceId, lookupCloneBaseUrl(workspaceId));
        const win = window.open(url, `coc-git-review-branch-${workspaceId}`, 'width=1200,height=800');
        if (win) {
            markPoppedOut(gitReviewBranchPopOutKey(workspaceId));
        }
    }, [workspaceId, markPoppedOut]);

    const getMaxUpperHeight = useCallback(() => {
        if (!rangeContainerRef.current) return 400;
        return Math.floor(rangeContainerRef.current.clientHeight * 0.5);
    }, []);

    const onDragMove = useCallback((clientY: number) => {
        const delta = clientY - startYRef.current;
        const maxHeight = getMaxUpperHeight();
        const newHeight = Math.min(Math.max(startHeightRef.current + delta, MIN_UPPER_HEIGHT), maxHeight);
        setUpperHeight(newHeight);
    }, [getMaxUpperHeight]);

    const onDragEnd = useCallback(() => {
        setIsDragging(false);
    }, []);

    // Persist height when drag ends
    useEffect(() => {
        if (!isDragging) {
            try { localStorage.setItem(RANGE_STORAGE_KEY, String(upperHeight)); } catch { /* ignore */ }
        }
    }, [isDragging, upperHeight]);

    // Fetch branch-range comment count
    useEffect(() => {
        getSpaCocClient().git.listDiffComments(workspaceId, { oldRef: range.baseRef, newRef: range.headRef })
            .then((data: { comments?: DiffComment[] }) => setBranchCommentCount((data.comments ?? []).length))
            .catch(() => setBranchCommentCount(0));
    }, [workspaceId, range.baseRef, range.headRef]);

    // Global mouse/touch listeners while dragging
    useEffect(() => {
        if (!isDragging) return;
        const handleMouseMove = (e: MouseEvent) => { e.preventDefault(); onDragMove(e.clientY); };
        const handleMouseUp = () => onDragEnd();
        const handleTouchMove = (e: TouchEvent) => {
            if (e.touches.length === 1) { e.preventDefault(); onDragMove(e.touches[0].clientY); }
        };
        const handleTouchEnd = () => onDragEnd();

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('touchmove', handleTouchMove, { passive: false });
        document.addEventListener('touchend', handleTouchEnd);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('touchmove', handleTouchMove);
            document.removeEventListener('touchend', handleTouchEnd);
        };
    }, [isDragging, onDragMove, onDragEnd]);

    const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        startYRef.current = e.clientY;
        startHeightRef.current = upperHeight;
        setIsDragging(true);
    }, [upperHeight]);

    const handleDividerTouchStart = useCallback((e: React.TouchEvent) => {
        if (e.touches.length !== 1) return;
        startYRef.current = e.touches[0].clientY;
        startHeightRef.current = upperHeight;
        setIsDragging(true);
    }, [upperHeight]);

    return (
        <div
            ref={rangeContainerRef}
            className={`commit-detail flex flex-col h-full overflow-hidden${isDragging ? ' select-none' : ''}`}
            data-testid="commit-detail"
        >
            {/* Upper panel — commit strip */}
            <div
                style={{ height: upperHeight, minHeight: MIN_UPPER_HEIGHT }}
                className="flex-shrink-0 overflow-hidden border-b border-[#e0e0e0] dark:border-[#3c3c3c]"
                data-testid="branch-range-overview-upper"
            >
                <BranchCommitStrip
                    commits={(rangeCommits ?? []).slice(0, unpushedCount ?? 0)}
                    branchRangeData={range}
                    onAllCommentsClick={onAllCommentsClick}
                    commentCount={branchCommentCount}
                    onAskAI={onAskAI}
                    sessionContextPayload={sessionContextPayload}
                />
            </div>

            {/* Toolbar — pop-out button */}
            {!isPopOut && (
                <div className="flex items-center justify-end px-4 py-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526]">
                    <button
                        onClick={handlePopOut}
                        title="Open in new window"
                        className="text-xs px-2 py-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                        data-testid="branch-range-popout-btn"
                    >
                        ↗️
                    </button>
                </div>
            )}

            {/* Draggable horizontal divider */}
            <div
                className="h-1 flex-shrink-0 cursor-row-resize bg-[#e0e0e0] dark:bg-[#3c3c3c] hover:bg-[#007acc]/40 active:bg-[#007acc]/60 transition-colors"
                onMouseDown={handleDividerMouseDown}
                onTouchStart={handleDividerTouchStart}
                data-testid="branch-range-overview-divider"
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize panels"
                tabIndex={0}
            />

            {/* Lower panel — all files diff */}
            <div
                className="flex-1 min-h-0 overflow-y-auto"
                data-testid="branch-range-overview-lower"
            >
                <BranchAllFilesDiff
                    workspaceId={workspaceId}
                    files={rangeFiles ?? []}
                    onFileSelect={onFileSelect ?? (() => {})}
                    scrollToFilePath={scrollToFilePath}
                />
            </div>
        </div>
    );
}
