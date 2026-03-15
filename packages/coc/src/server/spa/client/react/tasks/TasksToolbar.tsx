/**
 * TasksToolbar — toolbar strip at the top of the Tasks panel.
 */

import type { RefObject } from 'react';
import type { ReactElement } from 'react';
import { Button } from '../shared/Button';

interface TasksToolbarProps {
    isMobile: boolean;
    onNewTask: () => void;
    onNewFolder: () => void;
    undoAvailable: boolean;
    undoInFlight: boolean;
    onUndoArchive: () => Promise<void>;
    onUndoError: (msg: string) => void;
    searchInput: string;
    searchInputRef: RefObject<HTMLInputElement>;
    onSearchChange: (value: string) => void;
    onSearchClear: () => void;
    taskActions: ReactElement;
    selectedFolderPath: string | null;
    onQueueFolder: (folderPath: string) => void;
    toolbarOverflowOpen: boolean;
    setToolbarOverflowOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
}

export function TasksToolbar({
    isMobile,
    onNewTask,
    onNewFolder,
    undoAvailable,
    undoInFlight,
    onUndoArchive,
    onUndoError,
    searchInput,
    searchInputRef,
    onSearchChange,
    onSearchClear,
    taskActions,
    selectedFolderPath,
    onQueueFolder,
    toolbarOverflowOpen,
    setToolbarOverflowOpen,
}: TasksToolbarProps) {
    return (
        <div className={`repo-tasks-toolbar flex items-center gap-2 px-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] ${isMobile ? 'py-1.5' : 'py-2'}`}>
            <Button
                variant="primary"
                size="sm"
                id="repo-tasks-new-btn"
                data-testid="repo-tasks-new-btn"
                onClick={onNewTask}
            >
                + New Task
            </Button>
            {!isMobile && (
                <Button
                    variant="secondary"
                    size="sm"
                    id="repo-tasks-folder-btn"
                    data-testid="repo-tasks-folder-btn"
                    onClick={onNewFolder}
                >
                    + New Folder
                </Button>
            )}
            {undoAvailable && (
                <Button
                    variant="secondary"
                    size="sm"
                    data-testid="undo-archive-btn"
                    title="Undo last archive"
                    loading={undoInFlight}
                    onClick={async () => {
                        try {
                            await onUndoArchive();
                        } catch (err: any) {
                            onUndoError(err.message || 'Undo failed');
                        }
                    }}
                >
                    ↩ Undo Archive
                </Button>
            )}
            <div className={`relative flex items-center ${isMobile ? 'flex-1' : 'max-w-[14rem]'}`}>
                <span className="absolute left-2 text-[#999] dark:text-[#888] pointer-events-none text-sm" aria-hidden="true">
                    🔍
                </span>
                <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search tasks…"
                    value={searchInput}
                    onChange={e => onSearchChange(e.target.value)}
                    className="w-full pl-7 pr-7 py-1 text-sm rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4]"
                    data-testid="task-search-input"
                />
                {searchInput && (
                    <button
                        type="button"
                        onClick={onSearchClear}
                        className="absolute right-1.5 text-[#999] hover:text-[#333] dark:hover:text-[#eee] text-sm leading-none"
                        aria-label="Clear search"
                        data-testid="task-search-clear"
                    >
                        ✕
                    </button>
                )}
            </div>
            {!isMobile && (
                <div className="flex-1 min-w-0">
                    {taskActions}
                </div>
            )}
            {isMobile && selectedFolderPath && (
                <Button
                    variant="secondary"
                    size="sm"
                    data-testid="tasks-toolbar-queue-folder-btn"
                    title="Queue all tasks in folder"
                    onClick={() => onQueueFolder(selectedFolderPath)}
                >
                    ▶ Queue
                </Button>
            )}
            {isMobile && (
                <div className="relative">
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setToolbarOverflowOpen(prev => !prev)}
                        data-testid="tasks-toolbar-overflow-btn"
                        title="More actions"
                    >
                        ⋯
                    </Button>
                    {toolbarOverflowOpen && (
                        <div
                            className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded shadow-lg z-50"
                            data-testid="tasks-toolbar-overflow-menu"
                        >
                            {selectedFolderPath && (
                                <button
                                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-[#0078d4]/10 text-[#1e1e1e] dark:text-[#cccccc]"
                                    data-testid="tasks-toolbar-overflow-queue-folder"
                                    onClick={() => { setToolbarOverflowOpen(false); onQueueFolder(selectedFolderPath); }}
                                >
                                    ▶ Queue Folder
                                </button>
                            )}
                            <button
                                className="w-full text-left px-3 py-2.5 text-sm hover:bg-[#0078d4]/10 text-[#1e1e1e] dark:text-[#cccccc]"
                                data-testid="tasks-toolbar-overflow-new-folder"
                                onClick={() => { setToolbarOverflowOpen(false); onNewFolder(); }}
                            >
                                + New Folder
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
