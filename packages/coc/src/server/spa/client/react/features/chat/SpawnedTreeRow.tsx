import type React from 'react';
import { cn } from '../../ui/cn';
import {
    getSpawnedNodeId,
    type SpawnedTreeEntry,
    type SpawnedTreeNode,
} from './spawned-tree-grouping';

/**
 * SpawnedTreeRow — renders a `send_to_conversation` spawn tree in the chat list
 * (AC-03). Unlike the for-each / map-reduce group rows (whose parent is a
 * synthetic run header), every node here is a real chat: the root row is the
 * originating chat itself, and its spawned descendants nest recursively beneath
 * it with a chevron, indentation, and a connector.
 *
 * Each node renders its own chat row via `renderTaskCard`. Parent nodes pass an
 * expand/collapse chevron as the row's `leadingElement`, which replaces the
 * status dot in the first grid column so the mode pill/avatar stays aligned with
 * non-spawned rows; leaf nodes pass none and keep their status dot. A sub-job
 * count chip sits to the row's right showing the total recursive descendant
 * count. Collapse state is per-node, keyed by node id; a node absent from
 * `collapsedIds` renders expanded (default-expanded contract).
 *
 * Presentational only: collapse persistence + the feature toggle live in
 * {@link ./spawned-tree-view-state}; the grouping lives in
 * {@link ./spawned-tree-grouping}.
 */

export interface SpawnedTreeRowProps {
    /** The spawned-tree entry whose root + descendants to render. */
    entry: SpawnedTreeEntry;
    /** Node ids currently collapsed. A node not in this set renders expanded. */
    collapsedIds: Set<string>;
    /** Toggle a node's collapsed state (by node id). */
    onToggleCollapsed: (nodeId: string) => void;
    /**
     * Render the chat row for a node's underlying task.
     * `leadingElement`, when provided, replaces the row's status dot in the first
     * grid column — used to drop the expand/collapse chevron into the dot slot so
     * the avatar/mode pill stays aligned with non-spawned rows.
     */
    renderTaskCard: (
        task: any,
        options: { isGroupChild: boolean; leadingElement?: React.ReactNode },
    ) => React.ReactNode;
}

function descendantLabel(count: number): string {
    return `${count} sub-job${count === 1 ? '' : 's'}`;
}

interface NodeProps {
    node: SpawnedTreeNode;
    depth: number;
    collapsedIds: Set<string>;
    onToggleCollapsed: (nodeId: string) => void;
    renderTaskCard: (
        task: any,
        options: { isGroupChild: boolean; leadingElement?: React.ReactNode },
    ) => React.ReactNode;
}

function SpawnedTreeNodeRow({ node, depth, collapsedIds, onToggleCollapsed, renderTaskCard }: NodeProps) {
    const nodeId = getSpawnedNodeId(node);
    const isRoot = depth === 0;
    const hasChildren = node.children.length > 0;
    const isExpanded = !collapsedIds.has(nodeId);

    // Parent rows drop their expand/collapse chevron into the status-dot column
    // (via `leadingElement`) so the avatar/mode pill lands at the same x position
    // as non-spawned rows. Leaf rows pass no leading element and keep their dot.
    const chevron = hasChildren ? (
        <button
            type="button"
            className={cn(
                'justify-self-center shrink-0 inline-flex items-center justify-center w-4 h-4 rounded',
                'text-[#848484] dark:text-[#a0a0a0] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]',
                'transition-transform',
                isExpanded && 'rotate-90',
            )}
            onClick={e => { e.stopPropagation(); onToggleCollapsed(nodeId); }}
            data-testid="spawned-tree-chevron"
            aria-label={isExpanded ? 'Collapse spawned chats' : 'Expand spawned chats'}
            aria-expanded={isExpanded}
        >
            <span className="text-[12px] leading-none" aria-hidden="true">›</span>
        </button>
    ) : undefined;

    return (
        <div data-testid="spawned-tree-node" data-node-id={nodeId} data-depth={depth}>
            <div className="flex items-center gap-1">
                <span className="flex-1 min-w-0">
                    {renderTaskCard(node.task, { isGroupChild: !isRoot, leadingElement: chevron })}
                </span>
                {node.descendantCount > 0 && (
                    <span
                        className="shrink-0 mr-2 text-[10px] font-mono tabular-nums text-[#848484] dark:text-[#9d9d9d]"
                        data-testid="spawned-tree-child-count"
                        title={descendantLabel(node.descendantCount)}
                    >
                        {node.descendantCount}
                    </span>
                )}
            </div>
            {hasChildren && isExpanded && (
                <div
                    className="flex flex-col ml-3 pl-2 border-l border-[#e0e0e0] dark:border-[#3c3c3c]"
                    data-testid="spawned-tree-children"
                >
                    {node.children.map(child => (
                        <SpawnedTreeNodeRow
                            key={getSpawnedNodeId(child)}
                            node={child}
                            depth={depth + 1}
                            collapsedIds={collapsedIds}
                            onToggleCollapsed={onToggleCollapsed}
                            renderTaskCard={renderTaskCard}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export function SpawnedTreeRow({ entry, collapsedIds, onToggleCollapsed, renderTaskCard }: SpawnedTreeRowProps) {
    return (
        <div data-testid="spawned-tree-row" data-root-id={entry.rootProcessId}>
            <SpawnedTreeNodeRow
                node={entry.root}
                depth={0}
                collapsedIds={collapsedIds}
                onToggleCollapsed={onToggleCollapsed}
                renderTaskCard={renderTaskCard}
            />
        </div>
    );
}
