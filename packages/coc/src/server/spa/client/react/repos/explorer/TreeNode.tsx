/**
 * TreeNode — single row in the file tree.
 * Handles expand/collapse for directories and click-to-select for files.
 */

import { useEffect, useRef, useState, type Ref } from 'react';
import { cn } from '../../shared/cn';
import { Spinner } from '../../shared';
import { fetchApi } from '../../hooks/useApi';
import { highlightMatch } from '../../tasks/TaskSearchResults';
import { filterEntries } from './FileTree';
import type { TreeEntry } from './types';

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
    onToggle, onSelect, onFileOpen, onChildrenLoaded, isFocused, treeIndex, filterQuery,
}: TreeNodeProps) {
    const isDir = entry.type === 'dir';
    const isExpanded = expandedPaths.has(entry.path);
    const children = childrenMap.get(entry.path);
    const [loading, setLoading] = useState(false);
    const rowRef = useRef<HTMLDivElement>(null);

    // Scroll focused node into view
    useEffect(() => {
        if (isFocused && rowRef.current) {
            rowRef.current.scrollIntoView({ block: 'nearest' });
        }
    }, [isFocused]);

    // Lazy-load children when expanded and not yet cached
    useEffect(() => {
        if (!isDir || !isExpanded || children !== undefined) return;
        let cancelled = false;
        setLoading(true);
        fetchApi(`/repos/${encodeURIComponent(workspaceId)}/tree?path=${encodeURIComponent(entry.path)}`)
            .then((data: { entries: TreeEntry[] }) => {
                if (!cancelled) onChildrenLoaded(entry.path, data.entries);
            })
            .catch(() => {})
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [isDir, isExpanded, children, workspaceId, entry.path, onChildrenLoaded]);

    const handleClick = () => {
        if (isDir) {
            onToggle(entry.path);
        }
        onSelect(entry.path, isDir);
    };

    return (
        <>
            <div
                ref={rowRef}
                className={cn(
                    'flex items-center gap-1.5 px-3 py-1 cursor-pointer text-xs transition-colors',
                    'hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
                    selectedPath === entry.path && 'bg-[#0078d4]/10 dark:bg-[#3794ff]/10 text-[#0078d4] dark:text-[#3794ff]',
                    isFocused && 'ring-1 ring-[#0078d4]/50 dark:ring-[#3794ff]/50',
                )}
                style={{ paddingLeft: `${12 + depth * 16}px` }}
                data-testid={`tree-node-${entry.path}`}
                data-tree-index={treeIndex}
                onClick={handleClick}
                onDoubleClick={() => { if (!isDir) onFileOpen?.(entry); }}
            >
                {isDir && (
                    <span className={cn('text-[10px] transition-transform inline-block', isExpanded && 'rotate-90')}>▶</span>
                )}
                <span className="flex-shrink-0">{getFileIcon(entry)}</span>
                <span className="truncate">{filterQuery ? highlightMatch(entry.name, filterQuery) : entry.name}</span>
                {loading && <Spinner size="sm" className="ml-auto" />}
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
                    filterQuery={filterQuery}
                />
            ))}
        </>
    );
}
