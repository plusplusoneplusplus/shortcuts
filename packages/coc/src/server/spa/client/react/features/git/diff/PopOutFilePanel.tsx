/**
 * PopOutFilePanel — resizable left sidebar for the pop-out git review windows.
 *
 * Shows a flat or tree view of changed files with status badges,
 * comment counts, classification badges, reviewed/visited indicators,
 * and a collapse/expand toggle.
 */

import { useState, useCallback, useMemo } from 'react';
import {
    FileTreeView,
    FlatFileList,
    FilesViewToggle,
    buildFileTree,
    compactFolders,
    type FileChange,
    type FileBadgeInfo,
} from './FileTree';
import { useResizablePanel } from '../../../hooks/ui/useResizablePanel';
import { useFilesViewMode } from '../hooks/useFilesViewMode';
import {
    sortFilesByPriority,
    computeCategoryCounts,
    type CategoryCounts,
} from './prPopoutPriority';
import type { HunkCategory } from '../../pull-requests/classification-types';
import { HUNK_CATEGORIES } from '../../pull-requests/classification-types';

export interface PopOutFilePanelProps {
    workspaceId: string;
    files: FileChange[];
    selectedFilePath: string | null;
    onFileSelect: (filePath: string) => void;
    fileCommentMap?: Map<string, number>;
    /** When provided, files returning true are visually dimmed (e.g. filtered out by classification). */
    isFileDimmed?: (filePath: string) => boolean;
    /** Classification badge lookup for the file rail. Enables category badges, counts, priority sort. */
    getFileBadge?: (filePath: string) => FileBadgeInfo | undefined;
    /** Reviewed files (explicit "mark reviewed" state). */
    reviewedFiles?: ReadonlySet<string>;
    /** Visited files (opened but not reviewed). */
    visitedFiles?: ReadonlySet<string>;
    /** When true, files are sorted by review priority. */
    prioritySort?: boolean;
    /** Toggle handler for priority sort. When omitted, the toggle button is hidden. */
    onTogglePrioritySort?: () => void;
    /** Active classification filters. Used to compute the "all filters on" state for Show all. */
    activeFilters?: ReadonlySet<HunkCategory>;
    /** Show-all reset handler. When omitted, the Show all button is hidden. */
    onShowAll?: () => void;
    /** Move selection to the previous priority file. When omitted, the button is hidden. */
    onPrevPriorityFile?: () => void;
    /** Move selection to the next priority file. When omitted, the button is hidden. */
    onNextPriorityFile?: () => void;
    /** Disable Prev priority button (no candidate). */
    prevPriorityDisabled?: boolean;
    /** Disable Next priority button (no candidate). */
    nextPriorityDisabled?: boolean;
}

const PANEL_STORAGE_KEY = 'coc.popoutFilePanel.width';
const COLLAPSED_STORAGE_KEY = 'coc.popoutFilePanel.collapsed';
const ALL_CATEGORIES: readonly HunkCategory[] = HUNK_CATEGORIES;

function loadCollapsed(): boolean {
    try {
        return localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true';
    } catch { return false; }
}

export function PopOutFilePanel({
    workspaceId,
    files,
    selectedFilePath,
    onFileSelect,
    fileCommentMap = new Map(),
    isFileDimmed,
    getFileBadge,
    reviewedFiles,
    visitedFiles,
    prioritySort = false,
    onTogglePrioritySort,
    activeFilters,
    onShowAll,
    onPrevPriorityFile,
    onNextPriorityFile,
    prevPriorityDisabled = false,
    nextPriorityDisabled = false,
}: PopOutFilePanelProps) {
    const [collapsed, setCollapsed] = useState(loadCollapsed);
    const { mode, setMode } = useFilesViewMode(workspaceId);
    const { width, isDragging, handleMouseDown, handleTouchStart } = useResizablePanel({
        initialWidth: 280,
        minWidth: 160,
        maxWidth: 500,
        storageKey: PANEL_STORAGE_KEY,
    });

    // Optionally sort files by review priority. Tree view preserves the path
    // structure but inside each folder, files appear in the sorted order.
    const orderedFiles = useMemo(() => {
        if (!prioritySort || !getFileBadge) return files;
        return sortFilesByPriority(files, {
            getFileBadge,
            reviewedFiles,
        });
    }, [files, prioritySort, getFileBadge, reviewedFiles]);

    const counts: CategoryCounts | null = useMemo(() => {
        if (!getFileBadge) return null;
        return computeCategoryCounts(files, getFileBadge);
    }, [files, getFileBadge]);

    const reviewedCount = reviewedFiles?.size ?? 0;
    const logicRemaining = counts
        ? Math.max(
              0,
              counts.logic -
                  files.filter(
                      (f) =>
                          (reviewedFiles?.has(f.path) ?? false) &&
                          getFileBadge?.(f.path)?.category === 'logic',
                  ).length,
          )
        : 0;

    const allFiltersOn = activeFilters
        ? ALL_CATEGORIES.every((c) => activeFilters.has(c))
        : true;

    const treeNodes = buildFileTree(orderedFiles);
    const compactedNodes = compactFolders(treeNodes);

    const toggleCollapse = useCallback(() => {
        setCollapsed(prev => {
            const next = !prev;
            try { localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next)); } catch { /* ignore */ }
            return next;
        });
    }, []);

    if (collapsed) {
        return (
            <div className="flex flex-col items-center py-2 border-r border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#252526]" style={{ width: 36 }} data-testid="popout-file-panel-collapsed">
                <button
                    onClick={toggleCollapse}
                    className="text-xs text-[#616161] dark:text-[#999] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] rounded px-1 py-0.5"
                    title="Show file panel"
                    data-testid="popout-file-panel-expand-btn"
                >
                    ▶
                </button>
                <span className="text-[10px] text-[#848484] mt-1 [writing-mode:vertical-lr]" data-testid="popout-file-panel-file-count-collapsed">{files.length} files</span>
            </div>
        );
    }

    return (
        <>
            <div
                className="flex flex-col flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#252526] overflow-hidden"
                style={{ width }}
                data-testid="popout-file-panel"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-2 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-semibold text-[#1e1e1e] dark:text-[#ccc]">📁 Files</span>
                        <span className="text-[10px] text-[#848484]" data-testid="popout-file-panel-file-count">({files.length})</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <FilesViewToggle mode={mode} onChange={setMode} testIdPrefix="popout-files-view-toggle" />
                        <button
                            onClick={toggleCollapse}
                            className="text-xs text-[#616161] dark:text-[#999] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] rounded px-1 py-0.5"
                            title="Hide file panel"
                            data-testid="popout-file-panel-collapse-btn"
                        >
                            ◀
                        </button>
                    </div>
                </div>
                {/* Classification toolbar — visible only when classification is ready. */}
                {counts && (
                    <div
                        className="flex flex-col gap-1 px-2 py-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f5f5f5] dark:bg-[#262626]"
                        data-testid="popout-file-panel-classification-bar"
                    >
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[#616161] dark:text-[#999]">
                            <span data-testid="popout-file-panel-count-logic">Logic {counts.logic}</span>
                            <span data-testid="popout-file-panel-count-mechanical">Mech {counts.mechanical}</span>
                            <span data-testid="popout-file-panel-count-test">Test {counts.test}</span>
                            <span data-testid="popout-file-panel-count-simple">Simple {counts.simple}</span>
                            <span data-testid="popout-file-panel-count-generated">Gen {counts.generated}</span>
                            {counts.unclassified > 0 && (
                                <span data-testid="popout-file-panel-count-unclassified">? {counts.unclassified}</span>
                            )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
                            <span
                                className="text-[#1e1e1e] dark:text-[#ccc]"
                                data-testid="popout-file-panel-progress"
                            >
                                Reviewed {reviewedCount}/{counts.total}
                            </span>
                            <span
                                className="text-[#848484]"
                                data-testid="popout-file-panel-logic-remaining"
                            >
                                Logic remaining {logicRemaining}
                            </span>
                            {onTogglePrioritySort && (
                                <button
                                    type="button"
                                    onClick={onTogglePrioritySort}
                                    className={
                                        prioritySort
                                            ? 'inline-flex h-5 items-center rounded border border-indigo-400 bg-indigo-50 px-1.5 text-[10px] font-medium text-indigo-700 dark:border-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-200'
                                            : 'inline-flex h-5 items-center rounded border border-gray-300 bg-white px-1.5 text-[10px] font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                                    }
                                    title="Sort by review priority (logic/high first)"
                                    aria-pressed={prioritySort}
                                    data-testid="popout-file-panel-priority-sort-toggle"
                                >
                                    {prioritySort ? '✓ Priority' : 'Priority'}
                                </button>
                            )}
                            {onShowAll && !allFiltersOn && (
                                <button
                                    type="button"
                                    onClick={onShowAll}
                                    className="inline-flex h-5 items-center rounded border border-gray-300 bg-white px-1.5 text-[10px] font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                                    title="Restore all categories"
                                    data-testid="popout-file-panel-show-all"
                                >
                                    Show all
                                </button>
                            )}
                            {(onPrevPriorityFile || onNextPriorityFile) && (
                                <span
                                    className="inline-flex items-center gap-0.5"
                                    data-testid="popout-file-panel-priority-nav"
                                >
                                    {onPrevPriorityFile && (
                                        <button
                                            type="button"
                                            onClick={onPrevPriorityFile}
                                            disabled={prevPriorityDisabled}
                                            className={
                                                prevPriorityDisabled
                                                    ? 'inline-flex h-5 items-center rounded border border-gray-200 bg-gray-50 px-1.5 text-[10px] font-medium text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-600 cursor-not-allowed'
                                                    : 'inline-flex h-5 items-center rounded border border-gray-300 bg-white px-1.5 text-[10px] font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
                                            }
                                            title="Previous priority file"
                                            aria-label="Previous priority file"
                                            data-testid="popout-file-panel-prev-priority"
                                        >
                                            ◀ Prev
                                        </button>
                                    )}
                                    {onNextPriorityFile && (
                                        <button
                                            type="button"
                                            onClick={onNextPriorityFile}
                                            disabled={nextPriorityDisabled}
                                            className={
                                                nextPriorityDisabled
                                                    ? 'inline-flex h-5 items-center rounded border border-gray-200 bg-gray-50 px-1.5 text-[10px] font-medium text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-600 cursor-not-allowed'
                                                    : 'inline-flex h-5 items-center rounded border border-gray-300 bg-white px-1.5 text-[10px] font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
                                            }
                                            title="Next priority file"
                                            aria-label="Next priority file"
                                            data-testid="popout-file-panel-next-priority"
                                        >
                                            Next ▶
                                        </button>
                                    )}
                                </span>
                            )}
                        </div>
                    </div>
                )}
                {/* File list */}
                <div className="flex-1 overflow-y-auto px-1 py-1" data-testid="popout-file-panel-list">
                    {mode === 'tree' ? (
                        <FileTreeView
                            nodes={compactedNodes}
                            onFileSelectSimple={onFileSelect}
                            selectedFilePath={selectedFilePath}
                            fileCommentMap={fileCommentMap}
                            commentBadgeTestIdPrefix="popout-file-comment-badge"
                            fileTestIdPrefix="popout-file"
                            isFileDimmed={isFileDimmed}
                            getFileBadge={getFileBadge}
                            reviewedFiles={reviewedFiles}
                            visitedFiles={visitedFiles}
                        />
                    ) : (
                        <FlatFileList
                            files={orderedFiles}
                            onFileSelect={onFileSelect}
                            selectedFilePath={selectedFilePath}
                            fileCommentMap={fileCommentMap}
                            commentBadgeTestIdPrefix="popout-flat-file-comment-badge"
                            fileTestIdPrefix="popout-flat-file-row"
                            isFileDimmed={isFileDimmed}
                            getFileBadge={getFileBadge}
                            reviewedFiles={reviewedFiles}
                            visitedFiles={visitedFiles}
                        />
                    )}
                </div>
            </div>
            {/* Resize handle */}
            <div
                className={`hidden lg:flex items-center justify-center w-1 cursor-col-resize hover:bg-[#007acc]/30 active:bg-[#007acc]/50 shrink-0 ${isDragging ? 'bg-[#007acc]/50' : 'bg-[#e0e0e0] dark:bg-[#3c3c3c]'}`}
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
                role="separator"
                aria-label="Resize file panel"
                data-testid="popout-file-panel-resize-handle"
            />
        </>
    );
}
