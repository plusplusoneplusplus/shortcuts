import type { NoteTreeNode } from '../notesApi';
import { cn } from '../../shared/cn';

export interface NotesTreeItemProps {
    node: NoteTreeNode;
    selectedPath: string | null;
    isExpanded: boolean;
    depth: number;
    onToggleExpand: (path: string) => void;
    onSelectPage: (path: string) => void;
    onContextMenu: (node: NoteTreeNode, x: number, y: number) => void;
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
    onToggleExpand,
    onSelectPage,
    onContextMenu,
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
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(node, e.clientX, e.clientY);
    };

    return (
        <div
            className={cn(
                'flex items-center gap-2 px-2 py-1.5 cursor-pointer text-xs transition-colors',
                'hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
                selected && 'bg-[#0078d4]/10 dark:bg-[#3794ff]/10',
            )}
            style={{ paddingLeft: depth * 16 }}
            data-testid={`notes-tree-item-${node.name}`}
            data-node-path={node.path}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            role="treeitem"
            aria-selected={selected}
            aria-expanded={folder ? isExpanded : undefined}
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
            <span className="flex-1 truncate text-[#1e1e1e] dark:text-[#cccccc]">{displayName}</span>
        </div>
    );
}
