/**
 * TaskTreeItem — individual row in a Miller column.
 */

import { cn } from '../shared';
import { AIActionsDropdown } from '../shared/AIActionsDropdown';
import { isContextFile, isTaskFolder, isTaskDocumentGroup, isTaskDocument } from '../hooks/useTaskTree';
import type { TaskNode, TaskFolder, TaskDocumentGroup, TaskDocument } from '../hooks/useTaskTree';

export interface TaskTreeItemProps {
    item: TaskNode;
    wsId: string;
    isSelected: boolean;
    isOpen: boolean;
    isActiveFolder?: boolean;
    commentCount: number;
    queueRunning: number;
    folderQueueCount?: number;
    folderMdCount: number;
    showContextFiles: boolean;
    onFolderClick: (folder: TaskFolder) => void;
    onFileClick: (path: string) => void;
    onCheckboxChange: (path: string, checked: boolean) => void;
    onFolderContextMenu?: (folder: TaskFolder, x: number, y: number) => void;
    onFileContextMenu?: (item: TaskDocument | TaskDocumentGroup, x: number, y: number) => void;
    // Drag-and-drop handlers
    onDragStart?: (e: React.DragEvent) => void;
    onDragEnd?: (e: React.DragEvent) => void;
    onDragOver?: (e: React.DragEvent) => void;
    onDragEnter?: (e: React.DragEvent) => void;
    onDragLeave?: (e: React.DragEvent) => void;
    onDrop?: (e: React.DragEvent) => void;
    isDropTarget?: boolean;
    isDragSource?: boolean;
}

function getItemFileName(item: TaskNode): string {
    if (isTaskDocument(item)) return item.fileName;
    if (isTaskDocumentGroup(item)) return item.baseName;
    return '';
}

function getItemPath(item: TaskNode): string | null {
    if (isTaskDocument(item)) {
        const rel = (item.relativePath || '').replace(/\\/g, '/');
        return rel ? rel + '/' + item.fileName : item.fileName;
    }
    if (isTaskDocumentGroup(item)) {
        const firstDoc = item.documents[0];
        if (firstDoc) {
            const rel = (firstDoc.relativePath || '').replace(/\\/g, '/');
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

export function buildFileTooltip(
    path: string | null,
    commentCount: number,
    status?: string,
): string {
    const lines: string[] = [];
    if (path) lines.push(path);
    if (status) lines.push(`Status: ${status}`);
    if (commentCount > 0) lines.push(`Comments: ${commentCount}`);
    return lines.join('\n');
}

export function TaskTreeItem({
    item,
    wsId,
    isSelected,
    isOpen,
    isActiveFolder,
    commentCount,
    queueRunning,
    folderQueueCount,
    folderMdCount,
    showContextFiles,
    onFolderClick,
    onFileClick,
    onCheckboxChange,
    onFolderContextMenu,
    onFileContextMenu,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop,
    isDropTarget,
    isDragSource,
}: TaskTreeItemProps) {
    const isFolder = isTaskFolder(item);
    const fileName = getItemFileName(item);
    const isContext = !isFolder && isContextFile(fileName);

    if (isContext && !showContextFiles) return null;

    const displayName = getDisplayName(item);
    const path = getItemPath(item);
    const isNestedContextDoc = isContext && fileName.toLowerCase() === 'context.md' && !!path && path.includes('/');
    const canOpenFileContextMenu = !isFolder && (!isContext || isNestedContextDoc);
    const status = isTaskDocument(item)
        ? item.status
        : isTaskDocumentGroup(item)
            ? item.documents[0]?.status
            : undefined;
    const isArchived = isTaskDocument(item) ? item.isArchived : isTaskDocumentGroup(item) ? item.isArchived : false;
    const isArchiveFolder = isFolder && ((item as TaskFolder).relativePath === 'archive' || (item as TaskFolder).name === 'archive');
    const tooltip = !isFolder ? buildFileTooltip(path, commentCount, status) : undefined;

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

    const handleDragStart = (e: React.DragEvent) => {
        // Don't start drag from checkbox clicks
        if ((e.target as HTMLElement).tagName === 'INPUT') {
            e.preventDefault();
            return;
        }
        onDragStart?.(e);
    };

    return (
        <li
            className={cn(
                'flex items-center gap-2 px-2 py-1.5 cursor-pointer text-xs transition-colors',
                'hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
                isOpen && 'bg-[#0078d4]/10 dark:bg-[#3794ff]/10',
                isActiveFolder && 'bg-[#0078d4]/[0.12] dark:bg-[#3794ff]/[0.12]',
                isSelected && 'bg-[#0078d4]/5',
                isContext && 'opacity-50',
                isArchived && 'opacity-60 italic',
                isArchiveFolder && 'opacity-60 italic',
                !isFolder && 'miller-file-row',
                isDragSource && 'opacity-40',
                isDropTarget && 'ring-2 ring-[#0078d4] dark:ring-[#3794ff] bg-[#0078d4]/10 dark:bg-[#3794ff]/10',
            )}
            draggable={!isContext}
            onDragStart={handleDragStart}
            onDragEnd={onDragEnd}
            onDragOver={isFolder ? onDragOver : undefined}
            onDragEnter={isFolder ? onDragEnter : undefined}
            onDragLeave={isFolder ? onDragLeave : undefined}
            onDrop={isFolder ? onDrop : undefined}
            onClick={handleClick}
            onContextMenu={(e) => {
                if (e.shiftKey) {
                    // Keep the browser's native context menu when Shift is held.
                    return;
                }
                if (isFolder && onFolderContextMenu) {
                    e.preventDefault();
                    e.stopPropagation();
                    onFolderContextMenu(item as TaskFolder, e.clientX, e.clientY);
                } else if (canOpenFileContextMenu && onFileContextMenu) {
                    e.preventDefault();
                    e.stopPropagation();
                    onFileContextMenu(item as TaskDocument | TaskDocumentGroup, e.clientX, e.clientY);
                }
            }}
            title={tooltip}
            data-testid={`task-tree-item-${displayName}`}
            data-file-path={!isFolder && path ? path : undefined}
        >
            {/* Checkbox for files (hidden for context files) */}
            {!isFolder && path && !isContext && (
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
                {isFolder ? '📁' : isContext ? 'ℹ️' : isTaskDocumentGroup(item) ? '📄' : '📝'}
            </span>

            {/* Status */}
            {status && (
                <span
                    className={`miller-status task-status-${status} flex-shrink-0 text-[10px]`}
                    title={status}
                    data-status={status}
                >
                    {getStatusIcon(status)}
                </span>
            )}

            {/* Name */}
            <span className="miller-row-name flex-1 truncate text-[#1e1e1e] dark:text-[#cccccc]">
                {displayName}
            </span>

            {/* Queue execution indicator */}
            {queueRunning > 0 && (
                <span
                    className="miller-queue-indicator miller-queue-indicator-running flex-shrink-0 text-[9px] font-medium px-1.5 py-px rounded-full bg-[#0078d4] text-white animate-pulse"
                    title={`In progress (${queueRunning})`}
                >
                    in progress
                </span>
            )}

            {/* Folder queue activity badge */}
            {isFolder && (folderQueueCount ?? 0) > 0 && (
                <span
                    className="miller-queue-indicator miller-queue-indicator-running flex-shrink-0 text-[9px] font-medium px-1.5 py-px rounded-full bg-[#0078d4] text-white animate-pulse"
                    title={`${folderQueueCount} task${folderQueueCount === 1 ? '' : 's'} in progress in this folder`}
                >
                    {folderQueueCount} in progress
                </span>
            )}

            {/* Comment count badge */}
            {commentCount > 0 && (
                <span className="flex-shrink-0 text-[10px] bg-[#0078d4] text-white px-1 py-px rounded-full min-w-[16px] text-center">
                    {commentCount}
                </span>
            )}

            {/* Folder recursive markdown count badge */}
            {isFolder && (
                <span
                    className="task-folder-count flex-shrink-0 text-[10px] bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#616161] dark:text-[#999] px-1 py-px rounded-full min-w-[16px] text-center"
                    title={`${folderMdCount} markdown file${folderMdCount === 1 ? '' : 's'} in folder`}
                >
                    {folderMdCount}
                </span>
            )}

            {/* Folder arrow */}
            {isFolder && (
                <span className="flex-shrink-0 text-[10px] text-[#848484]">▶</span>
            )}

            {/* AI actions */}
            {!isFolder && path && (
                <AIActionsDropdown wsId={wsId} taskPath={path} />
            )}
        </li>
    );
}
