/**
 * ExplorerPanel — top-level panel for the Explorer sub-tab.
 * Left/right split: FileTree sidebar + placeholder preview pane.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Spinner } from '../../shared';
import { fetchApi } from '../../hooks/useApi';
import { FileTree } from './FileTree';
import { PreviewPane } from './PreviewPane';
import { SearchBar } from './SearchBar';
import { Breadcrumbs } from './Breadcrumbs';
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
    const [previewFile, setPreviewFile] = useState<{ path: string; name: string } | null>(null);

    // Search state
    const [searchInput, setSearchInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();
    const searchInputRef = useRef<HTMLInputElement>(null);
    const preFilterExpandedRef = useRef<Set<string> | null>(null);

    // Fetch root entries on mount
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        fetchApi(`/repos/${encodeURIComponent(workspaceId)}/tree?path=/`)
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

    const handleFileOpen = useCallback((entry: TreeEntry) => {
        setPreviewFile({ path: entry.path, name: entry.name });
    }, []);

    const handleRefresh = useCallback(() => {
        setChildrenMap(new Map());
        setExpandedPaths(new Set());
        setLoading(true);
        setError(null);
        fetchApi(`/repos/${encodeURIComponent(workspaceId)}/tree?path=/`)
            .then((data: { entries: TreeEntry[] }) => {
                setRootEntries(data.entries);
            })
            .catch((err: Error) => {
                setError(err.message || 'Failed to load directory');
            })
            .finally(() => setLoading(false));
    }, [workspaceId]);

    // Search handlers
    const onSearchChange = useCallback((value: string) => {
        setSearchInput(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setSearchQuery(value), 150);
    }, []);

    const onSearchClear = useCallback(() => {
        setSearchInput('');
        setSearchQuery('');
        if (debounceRef.current) clearTimeout(debounceRef.current);
    }, []);

    // Save/restore expanded state when filtering
    useEffect(() => {
        if (searchQuery && !preFilterExpandedRef.current) {
            preFilterExpandedRef.current = new Set(expandedPaths);
        } else if (!searchQuery && preFilterExpandedRef.current) {
            setExpandedPaths(preFilterExpandedRef.current);
            preFilterExpandedRef.current = null;
        }
    }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-expand directories with matching descendants when filter is active
    useEffect(() => {
        if (!searchQuery) return;
        const q = searchQuery.toLowerCase();
        const toExpand = new Set(expandedPaths);
        function walkAndExpand(entries: TreeEntry[]) {
            for (const entry of entries) {
                if (entry.type !== 'dir') continue;
                const children = childrenMap.get(entry.path);
                if (!children) continue;
                const hasMatch = children.some(c =>
                    c.name.toLowerCase().includes(q)
                    || (c.type === 'dir' && childrenMap.has(c.path)),
                );
                if (hasMatch) {
                    toExpand.add(entry.path);
                    walkAndExpand(children);
                }
            }
        }
        walkAndExpand(rootEntries);
        if (toExpand.size !== expandedPaths.size) {
            setExpandedPaths(toExpand);
        }
    }, [searchQuery, childrenMap, rootEntries]); // eslint-disable-line react-hooks/exhaustive-deps

    // Keyboard shortcut: '/' to focus search, Escape to clear
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
                e.preventDefault();
                searchInputRef.current?.focus();
            } else if (e.key === 'Escape' && (searchInput || document.activeElement === searchInputRef.current)) {
                onSearchClear();
                searchInputRef.current?.blur();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [searchInput, onSearchClear]);

    // Breadcrumb segments derived from selectedPath
    const breadcrumbSegments = useMemo(() => {
        if (!selectedPath) return [];
        return selectedPath.split('/').filter(Boolean);
    }, [selectedPath]);

    const handleBreadcrumbNavigate = useCallback((segmentIndex: number) => {
        if (segmentIndex < 0) {
            // Navigate to root
            setSelectedPath(null);
            return;
        }
        const segments = selectedPath?.split('/').filter(Boolean) || [];
        const targetPath = segments.slice(0, segmentIndex + 1).join('/');
        setSelectedPath(targetPath);
        setExpandedPaths(prev => {
            const next = new Set(prev);
            next.add(targetPath);
            return next;
        });
    }, [selectedPath]);

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
            <aside className="w-full flex-1 min-h-0 lg:flex-none lg:w-80 border-b lg:border-b-0 lg:border-r border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] overflow-hidden flex flex-col">
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
                <Breadcrumbs
                    segments={breadcrumbSegments}
                    onNavigate={handleBreadcrumbNavigate}
                />
                <SearchBar
                    value={searchInput}
                    onChange={onSearchChange}
                    onClear={onSearchClear}
                    inputRef={searchInputRef}
                    placeholder="Filter files…"
                />
                <FileTree
                    workspaceId={workspaceId}
                    entries={rootEntries}
                    selectedPath={selectedPath}
                    expandedPaths={expandedPaths}
                    childrenMap={childrenMap}
                    onSelect={handleSelect}
                    onToggle={handleToggle}
                    onFileOpen={handleFileOpen}
                    onChildrenLoaded={handleChildrenLoaded}
                    filterQuery={searchQuery}
                />
            </aside>

            {/* Right main — preview pane */}
            <main className="flex-1 min-h-0 flex items-center justify-center bg-white dark:bg-[#1e1e1e] overflow-hidden" data-testid="explorer-preview-pane">
                {previewFile
                    ? <PreviewPane
                        repoId={workspaceId}
                        filePath={previewFile.path}
                        fileName={previewFile.name}
                        onClose={() => setPreviewFile(null)}
                      />
                    : <p className="text-[#848484] text-sm">Double-click a file to preview</p>}
            </main>
        </div>
    );
}
