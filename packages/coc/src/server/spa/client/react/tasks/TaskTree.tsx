/**
 * TaskTree — Miller-columns file browser for workspace tasks.
 */

import { useEffect, useRef, useState } from 'react';
import { useTaskPanel } from '../context/TaskContext';
import { useQueueActivity } from '../hooks/useQueueActivity';
import type { TaskFolder, TaskNode, TaskDocument, TaskDocumentGroup } from '../hooks/useTaskTree';
import { countMarkdownFilesInFolder, folderToNodes, isTaskFolder } from '../hooks/useTaskTree';
import { TaskTreeItem } from './TaskTreeItem';

interface TaskTreeProps {
    tree: TaskFolder;
    commentCounts: Record<string, number>;
    wsId: string;
    initialFolderPath?: string | null;
    initialFilePath?: string | null;
    onColumnsChange?: () => void;
    onFolderContextMenu?: (folder: TaskFolder, x: number, y: number) => void;
    onFileContextMenu?: (item: TaskDocument | TaskDocumentGroup, x: number, y: number) => void;
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

export function TaskTree({ tree, commentCounts, wsId, initialFolderPath, initialFilePath, onColumnsChange, onFolderContextMenu, onFileContextMenu }: TaskTreeProps) {
    const { openFilePath, setOpenFilePath, selectedFilePaths, toggleSelectedFile, showContextFiles, setSelectedFolderPath } = useTaskPanel();
    const { fileMap: queueActivity, folderMap: queueFolderActivity } = useQueueActivity(wsId);
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
                const folderPath = initialFolderPath ?? (initialFilePath ? initialFilePath.split('/').slice(0, -1).join('/') : '');
                const segments = folderPath.split('/').filter(Boolean);
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
        const encoded = folderPath.split('/').map(encodeURIComponent).join('/');
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

        const parentFolderPath = path.includes('/') ? path.split('/').slice(0, -1).join('/') : null;
        setSelectedFolderPath(parentFolderPath);

        setOpenFilePath(path);
        const encoded = path.split('/').map(encodeURIComponent).join('/');
        history.replaceState(null, '', `#repos/${encodeURIComponent(wsId)}/tasks/${encoded}`);
    };

    const handleCheckboxChange = (path: string, _checked: boolean) => {
        toggleSelectedFile(path);
    };

    return (
        <div
            className="flex flex-row h-full min-h-0"
            data-testid="task-tree"
        >
            {columns.map((colNodes, colIndex) => {
                return (
                <div
                    key={colIndex}
                    className="flex-shrink-0 w-56 h-full border-r border-[#e0e0e0] dark:border-[#3c3c3c] overflow-y-auto"
                    data-testid={`miller-column-${colIndex}`}
                >
                    {colNodes.length === 0 ? (
                        <div className="py-6 px-4 text-center text-xs text-[#848484] dark:text-[#666] italic">
                            Empty folder
                        </div>
                    ) : (
                        <ul className="py-1">
                            {colNodes.map((node, nodeIndex) => {
                                const path = getNodePath(node);
                                const folderMdCount = isTaskFolder(node) ? countMarkdownFilesInFolder(node) : 0;
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
