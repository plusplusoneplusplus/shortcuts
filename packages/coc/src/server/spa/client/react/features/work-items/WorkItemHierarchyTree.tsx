/**
 * WorkItemHierarchyTree — the hierarchy board left pane.
 * Renders a collapsible hierarchy tree with Epic → Feature → PBI → WI/Bug.
 * Includes create actions, search, and context menu per node.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, cn } from '../../ui';
import { getSpaCocClient } from '../../api/cocClient';
import { useWorkItems } from '../../contexts/WorkItemContext';
import { WorkItemHierarchyNode } from './WorkItemHierarchyNode';
import { WorkItemParentPicker } from './WorkItemParentPicker';
import { ContextMenu } from '../../tasks/comments/ContextMenu';
import type { ContextMenuItem } from '../../tasks/comments/ContextMenu';
import { ALLOWED_CHILD_TYPES } from '@plusplusoneplusplus/coc-client';
import type { WorkItemTreeNode, WorkItemTreeResponse } from '@plusplusoneplusplus/coc-client';
import type { WorkItemTypeLabel } from './WorkItemHierarchyNode';
import { TYPE_LABELS } from './WorkItemHierarchyNode';

const TYPE_CHILD_LABELS: Record<WorkItemTypeLabel, string> = {
    epic:        'Feature',
    feature:     'PBI / Story',
    pbi:         'Work Item / Bug',
    'work-item': '',
    bug:         '',
};

const COLLAPSE_STORAGE_KEY = (workspaceId: string) => `coc-hierarchy-collapsed-${workspaceId}`;

function loadCollapsed(workspaceId: string): Set<string> {
    try {
        const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY(workspaceId));
        return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
}

function saveCollapsed(workspaceId: string, ids: Set<string>): void {
    try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY(workspaceId), JSON.stringify([...ids]));
    } catch { /* quota exceeded */ }
}

export interface WorkItemHierarchyTreeProps {
    workspaceId: string;
    selectedWorkItemId: string | null;
    onSelectWorkItem: (id: string) => void;
    /** Called when a new work item is created from within the tree. */
    onCreated: (item: any) => void;
    /** Open the create dialog for a given type with an optional parent. */
    onCreateItem: (type: WorkItemTypeLabel, parentId?: string) => void;
    /** When provided, renders the "✨ Create with AI" entry point in the tree header and empty state. */
    onCreateWithAi?: () => void;
    /** When true, renders the always-visible mobile add-child buttons. */
    isMobile?: boolean;
}

export function WorkItemHierarchyTree({
    workspaceId,
    selectedWorkItemId,
    onSelectWorkItem,
    onCreated,
    onCreateItem,
    onCreateWithAi,
    isMobile = false,
}: WorkItemHierarchyTreeProps) {
    const [treeData, setTreeData] = useState<WorkItemTreeNode[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => loadCollapsed(workspaceId));
    const [showArchived, setShowArchived] = useState(false);
    const [showDone, setShowDone] = useState(false);

    const [contextMenu, setContextMenu] = useState<{
        node: WorkItemTreeNode;
        position: { x: number; y: number };
    } | null>(null);

    const [parentPicker, setParentPicker] = useState<{
        itemId: string;
        itemType: WorkItemTypeLabel;
        currentParentId?: string;
    } | null>(null);

    const [typePicker, setTypePicker] = useState<{ node: WorkItemTreeNode } | null>(null);

    const handleAddChild = useCallback((node: WorkItemTreeNode) => {
        const effectiveType = (node.item.type ?? 'work-item') as WorkItemTypeLabel;
        const childTypes = ALLOWED_CHILD_TYPES[effectiveType] ?? [];
        if (childTypes.length === 0) return;
        if (childTypes.length === 1) {
            onCreateItem(childTypes[0] as WorkItemTypeLabel, node.item.id);
        } else {
            setTypePicker({ node });
        }
    }, [onCreateItem]);

    const { state: workItemState } = useWorkItems();
    const lastFetchedAt = useRef<string>('');

    const fetchTree = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const resp: WorkItemTreeResponse = await getSpaCocClient().workItems.tree(workspaceId, {
                q: searchQuery || undefined,
                includeArchived: showArchived,
                includeDone: showDone,
            });
            if (resp.disabled) {
                setError('Hierarchy feature is disabled.');
                return;
            }
            setTreeData(resp.roots);
            setTotal(resp.total);
            lastFetchedAt.current = new Date().toISOString();
        } catch (err: any) {
            setError(err.message ?? 'Failed to load hierarchy');
        } finally {
            setLoading(false);
        }
    }, [workspaceId, searchQuery, showArchived, showDone]);

    // Initial load
    useEffect(() => { fetchTree(); }, [fetchTree]);

    // Refresh when WebSocket events arrive (work item context changes)
    const repoItems = workItemState.workItemsByRepo[workspaceId];
    const prevRepoItemsRef = useRef(repoItems);
    useEffect(() => {
        if (prevRepoItemsRef.current === repoItems) return;
        prevRepoItemsRef.current = repoItems;
        // Debounce to avoid multiple rapid refreshes
        const timer = setTimeout(() => fetchTree(), 300);
        return () => clearTimeout(timer);
    }, [repoItems, fetchTree]);

    // Persist collapse state
    useEffect(() => {
        saveCollapsed(workspaceId, collapsedIds);
    }, [workspaceId, collapsedIds]);

    const handleToggleCollapse = useCallback((id: string) => {
        setCollapsedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const handleContextMenu = useCallback((e: React.MouseEvent, node: WorkItemTreeNode) => {
        e.preventDefault();
        setContextMenu({ node, position: { x: e.clientX, y: e.clientY } });
    }, []);

    const handleDelete = useCallback(async (id: string) => {
        if (!confirm('Delete this work item? Children must be moved or deleted first.')) return;
        try {
            await getSpaCocClient().workItems.delete(workspaceId, id);
            fetchTree();
        } catch (err: any) {
            alert(err.message ?? 'Failed to delete');
        }
    }, [workspaceId, fetchTree]);

    const buildContextMenuItems = useCallback((node: WorkItemTreeNode): ContextMenuItem[] => {
        const effectiveType = (node.item.type ?? 'work-item') as WorkItemTypeLabel;
        const childTypes = ALLOWED_CHILD_TYPES[effectiveType] ?? [];
        const items: ContextMenuItem[] = [];

        // Create child actions
        if (childTypes.length > 0) {
            const childLabel = TYPE_CHILD_LABELS[effectiveType];
            items.push({
                label: `Add ${childLabel}`,
                icon: '➕',
                onClick: () => {
                    if (childTypes.length === 1) {
                        onCreateItem(childTypes[0], node.item.id);
                    } else {
                        // pbi → work-item or bug; open dialog for work-item first
                        onCreateItem('work-item', node.item.id);
                    }
                },
            });
            if (childTypes.length > 1) {
                items.push({
                    label: 'Add Bug',
                    icon: '🐛',
                    onClick: () => onCreateItem('bug', node.item.id),
                });
            }
        }

        // Change parent
        if (effectiveType !== 'epic') {
            items.push({
                label: 'Change Parent…',
                icon: '🔗',
                onClick: () => setParentPicker({
                    itemId: node.item.id,
                    itemType: effectiveType,
                    currentParentId: node.item.parentId ?? undefined,
                }),
                separator: childTypes.length > 0,
            });
            if (node.item.parentId) {
                items.push({
                    label: 'Unlink Parent',
                    icon: '🔓',
                    onClick: async () => {
                        try {
                            await getSpaCocClient().workItems.update(workspaceId, node.item.id, { parentId: null });
                            fetchTree();
                        } catch (err: any) {
                            alert(err.message ?? 'Failed to unlink');
                        }
                    },
                });
            }
        }

        // Pin/archive/delete
        items.push({
            label: node.item.pinnedAt ? 'Unpin' : 'Pin',
            icon: '📌',
            separator: true,
            onClick: async () => {
                try {
                    await getSpaCocClient().workItems.pin(workspaceId, node.item.id, !node.item.pinnedAt);
                    fetchTree();
                } catch (err: any) {
                    alert(err.message ?? 'Failed to pin');
                }
            },
        });
        items.push({
            label: node.item.archivedAt ? 'Unarchive' : 'Archive',
            icon: '🗄️',
            onClick: async () => {
                try {
                    await getSpaCocClient().workItems.archive(workspaceId, node.item.id, !node.item.archivedAt);
                    fetchTree();
                } catch (err: any) {
                    alert(err.message ?? 'Failed to archive');
                }
            },
        });
        items.push({
            label: 'Delete',
            icon: '🗑',
            onClick: () => handleDelete(node.item.id),
        });

        return items;
    }, [workspaceId, onCreateItem, fetchTree, handleDelete]);

    /** Recursively render a tree node and its children. */
    const renderNode = useCallback((node: WorkItemTreeNode, depth: number): React.ReactNode => {
        const id = node.item.id;
        const hasChildren = node.children.length > 0;
        const collapsed = collapsedIds.has(id);

        return (
            <WorkItemHierarchyNode
                key={id}
                node={node}
                depth={depth}
                collapsed={collapsed}
                selected={selectedWorkItemId === id}
                hasChildren={hasChildren}
                onSelect={onSelectWorkItem}
                onToggleCollapse={handleToggleCollapse}
                onContextMenu={handleContextMenu}
                isMobile={isMobile}
                onAddChild={handleAddChild}
            >
                {!collapsed && node.children.map(child => renderNode(child, depth + 1))}
            </WorkItemHierarchyNode>
        );
    }, [collapsedIds, selectedWorkItemId, onSelectWorkItem, handleToggleCollapse, handleContextMenu, isMobile, handleAddChild]);

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col h-full" data-testid="work-item-hierarchy-tree">
            {/* ── Header ── */}
            <div className="px-3 pt-3 pb-2 flex items-center justify-between gap-2 shrink-0">
                <h2 className="text-sm font-medium truncate">Work Items Board</h2>
                <div className="flex gap-1 shrink-0">
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => onCreateItem('epic')}
                        data-testid="create-epic-btn"
                        title="Create top-level Epic"
                    >
                        + Epic
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onCreateItem('work-item')}
                        data-testid="create-wi-btn"
                        title="Create unparented Work Item"
                    >
                        + WI
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onCreateItem('bug')}
                        data-testid="create-bug-btn"
                        title="Create unparented Bug"
                    >
                        🐛
                    </Button>
                    {onCreateWithAi && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onCreateWithAi}
                            data-testid="hierarchy-create-with-ai-btn"
                            title="Create with AI"
                        >
                            ✨
                        </Button>
                    )}
                </div>
            </div>

            {/* ── Search ── */}
            <div className="px-3 pb-2 shrink-0 flex items-center gap-2">
                <input
                    type="text"
                    className="flex-1 rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-[12px] text-[#1e1e1e] dark:text-[#cccccc] px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                    placeholder="Search hierarchy…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    data-testid="hierarchy-search-input"
                />
                <button
                    className={cn(
                        'text-[11px] px-1.5 py-0.5 rounded border transition-colors',
                        showDone
                            ? 'border-[#007acc] text-[#007acc] bg-[#007acc]/10'
                            : 'border-[#d0d0d0] dark:border-[#555] text-[#848484] hover:border-[#999]',
                    )}
                    onClick={() => setShowDone(p => !p)}
                    title="Toggle done items"
                    data-testid="hierarchy-done-toggle"
                >
                    ✓
                </button>
                <button
                    className={cn(
                        'text-[11px] px-1.5 py-0.5 rounded border transition-colors',
                        showArchived
                            ? 'border-[#007acc] text-[#007acc] bg-[#007acc]/10'
                            : 'border-[#d0d0d0] dark:border-[#555] text-[#848484] hover:border-[#999]',
                    )}
                    onClick={() => setShowArchived(p => !p)}
                    title="Toggle archived items"
                    data-testid="hierarchy-archived-toggle"
                >
                    📂
                </button>
            </div>

            {/* ── Tree body ── */}
            <div className="flex-1 overflow-y-auto min-h-0">
                {loading ? (
                    <div className="flex items-center justify-center h-16 text-sm text-[#848484]" data-testid="hierarchy-loading">
                        Loading…
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center h-16 gap-2 px-3" data-testid="hierarchy-error">
                        <p className="text-xs text-red-500 text-center">{error}</p>
                        <Button variant="ghost" size="sm" onClick={fetchTree}>Retry</Button>
                    </div>
                ) : treeData.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-24 gap-3 px-4 text-center" data-testid="hierarchy-empty">
                        <div className="text-3xl">🗂️</div>
                        <p className="text-xs text-[#848484]">
                            {searchQuery ? 'No results found.' : 'No work items yet. Create an Epic to start, or add an unparented Work Item.'}
                        </p>
                        {!searchQuery && (
                            <div className="flex gap-2">
                                <Button variant="primary" size="sm" onClick={() => onCreateItem('epic')} data-testid="empty-create-epic-btn">
                                    + Create Epic
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => onCreateItem('work-item')}>
                                    + Work Item
                                </Button>
                                {onCreateWithAi && (
                                    <Button variant="ghost" size="sm" onClick={onCreateWithAi} data-testid="hierarchy-empty-create-with-ai-btn">
                                        ✨ Create with AI
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <div data-testid="hierarchy-tree-list">
                        {/* Rooted nodes (epics and parented items at each level) */}
                        {treeData
                            .filter(n => n.item.type === 'epic' || (n.item.type && ['feature', 'pbi'].includes(n.item.type) && n.item.parentId == null))
                            .map(n => renderNode(n, 0))}

                        {/* Unparented group — roots that are not epics */}
                        {(() => {
                            const unparented = treeData.filter(n => {
                                const t = n.item.type ?? 'work-item';
                                return t !== 'epic' && !n.item.parentId;
                            });
                            if (unparented.length === 0) return null;
                            return (
                                <div data-testid="hierarchy-unparented-group">
                                    <div className="px-3 py-1 mt-2 text-[10px] font-medium text-[#848484] dark:text-[#999] uppercase tracking-wide border-t border-[#e8e8e8] dark:border-[#333]">
                                        Unparented
                                    </div>
                                    {unparented.map(n => renderNode(n, 0))}
                                </div>
                            );
                        })()}

                        {/* Count */}
                        <div className="px-3 py-2 text-[10px] text-[#848484] dark:text-[#999]">
                            {total} item{total !== 1 ? 's' : ''}
                        </div>
                    </div>
                )}
            </div>

            {/* ── Context menu ── */}
            {contextMenu && (
                <ContextMenu
                    position={contextMenu.position}
                    items={buildContextMenuItems(contextMenu.node)}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {/* ── Parent picker ── */}
            {parentPicker && (
                <WorkItemParentPicker
                    open={true}
                    onClose={() => setParentPicker(null)}
                    workspaceId={workspaceId}
                    itemId={parentPicker.itemId}
                    itemType={parentPicker.itemType}
                    currentParentId={parentPicker.currentParentId}
                    onParentChanged={() => {
                        setParentPicker(null);
                        fetchTree();
                    }}
                />
            )}

            {/* ── Type picker (mobile add-child) ── */}
            {typePicker && (
                <div
                    className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
                    onClick={() => setTypePicker(null)}
                    data-testid="type-picker-overlay"
                >
                    <div
                        className="w-full max-w-sm bg-white dark:bg-[#1e1e1e] rounded-t-xl p-4 pb-8 shadow-2xl"
                        onClick={e => e.stopPropagation()}
                        data-testid="type-picker-modal"
                    >
                        <p className="text-xs font-medium text-[#848484] dark:text-[#999] mb-3 uppercase tracking-wide">
                            Add child to "{typePicker.node.item.title}"
                        </p>
                        <div className="flex flex-col gap-2">
                            {(ALLOWED_CHILD_TYPES[(typePicker.node.item.type ?? 'work-item') as WorkItemTypeLabel] ?? []).map(childType => (
                                <button
                                    key={childType}
                                    className="w-full text-left px-3 py-2.5 rounded-lg border border-[#e0e0e0] dark:border-[#444] text-sm text-[#3c3c3c] dark:text-[#cccccc] hover:bg-[#f5f5f5] dark:hover:bg-[#2a2d2e] active:bg-[#e8e8e8] dark:active:bg-[#333]"
                                    onClick={() => { onCreateItem(childType as WorkItemTypeLabel, typePicker.node.item.id); setTypePicker(null); }}
                                    data-testid={`type-picker-option-${childType}`}
                                >
                                    {TYPE_LABELS[childType as WorkItemTypeLabel] ?? childType}
                                </button>
                            ))}
                        </div>
                        <button
                            className="mt-3 w-full text-center text-xs text-[#848484] py-2"
                            onClick={() => setTypePicker(null)}
                            data-testid="type-picker-cancel"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
