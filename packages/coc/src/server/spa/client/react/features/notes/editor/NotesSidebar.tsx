import { useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from 'react';
import type { NoteTreeNode } from '../notesApi';
import type { ContextMenuItem } from '../../../tasks/comments/ContextMenu';
import { ContextMenu } from '../../../tasks/comments/ContextMenu';
import { Spinner } from '../../../ui/Spinner';
import { NotesTree } from './NotesTree';
import { NotesDialogs } from './NotesDialogs';
import { useNotesTree } from './useNotesTree';
import { useNotesContextMenu } from './useNotesContextMenu';
import { useNotesDragDrop, getNotesParentPath, type NoteDragItem, type DropPosition } from '../hooks/useNotesDragDrop';
import { useNoteSeenState } from '../hooks/useNoteSeenState';
import { useNotesSelection } from '../hooks/useNotesSelection';
import { getSpaCocClient } from '../../../api/cocClient';
import { notesApi } from '../notesApi';
import { useGlobalToast } from '../../../contexts/ToastContext';

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

/** Recursively count `page` nodes inside the subtree (excluding the root node itself). */
function countDescendantPages(node: NoteTreeNode): number {
    if (!node.children || node.children.length === 0) return 0;
    let total = 0;
    for (const child of node.children) {
        if (child.type === 'page') total += 1;
        else total += countDescendantPages(child);
    }
    return total;
}

/** Sum of pages across the entire top-level tree. */
function countTotalPages(tree: NoteTreeNode[]): number {
    let total = 0;
    const walk = (nodes: NoteTreeNode[]) => {
        for (const n of nodes) {
            if (n.type === 'page') total += 1;
            else if (n.children) walk(n.children);
        }
    };
    walk(tree);
    return total;
}

/**
 * Flatten the tree into an ordered list of page paths respecting expanded state
 * and optional visibility filter. Folder nodes are excluded from the result.
 */
export function flattenVisiblePagePaths(
    nodes: NoteTreeNode[],
    expandedPaths: Set<string>,
    visiblePaths?: Set<string> | null,
): string[] {
    const result: string[] = [];
    const walk = (children: NoteTreeNode[]) => {
        for (const node of children) {
            if (visiblePaths && !visiblePaths.has(node.path)) continue;
            if (node.type === 'page') {
                result.push(node.path);
            } else if (expandedPaths.has(node.path) && node.children) {
                walk(node.children);
            }
        }
    };
    walk(nodes);
    return result;
}

/** Count of page nodes that the seen-state hook marks as updated. */
function countUpdatedPages(tree: NoteTreeNode[], isUpdated: (node: NoteTreeNode) => boolean): number {
    let total = 0;
    const walk = (nodes: NoteTreeNode[]) => {
        for (const n of nodes) {
            if (n.type === 'page') {
                if (isUpdated(n)) total += 1;
            } else if (n.children) walk(n.children);
        }
    };
    walk(tree);
    return total;
}

interface VisibilityFilter {
    visible: Set<string>;
    expand: Set<string>;
}

/**
 * Build a search-driven visibility filter. A node is visible if its name
 * matches the query or any descendant matches. Ancestors of any match are
 * expanded so the user can actually see the hits.
 */
function buildVisibilityFilter(tree: NoteTreeNode[], query: string): VisibilityFilter | null {
    const q = query.trim().toLowerCase();
    if (!q) return null;

    const visible = new Set<string>();
    const expand = new Set<string>();

    const walk = (nodes: NoteTreeNode[], ancestors: string[]): boolean => {
        let anyMatch = false;
        for (const n of nodes) {
            const nameMatch = n.name.toLowerCase().includes(q);
            const childMatch = n.children ? walk(n.children, [...ancestors, n.path]) : false;
            if (nameMatch || childMatch) {
                visible.add(n.path);
                if (childMatch) expand.add(n.path);
                for (const a of ancestors) {
                    visible.add(a);
                    expand.add(a);
                }
                anyMatch = true;
            }
        }
        return anyMatch;
    };
    walk(tree, []);
    return { visible, expand };
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
    /** Restores the active note editor after focus-preserving copy actions. */
    onRestoreEditorFocus?: () => void;
    /** Ref populated with a callback that marks the currently selected note as seen. */
    markSeenRef?: React.RefObject<(() => void) | null>;
    /** Whether the current root is the default managed root. Defaults to true. */
    isDefaultRoot?: boolean;
    /** The selected root ID to pass to the tree fetch ('default' or a relative path). */
    selectedRootId?: string;
    /** Display label for the currently selected root. */
    selectedRootLabel?: string;
    /** All available roots for the dropdown. */
    roots?: import('../notesApi').NotesRootEntry[];
    /** Callback when the user selects a different root. */
    onSelectRoot?: (rootId: string) => void;
    /** Callback after root configuration changes so the parent can refresh useNotesRoots state. */
    onRootsChanged?: () => void | Promise<void>;
    /**
     * Optional element pinned to the very bottom of the sidebar column (below
     * the note tree). Used by the remote-first shell to dock the status/action
     * cluster here so the note editor pane keeps full height instead of the
     * app-wide `GlobalStatusDock` painting a partial-width band beside it.
     */
    footer?: ReactNode;
}

export function NotesSidebar({ workspaceId, selectedPath, onSelectPage, onNoteRenamed, onNoteCreated, onNoteDeleted, canGoBack, onGoBack, onNotesRootReady, onRestoreEditorFocus, markSeenRef, isDefaultRoot = true, selectedRootId, selectedRootLabel, roots, onSelectRoot, onRootsChanged, footer }: NotesSidebarProps) {
    const { addToast } = useGlobalToast();
    const rootParam = selectedRootId && selectedRootId !== 'default' ? selectedRootId : undefined;
    const { tree, notesRoot, systemFolders, loading, error, refresh, createNode, renameNode, deleteNode, reorderNodes } = useNotesTree(workspaceId, rootParam);
    const { isNoteUpdated, markAsSeen, syncSeenState } = useNoteSeenState(workspaceId);
    const { ctxMenu, dialog, openContextMenu, closeContextMenu, openDialog, closeDialog, setSubmitting } = useNotesContextMenu();
    const { selectedPaths: multiSelectedPaths, handleSelect: handleMultiSelect, clearSelection } = useNotesSelection();
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [gitInitialized, setGitInitialized] = useState(false);
    const deepLinkAppliedRef = useRef<string | null>(null);
    const dragDrop = useNotesDragDrop();
    const [addDropdownOpen, setAddDropdownOpen] = useState(false);
    const addDropdownRef = useRef<HTMLDivElement>(null);
    const treeAreaRef = useRef<HTMLDivElement>(null);
    const [rootDropdownOpen, setRootDropdownOpen] = useState(false);
    const rootDropdownRef = useRef<HTMLDivElement>(null);
    const hasMultipleRoots = roots && roots.length > 1;
    const [selectedRootIdsForRemoval, setSelectedRootIdsForRemoval] = useState<Set<string>>(new Set());
    const [rootSelectionAnchor, setRootSelectionAnchor] = useState<string | null>(null);
    const [removingSelectedRoots, setRemovingSelectedRoots] = useState(false);
    const orderedRootIds = useMemo(() => roots?.map(r => r.rootId) ?? [], [roots]);
    const removableRootIds = useMemo(
        () => new Set((roots ?? []).filter(r => !r.isDefault && !r.isProtected).map(r => r.rootId)),
        [roots],
    );
    const removableSelectionCount = useMemo(
        () => [...selectedRootIdsForRemoval].filter(id => removableRootIds.has(id)).length,
        [removableRootIds, selectedRootIdsForRemoval],
    );

    useEffect(() => {
        if (rootDropdownOpen) return;
        setSelectedRootIdsForRemoval(prev => prev.size === 0 ? prev : new Set());
        setRootSelectionAnchor(null);
    }, [rootDropdownOpen]);

    // Close root dropdown on outside click
    useEffect(() => {
        if (!rootDropdownOpen) return;
        function handleClickOutside(e: MouseEvent) {
            if (rootDropdownRef.current && !rootDropdownRef.current.contains(e.target as Node)) {
                setRootDropdownOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [rootDropdownOpen]);

    // Close root dropdown on Escape
    useEffect(() => {
        if (!rootDropdownOpen) return;
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') setRootDropdownOpen(false);
        }
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [rootDropdownOpen]);

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

    useEffect(() => {
        if (tree) syncSeenState(tree);
    }, [tree, syncSeenState]);

    useEffect(() => {
        if (selectedPath) markAsSeen(selectedPath);
    }, [selectedPath, markAsSeen]);

    // Expose markAsSeen for the currently selected path so parent can dismiss the update dot on click
    useEffect(() => {
        if (!markSeenRef) return;
        (markSeenRef as React.MutableRefObject<(() => void) | null>).current = () => {
            if (selectedPath) markAsSeen(selectedPath);
        };
        return () => { (markSeenRef as React.MutableRefObject<(() => void) | null>).current = null; };
    }, [markSeenRef, selectedPath, markAsSeen]);

    // One-shot fetch of notes git status for the "tracked" meta pill.
    // Only fetched for the default managed root — repo-folder roots have no separate git tracking.
    // Refreshed when the server emits `notes-changed` for this workspace.
    useEffect(() => {
        if (!isDefaultRoot) {
            setGitInitialized(false);
            return;
        }
        let cancelled = false;
        const fetchStatus = () => {
            notesApi.getGitStatus(workspaceId)
                .then(s => { if (!cancelled) setGitInitialized(Boolean(s?.initialized)); })
                .catch(() => { /* silently ignore — pill simply stays hidden */ });
        };
        fetchStatus();
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { wsId?: string } | undefined;
            if (detail?.wsId !== workspaceId) return;
            fetchStatus();
        };
        window.addEventListener('notes-changed', handler);
        return () => {
            cancelled = true;
            window.removeEventListener('notes-changed', handler);
        };
    }, [workspaceId, isDefaultRoot]);

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
            const res = await notesApi.createWithAI(workspaceId, prompt);
            const taskId = res?.taskId;
            if (!taskId) return;

            // Poll the process for completion and navigate to the new note
            const processId = `queue_${taskId}`;
            const pollInterval = setInterval(async () => {
                try {
                    const procRes = await getSpaCocClient().processes.get(processId);
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
        const created = await createNode(parentPath, name, type);
        if (type === 'page') {
            onNoteCreated?.(created.path);
        }
    }, [createNode, onNoteCreated]);

    const handleRenameNode = useCallback(async (oldPath: string, newPath: string) => {
        const renamed = await renameNode(oldPath, newPath);
        onNoteRenamed?.(renamed.oldPath, renamed.newPath);
    }, [renameNode, onNoteRenamed]);

    const handleDeleteNode = useCallback(async (path: string) => {
        await deleteNode(path);
        onNoteDeleted?.(path);
    }, [deleteNode, onNoteDeleted]);

    const copyTextAndRestoreFocus = useCallback((text: string | null) => {
        if (text !== null) void navigator.clipboard.writeText(text);
        closeContextMenu();
        onRestoreEditorFocus?.();
    }, [closeContextMenu, onRestoreEditorFocus]);

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
                const renamed = await renameNode(dragged.path, newPath);
                onNoteRenamed?.(renamed.oldPath, renamed.newPath);
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
                const renamed = await renameNode(dragged.path, newPath);
                onNoteRenamed?.(renamed.oldPath, renamed.newPath);
            } catch {
                // Rename failed
            }
        }
    }, [tree, renameNode, reorderNodes, onNoteRenamed]);

    const buildContextMenuItems = (): ContextMenuItem[] => {
        if (!ctxMenu) return [];
        const { node } = ctxMenu;

        // Multi-selection context menu: show bulk actions when right-clicking a selected item
        if (multiSelectedPaths.size > 1 && multiSelectedPaths.has(node.path)) {
            return [
                { label: `Delete Selected (${multiSelectedPaths.size})`, onClick: () => void handleBulkDelete() },
            ];
        }

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
                { label: 'Copy Path', onClick: () => copyTextAndRestoreFocus(node.path) },
                { label: 'Copy Link', onClick: () => copyTextAndRestoreFocus(`[[note:${node.path}/]]`) },
                { label: 'Copy Absolute Path', onClick: () => copyTextAndRestoreFocus(notesRoot ? notesRoot + '/' + node.path : null) },
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
            { label: 'Copy Path', onClick: () => copyTextAndRestoreFocus(node.path) },
            { label: 'Copy Link', onClick: () => copyTextAndRestoreFocus(`[[note:${node.path}]]`) },
            { label: 'Copy Absolute Path', onClick: () => copyTextAndRestoreFocus(notesRoot ? notesRoot + '/' + node.path : null) },
            { separator: true, label: '', onClick: () => {} },
            { label: 'Rename', onClick: () => openDialog('rename', node) },
            { label: 'Delete', onClick: () => openDialog('delete', node) },
        ];
    };

    // ── Derived values for the redesigned header / meta row ────────────────

    const totalPages = useMemo(() => (tree ? countTotalPages(tree) : 0), [tree]);
    const updatedCount = useMemo(
        () => (tree ? countUpdatedPages(tree, isNoteUpdated) : 0),
        [tree, isNoteUpdated],
    );

    const filter = useMemo(
        () => (tree ? buildVisibilityFilter(tree, searchQuery) : null),
        [tree, searchQuery],
    );

    /** Combined expansion set: user-controlled plus search-driven expansion. */
    const effectiveExpanded = useMemo(() => {
        if (!filter) return expandedPaths;
        const combined = new Set(expandedPaths);
        for (const p of filter.expand) combined.add(p);
        return combined;
    }, [filter, expandedPaths]);

    /** Ordered list of visible page paths for range-selection computation. */
    const flatPageList = useMemo(
        () => (tree ? flattenVisiblePagePaths(tree, effectiveExpanded, filter?.visible ?? null) : []),
        [tree, effectiveExpanded, filter],
    );

    /** Handler for Shift/Ctrl+Click on page items (multi-selection). */
    const handleSelectWithModifiers = useCallback((path: string, shiftKey: boolean, ctrlKey: boolean) => {
        handleMultiSelect(path, { shift: shiftKey, ctrl: ctrlKey }, flatPageList);
    }, [handleMultiSelect, flatPageList]);

    const handleRootOptionClick = useCallback((rootId: string, isProtected: boolean, e: React.MouseEvent<HTMLButtonElement>) => {
        const hasModifier = e.shiftKey || e.ctrlKey || e.metaKey;
        if (!hasModifier) {
            onSelectRoot?.(rootId);
            setRootSelectionAnchor(rootId);
            setSelectedRootIdsForRemoval(new Set());
            setRootDropdownOpen(false);
            return;
        }

        e.preventDefault();
        if (isProtected) {
            return;
        }
        if (e.shiftKey) {
            const anchor = rootSelectionAnchor && orderedRootIds.includes(rootSelectionAnchor)
                ? rootSelectionAnchor
                : selectedRootId;
            const anchorIndex = anchor ? orderedRootIds.indexOf(anchor) : -1;
            const targetIndex = orderedRootIds.indexOf(rootId);
            if (anchorIndex === -1 || targetIndex === -1) {
                return;
            }

            const start = Math.min(anchorIndex, targetIndex);
            const end = Math.max(anchorIndex, targetIndex);
            const range = orderedRootIds.slice(start, end + 1);
            setSelectedRootIdsForRemoval(prev => {
                const next = new Set(prev);
                for (const id of range) {
                    if (removableRootIds.has(id)) {
                        next.add(id);
                    }
                }
                return next;
            });
            return;
        }

        setRootSelectionAnchor(rootId);
        setSelectedRootIdsForRemoval(prev => {
            const next = new Set(prev);
            if (next.has(rootId)) {
                next.delete(rootId);
            } else {
                next.add(rootId);
            }
            return next;
        });
    }, [onSelectRoot, orderedRootIds, removableRootIds, rootSelectionAnchor, selectedRootId]);

    const handleRefreshNotes = useCallback(async () => {
        await Promise.allSettled([
            refresh(),
            Promise.resolve(onRootsChanged?.()),
        ]);
    }, [onRootsChanged, refresh]);

    const handleRemoveSelectedRoots = useCallback(async () => {
        if (removingSelectedRoots) {
            return;
        }
        const selectedIds = [...selectedRootIdsForRemoval].filter(id => removableRootIds.has(id));
        if (selectedIds.length === 0) {
            return;
        }

        setRemovingSelectedRoots(true);
        let removedCount = 0;
        const removedIds: string[] = [];
        const failures: string[] = [];

        for (const rootId of selectedIds) {
            try {
                await notesApi.removeRoot(workspaceId, rootId);
                removedCount += 1;
                removedIds.push(rootId);
            } catch (error) {
                failures.push(error instanceof Error && error.message
                    ? error.message
                    : `Failed to remove root '${rootId}'`);
            }
        }

        try {
            if (removedCount > 0) {
                if (selectedRootId && removedIds.includes(selectedRootId)) {
                    onSelectRoot?.('default');
                }
                await onRootsChanged?.();
                addToast(`Removed ${removedCount} note collection${removedCount === 1 ? '' : 's'}`, 'success');
            }

            for (const failure of failures) {
                addToast(failure, 'error');
            }
        } finally {
            setSelectedRootIdsForRemoval(new Set());
            setRootSelectionAnchor(null);
            setRemovingSelectedRoots(false);
        }
    }, [addToast, onRootsChanged, onSelectRoot, removableRootIds, removingSelectedRoots, selectedRootId, selectedRootIdsForRemoval, workspaceId]);

    /** Wraps onSelectPage to also clear multi-selection on plain click. */
    const handleSelectPage = useCallback((path: string) => {
        clearSelection();
        onSelectPage(path);
    }, [clearSelection, onSelectPage]);

    /** Bulk delete all multi-selected pages. */
    const handleBulkDelete = useCallback(async () => {
        const paths = [...multiSelectedPaths];
        closeContextMenu();
        for (const p of paths) {
            await deleteNode(p);
            onNoteDeleted?.(p);
        }
        clearSelection();
    }, [multiSelectedPaths, closeContextMenu, deleteNode, onNoteDeleted, clearSelection]);

    return (
        <div className="flex flex-col h-full bg-[#f6f8fa] dark:bg-[#252526]" data-testid="notes-sidebar">
            {/* Panel header — back / title / refresh / primary "New" button */}
            <div className="flex items-center min-h-[36px] px-2 py-1 gap-1.5 border-b border-[#d0d7de] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e]">
                <button
                    type="button"
                    className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-transparent text-[#1f2328] dark:text-[#cccccc] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2d2e] disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={onGoBack}
                    disabled={!canGoBack}
                    aria-label="Previous note"
                    title="Previous note"
                    data-testid="notes-back-btn"
                >
                    <svg className="w-4 h-4" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10 12L6 8l4-4" />
                    </svg>
                </button>
                {/* Root selector — dropdown when multiple roots, static label when single */}
                {hasMultipleRoots ? (
                    <div className="relative flex-1 min-w-0" ref={rootDropdownRef}>
                        <button
                            type="button"
                            className="flex items-center gap-1 max-w-full text-[13px] font-semibold text-[#1f2328] dark:text-[#cccccc] truncate hover:bg-[#f6f8fa] dark:hover:bg-[#2a2d2e] rounded-md px-1.5 py-0.5"
                            onClick={() => setRootDropdownOpen(prev => !prev)}
                            aria-haspopup="listbox"
                            aria-expanded={rootDropdownOpen}
                            data-testid="notes-root-selector"
                            title={`Current root: ${selectedRootLabel ?? 'Notes'}`}
                        >
                            <span className="truncate">{selectedRootLabel ?? 'Notes'}</span>
                            <svg className="w-3 h-3 flex-shrink-0 opacity-60" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M4 6l4 4 4-4" />
                            </svg>
                        </button>
                        {rootDropdownOpen && (
                            <div
                                className="absolute left-0 top-full mt-1 z-30 min-w-[180px] max-w-[300px] bg-white dark:bg-[#252526] border border-[#d0d7de] dark:border-[#3c3c3c] rounded-md shadow-[0_8px_24px_rgba(140,149,159,0.2)] py-1"
                                role="listbox"
                                data-testid="notes-root-dropdown"
                            >
                                {roots!.map(r => {
                                    const selectedForRemoval = removableRootIds.has(r.rootId)
                                        && selectedRootIdsForRemoval.has(r.rootId);
                                    const isActive = r.rootId === selectedRootId;
                                    const isProtected = r.isDefault || Boolean(r.isProtected);
                                    const protectedReason = r.isDefault
                                        ? 'Default managed root cannot be removed'
                                        : 'Managed through Task/Plans settings and cannot be removed';
                                    return (
                                        <button
                                            key={r.rootId}
                                            className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs truncate ${
                                                selectedForRemoval
                                                    ? 'bg-[#fff8c5] dark:bg-[#5a3b00]/30 text-[#1f2328] dark:text-[#ffdf5d] font-semibold'
                                                    : isActive
                                                        ? 'bg-[#ddf4ff] dark:bg-[#0a3b66]/40 text-[#0969da] dark:text-[#79c0ff] font-semibold'
                                                        : 'text-[#1f2328] dark:text-[#cccccc] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2d2e]'
                                            }`}
                                            role="option"
                                            aria-selected={isActive}
                                            aria-label={`${r.label}${isActive ? ', current root' : ''}${isProtected ? `, ${protectedReason.toLowerCase()}` : selectedForRemoval ? ', selected for removal' : ''}`}
                                            onClick={(e) => handleRootOptionClick(r.rootId, isProtected, e)}
                                            data-testid={`notes-root-option-${r.rootId}`}
                                            data-removal-selected={selectedForRemoval ? 'true' : undefined}
                                            title={isProtected ? protectedReason : r.rootId}
                                        >
                                            <span className="min-w-0 flex items-center gap-1 truncate">
                                                <span aria-hidden="true">{r.isDefault ? '📓' : '📁'}</span>
                                                <span className="truncate">{r.label}</span>
                                            </span>
                                            <span className="flex-shrink-0 text-[11px] text-[#656d76] dark:text-[#9d9d9d]">
                                                {selectedForRemoval ? (
                                                    <span data-testid={`notes-root-selected-check-${r.rootId}`} aria-hidden="true">✓</span>
                                                ) : isProtected ? (
                                                    <span data-testid={`notes-root-protected-${r.rootId}`} title={protectedReason} aria-label="Protected root">🔒</span>
                                                ) : isActive ? (
                                                    <span>Current</span>
                                                ) : null}
                                            </span>
                                        </button>
                                    );
                                })}
                                {removableSelectionCount > 0 && (
                                    <div className="mt-1 pt-1 border-t border-[#d0d7de] dark:border-[#3c3c3c]">
                                        <button
                                            type="button"
                                            className="w-full px-3 py-1.5 text-left text-xs font-semibold text-[#cf222e] dark:text-[#ff7b72] hover:bg-[#ffebe9] dark:hover:bg-[#3c1f1f] disabled:opacity-60 disabled:cursor-not-allowed"
                                            onClick={() => void handleRemoveSelectedRoots()}
                                            disabled={removingSelectedRoots}
                                            data-testid="notes-root-remove-selected"
                                        >
                                            {removingSelectedRoots ? 'Removing…' : `Remove selected (${removableSelectionCount})`}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <span className="flex-1 min-w-0 text-[13px] font-semibold text-[#1f2328] dark:text-[#cccccc] truncate">
                        Notes
                    </span>
                )}
                <button
                    type="button"
                    className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-transparent text-[#1f2328] dark:text-[#cccccc] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2d2e] disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={() => void handleRefreshNotes()}
                    disabled={loading}
                    aria-label="Refresh Notes"
                    title="Refresh Notes"
                    data-testid="refresh-notes-btn"
                >
                    <svg className="w-4 h-4" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M13 8a5 5 0 1 1-1.46-3.54" />
                        <path d="M13 3.5V7h-3.5" />
                    </svg>
                </button>
                <div className="relative" ref={addDropdownRef}>
                    <button
                        type="button"
                        className="inline-flex items-center justify-center gap-1.5 min-h-[28px] px-2.5 rounded-md border border-black/15 bg-[#1f883d] text-white text-[13px] font-semibold leading-none shadow-[0_1px_0_rgba(31,35,40,0.1)] hover:bg-[#1a7f37] disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => setAddDropdownOpen(prev => !prev)}
                        data-testid="add-note-btn"
                        aria-label="New"
                        aria-haspopup="menu"
                        aria-expanded={addDropdownOpen}
                        title="New"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 8h10M8 3v10" />
                        </svg>
                        <span>New</span>
                    </button>
                    {addDropdownOpen && (
                        <div
                            className="absolute right-0 top-full mt-1 z-30 min-w-[200px] bg-white dark:bg-[#252526] border border-[#d0d7de] dark:border-[#3c3c3c] rounded-md shadow-[0_8px_24px_rgba(140,149,159,0.2)] py-1"
                            data-testid="add-note-dropdown"
                            role="menu"
                        >
                            <button
                                className="w-full text-left px-3 py-1.5 text-xs text-[#1f2328] dark:text-[#cccccc] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2d2e]"
                                onClick={handleNewNotebook}
                                data-testid="add-note-new-notebook"
                                role="menuitem"
                            >
                                📓 New Notebook
                            </button>
                            <button
                                className={`w-full text-left px-3 py-1.5 text-xs ${
                                    findCurrentNotebook()
                                        ? 'text-[#1f2328] dark:text-[#cccccc] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2d2e]'
                                        : 'text-[#8c959f] dark:text-[#555] cursor-not-allowed'
                                }`}
                                onClick={handleNewPage}
                                disabled={!findCurrentNotebook()}
                                data-testid="add-note-new-page"
                                role="menuitem"
                            >
                                📄 New Page
                            </button>
                            <button
                                className={`w-full text-left px-3 py-1.5 text-xs ${
                                    isDefaultRoot
                                        ? 'text-[#1f2328] dark:text-[#cccccc] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2d2e]'
                                        : 'text-[#8c959f] dark:text-[#555] cursor-not-allowed'
                                }`}
                                onClick={handleNewPageWithAI}
                                disabled={!isDefaultRoot}
                                data-testid="add-note-ai-create"
                                role="menuitem"
                                title={!isDefaultRoot ? 'New Page with AI is available only in the managed Notes collection' : undefined}
                            >
                                🤖 New Page with AI…
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Search */}
            <div className="px-2 py-1.5 border-b border-[#d8dee4] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e]">
                <div className="relative flex items-center">
                    <svg
                        className="pointer-events-none absolute left-2 w-3.5 h-3.5 text-[#656d76] dark:text-[#9d9d9d]"
                        viewBox="0 0 16 16"
                        aria-hidden="true"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <circle cx="7" cy="7" r="4.25" />
                        <path d="M10.3 10.3L13 13" />
                    </svg>
                    <input
                        type="search"
                        placeholder="Search notes"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full h-7 pl-7 pr-2 rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[13px] text-[#1f2328] dark:text-[#cccccc] outline-none focus:border-[#0969da] dark:focus:border-[#3794ff] focus:shadow-[0_0_0_3px_rgba(9,105,218,0.18)]"
                        aria-label="Search notes"
                        data-testid="notes-search-input"
                    />
                </div>
            </div>

            {/* Meta row — counts + tracked status */}
            <div
                className="flex items-center gap-1 px-2 py-1.5 border-b border-[#eaeef2] dark:border-[#3c3c3c] bg-[#f6f8fa] dark:bg-[#252526]"
                data-testid="notes-tree-meta"
            >
                {updatedCount > 0 && (
                    <span
                        className="inline-flex items-center gap-1 min-h-[18px] px-1.5 rounded-full border border-[#b6e3ff] dark:border-[#3a567e] bg-[#ddf4ff] dark:bg-[#0a3b66]/40 text-[#0969da] dark:text-[#79c0ff] text-[12px] whitespace-nowrap"
                        data-testid="notes-updated-pill"
                    >
                        {updatedCount} updated
                    </span>
                )}
                <span
                    className="inline-flex items-center gap-1 min-h-[18px] px-1.5 rounded-full border border-[#d8dee4] dark:border-[#3c3c3c] bg-white dark:bg-transparent text-[#656d76] dark:text-[#9d9d9d] text-[12px] whitespace-nowrap"
                    data-testid="notes-pages-pill"
                >
                    {totalPages} {totalPages === 1 ? 'page' : 'pages'}
                </span>
                {gitInitialized && (
                    <span
                        className="inline-flex items-center gap-1 min-h-[18px] px-1.5 rounded-full border border-[#aceebb] dark:border-[#2ea043]/40 bg-[#dafbe1] dark:bg-[#0f5132]/30 text-[#1a7f37] dark:text-[#56d364] text-[12px] whitespace-nowrap"
                        data-testid="notes-tracked-pill"
                        title="Notes are tracked by git"
                    >
                        tracked
                    </span>
                )}
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
                    <div className="py-6 px-4 text-center text-xs text-[#656d76] dark:text-[#666] italic" data-testid="notes-empty">
                        No notebooks yet
                    </div>
                )}

                {!loading && !error && tree && tree.length > 0 && (
                    <NotesTree
                        nodes={tree}
                        selectedPath={selectedPath}
                        expandedPaths={effectiveExpanded}
                        systemFolders={systemFolders}
                        onToggleExpand={handleToggleExpand}
                        onSelectPage={handleSelectPage}
                        onContextMenu={handleContextMenu}
                        isNoteUpdated={isNoteUpdated}
                        visiblePaths={filter?.visible ?? null}
                        countDescendantPages={countDescendantPages}
                        multiSelectedPaths={multiSelectedPaths}
                        onSelectWithModifiers={handleSelectWithModifiers}
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

                {!loading && !error && tree && tree.length > 0 && filter && filter.visible.size === 0 && (
                    <div className="py-6 px-4 text-center text-xs text-[#656d76] dark:text-[#9d9d9d] italic" data-testid="notes-search-empty">
                        No notes match “{searchQuery.trim()}”
                    </div>
                )}
            </div>

            {/* Multi-selection footer badge */}
            {multiSelectedPaths.size > 1 && (
                <div
                    className="flex items-center gap-1.5 px-2 py-1.5 border-t border-[#d0d7de] dark:border-[#3c3c3c] bg-[#f6f8fa] dark:bg-[#252526]"
                    data-testid="notes-selection-badge"
                >
                    <span className="text-[12px] text-[#656d76] dark:text-[#9d9d9d] bg-[#d0d7de]/40 dark:bg-[#3c3c3c]/60 rounded px-1.5 py-0.5">
                        {multiSelectedPaths.size} selected
                    </span>
                    <button
                        type="button"
                        className="text-[12px] text-[#656d76] dark:text-[#9d9d9d] hover:text-[#1f2328] dark:hover:text-[#cccccc] leading-none"
                        onClick={clearSelection}
                        aria-label="Clear selection"
                        data-testid="notes-clear-selection-btn"
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* Docked status/action cluster (remote-first shell). No-ops in
                classic / mobile via DockedStatusFooter's own gate. */}
            {footer}

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
