/**
 * TaskTree — Miller-columns file browser for workspace tasks.
 */

import { useEffect, useRef, useState } from 'react';
import { useTaskPanel } from '../contexts/TaskContext';
import { useBreakpoint } from '../hooks/ui/useBreakpoint';
import { useQueueChat } from '../queue/hooks/useQueueChat';
import type { TaskFolder, TaskNode, TaskDocument, TaskDocumentGroup } from './hooks/useTaskTree';
import { countMarkdownFilesInFolder, folderToNodes, isTaskFolder, isTaskDocument, isTaskDocumentGroup, getTaskNodePath, getTaskNodeTaskRootPath } from './hooks/useTaskTree';
import { useTaskDragDrop } from './hooks/useTaskDragDrop';
import type { DragItem } from './hooks/useTaskDragDrop';
import { TaskTreeItem } from './TaskTreeItem';

interface TaskTreeProps {
    tree: TaskFolder;
    commentCounts: Record<string, number>;
    wsId: string;
    tasksFolder?: string;
    primaryFolderPath?: string;
    initialFolderPath?: string | null;
    initialFilePath?: string | null;
    initialActiveFolderPath?: string | null;
    navigateToFilePath?: string | null;
    onNavigated?: () => void;
    onColumnsChange?: () => void;
    onFolderContextMenu?: (folder: TaskFolder, x: number, y: number) => void;
    onFolderEmptySpaceContextMenu?: (folder: TaskFolder, x: number, y: number) => void;
    onFileContextMenu?: (item: TaskDocument | TaskDocumentGroup, x: number, y: number) => void;
    onDrop?: (items: DragItem[], targetFolderPath: string) => void;
    onNavigateBack?: () => void;
    onActiveFolderChange?: (folder: TaskFolder) => void;
}

export function getFolderKey(folder: TaskFolder): string {
    return (folder.relativePath || folder.name).replace(/\\/g, '/');
}

export function rebuildColumnsFromKeys(tree: TaskFolder, keys: (string | null)[]): TaskNode[][] {
    const rootNodes = folderToNodes(tree);
    const cols: TaskNode[][] = [rootNodes];
    let parent = tree;
    for (const key of keys) {
        if (!key) break;
        const folder = parent.children.find(c => getFolderKey(c) === key) ?? null;
        if (!folder) break;
        cols.push(folderToNodes(folder));
        parent = folder;
    }
    return cols;
}

export function buildColumnsForFolderPath(tree: TaskFolder, folderPath: string | null): {
    columns: TaskNode[][];
    keys: (string | null)[];
    folder: TaskFolder;
} {
    const columns: TaskNode[][] = [folderToNodes(tree)];
    const keys: (string | null)[] = [];
    let folder = tree;

    for (const segment of (folderPath ?? '').split(/[\\/]/).filter(Boolean)) {
        const child = folder.children.find(f => f.name === segment);
        if (!child) break;
        columns.push(folderToNodes(child));
        keys.push(getFolderKey(child));
        folder = child;
    }

    return { columns, keys, folder };
}

function getParentFolderPath(filePath: string | null | undefined): string | null {
    if (!filePath || !filePath.match(/[\\/]/)) return null;
    return filePath.split(/[\\/]/).slice(0, -1).join('/');
}

export function TaskTree({
    tree,
    commentCounts,
    wsId,
    tasksFolder,
    primaryFolderPath,
    initialFolderPath,
    initialFilePath,
    initialActiveFolderPath,
    navigateToFilePath,
    onNavigated,
    onColumnsChange,
    onFolderContextMenu,
    onFolderEmptySpaceContextMenu,
    onFileContextMenu,
    onDrop: onDropCallback,
    onNavigateBack,
    onActiveFolderChange,
}: TaskTreeProps) {
    const { openFilePath, setOpenFilePath, selectedFilePaths, toggleSelectedFile, setSelectedFiles, clearSelection, showContextFiles, setSelectedFolderPath } = useTaskPanel();
    const { fileMap: queueActivity, folderMap: queueFolderActivity } = useQueueChat(wsId, tasksFolder);
    const { isMobile } = useBreakpoint();
    const dnd = useTaskDragDrop();
    const [columns, setColumns] = useState<TaskNode[][]>([]);

    /** Resolve taskRootPath for a file path by searching visible columns. */
    const findTaskRootPathInColumns = (filePath: string): string | undefined => {
        for (const col of columns) {
            for (const node of col) {
                if (getTaskNodePath(node) === filePath) {
                    return getTaskNodeTaskRootPath(node);
                }
            }
        }
        return undefined;
    };

    /** Resolve taskRootPath by recursively searching the tree. */
    const findTaskRootPathInTree = (folder: TaskFolder, filePath: string): string | undefined => {
        for (const doc of folder.singleDocuments) {
            if (getTaskNodePath(doc) === filePath) return doc.taskRootPath;
        }
        for (const group of folder.documentGroups) {
            if (getTaskNodePath(group) === filePath) return group.documents[0]?.taskRootPath;
        }
        for (const child of folder.children) {
            const result = findTaskRootPathInTree(child, filePath);
            if (result !== undefined) return result;
        }
        return undefined;
    };
    const [activeFolderKeys, setActiveFolderKeys] = useState<(string | null)[]>([]);
    const activeFolderKeysRef = useRef<(string | null)[]>([]);
    const lastClickAnchorRef = useRef<{ path: string; colIndex: number } | null>(null);
    const isInitialMount = useRef(true);
    const activeFolderChangeRef = useRef(onActiveFolderChange);
    activeFolderChangeRef.current = onActiveFolderChange;

    // Emit resolved active folder to parent whenever keys or tree change
    useEffect(() => {
        if (isInitialMount.current) return;
        const cb = activeFolderChangeRef.current;
        if (!cb) return;
        let parent = tree;
        for (const key of activeFolderKeys) {
            if (!key) break;
            const child = parent.children.find(c => getFolderKey(c) === key);
            if (!child) break;
            parent = child;
        }
        cb(parent);
    }, [activeFolderKeys, tree]);

    // Initialize or rebuild columns from tree
    useEffect(() => {
        if (!tree) return;
        const rootNodes = folderToNodes(tree);

        if (isInitialMount.current) {
            isInitialMount.current = false;
            const restoredFilePath = initialFilePath ?? openFilePath;
            const folderPath = initialFolderPath
                ?? getParentFolderPath(initialFilePath)
                ?? initialActiveFolderPath
                ?? getParentFolderPath(restoredFilePath);
            if (folderPath || restoredFilePath) {
                const { columns: cols, keys } = buildColumnsForFolderPath(tree, folderPath);
                setColumns(cols);
                setActiveFolderKeys(keys);
                activeFolderKeysRef.current = keys;
                if (restoredFilePath) setOpenFilePath(restoredFilePath, findTaskRootPathInTree(tree, restoredFilePath));
                return;
            }
            setColumns([rootNodes]);
            setActiveFolderKeys([]);
            activeFolderKeysRef.current = [];
            return;
        }

        // Subsequent tree updates: rebuild columns preserving current navigation
        setColumns(rebuildColumnsFromKeys(tree, activeFolderKeysRef.current));
    }, [tree]);

    // Navigate to a specific file path (e.g. from search "Reveal in Panel")
    useEffect(() => {
        if (!navigateToFilePath || !tree) return;

        const folderPath = getParentFolderPath(navigateToFilePath) ?? '';
        const { columns: cols, keys } = buildColumnsForFolderPath(tree, folderPath);
        setColumns(cols);
        setActiveFolderKeys(keys);
        activeFolderKeysRef.current = keys;
        setOpenFilePath(navigateToFilePath, findTaskRootPathInTree(tree, navigateToFilePath));
        setSelectedFolderPath(folderPath || null);
        const encoded = navigateToFilePath.split('/').map(encodeURIComponent).join('/');
        history.replaceState(null, '', `#repos/${encodeURIComponent(wsId)}/tasks/${encoded}`);
        onNavigated?.();
    }, [navigateToFilePath, tree]);

    const handleFolderClick = (folder: TaskFolder, colIndex: number) => {
        const children = folderToNodes(folder);
        setColumns(prev => [...prev.slice(0, colIndex + 1), children]);

        const newKeys = [...activeFolderKeys.slice(0, colIndex), getFolderKey(folder)];
        setActiveFolderKeys(newKeys);
        activeFolderKeysRef.current = newKeys;

        setOpenFilePath(null);

        const folderPath = getFolderKey(folder);
        const encoded = folderPath.split(/[\\/]/).map(encodeURIComponent).join('/');
        history.replaceState(null, '', `#repos/${encodeURIComponent(wsId)}/tasks/${encoded}`);

        setSelectedFolderPath(getFolderKey(folder));
        onColumnsChange?.();
    };

    const handleFileClick = (path: string, colIndex: number, e: React.MouseEvent) => {
        const isCtrl = e.ctrlKey || e.metaKey;
        const isShift = e.shiftKey;

        if (isCtrl && !isShift) {
            // Ctrl+Click: toggle selection, no navigation
            toggleSelectedFile(path);
            lastClickAnchorRef.current = { path, colIndex };
            return;
        }

        if (isShift) {
            // Shift+Click: range-select within same column
            const anchor = lastClickAnchorRef.current;
            if (!anchor || anchor.colIndex !== colIndex) {
                // No anchor in same column → fall back to toggle
                toggleSelectedFile(path);
                lastClickAnchorRef.current = { path, colIndex };
                return;
            }

            const colNodes = columns[colIndex] ?? [];
            const anchorIdx = colNodes.findIndex(n => getTaskNodePath(n) === anchor.path);
            const currentIdx = colNodes.findIndex(n => getTaskNodePath(n) === path);

            if (anchorIdx === -1 || currentIdx === -1) {
                toggleSelectedFile(path);
                return;
            }

            const [lo, hi] = anchorIdx < currentIdx
                ? [anchorIdx, currentIdx]
                : [currentIdx, anchorIdx];

            const rangePaths = new Set<string>();
            for (const p of selectedFilePaths) rangePaths.add(p);
            for (let i = lo; i <= hi; i++) {
                const node = colNodes[i];
                if (!isTaskFolder(node)) {
                    const p = getTaskNodePath(node);
                    if (p) rangePaths.add(p);
                }
            }

            setSelectedFiles(rangePaths);
            // Keep anchor fixed for further shift-clicks
            return;
        }

        // Plain click: clear selection, navigate/open
        clearSelection();
        lastClickAnchorRef.current = { path, colIndex };

        // Collapse any deeper stale folder columns when opening a file.
        setColumns(prev => prev.slice(0, colIndex + 1));

        const newKeys = activeFolderKeysRef.current.slice(0, colIndex);
        setActiveFolderKeys(newKeys);
        activeFolderKeysRef.current = newKeys;

        const parentFolderPath = path.match(/[\\/]/) ? path.split(/[\\/]/).slice(0, -1).join('/') : null;
        setSelectedFolderPath(parentFolderPath);

        if (isMobile) {
            window.dispatchEvent(new CustomEvent('coc-open-markdown-review', {
                detail: { filePath: path, wsId, taskRootPath: findTaskRootPathInColumns(path) },
            }));
            return;
        }

        setOpenFilePath(path, findTaskRootPathInColumns(path));
        const encoded = path.split(/[\\/]/).map(encodeURIComponent).join('/');
        history.replaceState(null, '', `#repos/${encodeURIComponent(wsId)}/tasks/${encoded}`);
    };

    const handleCheckboxChange = (path: string, _checked: boolean) => {
        toggleSelectedFile(path);
    };

    const handleFileDoubleClick = (path: string) => {
        window.dispatchEvent(new CustomEvent('coc-open-markdown-review', {
            detail: { filePath: path, wsId, taskRootPath: findTaskRootPathInColumns(path) },
        }));
    };

    const handleNavigateBack = () => {
        if (activeFolderKeys.length === 0) return;
        const newKeys = activeFolderKeys.slice(0, -1);
        setActiveFolderKeys(newKeys);
        activeFolderKeysRef.current = newKeys;
        setColumns(rebuildColumnsFromKeys(tree, newKeys));
        if (newKeys.length > 0) {
            const folderPath = newKeys[newKeys.length - 1]!;
            const encoded = folderPath.split(/[\\/]/).map(encodeURIComponent).join('/');
            history.replaceState(null, '', `#repos/${encodeURIComponent(wsId)}/tasks/${encoded}`);
            setSelectedFolderPath(folderPath);
        } else {
            history.replaceState(null, '', `#repos/${encodeURIComponent(wsId)}/tasks`);
            setSelectedFolderPath(null);
        }
        onNavigateBack?.();
    };

    const getColumnFolder = (colIndex: number): TaskFolder | null => {
        if (colIndex === 0) return tree;
        let parent = tree;
        for (let i = 0; i < colIndex; i++) {
            const key = activeFolderKeys[i];
            if (!key) return null;
            const child = parent.children.find(c => getFolderKey(c) === key);
            if (!child) return null;
            parent = child;
        }
        return parent;
    };

    // Resolve selected file paths into DragItem[] for multi-select drag
    const resolveSelectedItems = (paths: Set<string>): DragItem[] => {
        const items: DragItem[] = [];
        for (const p of paths) {
            const name = p.includes('/') ? p.split('/').pop()! : p;
            items.push({ path: p, type: 'file', name });
        }
        return items;
    };

    // Build a DragItem for a given node
    const nodeToDragItem = (node: TaskNode): DragItem | null => {
        if (isTaskFolder(node)) {
            const folder = node as TaskFolder;
            return { path: getFolderKey(folder), type: 'folder', name: folder.name };
        }
        const path = getTaskNodePath(node);
        const name = isTaskDocument(node)
            ? node.baseName || node.fileName
            : isTaskDocumentGroup(node)
                ? node.baseName
                : '';
        return { path, type: 'file', name };
    };

    const handleDndDrop = onDropCallback
        ? (items: DragItem[], targetFolder: string) => onDropCallback(items, targetFolder)
        : () => {};

    const MAX_VISIBLE_COLUMNS = 2;
    const visibleStartIndex = Math.max(0, columns.length - MAX_VISIBLE_COLUMNS);
    const visibleColumns = columns.slice(visibleStartIndex);

    return (
        <div
            className="flex flex-row h-full min-h-0"
            data-testid="task-tree"
        >
            {visibleStartIndex > 0 && (
                <button
                    data-testid="column-overflow-indicator"
                    className="flex-shrink-0 flex items-start pt-2 px-1 text-xs text-[#848484] dark:text-[#666] border-r border-[#e0e0e0] dark:border-[#3c3c3c] select-none cursor-pointer hover:bg-[#e8e8e8] dark:hover:bg-[#2a2a2a]"
                    title={`${visibleStartIndex} hidden column${visibleStartIndex > 1 ? 's' : ''}`}
                    onClick={handleNavigateBack}
                    aria-label="Go back"
                >
                    ‹ {visibleStartIndex}
                </button>
            )}
            {visibleColumns.map((colNodes, relIndex) => {
                const colIndex = visibleStartIndex + relIndex;
                const columnFolder = getColumnFolder(colIndex);
                const columnFolderPath = columnFolder ? getFolderKey(columnFolder) : '';
                return (
                <div
                    key={colIndex}
                    className={`flex-shrink-0 w-56 h-full border-r border-[#e0e0e0] dark:border-[#3c3c3c] overflow-y-auto ${
                        dnd.dropTargetPath === columnFolderPath ? 'bg-[#0078d4]/5 dark:bg-[#3794ff]/5' : ''
                    }`}
                    data-testid={`miller-column-${colIndex}`}
                    onContextMenu={(e) => {
                        if (e.shiftKey || !onFolderEmptySpaceContextMenu) return;
                        const target = e.target as HTMLElement;
                        if (target.closest('[data-testid^="task-tree-item-"]')) return;

                        const folder = getColumnFolder(colIndex);
                        if (!folder) return;

                        e.preventDefault();
                        e.stopPropagation();
                        onFolderEmptySpaceContextMenu(folder, e.clientX, e.clientY);
                    }}
                    onDragOver={dnd.createDragOverHandler(columnFolderPath)}
                    onDragEnter={dnd.createDragEnterHandler(columnFolderPath)}
                    onDragLeave={dnd.createDragLeaveHandler(columnFolderPath)}
                    onDrop={dnd.createDropHandler(columnFolderPath, handleDndDrop)}
                >
                    {colNodes.length === 0 ? (
                        <div className="py-6 px-4 text-center text-xs text-[#848484] dark:text-[#666] italic">
                            Empty folder
                        </div>
                    ) : (
                        <ul className="py-1">
                            {colNodes.map((node, nodeIndex) => {
                                const path = getTaskNodePath(node);
                                const dragItem = nodeToDragItem(node);
                                const folderMdCount = isTaskFolder(node) ? countMarkdownFilesInFolder(node) : 0;
                                const folderKey = isTaskFolder(node) ? getFolderKey(node as TaskFolder) : null;
                                return (
                                    <TaskTreeItem
                                        key={nodeIndex}
                                        item={node}
                                        wsId={wsId}
                                        isSelected={path ? selectedFilePaths.has(path) : false}
                                        isOpen={path ? path === openFilePath : false}
                                        isActiveFolder={isTaskFolder(node) && activeFolderKeys[colIndex] === getFolderKey(node as TaskFolder)}
                                        isPrimaryRoot={colIndex === 0 && isTaskFolder(node) && !!(node as TaskFolder).folderPath && (node as TaskFolder).folderPath === primaryFolderPath}
                                        commentCount={path ? (commentCounts[path] || 0) : 0}
                                        queueRunning={path ? (queueActivity[path]?.count ?? 0) : 0}
                                        queueRunningProvider={path ? queueActivity[path]?.provider : undefined}
                                        folderQueueCount={isTaskFolder(node) ? (queueFolderActivity[getFolderKey(node as TaskFolder)]?.count ?? 0) : 0}
                                        folderQueueProvider={isTaskFolder(node) ? queueFolderActivity[getFolderKey(node as TaskFolder)]?.provider : undefined}
                                        folderMdCount={folderMdCount}
                                        showContextFiles={showContextFiles}
                                        onFolderClick={(folder) => handleFolderClick(folder, colIndex)}
                                        onFileClick={(path, e) => handleFileClick(path, colIndex, e)}
                                        onCheckboxChange={handleCheckboxChange}
                                        onDoubleClick={handleFileDoubleClick}
                                        onFolderContextMenu={onFolderContextMenu}
                                        onFileContextMenu={onFileContextMenu}
                                        onDragStart={dragItem ? dnd.createDragStartHandler(dragItem, selectedFilePaths, resolveSelectedItems) : undefined}
                                        onDragEnd={dnd.createDragEndHandler()}
                                        onDragOver={folderKey ? dnd.createDragOverHandler(folderKey) : undefined}
                                        onDragEnter={folderKey ? dnd.createDragEnterHandler(folderKey) : undefined}
                                        onDragLeave={folderKey ? dnd.createDragLeaveHandler(folderKey) : undefined}
                                        onDrop={folderKey ? dnd.createDropHandler(folderKey, handleDndDrop) : undefined}
                                        isDropTarget={isTaskFolder(node) && dnd.dropTargetPath === folderKey}
                                        isDragSource={dnd.isDragging && dragItem != null && dnd.draggedItems.some(d => d.path === dragItem.path)}
                                    />
                                );
                            })}
                        </ul>
                    )}
                </div>
                );
            })}
        </div>
    );
}
