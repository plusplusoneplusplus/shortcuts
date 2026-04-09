import { useState, useCallback, useEffect, useRef } from 'react';
import type { NoteTreeNode } from '../notesApi';
import type { ContextMenuItem } from '../../tasks/comments/ContextMenu';
import { ContextMenu } from '../../tasks/comments/ContextMenu';
import { Button } from '../../shared/Button';
import { Spinner } from '../../shared/Spinner';
import { NotesTree } from './NotesTree';
import { NotesDialogs } from './NotesDialogs';
import { useNotesTree } from './useNotesTree';
import { useNotesContextMenu, type NoteDialogAction } from './useNotesContextMenu';

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
}

export function NotesSidebar({ workspaceId, selectedPath, onSelectPage, onNoteRenamed, onNoteCreated, onNoteDeleted }: NotesSidebarProps) {
    const { tree, loading, error, createNode, renameNode, deleteNode } = useNotesTree(workspaceId);
    const { ctxMenu, dialog, openContextMenu, closeContextMenu, openDialog, closeDialog, setSubmitting } = useNotesContextMenu();
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
    const deepLinkAppliedRef = useRef<string | null>(null);

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

    const handleNewNotebook = useCallback(() => {
        openDialog('create-notebook', { name: '', path: '', type: 'notebook' });
    }, [openDialog]);

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

    const buildContextMenuItems = (): ContextMenuItem[] => {
        if (!ctxMenu) return [];
        const { node } = ctxMenu;
        const isFolder = node.type === 'notebook' || node.type === 'section';

        if (isFolder) {
            return [
                { label: 'Create Page', onClick: () => openDialog('create-page', node) },
                { label: 'Create Section', onClick: () => openDialog('create-section', node) },
                { separator: true, label: '', onClick: () => {} },
                { label: 'Rename', onClick: () => openDialog('rename', node) },
                { label: 'Delete', onClick: () => openDialog('delete', node) },
            ];
        }
        return [
            { label: 'Rename', onClick: () => openDialog('rename', node) },
            { label: 'Delete', onClick: () => openDialog('delete', node) },
        ];
    };

    return (
        <div className="flex flex-col h-full" data-testid="notes-sidebar">
            {/* Toolbar */}
            <div className="h-10 flex items-center px-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <span className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc] flex-1">Notes</span>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleNewNotebook}
                    data-testid="new-notebook-btn"
                    aria-label="New Notebook"
                    title="New Notebook"
                >
                    + Notebook
                </Button>
            </div>

            {/* Tree area */}
            <div className="flex-1 overflow-y-auto py-1">
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
                        onToggleExpand={handleToggleExpand}
                        onSelectPage={onSelectPage}
                        onContextMenu={handleContextMenu}
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
                setSubmitting={setSubmitting}
            />
        </div>
    );
}
