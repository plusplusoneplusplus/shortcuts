import type { NoteTreeNode } from '../notesApi';
import { cn } from '../../../ui/cn';
import type { NoteDragItem, DropPosition } from '../hooks/useNotesDragDrop';

export interface NotesTreeItemProps {
    node: NoteTreeNode;
    selectedPath: string | null;
    isExpanded: boolean;
    depth: number;
    isSystemFolder?: boolean;
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

const ICON_MAP: Record<NoteTreeNode['type'], string> = {
    notebook: '📓',
    section: '📁',
    page: '📄',
};

const isFolder = (type: NoteTreeNode['type']): boolean => type === 'notebook' || type === 'section';

export function NotesTreeItem({
    node,
    selectedPath,
    isExpanded,
    depth,
    isSystemFolder,
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

    const showInsideFolderHighlight = isDragOver && folder && dropPosition === 'inside';
    const showBeforeIndicator = isDragOver && dropPosition === 'before';
    const showAfterIndicator = isDragOver && dropPosition === 'after';

    return (
        <div className="relative">
            {/* Drop indicator line — before */}
            {showBeforeIndicator && (
                <div
                    className="absolute left-0 right-0 top-0 h-0.5 bg-[#007acc] z-10 pointer-events-none"
                    data-testid="drop-indicator-before"
                />
            )}
            <div
                className={cn(
                    'flex items-center gap-2 px-2 py-1.5 cursor-pointer text-xs transition-colors',
                    'hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
                    selected && 'bg-[#0078d4]/10 dark:bg-[#3794ff]/10',
                    showInsideFolderHighlight && 'ring-1 ring-inset ring-[#007acc] bg-[#007acc]/10',
                    draggable && 'select-none',
                )}
                style={{ paddingLeft: depth * 16 }}
                data-testid={`notes-tree-item-${node.name}`}
                data-node-path={node.path}
                onClick={handleClick}
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
                {/* Chevron */}
                {folder ? (
                    <span className="flex-shrink-0 text-xs text-[#848484] w-3.5 inline-block" data-testid="chevron">
                        {isExpanded ? '▾' : '▸'}
                    </span>
                ) : (
                    <span className="flex-shrink-0 w-3 inline-block" />
                )}
                {/* Icon */}
                <span className="flex-shrink-0 text-[11px]" data-testid="node-icon">{ICON_MAP[node.type]}</span>
                {/* Name */}
                <span className={cn('flex-1 truncate text-[#1e1e1e] dark:text-[#cccccc]', isSystemFolder && 'italic opacity-80')}>{displayName}</span>
                {/* System folder lock badge */}
                {isSystemFolder && (
                    <span
                        className="flex-shrink-0 ml-1 text-[#848484] dark:text-[#666] opacity-60"
                        title="System folder — cannot be renamed or deleted"
                        aria-label="System folder"
                    >
                        <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 inline-block">
                            <path d="M10 7V5a2 2 0 0 0-4 0v2H4.5A1.5 1.5 0 0 0 3 8.5v4A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-4A1.5 1.5 0 0 0 11.5 7H10zM7 5a1 1 0 1 1 2 0v2H7V5zm1 4.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" />
                        </svg>
                    </span>
                )}
            </div>
            {/* Drop indicator line — after */}
            {showAfterIndicator && (
                <div
                    className="absolute left-0 right-0 bottom-0 h-0.5 bg-[#007acc] z-10 pointer-events-none"
                    data-testid="drop-indicator-after"
                />
            )}
        </div>
    );
}

export type { NoteDragItem };
