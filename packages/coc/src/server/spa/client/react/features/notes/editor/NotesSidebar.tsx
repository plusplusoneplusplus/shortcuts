import { useState, useCallback, useEffect, useRef } from 'react';
import type { NoteTreeNode } from '../notesApi';
import type { ContextMenuItem } from '../../../tasks/comments/ContextMenu';
import { ContextMenu } from '../../../tasks/comments/ContextMenu';
import { Button } from '../../../ui/Button';
import { Spinner } from '../../../ui/Spinner';
import { NotesTree } from './NotesTree';
import { NotesDialogs } from './NotesDialogs';
import { useNotesTree } from './useNotesTree';
import { useNotesContextMenu, type NoteDialogAction } from './useNotesContextMenu';
import { useNotesDragDrop, getNotesParentPath, type NoteDragItem, type DropPosition } from '../hooks/useNotesDragDrop';
import { fetchApi } from '../../../hooks/useApi';

/** Synthetic root node used when right-clicking empty space in the sidebar. */
const ROOT_NODE: NoteTreeNode = { name: '', path: '', type: 'notebook' };

/** Compute ancestor folder paths that need to be expanded for a given note path. */
function getAncestorPaths(notePath: string): string[] {
    const segments = notePath.split('/');
    const ancestors: string[] = [];
    for (let i = 1; i < segments.length; i++) {
        ancestors.push(segments.slice(0, i).join('/'));
    }
    return ancestors;
}

export interface NotesSidebarProps {
    workspaceId: string;
    selectedPath: string | null;
    onSelectPage: (path: string) => void;
    onNoteRenamed?: (oldPath: string, newPath: string) => void;
    onNoteCreated?: (path: string) => void;
    onNoteDeleted?: (path: string) => void;
    canGoBack?: boolean;
    onGoBack?: () => void;
    /** Called once the notes root path is resolved from the server. */
    onNotesRootReady?: (notesRoot: string) => void;
}

export function NotesSidebar({ workspaceId, selectedPath, onSelectPage, onNoteRenamed, onNoteCreated, onNoteDeleted, canGoBack, onGoBack, onNotesRootReady }: NotesSidebarProps) {
    const { tree, notesRoot, systemFolders, loading, error, refresh, createNode, renameNode, deleteNode, reorderNodes } = useNotesTree(workspaceId);
    const { ctxMenu, dialog, openContextMenu, closeContextMenu, openDialog, closeDialog, setSubmitting } = useNotesContextMenu();
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
    const deepLinkAppliedRef = useRef<string | null>(null);
    const dragDrop = useNotesDragDrop();
    const [addDropdownOpen, setAddDropdownOpen] = useState(false);
    const addDropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown on outside click
    useEffect(() => {
        if (!addDropdownOpen) return;
        function handleClickOutside(e: MouseEvent) {
            if (addDropdownRef.current && !addDropdownRef.current.contains(e.target as Node)) {
                setAddDropdownOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [addDropdownOpen]);

    // Close dropdown on Escape
    useEffect(() => {
        if (!addDropdownOpen) return;
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') setAddDropdownOpen(false);
        }
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [addDropdownOpen]);

    // Auto-expand tree when selectedPath changes (deep-link or selection)
    useEffect(() => {
        if (!selectedPath || !tree || tree.length === 0) return;
        // Only auto-expand once per unique selectedPath to avoid overriding user collapses
        if (deepLinkAppliedRef.current === selectedPath) return;
        deepLinkAppliedRef.current = selectedPath;
        const ancestors = getAncestorPaths(selectedPath);
        if (ancestors.length > 0) {
            setExpandedPaths(prev => {
                const next = new Set(prev);
                for (const a of ancestors) next.add(a);
                return next;
            });
        }
    }, [selectedPath, tree]);

    // Notify parent when the notes root path becomes available
    useEffect(() => {
        if (notesRoot) onNotesRootReady?.(notesRoot);
    }, [notesRoot, onNotesRootReady]);

    // Scroll the selected tree item into view after tree renders
    useEffect(() => {
        if (!selectedPath || loading) return;
        // Defer to allow DOM update after expansion
        const timer = setTimeout(() => {
            const el = document.querySelector(`[data-node-path="${CSS.escape(selectedPath)}"]`);
            el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }, 50);
        return () => clearTimeout(timer);
    }, [selectedPath, loading]);

    const handleToggleExpand = useCallback((path: string) => {
        setExpandedPaths(prev => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    }, []);

    const handleContextMenu = useCallback((node: NoteTreeNode, x: number, y: number) => {
        openContextMenu(node, x, y);
    }, [openContextMenu]);

    const handleBackgroundContextMenu = useCallback((e: React.MouseEvent) => {
        if (e.shiftKey) return;
        e.preventDefault();
        openContextMenu(ROOT_NODE, e.clientX, e.clientY);
    }, [openContextMenu]);

    const handleNewNotebook = useCallback(() => {
        setAddDropdownOpen(false);
        openDialog('create-notebook', { name: '', path: '', type: 'notebook' });
    }, [openDialog]);

    /** Find the current notebook/section from selectedPath for "New Page". */
    const findCurrentNotebook = useCallback((): NoteTreeNode | null => {
        if (!selectedPath || !tree) return null;
        // If selectedPath is a page (.md file), use its parent directory
        const isPage = selectedPath.endsWith('.md');
        const targetPath = isPage && selectedPath.includes('/')
            ? selectedPath.substring(0, selectedPath.lastIndexOf('/'))
            : isPage ? '' : selectedPath;

        if (!targetPath) return null;

        // Walk the tree to find the node at targetPath
        const findNode = (nodes: NoteTreeNode[], path: string): NoteTreeNode | null => {
            for (const n of nodes) {
                if (n.path === path) return n;
                if (n.children) {
                    const found = findNode(n.children, path);
                    if (found) return found;
                }
            }
            return null;
        };
        return findNode(tree, targetPath);
    }, [selectedPath, tree]);

    const handleNewPage = useCallback(() => {
        setAddDropdownOpen(false);
        const notebook = findCurrentNotebook();
        if (notebook) {
            openDialog('create-page', notebook);
        }
    }, [findCurrentNotebook, openDialog]);

    const handleNewPageWithAI = useCallback(() => {
        setAddDropdownOpen(false);
        openDialog('create-page-ai', ROOT_NODE);
    }, [openDialog]);

    const handleAICreateNote = useCallback(async (prompt: string) => {
        try {
            const res = await fetchApi(`/workspaces/${workspaceId}/notes/ai-create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt }),
            });
            const taskId = res?.taskId;
            if (!taskId) return;

            // Poll the process for completion and navigate to the new note
            const processId = `queue_${taskId}`;
            const pollInterval = setInterval(async () => {
                try {
                    const procRes = await fetchApi(`/processes/${processId}`);
                    const proc = procRes?.process ?? procRes;
                    const status = proc?.status;
                    if (status === 'completed') {
                        clearInterval(pollInterval);
                        const noteCreate = proc?.metadata?.noteCreate;
                        if (noteCreate?.path) {
                            await refresh();
                            onSelectPage(noteCreate.path);
                            onNoteCreated?.(noteCreate.path);
                        } else {
                            await refresh();
                        }
                    } else if (status === 'failed' || status === 'cancelled') {
                        clearInterval(pollInterval);
                    }
                } catch {
                    clearInterval(pollInterval);
                }
            }, 2000);

            // Safety timeout after 2 minutes
            setTimeout(() => clearInterval(pollInterval), 120_000);
        } catch {
            // Error handled silently — the dialog already closed
        }
    }, [workspaceId, refresh, onSelectPage, onNoteCreated]);

    const handleCreateNode = useCallback(async (parentPath: string, name: string, type: 'notebook' | 'section' | 'page') => {
        await createNode(parentPath, name, type);
        if (type === 'page') {
            const newPath = parentPath ? `${parentPath}/${name}.md` : `${name}.md`;
            onNoteCreated?.(newPath);
        }
    }, [createNode, onNoteCreated]);

    const handleRenameNode = useCallback(async (oldPath: string, newPath: string) => {
        await renameNode(oldPath, newPath);
        onNoteRenamed?.(oldPath, newPath);
    }, [renameNode, onNoteRenamed]);

    const handleDeleteNode = useCallback(async (path: string) => {
        await deleteNode(path);
        onNoteDeleted?.(path);
    }, [deleteNode, onNoteDeleted]);

    /**
     * Handle a drop in the notes tree.
     *
     * - 'inside' → move the dragged item into the target folder
     * - 'before' / 'after' → reorder siblings within the same parent
     *
     * For cross-parent moves we call renameNode (PATCH /notes/path).
     * For same-parent reorder we call reorderNodes (PUT /notes/order).
     */
    const handleNoteDrop = useCallback(async (
        dragged: NoteDragItem,
        target: NoteDragItem,
        position: DropPosition,
    ) => {
        if (!tree) return;

        // System folders cannot be moved or reordered
        const isSysFolder = (item: NoteDragItem) =>
            item.type === 'notebook' &&
            systemFolders.includes(item.name) &&
            !getNotesParentPath(item.path);
        if (isSysFolder(dragged)) return;

        if (position === 'inside') {
            // Move dragged item INTO target folder
            const isTargetFolder = target.type !== 'page';
            if (!isTargetFolder) return; // 'inside' only valid for folders

            const newPath = `${target.path}/${dragged.name}`;
            try {
                await renameNode(dragged.path, newPath);
                onNoteRenamed?.(dragged.path, newPath);
            } catch {
                // Rename failed — tree already refreshed by renameNode
            }
            return;
        }

        // Reorder or cross-parent move for 'before' / 'after'
        const draggedParent = getNotesParentPath(dragged.path);
        const targetParent = getNotesParentPath(target.path);

        if (draggedParent === targetParent) {
            // Same parent → reorder siblings
            // Find sibling nodes at this level
            let siblings: NoteTreeNode[];
            if (draggedParent === '') {
                siblings = tree;
            } else {
                // Walk the tree to find the parent node's children
                const findChildren = (nodes: NoteTreeNode[], parentPath: string): NoteTreeNode[] | null => {
                    for (const n of nodes) {
                        if (n.path === parentPath) return n.children ?? [];
                        if (n.children) {
                            const found = findChildren(n.children, parentPath);
                            if (found) return found;
                        }
                    }
                    return null;
                };
                siblings = findChildren(tree, draggedParent) ?? [];
            }

            // Build the new order: remove dragged, insert relative to target
            const names = siblings.map(s => s.name);
            const draggedIdx = names.indexOf(dragged.name);
            const targetIdx = names.indexOf(target.name);
            if (draggedIdx === -1 || targetIdx === -1) return;

            const newNames = [...names];
            newNames.splice(draggedIdx, 1);
            const insertIdx = position === 'before'
                ? newNames.indexOf(target.name)
                : newNames.indexOf(target.name) + 1;
            newNames.splice(insertIdx, 0, dragged.name);

            try {
                await reorderNodes(draggedParent, newNames);
            } catch {
                // API error — tree already refreshed
            }
        } else {
            // Cross-parent move: place dragged into target's parent directory
            const newPath = targetParent ? `${targetParent}/${dragged.name}` : dragged.name;
            try {
                await renameNode(dragged.path, newPath);
                onNoteRenamed?.(dragged.path, newPath);
            } catch {
                // Rename failed
            }
        }
    }, [tree, renameNode, reorderNodes, onNoteRenamed]);

    const buildContextMenuItems = (): ContextMenuItem[] => {
        if (!ctxMenu) return [];
        const { node } = ctxMenu;

        // Root-level context menu (right-click on empty space)
        if (node.path === '' && node.name === '') {
            return [
                { label: 'New Notebook', onClick: () => openDialog('create-notebook', node) },
                { label: 'New Note', onClick: () => openDialog('create-page', node) },
            ];
        }

        const isFolder = node.type === 'notebook' || node.type === 'section';
        const isSys = systemFolders.includes(node.name) && node.type === 'notebook';

        if (isFolder) {
            const items: ContextMenuItem[] = [
                { label: 'Copy Path', onClick: () => { void navigator.clipboard.writeText(node.path); closeContextMenu(); } },
                { label: 'Copy Link', onClick: () => { void navigator.clipboard.writeText(`[[note:${node.path}/]]`); closeContextMenu(); } },
                { label: 'Copy Absolute Path', onClick: () => { if (notesRoot) void navigator.clipboard.writeText(notesRoot + '/' + node.path); closeContextMenu(); } },
                { separator: true, label: '', onClick: () => {} },
                { label: 'Create Page', onClick: () => openDialog('create-page', node) },
                { label: 'Create Section', onClick: () => openDialog('create-section', node) },
            ];
            if (!isSys) {
                items.push(
                    { separator: true, label: '', onClick: () => {} },
                    { label: 'Rename', onClick: () => openDialog('rename', node) },
                    { label: 'Delete', onClick: () => openDialog('delete', node) },
                );
            }
            return items;
        }
        return [
            { label: 'Copy Path', onClick: () => { void navigator.clipboard.writeText(node.path); closeContextMenu(); } },
            { label: 'Copy Link', onClick: () => { void navigator.clipboard.writeText(`[[note:${node.path}]]`); closeContextMenu(); } },
            { label: 'Copy Absolute Path', onClick: () => { if (notesRoot) void navigator.clipboard.writeText(notesRoot + '/' + node.path); closeContextMenu(); } },
            { separator: true, label: '', onClick: () => {} },
            { label: 'Rename', onClick: () => openDialog('rename', node) },
            { label: 'Delete', onClick: () => openDialog('delete', node) },
        ];
    };

    return (
        <div className="flex flex-col h-full" data-testid="notes-sidebar">
            {/* Toolbar */}
            <div className="h-10 flex items-center gap-1 px-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onGoBack}
                    disabled={!canGoBack}
                    data-testid="notes-back-btn"
                    aria-label="Go to previous note"
                    title="Go to previous note"
                    className={!canGoBack ? 'opacity-40 cursor-not-allowed' : ''}
                >
                    ←
                </Button>
                <span className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc] flex-1">Notes</span>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={refresh}
                    disabled={loading}
                    data-testid="refresh-notes-btn"
                    aria-label="Refresh Notes"
                    title="Refresh Notes"
                >
                    ↻
                </Button>
                <div className="relative" ref={addDropdownRef}>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setAddDropdownOpen(prev => !prev)}
                        data-testid="add-note-btn"
                        aria-label="Add"
                        title="Add"
                    >
                        + ▾
                    </Button>
                    {addDropdownOpen && (
                        <div
                            className="absolute right-0 top-full mt-1 z-30 min-w-[180px] bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded shadow-lg py-1"
                            data-testid="add-note-dropdown"
                        >
                            <button
                                className="w-full text-left px-3 py-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e]"
                                onClick={handleNewNotebook}
                                data-testid="add-note-new-notebook"
                            >
                                📓 New Notebook
                            </button>
                            <button
                                className={`w-full text-left px-3 py-1.5 text-xs ${
                                    findCurrentNotebook()
                                        ? 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e]'
                                        : 'text-[#999] dark:text-[#555] cursor-not-allowed'
                                }`}
                                onClick={handleNewPage}
                                disabled={!findCurrentNotebook()}
                                data-testid="add-note-new-page"
                            >
                                📄 New Page
                            </button>
                            <button
                                className="w-full text-left px-3 py-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e]"
                                onClick={handleNewPageWithAI}
                                data-testid="add-note-ai-create"
                            >
                                🤖 New Page with AI…
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Tree area */}
            <div className="flex-1 overflow-y-auto py-1" data-testid="notes-tree-area" onContextMenu={handleBackgroundContextMenu}>
                {loading && (
                    <div className="flex items-center justify-center py-6" data-testid="notes-loading">
                        <Spinner size="md" />
                    </div>
                )}

                {error && !loading && (
                    <div className="py-6 px-4 text-center text-xs text-red-500 dark:text-red-400" data-testid="notes-error">
                        {error}
                    </div>
                )}

                {!loading && !error && tree && tree.length === 0 && (
                    <div className="py-6 px-4 text-center text-xs text-[#848484] dark:text-[#666] italic" data-testid="notes-empty">
                        No notebooks yet
                    </div>
                )}

                {!loading && !error && tree && tree.length > 0 && (
                    <NotesTree
                        nodes={tree}
                        selectedPath={selectedPath}
                        expandedPaths={expandedPaths}
                        systemFolders={systemFolders}
                        onToggleExpand={handleToggleExpand}
                        onSelectPage={onSelectPage}
                        onContextMenu={handleContextMenu}
                        dragDrop={{
                            createDragStartHandler: dragDrop.createDragStartHandler,
                            createDragEndHandler: dragDrop.createDragEndHandler,
                            createDragOverHandler: dragDrop.createDragOverHandler,
                            createDragEnterHandler: dragDrop.createDragEnterHandler,
                            createDragLeaveHandler: dragDrop.createDragLeaveHandler,
                            createDropHandler: dragDrop.createDropHandler,
                            dropTargetPath: dragDrop.dropTargetPath,
                            dropPosition: dragDrop.dropPosition,
                            onDrop: handleNoteDrop,
                        }}
                    />
                )}
            </div>

            {/* Context menu */}
            {ctxMenu && (
                <ContextMenu
                    position={{ x: ctxMenu.x, y: ctxMenu.y }}
                    items={buildContextMenuItems()}
                    onClose={closeContextMenu}
                />
            )}

            {/* Dialogs */}
            <NotesDialogs
                dialog={dialog}
                onClose={closeDialog}
                onCreateNode={handleCreateNode}
                onRenameNode={handleRenameNode}
                onDeleteNode={handleDeleteNode}
                onAICreateNote={handleAICreateNote}
                setSubmitting={setSubmitting}
            />
        </div>
    );
}
