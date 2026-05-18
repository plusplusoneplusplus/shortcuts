/**
 * PopOutFilePanel — resizable left sidebar for the pop-out git review windows.
 *
 * Shows a flat or tree view of changed files with status badges,
 * comment counts, and a collapse/expand toggle.
 */

import { useState, useCallback } from 'react';
import {
    FileTreeView,
    FlatFileList,
    FilesViewToggle,
    buildFileTree,
    compactFolders,
    type FileChange,
    type FilesViewMode,
} from './FileTree';
import { useResizablePanel } from '../../../hooks/ui/useResizablePanel';
import { useFilesViewMode } from '../hooks/useFilesViewMode';

export interface PopOutFilePanelProps {
    workspaceId: string;
    files: FileChange[];
    selectedFilePath: string | null;
    onFileSelect: (filePath: string) => void;
    fileCommentMap?: Map<string, number>;
    /** When provided, files returning true are visually dimmed (e.g. filtered out by classification). */
    isFileDimmed?: (filePath: string) => boolean;
}

const PANEL_STORAGE_KEY = 'coc.popoutFilePanel.width';
const COLLAPSED_STORAGE_KEY = 'coc.popoutFilePanel.collapsed';

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
}: PopOutFilePanelProps) {
    const [collapsed, setCollapsed] = useState(loadCollapsed);
    const { mode, setMode } = useFilesViewMode(workspaceId);
    const { width, isDragging, handleMouseDown, handleTouchStart } = useResizablePanel({
        initialWidth: 280,
        minWidth: 160,
        maxWidth: 500,
        storageKey: PANEL_STORAGE_KEY,
    });

    const treeNodes = buildFileTree(files);
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
                        />
                    ) : (
                        <FlatFileList
                            files={files}
                            onFileSelect={onFileSelect}
                            selectedFilePath={selectedFilePath}
                            fileCommentMap={fileCommentMap}
                            commentBadgeTestIdPrefix="popout-flat-file-comment-badge"
                            fileTestIdPrefix="popout-flat-file-row"
                            isFileDimmed={isFileDimmed}
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
