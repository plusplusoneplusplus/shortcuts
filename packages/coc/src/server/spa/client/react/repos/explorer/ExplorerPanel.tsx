/**
 * ExplorerPanel — top-level panel for the Explorer sub-tab.
 * Left/right split: FileTree sidebar + placeholder preview pane.
 */

import { useState, useEffect, useCallback } from 'react';
import { Spinner } from '../../shared';
import { fetchApi } from '../../hooks/useApi';
import { FileTree } from './FileTree';
import type { TreeEntry } from './types';

export interface ExplorerPanelProps {
    workspaceId: string;
}

export function ExplorerPanel({ workspaceId }: ExplorerPanelProps) {
    const [rootEntries, setRootEntries] = useState<TreeEntry[]>([]);
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
    const [childrenMap, setChildrenMap] = useState<Map<string, TreeEntry[]>>(new Map());

    // Fetch root entries on mount
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        fetchApi(`/api/repos/${encodeURIComponent(workspaceId)}/tree?path=/`)
            .then((data: { entries: TreeEntry[] }) => {
                if (!cancelled) setRootEntries(data.entries);
            })
            .catch((err: Error) => {
                if (!cancelled) setError(err.message || 'Failed to load directory');
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [workspaceId]);

    // Deep-link: read hash on mount to restore selected path
    useEffect(() => {
        const hash = location.hash.replace(/^#/, '');
        const parts = hash.split('/');
        // #repos/:id/explorer/:path
        if (parts[0] === 'repos' && parts[2] === 'explorer' && parts[3]) {
            setSelectedPath(decodeURIComponent(parts.slice(3).join('/')));
        }
    }, []);

    const handleSelect = useCallback((path: string, isDirectory: boolean) => {
        setSelectedPath(path);
        // Update hash for deep-linking
        location.hash = `#repos/${encodeURIComponent(workspaceId)}/explorer/${encodeURIComponent(path)}`;
    }, [workspaceId]);

    const handleToggle = useCallback((path: string) => {
        setExpandedPaths(prev => {
            const next = new Set(prev);
            if (next.has(path)) {
                next.delete(path);
            } else {
                next.add(path);
            }
            return next;
        });
    }, []);

    const handleChildrenLoaded = useCallback((parentPath: string, children: TreeEntry[]) => {
        setChildrenMap(prev => new Map(prev).set(parentPath, children));
    }, []);

    const handleRefresh = useCallback(() => {
        setChildrenMap(new Map());
        setExpandedPaths(new Set());
        setLoading(true);
        setError(null);
        fetchApi(`/api/repos/${encodeURIComponent(workspaceId)}/tree?path=/`)
            .then((data: { entries: TreeEntry[] }) => {
                setRootEntries(data.entries);
            })
            .catch((err: Error) => {
                setError(err.message || 'Failed to load directory');
            })
            .finally(() => setLoading(false));
    }, [workspaceId]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-8" data-testid="explorer-loading">
                <Spinner size="lg" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 text-sm text-[#d32f2f]" data-testid="explorer-error">
                {error}
            </div>
        );
    }

    return (
        <div className="flex flex-col lg:flex-row h-full overflow-hidden" data-testid="explorer-panel">
            {/* Left aside — file tree */}
            <aside className="w-full lg:w-80 flex-shrink-0 border-b lg:border-b-0 lg:border-r border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <span className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">Files</span>
                    <button
                        className="text-xs text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] transition-colors"
                        onClick={handleRefresh}
                        title="Refresh"
                        data-testid="explorer-refresh-btn"
                    >
                        ↻
                    </button>
                </div>
                <FileTree
                    workspaceId={workspaceId}
                    entries={rootEntries}
                    selectedPath={selectedPath}
                    expandedPaths={expandedPaths}
                    childrenMap={childrenMap}
                    onSelect={handleSelect}
                    onToggle={handleToggle}
                    onChildrenLoaded={handleChildrenLoaded}
                />
            </aside>

            {/* Right main — preview placeholder */}
            <main className="flex-1 flex items-center justify-center bg-white dark:bg-[#1e1e1e] text-[#848484] text-sm" data-testid="explorer-preview-pane">
                <p>Double-click a file to preview</p>
            </main>
        </div>
    );
}
