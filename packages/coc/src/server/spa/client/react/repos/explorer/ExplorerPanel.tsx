/**
 * ExplorerPanel — top-level panel for the Explorer sub-tab.
 * Left/right split: FileTree sidebar + placeholder preview pane.
 * On mobile, shows either the file tree OR the preview pane (not both).
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Spinner } from '../../shared';
import { fetchApi } from '../../hooks/useApi';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { FileTree } from './FileTree';
import { PreviewPane } from './PreviewPane';
import { SearchBar } from './SearchBar';
import { Breadcrumbs } from './Breadcrumbs';
import { QuickOpen } from './QuickOpen';
import { ExactOpen } from './ExactOpen';
import { ContextMenu, type ContextMenuItem } from '../../tasks/comments/ContextMenu';
import type { TreeEntry } from './types';

export interface ExplorerPanelProps {
    workspaceId: string;
}

export function ExplorerPanel({ workspaceId }: ExplorerPanelProps) {
    const { isMobile } = useBreakpoint();
    const { width: sidebarWidth, isDragging, handleMouseDown, handleTouchStart } = useResizablePanel({
        initialWidth: 320,
        minWidth: 160,
        maxWidth: 600,
        storageKey: 'explorer-sidebar-width',
    });

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

    // Context menu state
    const [contextMenu, setContextMenu] = useState<{
        position: { x: number; y: number };
        entry: TreeEntry;
    } | null>(null);

    // Quick Open state (Ctrl+P)
    const [quickOpenVisible, setQuickOpenVisible] = useState(false);

    // Exact Open state (Ctrl+O)
    const [exactOpenVisible, setExactOpenVisible] = useState(false);

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

    // Deep-link: read hash on mount to restore selected path and open file preview
    useEffect(() => {
        const hash = location.hash.replace(/^#/, '');
        const parts = hash.split('/');
        // #repos/:id/explorer/:path
        if (parts[0] === 'repos' && parts[2] === 'explorer' && parts[3]) {
            const decoded = decodeURIComponent(parts.slice(3).join('/'));
            setSelectedPath(decoded);
            const segments = decoded.split('/').filter(Boolean);
            const lastName = segments[segments.length - 1] ?? '';
            if (lastName.includes('.')) {
                setPreviewFile({ path: decoded, name: lastName });
            }
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

    const handleQuickOpenSelect = useCallback((filePath: string) => {
        const name = filePath.includes('/') ? filePath.slice(filePath.lastIndexOf('/') + 1) : filePath;
        setSelectedPath(filePath);
        setPreviewFile({ path: filePath, name });
        // Expand ancestor directories
        const segments = filePath.split('/');
        if (segments.length > 1) {
            setExpandedPaths(prev => {
                const next = new Set(prev);
                for (let i = 1; i < segments.length; i++) {
                    next.add(segments.slice(0, i).join('/'));
                }
                return next;
            });
        }
        location.hash = `#repos/${encodeURIComponent(workspaceId)}/explorer/${encodeURIComponent(filePath)}`;
    }, [workspaceId]);

    const handleTreeContextMenu = useCallback((e: React.MouseEvent, entry: TreeEntry) => {
        setContextMenu({ position: { x: e.clientX, y: e.clientY }, entry });
    }, []);

    const buildContextMenuItems = useCallback((entry: TreeEntry): ContextMenuItem[] => {
        const isDir = entry.type === 'dir';
        const isExpanded = expandedPaths.has(entry.path);
        const items: ContextMenuItem[] = [];

        if (isDir) {
            items.push({
                label: isExpanded ? 'Collapse' : 'Expand',
                icon: isExpanded ? '📂' : '📁',
                onClick: () => handleToggle(entry.path),
            });
        } else {
            items.push({
                label: 'Open Preview',
                icon: '👁️',
                onClick: () => {
                    setPreviewFile({ path: entry.path, name: entry.name });
                },
            });
        }

        items.push({
            label: '',
            separator: true,
            onClick: () => {},
        });

        items.push({
            label: 'Copy Path',
            icon: '📋',
            onClick: () => { navigator.clipboard.writeText(entry.path); },
        });

        items.push({
            label: 'Copy Name',
            icon: '📝',
            onClick: () => { navigator.clipboard.writeText(entry.name); },
        });

        return items;
    }, [expandedPaths, handleToggle]);

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

    // Keyboard shortcut: '/' to focus search, Escape to clear, Ctrl+P for Quick Open, Ctrl+O for Exact Open
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            // Ctrl+P / Cmd+P → Quick Open
            if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
                e.preventDefault();
                setQuickOpenVisible(true);
                return;
            }
            // Ctrl+O / Cmd+O → Exact Open
            if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
                e.preventDefault();
                setExactOpenVisible(true);
                return;
            }
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

    // On mobile: show file tree OR preview pane, not both
    const showMobilePreview = isMobile && !!previewFile;

    return (
        <div className={`flex flex-col lg:flex-row h-full overflow-hidden${isDragging ? ' select-none' : ''}`} data-testid="explorer-panel">
            {/* Left aside — file tree (hidden on mobile when previewing a file) */}
            <aside
                className="w-full flex-1 min-h-0 lg:flex-none border-b lg:border-b-0 lg:border-r border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] overflow-hidden flex flex-col"
                style={showMobilePreview ? { display: 'none' } : { width: undefined }}
                data-testid="explorer-sidebar"
            >
                <style>{`@media (min-width: 1024px) { [data-testid="explorer-sidebar"] { width: ${sidebarWidth}px !important; } }`}</style>
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
                    onContextMenu={handleTreeContextMenu}
                    filterQuery={searchQuery}
                />
            </aside>

            {/* Resize handle — desktop only */}
            <div
                className="hidden lg:flex items-center justify-center w-1 cursor-col-resize hover:bg-[#007acc]/30 active:bg-[#007acc]/50 transition-colors flex-shrink-0"
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
                data-testid="explorer-resize-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize sidebar"
                tabIndex={0}
            />

            {/* Right main — preview pane (full-screen on mobile when file is open) */}
            <main
                className={`flex-1 min-h-0 min-w-0 bg-white dark:bg-[#1e1e1e] overflow-hidden${previewFile ? '' : ' flex items-center justify-center'}`}
                style={isMobile && !previewFile ? { display: 'none' } : undefined}
                data-testid="explorer-preview-pane"
            >
                {previewFile
                    ? (
                        <div className="flex flex-col w-full h-full">
                            {/* Mobile back bar */}
                            {isMobile && (
                                <div
                                    className="flex items-center gap-2 h-10 px-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] flex-shrink-0"
                                    data-testid="explorer-mobile-back-bar"
                                >
                                    <button
                                        className="text-xs text-[#0078d4] dark:text-[#3794ff] hover:underline flex items-center gap-1"
                                        onClick={() => setPreviewFile(null)}
                                        data-testid="explorer-mobile-back-btn"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                                        </svg>
                                        Files
                                    </button>
                                    <span className="text-xs text-[#848484] truncate flex-1 text-right">{previewFile.name}</span>
                                </div>
                            )}
                            <div className="flex-1 min-h-0">
                                <PreviewPane
                                    repoId={workspaceId}
                                    filePath={previewFile.path}
                                    fileName={previewFile.name}
                                    onClose={isMobile ? undefined : () => setPreviewFile(null)}
                                />
                            </div>
                        </div>
                    )
                    : <p className="text-[#848484] text-sm">Click a file to preview</p>}
            </main>

            {/* Explorer context menu */}
            {contextMenu && (
                <ContextMenu
                    position={contextMenu.position}
                    items={buildContextMenuItems(contextMenu.entry)}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {/* Quick Open (Ctrl+P) */}
            <QuickOpen
                workspaceId={workspaceId}
                open={quickOpenVisible}
                onClose={() => setQuickOpenVisible(false)}
                onFileSelect={handleQuickOpenSelect}
            />

            {/* Exact Open (Ctrl+O) */}
            <ExactOpen
                workspaceId={workspaceId}
                open={exactOpenVisible}
                onClose={() => setExactOpenVisible(false)}
                onFileSelect={handleQuickOpenSelect}
            />
        </div>
    );
}
