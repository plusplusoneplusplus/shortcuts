/**
 * TreeNode — single row in the file tree.
 * Handles expand/collapse for directories and click-to-select for files.
 */

import { useEffect, useRef, useState, type Ref } from 'react';
import { cn } from '../../../ui/cn';
import { Spinner } from '../../../ui';
import { highlightMatch } from '../../../tasks/TaskSearchResults';
import { filterEntries } from './FileTree';
import type { TreeEntry } from './types';
import { explorerApi } from './explorerApi';

export interface TreeNodeProps {
    entry: TreeEntry;
    depth: number;
    workspaceId: string;
    selectedPath: string | null;
    expandedPaths: Set<string>;
    childrenMap: Map<string, TreeEntry[]>;
    onToggle: (path: string) => void;
    onSelect: (path: string, isDirectory: boolean) => void;
    onFileOpen?: (entry: TreeEntry) => void;
    onChildrenLoaded: (parentPath: string, children: TreeEntry[]) => void;
    onContextMenu?: (e: React.MouseEvent, entry: TreeEntry) => void;
    isFocused?: boolean;
    treeIndex?: number;
    filterQuery?: string;
}

function getFileIcon(entry: TreeEntry): string {
    if (entry.type === 'dir') return '📁';
    const name = entry.name.toLowerCase();
    if (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.mdx')) return '📝';
    if (name.endsWith('.ts') || name.endsWith('.tsx') || name.endsWith('.js') || name.endsWith('.jsx')) return '📄';
    if (name.endsWith('.json') || name.endsWith('.yaml') || name.endsWith('.yml')) return '⚙️';
    if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.svg') || name.endsWith('.gif')) return '🖼️';
    return '📄';
}

export function TreeNode({
    entry, depth, workspaceId, selectedPath, expandedPaths, childrenMap,
    onToggle, onSelect, onFileOpen, onChildrenLoaded, onContextMenu, isFocused, treeIndex, filterQuery,
}: TreeNodeProps) {
    const isDir = entry.type === 'dir';
    const isExpanded = expandedPaths.has(entry.path);
    const children = childrenMap.get(entry.path);
    const [loadError, setLoadError] = useState<string | null>(null);
    const rowRef = useRef<HTMLDivElement>(null);

    // "Loading" is exactly "expanded, and children not yet known" — derive it from
    // the shared cache rather than tracking a separate flag. A tracked flag has to
    // be cleared by the same effect whose success invalidates it, which loses a race
    // against React's sync lane (`childrenMap` lives in `useSyncExternalStore`, so
    // the cleanup runs before `.finally` and the spinner never clears). Deriving it
    // also keeps two mounted Explorer panels in agreement.
    const loading = isDir && isExpanded && children === undefined && !loadError;

    // Scroll focused node into view
    useEffect(() => {
        if (isFocused && rowRef.current) {
            rowRef.current.scrollIntoView({ block: 'nearest' });
        }
    }, [isFocused]);

    // Drop a stale failure when the node is collapsed, so re-expanding retries.
    useEffect(() => {
        if (!isExpanded) setLoadError(null);
    }, [isExpanded]);

    // Lazy-load children when expanded and not yet cached. `cancelled` guards stale
    // writes only. While a request is in flight none of the deps change
    // (`onChildrenLoaded` is a stable `useCallback`), so the effect does not re-fire
    // and needs no in-flight guard. A failure leaves `children` undefined and sets
    // `loadError`, which the guard below honours until it is cleared by a retry.
    useEffect(() => {
        if (!isDir || !isExpanded || children !== undefined || loadError) return;
        let cancelled = false;
        explorerApi.tree(workspaceId, { path: entry.path })
            .then((data: { entries: TreeEntry[] }) => {
                if (!cancelled) onChildrenLoaded(entry.path, data.entries);
            })
            .catch((err: unknown) => {
                if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
            });
        return () => { cancelled = true; };
    }, [isDir, isExpanded, children, loadError, workspaceId, entry.path, onChildrenLoaded]);

    const handleClick = () => {
        if (isDir) {
            onToggle(entry.path);
        } else {
            onFileOpen?.(entry);
        }
        onSelect(entry.path, isDir);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        if (e.shiftKey) return;
        e.preventDefault();
        e.stopPropagation();
        onSelect(entry.path, isDir);
        onContextMenu?.(e, entry);
    };

    return (
        <>
            <div
                ref={rowRef}
                className={cn(
                    'flex items-center gap-1.5 px-3 py-2 lg:py-1 cursor-pointer text-sm lg:text-xs transition-colors',
                    'hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
                    // Explicit foreground so rows don't inherit the near-black app default,
                    // which is invisible on the dark sidebar. Selected rows use the accent color.
                    selectedPath === entry.path
                        ? 'bg-[#0078d4]/10 dark:bg-[#3794ff]/10 text-[#0078d4] dark:text-[#3794ff]'
                        : 'text-[#1e1e1e] dark:text-[#cccccc]',
                    isFocused && 'ring-1 ring-[#0078d4]/50 dark:ring-[#3794ff]/50',
                )}
                style={{ paddingLeft: `${12 + depth * 16}px` }}
                data-testid={`tree-node-${entry.path}`}
                data-tree-index={treeIndex}
                onClick={handleClick}
                onContextMenu={handleContextMenu}
                onDoubleClick={() => { if (!isDir) onFileOpen?.(entry); }} /* kept for accessibility */
            >
                {isDir && (
                    <span className={cn('text-[10px] transition-transform inline-block', isExpanded && 'rotate-90')}>▶</span>
                )}
                <span className="flex-shrink-0">{getFileIcon(entry)}</span>
                <span className="truncate">{filterQuery ? highlightMatch(entry.name, filterQuery) : entry.name}</span>
                {loading && <Spinner size="sm" className="ml-auto" />}
                {loadError && (
                    <span
                        role="button"
                        tabIndex={0}
                        title={`${loadError} — click to retry`}
                        aria-label={`Failed to load ${entry.name} — click to retry`}
                        data-testid={`tree-node-error-${entry.path}`}
                        className="ml-auto text-[11px] text-red-600 dark:text-red-400"
                        onClick={e => { e.stopPropagation(); setLoadError(null); }}
                    >
                        ⚠
                    </span>
                )}
            </div>
            {isDir && isExpanded && children && filterEntries(children, filterQuery || '', childrenMap).map(child => (
                <TreeNode
                    key={child.path}
                    entry={child}
                    depth={depth + 1}
                    workspaceId={workspaceId}
                    selectedPath={selectedPath}
                    expandedPaths={expandedPaths}
                    childrenMap={childrenMap}
                    onToggle={onToggle}
                    onSelect={onSelect}
                    onFileOpen={onFileOpen}
                    onChildrenLoaded={onChildrenLoaded}
                    onContextMenu={onContextMenu}
                    filterQuery={filterQuery}
                />
            ))}
        </>
    );
}
