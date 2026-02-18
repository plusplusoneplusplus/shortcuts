/**
 * TaskTreeItem — individual row in a Miller column.
 */

import { cn } from '../shared';
import { isContextFile, isTaskFolder, isTaskDocumentGroup, isTaskDocument } from '../hooks/useTaskTree';
import type { TaskNode, TaskFolder, TaskDocumentGroup, TaskDocument } from '../hooks/useTaskTree';

export interface TaskTreeItemProps {
    item: TaskNode;
    isSelected: boolean;
    isOpen: boolean;
    commentCount: number;
    showContextFiles: boolean;
    onFolderClick: (folder: TaskFolder) => void;
    onFileClick: (path: string) => void;
    onCheckboxChange: (path: string, checked: boolean) => void;
}

function getItemFileName(item: TaskNode): string {
    if (isTaskDocument(item)) return item.fileName;
    if (isTaskDocumentGroup(item)) return item.baseName;
    return '';
}

function getItemPath(item: TaskNode): string | null {
    if (isTaskDocument(item)) {
        const rel = item.relativePath || '';
        return rel ? rel + '/' + item.fileName : item.fileName;
    }
    if (isTaskDocumentGroup(item)) {
        const firstDoc = item.documents[0];
        if (firstDoc) {
            const rel = firstDoc.relativePath || '';
            return rel ? rel + '/' + firstDoc.fileName : firstDoc.fileName;
        }
    }
    return null;
}

function getDisplayName(item: TaskNode): string {
    if (isTaskFolder(item)) return item.name;
    if (isTaskDocumentGroup(item)) return item.baseName;
    if (isTaskDocument(item)) return item.baseName || item.fileName;
    return '';
}

function getStatusIcon(status?: string): string {
    switch (status) {
        case 'done': return '✅';
        case 'in-progress': return '🔄';
        case 'pending': return '⏳';
        case 'future': return '📋';
        default: return '';
    }
}

export function TaskTreeItem({
    item,
    isSelected,
    isOpen,
    commentCount,
    showContextFiles,
    onFolderClick,
    onFileClick,
    onCheckboxChange,
}: TaskTreeItemProps) {
    const isFolder = isTaskFolder(item);
    const fileName = getItemFileName(item);
    const isContext = !isFolder && isContextFile(fileName);

    if (isContext && !showContextFiles) return null;

    const displayName = getDisplayName(item);
    const path = getItemPath(item);
    const status = isTaskDocument(item) ? item.status : undefined;
    const isArchived = isTaskDocument(item) ? item.isArchived : isTaskDocumentGroup(item) ? item.isArchived : false;

    const handleClick = () => {
        if (isFolder) {
            onFolderClick(item as TaskFolder);
        } else if (path) {
            onFileClick(path);
        }
    };

    const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.stopPropagation();
        if (path) {
            onCheckboxChange(path, e.target.checked);
        }
    };

    return (
        <li
            className={cn(
                'flex items-center gap-2 px-2 py-1.5 cursor-pointer text-xs transition-colors',
                'hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
                isOpen && 'bg-[#0078d4]/10 dark:bg-[#3794ff]/10',
                isSelected && 'bg-[#0078d4]/5',
                isContext && 'opacity-50',
                isArchived && 'opacity-60 italic',
            )}
            onClick={handleClick}
            data-testid={`task-tree-item-${displayName}`}
        >
            {/* Checkbox for files */}
            {!isFolder && path && (
                <input
                    type="checkbox"
                    className="task-checkbox flex-shrink-0 accent-[#0078d4]"
                    checked={isSelected}
                    onChange={handleCheckboxChange}
                    onClick={(e) => e.stopPropagation()}
                    data-check-path={path}
                />
            )}

            {/* Icon */}
            <span className="flex-shrink-0 text-[11px]">
                {isFolder ? '📁' : isTaskDocumentGroup(item) ? '📄' : '📝'}
            </span>

            {/* Status */}
            {status && (
                <span className="flex-shrink-0 text-[10px]" title={status}>
                    {getStatusIcon(status)}
                </span>
            )}

            {/* Name */}
            <span className="flex-1 truncate text-[#1e1e1e] dark:text-[#cccccc]">
                {displayName}
            </span>

            {/* Comment count badge */}
            {commentCount > 0 && (
                <span className="flex-shrink-0 text-[10px] bg-[#0078d4] text-white px-1 py-px rounded-full min-w-[16px] text-center">
                    {commentCount}
                </span>
            )}

            {/* Folder arrow */}
            {isFolder && (
                <span className="flex-shrink-0 text-[10px] text-[#848484]">▶</span>
            )}

            {/* AI actions stub (commit 010) */}
            <span data-testid="ai-actions-stub" />
        </li>
    );
}
