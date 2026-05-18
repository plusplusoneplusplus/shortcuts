import type { NoteTreeNode } from '../notesApi';
import { NotesTreeItem } from './NotesTreeItem';
import type { NoteDragItem, DropPosition } from '../hooks/useNotesDragDrop';

export interface NotesDragDropHandlers {
    createDragStartHandler: (item: NoteDragItem) => (e: React.DragEvent) => void;
    createDragEndHandler: () => (e: React.DragEvent) => void;
    createDragOverHandler: (target: NoteDragItem) => (e: React.DragEvent) => void;
    createDragEnterHandler: (target: NoteDragItem) => (e: React.DragEvent) => void;
    createDragLeaveHandler: (target: NoteDragItem) => (e: React.DragEvent) => void;
    createDropHandler: (
        target: NoteDragItem,
        onReorder: (dragged: NoteDragItem, target: NoteDragItem, position: DropPosition) => void,
    ) => (e: React.DragEvent) => void;
    dropTargetPath: string | null;
    dropPosition: DropPosition | null;
    onDrop: (dragged: NoteDragItem, target: NoteDragItem, position: DropPosition) => void;
}

export interface NotesTreeProps {
    nodes: NoteTreeNode[];
    selectedPath: string | null;
    expandedPaths: Set<string>;
    depth?: number;
    systemFolders?: string[];
    onToggleExpand: (path: string) => void;
    onSelectPage: (path: string) => void;
    onContextMenu: (node: NoteTreeNode, x: number, y: number) => void;
    isNoteUpdated?: (node: NoteTreeNode) => boolean;
    /**
     * When non-null, only nodes whose path is in this set are rendered.
     * Used by the sidebar search filter; `null` means "no filter".
     */
    visiblePaths?: Set<string> | null;
    /** Helper used to compute the recursive page count badge for folder rows. */
    countDescendantPages?: (node: NoteTreeNode) => number;
    dragDrop?: NotesDragDropHandlers;
    /** Set of paths in the current multi-selection. */
    multiSelectedPaths?: Set<string>;
    /** Multi-selection handler forwarding modifier key state. */
    onSelectWithModifiers?: (path: string, shiftKey: boolean, ctrlKey: boolean) => void;
}

function hasNodeUpdate(node: NoteTreeNode, isNoteUpdated?: (node: NoteTreeNode) => boolean): boolean {
    if (!isNoteUpdated) return false;
    if (node.type === 'page') return isNoteUpdated(node);
    return node.children?.some(child => hasNodeUpdate(child, isNoteUpdated)) ?? false;
}

export function NotesTree({
    nodes,
    selectedPath,
    expandedPaths,
    depth = 0,
    systemFolders,
    onToggleExpand,
    onSelectPage,
    onContextMenu,
    isNoteUpdated,
    visiblePaths,
    countDescendantPages,
    dragDrop,
    multiSelectedPaths,
    onSelectWithModifiers,
}: NotesTreeProps) {
    return (
        <div role="tree" data-testid={depth === 0 ? 'notes-tree' : undefined}>
            {nodes.map(node => {
                if (visiblePaths && !visiblePaths.has(node.path)) return null;

                const isFolder = node.type === 'notebook' || node.type === 'section';
                const isExpanded = expandedPaths.has(node.path);
                const isSysFolder = !!(systemFolders && systemFolders.includes(node.name) && node.type === 'notebook' && depth === 0);

                const dragItem: NoteDragItem | undefined = (dragDrop && !isSysFolder)
                    ? { path: node.path, name: node.name, type: node.type }
                    : undefined;

                const isDragOver = dragDrop ? dragDrop.dropTargetPath === node.path : false;
                const folderCount = isFolder && countDescendantPages ? countDescendantPages(node) : undefined;

                return (
                    <div key={node.path}>
                        <NotesTreeItem
                            node={node}
                            selectedPath={selectedPath}
                            isExpanded={isExpanded}
                            depth={depth}
                            isSystemFolder={isSysFolder}
                            hasUpdate={hasNodeUpdate(node, isNoteUpdated)}
                            pageCount={folderCount}
                            isMultiSelected={multiSelectedPaths ? multiSelectedPaths.has(node.path) : false}
                            onToggleExpand={onToggleExpand}
                            onSelectPage={onSelectPage}
                            onContextMenu={onContextMenu}
                            onSelectWithModifiers={onSelectWithModifiers}
                            draggable={!!dragDrop && !isSysFolder}
                            isDragOver={isDragOver}
                            dropPosition={isDragOver ? dragDrop!.dropPosition : null}
                            onDragStart={dragItem ? dragDrop!.createDragStartHandler(dragItem) : undefined}
                            onDragEnd={dragDrop && !isSysFolder ? dragDrop.createDragEndHandler() : undefined}
                            onDragOver={dragItem ? dragDrop!.createDragOverHandler(dragItem) : undefined}
                            onDragEnter={dragItem ? dragDrop!.createDragEnterHandler(dragItem) : undefined}
                            onDragLeave={dragItem ? dragDrop!.createDragLeaveHandler(dragItem) : undefined}
                            onDrop={dragItem
                                ? dragDrop!.createDropHandler(dragItem, dragDrop!.onDrop)
                                : undefined}
                        />
                        {isFolder && isExpanded && node.children && node.children.length > 0 && (
                            <NotesTree
                                nodes={node.children}
                                selectedPath={selectedPath}
                                expandedPaths={expandedPaths}
                                depth={depth + 1}
                                systemFolders={systemFolders}
                                onToggleExpand={onToggleExpand}
                                onSelectPage={onSelectPage}
                                onContextMenu={onContextMenu}
                                isNoteUpdated={isNoteUpdated}
                                visiblePaths={visiblePaths}
                                countDescendantPages={countDescendantPages}
                                dragDrop={dragDrop}
                                multiSelectedPaths={multiSelectedPaths}
                                onSelectWithModifiers={onSelectWithModifiers}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}
