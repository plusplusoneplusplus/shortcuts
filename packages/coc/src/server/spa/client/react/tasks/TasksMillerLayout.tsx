/**
 * TasksMillerLayout — scrollable miller-column container with TaskTree or search results.
 */

import type { RefObject } from 'react';
import type { TaskFolder, TaskDocument, TaskDocumentGroup } from '../hooks/useTaskTree';
import { TaskTree } from './TaskTree';
import { TaskSearchResults } from './TaskSearchResults';
import { TaskPreview } from './TaskPreview';
import type { DragItem } from '../hooks/useTaskDragDrop';

interface TasksMillerLayoutProps {
    scrollRef: RefObject<HTMLDivElement>;
    isSearching: boolean;
    searchResults: (TaskDocument | TaskDocumentGroup)[];
    searchQuery: string;
    tree: TaskFolder;
    commentCounts: Record<string, number>;
    wsId: string;
    tasksFolder: string;
    initialFolderPath: string | null;
    initialFilePath: string | null;
    initialViewMode: 'review' | 'source' | null;
    navigateToFilePath: string | null;
    onNavigated: () => void;
    onColumnsChange: () => void;
    onNavigateBack: () => void;
    onFolderContextMenu: (folder: TaskFolder, x: number, y: number) => void;
    onFolderEmptySpaceContextMenu: (folder: TaskFolder, x: number, y: number) => void;
    onFileContextMenu: (item: TaskDocument | TaskDocumentGroup, x: number, y: number) => void;
    onDrop: (items: DragItem[], targetFolderPath: string) => void;
    openFilePath: string | null;
    setOpenFilePath: (path: string | null) => void;
    isMobile: boolean;
    wsIdEncoded: string;
}

export function TasksMillerLayout({
    scrollRef,
    isSearching,
    searchResults,
    searchQuery,
    tree,
    commentCounts,
    wsId,
    tasksFolder,
    initialFolderPath,
    initialFilePath,
    initialViewMode,
    navigateToFilePath,
    onNavigated,
    onColumnsChange,
    onNavigateBack,
    onFolderContextMenu,
    onFolderEmptySpaceContextMenu,
    onFileContextMenu,
    onDrop,
    openFilePath,
    setOpenFilePath,
    isMobile,
    wsIdEncoded,
}: TasksMillerLayoutProps) {
    return (
        <div
            ref={scrollRef}
            className="miller-columns flex-1 overflow-x-scroll overflow-y-hidden min-h-0 min-w-0"
            style={{ WebkitOverflowScrolling: 'touch' } as any}
            data-testid="tasks-miller-scroll-container"
        >
            <div className="flex h-full min-h-0 min-w-full">
                <div
                    className="flex-shrink-0 h-full min-h-0"
                    style={isMobile && openFilePath ? { display: 'none' } : undefined}
                >
                    {isSearching ? (
                        <TaskSearchResults
                            results={searchResults}
                            query={searchQuery}
                            commentCounts={commentCounts}
                            wsId={wsId}
                            onFileClick={(path) => setOpenFilePath(path)}
                            onContextMenu={onFileContextMenu}
                        />
                    ) : (
                        <TaskTree
                            tree={tree}
                            commentCounts={commentCounts}
                            wsId={wsId}
                            tasksFolder={tasksFolder}
                            initialFolderPath={initialFolderPath}
                            initialFilePath={initialFilePath}
                            navigateToFilePath={navigateToFilePath}
                            onNavigated={onNavigated}
                            onColumnsChange={onColumnsChange}
                            onNavigateBack={onNavigateBack}
                            onFolderContextMenu={onFolderContextMenu}
                            onFolderEmptySpaceContextMenu={onFolderEmptySpaceContextMenu}
                            onFileContextMenu={onFileContextMenu}
                            onDrop={onDrop}
                        />
                    )}
                </div>

                {openFilePath && (
                    <div className={`h-full min-h-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c] ${isMobile ? 'flex-1 min-w-0' : 'flex-1 min-w-[48rem]'}`}>
                        {isMobile && (
                            <div className="flex items-center h-9 px-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526]">
                                <button
                                    onClick={() => {
                                        if (openFilePath) {
                                            const parentFolder = openFilePath.includes('/')
                                                ? openFilePath.split('/').slice(0, -1).join('/')
                                                : '';
                                            const encoded = parentFolder
                                                ? parentFolder.split('/').map(encodeURIComponent).join('/')
                                                : '';
                                            history.replaceState(
                                                null, '',
                                                `#repos/${wsIdEncoded}/tasks${encoded ? '/' + encoded : ''}`
                                            );
                                        }
                                        setOpenFilePath(null);
                                    }}
                                    className="flex items-center gap-1 text-xs text-[#616161] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]"
                                    data-testid="task-preview-back-btn"
                                >
                                    ← Tasks
                                </button>
                            </div>
                        )}
                        <TaskPreview wsId={wsId} filePath={openFilePath} initialViewMode={initialViewMode} />
                    </div>
                )}
            </div>
        </div>
    );
}
