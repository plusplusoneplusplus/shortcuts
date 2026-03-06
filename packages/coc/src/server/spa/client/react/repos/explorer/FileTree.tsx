/**
 * FileTree — recursive, lazy-loaded tree sidebar for the explorer panel.
 * Supports keyboard navigation (arrow keys, Enter/Space).
 */

import { useState, useCallback, useMemo } from 'react';
import { TreeNode } from './TreeNode';
import type { TreeEntry } from './types';

export interface FileTreeProps {
    workspaceId: string;
    entries: TreeEntry[];
    selectedPath: string | null;
    expandedPaths: Set<string>;
    childrenMap: Map<string, TreeEntry[]>;
    onSelect: (path: string, isDirectory: boolean) => void;
    onToggle: (path: string) => void;
    onFileOpen?: (entry: TreeEntry) => void;
    onChildrenLoaded: (parentPath: string, children: TreeEntry[]) => void;
}

/** Flatten the visible tree into an ordered list for keyboard navigation. */
export function flattenVisibleNodes(
    entries: TreeEntry[],
    expandedPaths: Set<string>,
    childrenMap: Map<string, TreeEntry[]>,
): TreeEntry[] {
    const result: TreeEntry[] = [];
    function walk(items: TreeEntry[]) {
        for (const item of items) {
            result.push(item);
            if (item.type === 'dir' && expandedPaths.has(item.path)) {
                const children = childrenMap.get(item.path);
                if (children) walk(children);
            }
        }
    }
    walk(entries);
    return result;
}

export function FileTree({
    workspaceId, entries, selectedPath, expandedPaths, childrenMap,
    onSelect, onToggle, onFileOpen, onChildrenLoaded,
}: FileTreeProps) {
    const [focusedIndex, setFocusedIndex] = useState(-1);

    const visibleNodes = useMemo(
        () => flattenVisibleNodes(entries, expandedPaths, childrenMap),
        [entries, expandedPaths, childrenMap],
    );

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setFocusedIndex(i => Math.min(i + 1, visibleNodes.length - 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setFocusedIndex(i => Math.max(i - 1, 0));
                break;
            case 'ArrowRight': {
                const node = visibleNodes[focusedIndex];
                if (node?.type === 'dir' && !expandedPaths.has(node.path)) {
                    onToggle(node.path);
                } else if (node?.type === 'file') {
                    onFileOpen?.(node);
                }
                break;
            }
            case 'ArrowLeft': {
                const node = visibleNodes[focusedIndex];
                if (node?.type === 'dir' && expandedPaths.has(node.path)) {
                    onToggle(node.path);
                }
                break;
            }
            case 'Enter':
            case ' ': {
                e.preventDefault();
                const node = visibleNodes[focusedIndex];
                if (node) {
                    onSelect(node.path, node.type === 'dir');
                    if (node.type === 'file') onFileOpen?.(node);
                }
                break;
            }
        }
    }, [visibleNodes, focusedIndex, expandedPaths, onToggle, onSelect, onFileOpen]);

    // Build a set of focused paths for efficient lookup
    const focusedPath = focusedIndex >= 0 && focusedIndex < visibleNodes.length
        ? visibleNodes[focusedIndex].path
        : null;

    return (
        <div className="flex flex-col h-full text-sm" data-testid="file-tree">
            <div
                className="flex-1 overflow-y-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0078d4]"
                tabIndex={0}
                onKeyDown={handleKeyDown}
                data-testid="file-tree-scroll"
            >
                {entries.map(entry => (
                    <TreeNode
                        key={entry.path}
                        entry={entry}
                        depth={0}
                        workspaceId={workspaceId}
                        selectedPath={selectedPath}
                        expandedPaths={expandedPaths}
                        childrenMap={childrenMap}
                        onToggle={onToggle}
                        onSelect={onSelect}
                        onFileOpen={onFileOpen}
                        onChildrenLoaded={onChildrenLoaded}
                        isFocused={entry.path === focusedPath}
                    />
                ))}
            </div>
        </div>
    );
}
