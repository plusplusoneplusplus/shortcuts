import type { NoteTreeNode } from '../notesApi';
import { cn } from '../../../ui/cn';
import type { NoteDragItem, DropPosition } from '../hooks/useNotesDragDrop';

export interface NotesTreeItemProps {
    node: NoteTreeNode;
    selectedPath: string | null;
    isExpanded: boolean;
    depth: number;
    isSystemFolder?: boolean;
    hasUpdate?: boolean;
    /** Recursive page count rendered as a muted badge on folder rows. */
    pageCount?: number;
    onToggleExpand: (path: string) => void;
    onSelectPage: (path: string) => void;
    onContextMenu: (node: NoteTreeNode, x: number, y: number) => void;
    // Drag-and-drop (optional — omitting disables DnD for this item)
    draggable?: boolean;
    isDragOver?: boolean;
    dropPosition?: DropPosition | null;
    onDragStart?: (e: React.DragEvent) => void;
    onDragEnd?: (e: React.DragEvent) => void;
    onDragOver?: (e: React.DragEvent) => void;
    onDragEnter?: (e: React.DragEvent) => void;
    onDragLeave?: (e: React.DragEvent) => void;
    onDrop?: (e: React.DragEvent) => void;
}

const isFolder = (type: NoteTreeNode['type']): boolean => type === 'notebook' || type === 'section';

export function NotesTreeItem({
    node,
    selectedPath,
    isExpanded,
    depth,
    isSystemFolder,
    hasUpdate,
    pageCount,
    onToggleExpand,
    onSelectPage,
    onContextMenu,
    draggable,
    isDragOver,
    dropPosition,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop,
}: NotesTreeItemProps) {
    const folder = isFolder(node.type);
    const selected = node.path === selectedPath;
    const displayName = node.type === 'page' && node.name.endsWith('.md')
        ? node.name.slice(0, -3)
        : node.name;

    const handleClick = () => {
        if (folder) {
            onToggleExpand(node.path);
        } else {
            onSelectPage(node.path);
        }
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        if (e.shiftKey) return;
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(node, e.clientX, e.clientY);
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button === 2 && !e.shiftKey) {
            e.preventDefault();
        }
    };

    const showInsideFolderHighlight = isDragOver && folder && dropPosition === 'inside';
    const showBeforeIndicator = isDragOver && dropPosition === 'before';
    const showAfterIndicator = isDragOver && dropPosition === 'after';

    // Indent base: 10px so the first column lines up with the search/meta padding.
    const paddingLeft = 10 + depth * 16;

    return (
        <div className="relative">
            {/* Drop indicator line — before */}
            {showBeforeIndicator && (
                <div
                    className="absolute left-0 right-0 top-0 h-0.5 bg-[#0969da] z-10 pointer-events-none"
                    data-testid="drop-indicator-before"
                />
            )}
            <div
                className={cn(
                    'relative grid items-center gap-1.5 pr-2 py-[3px] min-h-[26px] cursor-pointer text-[13px] transition-colors',
                    'grid-cols-[14px_minmax(0,1fr)_auto]',
                    'hover:bg-[#d0d7de]/[0.34] dark:hover:bg-white/[0.06]',
                    selected && 'bg-[#ddf4ff] dark:bg-[#0078d4]/20 text-[#1f2328] dark:text-[#cccccc]',
                    selected && 'shadow-[inset_3px_0_0_#0969da] dark:shadow-[inset_3px_0_0_#3794ff]',
                    showInsideFolderHighlight && 'ring-1 ring-inset ring-[#0969da] bg-[#0969da]/10',
                    folder && 'font-semibold',
                    draggable && 'select-none',
                )}
                style={{ paddingLeft }}
                data-testid={`notes-tree-item-${node.name}`}
                data-node-path={node.path}
                onClick={handleClick}
                onMouseDown={handleMouseDown}
                onContextMenu={handleContextMenu}
                role="treeitem"
                aria-selected={selected}
                aria-expanded={folder ? isExpanded : undefined}
                draggable={draggable}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragOver={onDragOver}
                onDragEnter={onDragEnter}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
            >
                {/* Chevron column — folders show ▾/▸, pages get a blank spacer */}
                {folder ? (
                    <span
                        className="flex-shrink-0 text-[11px] leading-none text-[#656d76] dark:text-[#9d9d9d] inline-flex justify-center"
                        data-testid="chevron"
                        aria-hidden="true"
                    >
                        {isExpanded ? '▾' : '▸'}
                    </span>
                ) : (
                    <span className="flex-shrink-0 inline-block" aria-hidden="true" />
                )}
                {/* Name */}
                <span
                    className={cn(
                        'truncate text-[#1f2328] dark:text-[#cccccc]',
                        isSystemFolder && 'italic opacity-80',
                    )}
                >
                    {displayName}
                </span>
                {/* Trailing badge column: folder page-count, page update-dot, or system lock */}
                <span className="flex items-center justify-end gap-1 flex-shrink-0">
                    {folder && typeof pageCount === 'number' && pageCount > 0 && (
                        <span
                            className="text-[12px] tabular-nums text-[#656d76] dark:text-[#9d9d9d] font-mono"
                            data-testid="folder-page-count"
                            aria-label={`${pageCount} pages`}
                        >
                            {pageCount}
                        </span>
                    )}
                    {hasUpdate && (
                        <span
                            className="h-2 w-2 rounded-full bg-[#0969da] dark:bg-[#3794ff]"
                            data-testid="note-update-indicator"
                            title="Updated since last viewed"
                            aria-label="Updated since last viewed"
                        />
                    )}
                    {isSystemFolder && (
                        <span
                            className="text-[#656d76] dark:text-[#9d9d9d] opacity-60"
                            title="System folder — cannot be renamed or deleted"
                            aria-label="System folder"
                        >
                            <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 inline-block">
                                <path d="M10 7V5a2 2 0 0 0-4 0v2H4.5A1.5 1.5 0 0 0 3 8.5v4A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-4A1.5 1.5 0 0 0 11.5 7H10zM7 5a1 1 0 1 1 2 0v2H7V5zm1 4.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" />
                            </svg>
                        </span>
                    )}
                </span>
            </div>
            {/* Drop indicator line — after */}
            {showAfterIndicator && (
                <div
                    className="absolute left-0 right-0 bottom-0 h-0.5 bg-[#0969da] z-10 pointer-events-none"
                    data-testid="drop-indicator-after"
                />
            )}
        </div>
    );
}

export type { NoteDragItem };
