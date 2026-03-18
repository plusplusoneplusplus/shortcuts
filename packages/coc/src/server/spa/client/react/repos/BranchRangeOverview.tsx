/**
 * BranchRangeOverview — "cup" layout container for the branch range default view.
 *
 * Upper panel: BranchCommitStrip (compact commit list) with configurable height.
 * Draggable horizontal divider between panels.
 * Lower panel: BranchAllFilesDiff (all file diffs, lazy-loaded per file).
 *
 * Shown as the default right panel when the user is on a feature branch
 * with commits ahead of the base branch.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { BranchCommitStrip } from './BranchCommitStrip';
import { BranchAllFilesDiff } from './BranchAllFilesDiff';
import type { GitCommitItem } from './CommitList';
import type { BranchRangeInfo } from './BranchChanges';
import type { BranchRangeFile } from './BranchAllFilesDiff';

const STORAGE_KEY = 'coc.branchRangeOverview.upperHeight';
const DEFAULT_UPPER_HEIGHT = 160;
const MIN_UPPER_HEIGHT = 80;

function loadUpperHeight(): number {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored !== null) {
            const parsed = Number(stored);
            if (Number.isFinite(parsed) && parsed >= MIN_UPPER_HEIGHT) return parsed;
        }
    } catch { /* ignore */ }
    return DEFAULT_UPPER_HEIGHT;
}

interface BranchRangeOverviewProps {
    workspaceId: string;
    branchRangeData: BranchRangeInfo;
    commits: GitCommitItem[];
    unpushedCount: number;
    files: BranchRangeFile[];
    onFileSelect: (filePath: string) => void;
}

export function BranchRangeOverview({ workspaceId, branchRangeData, commits, unpushedCount, files, onFileSelect }: BranchRangeOverviewProps) {
    const [upperHeight, setUpperHeight] = useState(loadUpperHeight);
    const [isDragging, setIsDragging] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const startYRef = useRef(0);
    const startHeightRef = useRef(0);

    const getMaxUpperHeight = useCallback(() => {
        if (!containerRef.current) return 400;
        return Math.floor(containerRef.current.clientHeight * 0.5);
    }, []);

    const onMove = useCallback((clientY: number) => {
        const delta = clientY - startYRef.current;
        const maxHeight = getMaxUpperHeight();
        const newHeight = Math.min(Math.max(startHeightRef.current + delta, MIN_UPPER_HEIGHT), maxHeight);
        setUpperHeight(newHeight);
    }, [getMaxUpperHeight]);

    const onEnd = useCallback(() => {
        setIsDragging(false);
    }, []);

    // Persist height when drag ends
    useEffect(() => {
        if (!isDragging) {
            try { localStorage.setItem(STORAGE_KEY, String(upperHeight)); } catch { /* ignore */ }
        }
    }, [isDragging, upperHeight]);

    // Global mouse/touch listeners while dragging
    useEffect(() => {
        if (!isDragging) return;

        const handleMouseMove = (e: MouseEvent) => { e.preventDefault(); onMove(e.clientY); };
        const handleMouseUp = () => onEnd();
        const handleTouchMove = (e: TouchEvent) => {
            if (e.touches.length === 1) { e.preventDefault(); onMove(e.touches[0].clientY); }
        };
        const handleTouchEnd = () => onEnd();

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
    }, [isDragging, onMove, onEnd]);

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
            ref={containerRef}
            className={`flex flex-col h-full overflow-hidden${isDragging ? ' select-none' : ''}`}
            data-testid="branch-range-overview"
        >
            {/* Upper panel — commit strip */}
            <div
                style={{ height: upperHeight, minHeight: MIN_UPPER_HEIGHT }}
                className="flex-shrink-0 overflow-hidden border-b border-[#e0e0e0] dark:border-[#3c3c3c]"
                data-testid="branch-range-overview-upper"
            >
                <BranchCommitStrip commits={commits.slice(0, unpushedCount)} branchRangeData={branchRangeData} />
            </div>

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
                    files={files}
                    onFileSelect={onFileSelect}
                />
            </div>
        </div>
    );
}
