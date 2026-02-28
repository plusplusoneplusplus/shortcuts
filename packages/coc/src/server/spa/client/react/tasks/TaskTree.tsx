/**
 * TaskTree — Miller-columns file browser for workspace tasks.
 */

import { useEffect, useRef, useState } from 'react';
import { useTaskPanel } from '../context/TaskContext';
import { useQueueActivity } from '../hooks/useQueueActivity';
import type { TaskFolder, TaskNode, TaskDocument, TaskDocumentGroup } from '../hooks/useTaskTree';
import { countMarkdownFilesInFolder, folderToNodes, isTaskFolder, isTaskDocument, isTaskDocumentGroup } from '../hooks/useTaskTree';
import { useTaskDragDrop } from '../hooks/useTaskDragDrop';
import type { DragItem } from '../hooks/useTaskDragDrop';
import { TaskTreeItem } from './TaskTreeItem';

interface TaskTreeProps {
    tree: TaskFolder;
    commentCounts: Record<string, number>;
    wsId: string;
    initialFolderPath?: string | null;
    initialFilePath?: string | null;
    onColumnsChange?: () => void;
    onFolderContextMenu?: (folder: TaskFolder, x: number, y: number) => void;
    onFolderEmptySpaceContextMenu?: (folder: TaskFolder, x: number, y: number) => void;
    onFileContextMenu?: (item: TaskDocument | TaskDocumentGroup, x: number, y: number) => void;
    onDrop?: (items: DragItem[], targetFolderPath: string) => void;
}

function getNodePath(node: TaskNode): string | null {
    if ('fileName' in node && !('documents' in node) && !('children' in node)) {
        const rel = (node as any).relativePath || '';
        return rel ? rel + '/' + node.fileName : node.fileName;
    }
    if ('documents' in node && 'baseName' in node && !('children' in node)) {
        const firstDoc = (node as any).documents[0];
        if (firstDoc) {
            const rel = firstDoc.relativePath || '';
            return rel ? rel + '/' + firstDoc.fileName : firstDoc.fileName;
        }
    }
    return null;
}

export function getFolderKey(folder: TaskFolder): string {
    return folder.relativePath || folder.name;
}

function findFolderByKey(tree: TaskFolder, key: string): TaskFolder | null {
    for (const child of tree.children) {
        if (getFolderKey(child) === key) return child;
        const found = findFolderByKey(child, key);
        if (found) return found;
    }
    return null;
}

export function rebuildColumnsFromKeys(tree: TaskFolder, keys: (string | null)[]): TaskNode[][] {
    const rootNodes = folderToNodes(tree);
    const cols: TaskNode[][] = [rootNodes];
    for (const key of keys) {
        if (!key) break;
        const folder = findFolderByKey(tree, key);
        if (!folder) break;
        cols.push(folderToNodes(folder));
    }
    return cols;
}

export function TaskTree({
    tree,
    commentCounts,
    wsId,
    initialFolderPath,
    initialFilePath,
    onColumnsChange,
    onFolderContextMenu,
    onFolderEmptySpaceContextMenu,
    onFileContextMenu,
    onDrop: onDropCallback,
}: TaskTreeProps) {
    const { openFilePath, setOpenFilePath, selectedFilePaths, toggleSelectedFile, showContextFiles, setSelectedFolderPath } = useTaskPanel();
    const { fileMap: queueActivity, folderMap: queueFolderActivity } = useQueueActivity(wsId);
    const dnd = useTaskDragDrop();
    const [columns, setColumns] = useState<TaskNode[][]>([]);
    const [activeFolderKeys, setActiveFolderKeys] = useState<(string | null)[]>([]);
    const activeFolderKeysRef = useRef<(string | null)[]>([]);
    const isInitialMount = useRef(true);

    // Initialize or rebuild columns from tree
    useEffect(() => {
        if (!tree) return;
        const rootNodes = folderToNodes(tree);

        if (isInitialMount.current) {
            isInitialMount.current = false;
            if (initialFolderPath || initialFilePath) {
                const folderPath = initialFolderPath ?? (initialFilePath ? initialFilePath.split(/[\\/]/).slice(0, -1).join('/') : '');
                const segments = folderPath.split(/[\\/]/).filter(Boolean);
                const cols: TaskNode[][] = [rootNodes];
                const keys: (string | null)[] = [];
                let cur = tree;
                for (const seg of segments) {
                    const found = cur.children.find(f => f.name === seg);
                    if (!found) break;
                    cols.push(folderToNodes(found));
                    keys.push(getFolderKey(found));
                    cur = found;
                }
                setColumns(cols);
                setActiveFolderKeys(keys);
                activeFolderKeysRef.current = keys;
                if (initialFilePath) setOpenFilePath(initialFilePath);
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

    const handleFileClick = (path: string, colIndex: number) => {
        // Collapse any deeper stale folder columns when opening a file.
        setColumns(prev => prev.slice(0, colIndex + 1));

        const newKeys = activeFolderKeysRef.current.slice(0, colIndex);
        setActiveFolderKeys(newKeys);
        activeFolderKeysRef.current = newKeys;

        const parentFolderPath = path.match(/[\\/]/) ? path.split(/[\\/]/).slice(0, -1).join('/') : null;
        setSelectedFolderPath(parentFolderPath);

        setOpenFilePath(path);
        const encoded = path.split(/[\\/]/).map(encodeURIComponent).join('/');
        history.replaceState(null, '', `#repos/${encodeURIComponent(wsId)}/tasks/${encoded}`);
    };

    const handleCheckboxChange = (path: string, _checked: boolean) => {
        toggleSelectedFile(path);
    };

    const getColumnFolder = (colIndex: number): TaskFolder | null => {
        if (colIndex === 0) return tree;
        const parentKey = activeFolderKeys[colIndex - 1];
        if (!parentKey) return null;
        return findFolderByKey(tree, parentKey);
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
        const path = getNodePath(node);
        if (!path) return null;
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

    return (
        <div
            className="flex flex-row h-full min-h-0"
            data-testid="task-tree"
        >
            {columns.map((colNodes, colIndex) => {
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
                                const path = getNodePath(node);
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
                                        commentCount={path ? (commentCounts[path] || 0) : 0}
                                        queueRunning={path ? (queueActivity[path] || 0) : 0}
                                        folderQueueCount={isTaskFolder(node) ? (queueFolderActivity[getFolderKey(node as TaskFolder)] ?? 0) : 0}
                                        folderMdCount={folderMdCount}
                                        showContextFiles={showContextFiles}
                                        onFolderClick={(folder) => handleFolderClick(folder, colIndex)}
                                        onFileClick={(path) => handleFileClick(path, colIndex)}
                                        onCheckboxChange={handleCheckboxChange}
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
