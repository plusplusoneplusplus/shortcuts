/**
 * TaskTree — Miller-columns file browser for workspace tasks.
 */

import { useState, useEffect, useRef } from 'react';
import { TaskTreeItem } from './TaskTreeItem';
import { useTaskPanel } from '../context/TaskContext';
import { folderToNodes, isTaskFolder } from '../hooks/useTaskTree';
import type { TaskNode, TaskFolder } from '../hooks/useTaskTree';

interface TaskTreeProps {
    tree: TaskFolder;
    commentCounts: Record<string, number>;
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

export function TaskTree({ tree, commentCounts }: TaskTreeProps) {
    const { openFilePath, setOpenFilePath, selectedFilePaths, toggleSelectedFile, showContextFiles } = useTaskPanel();
    const [columns, setColumns] = useState<TaskNode[][]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Initialize root column from tree
    useEffect(() => {
        const rootNodes = folderToNodes(tree);
        setColumns([rootNodes]);
    }, [tree]);

    // Auto-scroll to rightmost column
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
        }
    }, [columns]);

    const handleFolderClick = (folder: TaskFolder, colIndex: number) => {
        const children = folderToNodes(folder);
        setColumns(prev => [...prev.slice(0, colIndex + 1), children]);
    };

    const handleFileClick = (path: string) => {
        setOpenFilePath(path);
    };

    const handleCheckboxChange = (path: string, _checked: boolean) => {
        toggleSelectedFile(path);
    };

    return (
        <div
            ref={scrollRef}
            className="flex flex-row overflow-x-auto h-full"
            data-testid="task-tree"
        >
            {columns.map((colNodes, colIndex) => (
                <div
                    key={colIndex}
                    className="flex-shrink-0 w-56 border-r border-[#e0e0e0] dark:border-[#3c3c3c] overflow-y-auto"
                    data-testid={`miller-column-${colIndex}`}
                >
                    <ul className="py-1">
                        {colNodes.map((node, nodeIndex) => {
                            const path = getNodePath(node);
                            return (
                                <TaskTreeItem
                                    key={nodeIndex}
                                    item={node}
                                    isSelected={path ? selectedFilePaths.has(path) : false}
                                    isOpen={path ? path === openFilePath : false}
                                    commentCount={path ? (commentCounts[path] || 0) : 0}
                                    showContextFiles={showContextFiles}
                                    onFolderClick={(folder) => handleFolderClick(folder, colIndex)}
                                    onFileClick={handleFileClick}
                                    onCheckboxChange={handleCheckboxChange}
                                />
                            );
                        })}
                    </ul>
                </div>
            ))}
        </div>
    );
}
