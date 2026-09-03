/**
 * ExplorerPanel — top-level panel for the Explorer sub-tab.
 * Left/right split: FileTree sidebar + preview pane.
 * On mobile, shows either the file tree OR the preview pane (not both).
 */

import { useState, useEffect, useCallback, useRef, useMemo, useId, type Dispatch, type SetStateAction } from 'react';
import { Spinner } from '../../../ui';
import { useBreakpoint } from '../../../hooks/ui/useBreakpoint';
import { useResizablePanel } from '../../../hooks/ui/useResizablePanel';
import { FileTree } from './FileTree';
import { PreviewPane } from './PreviewPane';
import { SearchBar } from './SearchBar';
import { Breadcrumbs } from './Breadcrumbs';
import { QuickOpen } from './QuickOpen';
import { ContentSearchPanel } from './ContentSearchPanel';
import { SearchEditorPane } from './SearchEditorPane';
import { ExactOpen, TRUSTED_PATH_PREFIX, fileName as exactFileName } from './ExactOpen';
import { ContextMenu, type ContextMenuItem } from '../../../tasks/comments/ContextMenu';
import type { TreeEntry } from './types';
import { explorerApi } from './explorerApi';
import {
    useExplorerContentFilters,
    useExplorerExpandedPaths,
    useExplorerPreviewFile,
    useExplorerSelectedPath,
    useExplorerView,
} from './explorerStateStore';
import { useExplorerRootEntries, useExplorerChildrenMap, useExplorerRootLoaded } from './explorerTreeCache';
import { setExplorerInstanceDirty } from './explorerDirtyStore';

export interface ExplorerPanelProps {
    workspaceId: string;
    /**
     * Whether this mount owns the global `#repos/:id/explorer/:path` route.
     * Selecting a file writes that hash, which the router reads as "switch to
     * workspace :id and show its Explorer sub-tab" — correct for the Explorer
     * sub-tab itself, but wrong for a mount whose workspace is not the one the
     * app is showing. A repo group's dock points at a MEMBER repo, so the write
     * would navigate the user out of the group entirely; such a mount passes
     * `false` and keeps its selection purely local (it still persists through
     * explorerStateStore). Defaults to `true`.
     */
    deepLink?: boolean;
}

/** Recursively walk a depth-2 tree response and pre-populate a childrenMap. */
export function seedFromEntries(entries: TreeEntry[], map: Map<string, TreeEntry[]>): void {
    for (const e of entries) {
        if (e.type === 'dir' && e.children) {
            map.set(e.path, e.children);
            seedFromEntries(e.children, map);
        }
    }
}

/**
 * Returns every ancestor directory prefix of a repo-relative file path.
 * E.g. "src/components/Button/index.ts" → ["src", "src/components", "src/components/Button"]
 */
export function getAncestorPaths(filePath: string): string[] {
    const parts = filePath.split('/').filter(Boolean);
    const ancestors: string[] = [];
    for (let i = 1; i < parts.length; i++) {
        ancestors.push(parts.slice(0, i).join('/'));
    }
    return ancestors;
}

/**
 * For each path in `paths`, resolves ancestor directories not already in `childrenMap`,
 * fetches their tree data in parallel, then merges into `childrenMap` in a single update.
 * Returns the full set of ancestor directory paths across all input paths.
 */
export async function mergeServerResultsIntoChildrenMap(
    paths: string[],
    childrenMap: Map<string, TreeEntry[]>,
    setChildrenMap: Dispatch<SetStateAction<Map<string, TreeEntry[]>>>,
    workspaceId: string,
): Promise<string[]> {
    const allAncestors = new Set<string>();
    for (const p of paths) {
        for (const a of getAncestorPaths(p)) {
            allAncestors.add(a);
        }
    }
    const missing = [...allAncestors].filter(dir => !childrenMap.has(dir));
    if (missing.length > 0) {
        const results = await Promise.all(
            missing.map(dir =>
                explorerApi.tree(workspaceId, { path: dir })
                    .then((data: { entries: TreeEntry[] }) => ({ dir, entries: data.entries }))
                    .catch(() => null),
            ),
        );
        const updates: [string, TreeEntry[]][] = [];
        for (const r of results) {
            if (r) updates.push([r.dir, r.entries]);
        }
        if (updates.length > 0) {
            setChildrenMap(prev => new Map([...prev, ...updates]));
        }
    }
    return [...allAncestors];
}

/**
 * True when a tree request failed because the directory no longer exists.
 * The tree route answers a missing path with HTTP 404 ("Path not found: … does
 * not exist"), which the CoC client surfaces as a `CocApiError` carrying
 * `status`. Anything not recognisable as not-found is treated as a transient
 * failure by the caller, so this check stays deliberately narrow.
 */
export function isMissingDirError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    if ((err as { status?: unknown }).status === 404) return true;
    if ((err as { code?: unknown }).code === 'ENOENT') return true;
    const message = (err as { message?: unknown }).message;
    return typeof message === 'string'
        && /not found|does not exist|no such file or directory|ENOENT/i.test(message);
}

/** Best-effort human message for a rejected tree request. */
function errorMessage(reason: unknown): string {
    const message = reason instanceof Error ? reason.message : '';
    return message || 'Failed to load directory';
}

/**
 * Scroll offset that puts a row at the vertical middle of the tree's scroll
 * container, clamped to the scrollable range. Split out from the DOM so the
 * centring maths can be checked without laying out a real tree.
 *
 * `rowOffset` is the row's top measured against the container's *content* box
 * (i.e. already including the container's current scrollTop).
 */
export function computeCenterScrollTop(
    rowOffset: number,
    rowHeight: number,
    viewportHeight: number,
    maxScrollTop: number,
): number {
    const ideal = rowOffset + rowHeight / 2 - viewportHeight / 2;
    return Math.max(0, Math.min(ideal, Math.max(0, maxScrollTop)));
}

/** Quote a repo-relative path for use inside a `[data-testid="…"]` selector. */
function testIdSelector(path: string): string {
    return `[data-testid="tree-node-${path.replace(/["\\]/g, '\\$&')}"]`;
}

/** True when `path` is `root` itself or nested below it. */
function isAtOrUnder(path: string, root: string): boolean {
    return path === root || path.startsWith(`${root}/`);
}

/** Returns `paths` without any entry at or under one of `removedRoots`. */
export function prunePaths(paths: Iterable<string>, removedRoots: string[]): Set<string> {
    const next = new Set<string>();
    for (const p of paths) {
        if (!removedRoots.some(root => isAtOrUnder(p, root))) next.add(p);
    }
    return next;
}

export function ExplorerPanel({ workspaceId, deepLink = true }: ExplorerPanelProps) {
    const { isMobile } = useBreakpoint();
    const { width: sidebarWidth, isDragging, handleMouseDown, handleTouchStart } = useResizablePanel({
        initialWidth: 320,
        minWidth: 160,
        maxWidth: 600,
        storageKey: 'explorer-sidebar-width',
    });

    // Fetched tree data — cached in-memory per workspace so a switch-back reuses
    // already-loaded directory listings instead of re-fetching (AC-02). These
    // survive the `key={ws.id}` remount because they live in explorerTreeCache,
    // not in this component's React state. Cache is in-memory only; a page reload
    // starts empty and re-fetches.
    const [rootEntries, setRootEntries] = useExplorerRootEntries(workspaceId);
    const [childrenMap, setChildrenMap] = useExplorerChildrenMap(workspaceId);
    const [rootLoaded, setRootLoaded] = useExplorerRootLoaded(workspaceId);
    // Skip the mount spinner when the root listing is already cached from an
    // earlier visit to this workspace, so a switch-back renders instantly.
    const [loading, setLoading] = useState(!rootLoaded);
    const [error, setError] = useState<string | null>(null);
    // Refresh runs alongside the rendered tree: it only spins its own button, and
    // a run-id guard keeps a superseded refresh from overwriting fresher data.
    const [refreshing, setRefreshing] = useState(false);
    const refreshRunIdRef = useRef(0);

    // Per-workspace persisted UI state (localStorage). Because ExplorerPanel is
    // remounted with `key={ws.id}` on every workspace switch, these must survive
    // outside React state so expanded folders + the open file are restored when
    // the user switches back (and across a page reload). See explorerStateStore.
    const [selectedPath, setSelectedPath] = useExplorerSelectedPath(workspaceId);
    const [expandedPaths, setExpandedPaths] = useExplorerExpandedPaths(workspaceId);
    const [previewFile, setPreviewFile] = useExplorerPreviewFile(workspaceId);
    // The "Open in Editor" buffer (§2.7). In memory only — it is a snapshot of a
    // result set, and a stale one restored after a reload would be a lie.
    const [searchEditor, setSearchEditor] = useState<{ text: string; query: string } | null>(null);

    // Report the preview editor's unsaved-edits state into the per-workspace dirty
    // store so the workspace-switch guard (nav hooks) can prompt before discarding
    // it (AC-03). A stable per-mount id keeps sibling mounts (RepoDetail tab +
    // dock) independent; the flag is cleared when this panel unmounts.
    const dirtyInstanceId = useId();
    const reportPreviewDirty = useCallback((isDirty: boolean) => {
        setExplorerInstanceDirty(workspaceId, dirtyInstanceId, isDirty);
    }, [workspaceId, dirtyInstanceId]);
    useEffect(
        () => () => setExplorerInstanceDirty(workspaceId, dirtyInstanceId, false),
        [workspaceId, dirtyInstanceId],
    );

    // Which sidebar view is showing. Persisted per workspace, so the choice
    // survives a remount; the tree's own state is untouched while Search is up.
    const [view, setView] = useExplorerView(workspaceId);
    // Owned here only so "Find in Folder" can write the include glob; the Search
    // panel reads the same persisted store, so the write lands in its box.
    const [, setContentFilters] = useExplorerContentFilters(workspaceId);
    // Bumped by "Find in Folder" to move focus into the Search panel's query box.
    const [searchFocusToken, setSearchFocusToken] = useState(0);

    // Search state
    const [searchInput, setSearchInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();
    const searchInputRef = useRef<HTMLInputElement>(null);
    const preFilterExpandedRef = useRef<Set<string> | null>(null);

    // Server search state
    const [serverSearchLoading, setServerSearchLoading] = useState(false);
    const serverSearchTimerRef = useRef<ReturnType<typeof setTimeout>>();

    // Context menu state
    const [contextMenu, setContextMenu] = useState<{
        position: { x: number; y: number };
        entry: TreeEntry;
    } | null>(null);

    // Quick Open state (Ctrl+P)
    const [quickOpenVisible, setQuickOpenVisible] = useState(false);

    // Exact Open state (Ctrl+O)
    const [exactOpenVisible, setExactOpenVisible] = useState(false);

    // Reveal Open File: the handler expands ancestors, then hands the path that
    // should end up centred to the effect below. Centring has to wait for the
    // newly expanded rows to commit, so it cannot happen inside the handler.
    const [revealTarget, setRevealTarget] = useState<string | null>(null);
    const treeScrollRef = useRef<HTMLDivElement>(null);

    // Fetch root entries on mount — but skip it when the root listing is already
    // cached in-memory for this workspace (AC-02): a switch-back reuses the cache
    // instead of issuing a new tree-listing request.
    useEffect(() => {
        if (rootLoaded) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        explorerApi.tree(workspaceId, { path: '/', depth: 2 })
            .then((data: { entries: TreeEntry[] }) => {
                if (!cancelled) {
                    setRootEntries(data.entries);
                    const seedMap = new Map<string, TreeEntry[]>();
                    seedFromEntries(data.entries, seedMap);
                    if (seedMap.size > 0) {
                        setChildrenMap(prev => new Map([...prev, ...seedMap]));
                    }
                    setRootLoaded(true);
                }
            })
            .catch((err: Error) => {
                if (!cancelled) setError(err.message || 'Failed to load directory');
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Deep-link: read hash on mount to restore selected path and open file preview.
    // An explicit hash deep-link for THIS workspace wins over the persisted state
    // (per the feature decision). The `parts[1] === workspaceId` guard ensures a
    // stale hash left over from another workspace does not clobber this
    // workspace's restored state — each workspace's explorer stays independent.
    useEffect(() => {
        const hash = location.hash.replace(/^#/, '');
        const parts = hash.split('/');
        // #repos/:id/explorer/:path
        if (parts[0] === 'repos'
            && decodeURIComponent(parts[1] ?? '') === workspaceId
            && parts[2] === 'explorer'
            && parts[3]) {
            const decoded = decodeURIComponent(parts.slice(3).join('/'));
            setSelectedPath(decoded);
            const segments = decoded.split('/').filter(Boolean);
            const lastName = segments[segments.length - 1] ?? '';
            if (lastName.includes('.')) {
                setPreviewFile({ path: decoded, name: lastName });
            }
        }
    }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSelect = useCallback((path: string, isDirectory: boolean) => {
        setSelectedPath(path);
        // Update hash for deep-linking — only when this mount owns the route.
        if (deepLink) {
            location.hash = `#repos/${encodeURIComponent(workspaceId)}/explorer/${encodeURIComponent(path)}`;
        }
    }, [workspaceId, deepLink]);

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

    /**
     * Open a content-search hit: show the file in the preview pane scrolled to
     * the matching line, and move the tree selection to it so switching back to
     * the tree lands on the same file.
     */
    const handleOpenMatch = useCallback((filePath: string, line: number) => {
        const name = filePath.includes('/') ? filePath.slice(filePath.lastIndexOf('/') + 1) : filePath;
        setSelectedPath(filePath);
        // Opening a hit is a request to see the file, so the search buffer that
        // was covering the preview pane steps aside.
        setSearchEditor(null);
        setPreviewFile({ path: filePath, name, line });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    /**
     * "Open in Editor": park the rendered result set in the preview pane as a
     * read-only buffer. It sits *over* the preview rather than replacing it, so
     * closing the buffer returns to the file that was open.
     */
    const handleOpenSearchInEditor = useCallback((text: string, query: string) => {
        setSearchEditor({ text, query });
    }, []);

    const handleQuickOpenSelect = useCallback((filePath: string) => {
        // Trusted absolute-path from ExactOpen — skip tree expansion and hash update
        if (filePath.startsWith(TRUSTED_PATH_PREFIX)) {
            const absPath = filePath.slice(TRUSTED_PATH_PREFIX.length);
            const name = exactFileName(absPath);
            setSelectedPath(null);
            setPreviewFile({ path: filePath, name });
            return;
        }

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
        if (deepLink) {
            location.hash = `#repos/${encodeURIComponent(workspaceId)}/explorer/${encodeURIComponent(filePath)}`;
        }
    }, [workspaceId, deepLink]);

    const handleTreeContextMenu = useCallback((e: React.MouseEvent, entry: TreeEntry) => {
        setContextMenu({ position: { x: e.clientX, y: e.clientY }, entry });
    }, []);

    /**
     * VS Code's "Find in Folder": switch to the Search view and express the
     * scope as an *include* glob rather than a hidden request field, so it is
     * visible and the user can edit or clear it. Replaces the include box
     * outright — two folder scopes at once is never what the click meant.
     */
    const handleFindInFolder = useCallback((dirPath: string) => {
        setContentFilters(prev => ({ ...prev, include: `${dirPath}/**` }));
        setView('search');
        setSearchFocusToken(token => token + 1);
    }, [setContentFilters, setView]);

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
            items.push({
                label: 'Find in Folder',
                icon: '🔍',
                onClick: () => handleFindInFolder(entry.path),
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

        items.push({
            label: '',
            separator: true,
            onClick: () => {},
        });

        items.push({
            label: 'Reveal in File Explorer',
            icon: '🗂️',
            onClick: async () => {
                await explorerApi.reveal(workspaceId, entry.path);
            },
        });

        return items;
    }, [expandedPaths, handleToggle, handleFindInFolder]);

    /** Collapse All — clears expansion only; selection, preview and filter stay put. */
    const handleCollapseAll = useCallback(() => {
        setExpandedPaths(new Set());
    }, []);

    /**
     * Reveal Open File — expand every ancestor of the file in the preview pane and
     * centre its row. The tree is lazy-loaded, so each ancestor whose children are
     * not cached yet is fetched here and merged through `handleChildrenLoaded`,
     * which both keeps the shared cache authoritative and stops TreeNode from
     * re-fetching the same directory as it renders.
     *
     * Distinct from `explorerApi.reveal`, which reveals a path in the OS file
     * manager; this is purely client-side tree navigation.
     */
    const handleRevealOpenFile = useCallback(async () => {
        const target = previewFile?.path;
        // A trusted absolute path is outside the repo tree — it has no row to reveal.
        if (!target || target.startsWith(TRUSTED_PATH_PREFIX)) return;

        setError(null);
        const ancestors = getAncestorPaths(target);
        const known = new Set(childrenMap.keys());
        const toExpand: string[] = [];
        // A level that fails to load stops the walk: its own row still exists (its
        // parent is expanded and loaded), so that is the deepest thing to centre.
        let failedAt: string | null = null;

        for (const dir of ancestors) {
            if (!known.has(dir)) {
                try {
                    const data = await explorerApi.tree(workspaceId, { path: dir });
                    handleChildrenLoaded(dir, data.entries);
                    known.add(dir);
                } catch (err) {
                    setError(errorMessage(err));
                    failedAt = dir;
                    break;
                }
            }
            toExpand.push(dir);
        }

        if (toExpand.length > 0) {
            setExpandedPaths(prev => new Set([...prev, ...toExpand]));
        }
        setSelectedPath(target);
        setRevealTarget(failedAt ?? target);
    }, [previewFile, childrenMap, workspaceId, handleChildrenLoaded]);

    // Centre the revealed row once the expansion above has rendered. Runs against
    // the tree's own scroll container so nothing outside the sidebar moves.
    useEffect(() => {
        if (!revealTarget) return;
        const container = treeScrollRef.current;
        const row = container?.querySelector<HTMLElement>(testIdSelector(revealTarget));
        if (container && row) {
            const containerRect = container.getBoundingClientRect();
            const rowRect = row.getBoundingClientRect();
            const rowOffset = rowRect.top - containerRect.top + container.scrollTop;
            container.scrollTop = computeCenterScrollTop(
                rowOffset,
                rowRect.height,
                container.clientHeight,
                container.scrollHeight - container.clientHeight,
            );
        }
        setRevealTarget(null);
    }, [revealTarget]);

    /**
     * Refresh re-fetches the root listing plus every currently expanded directory
     * in parallel and swaps the results in atomically, so the open hierarchy,
     * selection and preview survive (AC-01). Nothing is blanked up-front: the tree
     * keeps rendering the previous data until fresh data for all of it has arrived,
     * which also means no open folder falls back to a loading spinner.
     */
    const handleRefresh = useCallback(() => {
        const runId = ++refreshRunIdRef.current;
        setRefreshing(true);
        setError(null);
        const targets = [...expandedPaths];
        Promise.allSettled([
            explorerApi.tree(workspaceId, { path: '/', depth: 2 }),
            ...targets.map(dir => explorerApi.tree(workspaceId, { path: dir })),
        ]).then(results => {
            // A newer refresh started while this one was in flight — its results win.
            if (runId !== refreshRunIdRef.current) return;

            const [rootResult, ...childResults] = results;
            if (rootResult.status === 'rejected') {
                setError(errorMessage(rootResult.reason));
                return;
            }

            // A directory that vanished from disk is pruned silently (AC-02); any
            // other failure aborts the whole swap so a transient error can never
            // collapse the tree (AC-03).
            const vanished: string[] = [];
            for (const [i, result] of childResults.entries()) {
                if (result.status !== 'rejected') continue;
                if (isMissingDirError(result.reason)) {
                    vanished.push(targets[i]);
                    continue;
                }
                setError(errorMessage(result.reason));
                return;
            }

            const nextMap = new Map<string, TreeEntry[]>();
            seedFromEntries(rootResult.value.entries, nextMap);
            for (const [i, result] of childResults.entries()) {
                if (result.status === 'fulfilled') nextMap.set(targets[i], result.value.entries);
            }
            for (const dir of nextMap.keys()) {
                if (vanished.some(root => isAtOrUnder(dir, root))) nextMap.delete(dir);
            }

            setRootEntries(rootResult.value.entries);
            setChildrenMap(nextMap);
            if (vanished.length > 0) {
                setExpandedPaths(prev => prunePaths(prev, vanished));
                // Keep the pre-filter snapshot in sync so clearing an active filter
                // cannot restore expansion for a directory that no longer exists.
                if (preFilterExpandedRef.current) {
                    preFilterExpandedRef.current = prunePaths(preFilterExpandedRef.current, vanished);
                }
            }
        }).finally(() => {
            if (runId === refreshRunIdRef.current) setRefreshing(false);
        });
    }, [workspaceId, expandedPaths]);

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

    // Server search: debounce 300 ms, seed childrenMap with results from unexplored directories
    useEffect(() => {
        if (serverSearchTimerRef.current) clearTimeout(serverSearchTimerRef.current);
        if (!searchQuery) {
            setServerSearchLoading(false);
            return;
        }
        serverSearchTimerRef.current = setTimeout(() => {
            setServerSearchLoading(true);
            explorerApi.searchFiles(workspaceId, searchQuery, { limit: 100 })
                .then(async (data: { results: { path: string; score: number }[] }) => {
                    const paths = data.results.map(r => r.path);
                    const ancestors = await mergeServerResultsIntoChildrenMap(
                        paths, childrenMap, setChildrenMap, workspaceId,
                    );
                    if (ancestors.length > 0) {
                        setExpandedPaths(prev => {
                            const next = new Set(prev);
                            for (const a of ancestors) next.add(a);
                            return next;
                        });
                    }
                })
                .catch(() => { /* silently ignore search errors */ })
                .finally(() => setServerSearchLoading(false));
        }, 300);
        return () => {
            if (serverSearchTimerRef.current) clearTimeout(serverSearchTimerRef.current);
        };
    }, [searchQuery, workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

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
            if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA' && !(document.activeElement as HTMLElement)?.isContentEditable) {
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

    // A failed mount fetch has nothing to show but the error. Once the root has
    // loaded, an error (from Refresh) is shown as a banner above the tree instead,
    // so a failed refresh never blanks the hierarchy (AC-03).
    if (error && !rootLoaded) {
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
                    <div className="flex items-center gap-2" role="tablist" aria-label="Explorer view">
                        {(['tree', 'search'] as const).map(target => (
                            <button
                                key={target}
                                role="tab"
                                aria-selected={view === target}
                                onClick={() => setView(target)}
                                className={`text-xs bg-transparent border-none p-0 cursor-pointer transition-colors ${
                                    view === target
                                        ? 'font-medium text-[#1e1e1e] dark:text-[#cccccc]'
                                        : 'text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]'
                                }`}
                                data-testid={`explorer-view-${target}`}
                            >
                                {target === 'tree' ? 'Files' : 'Search'}
                            </button>
                        ))}
                    </div>
                    {/* The header toolbar belongs to the Files view: collapsing,
                        revealing and refreshing the tree all say nothing in Search,
                        which carries its own strip (ContentSearchToolbar) at the top
                        of the panel instead. */}
                    <div className="flex items-center gap-2">
                        {view === 'tree' && (
                            <>
                                <button
                                    className="text-xs text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] transition-colors disabled:opacity-50"
                                    onClick={handleCollapseAll}
                                    title="Collapse all"
                                    disabled={expandedPaths.size === 0}
                                    data-testid="explorer-collapse-all-btn"
                                >
                                    ⊟
                                </button>
                                <button
                                    className="text-xs text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] transition-colors disabled:opacity-50"
                                    onClick={handleRevealOpenFile}
                                    title="Reveal open file"
                                    disabled={!previewFile}
                                    data-testid="explorer-reveal-file-btn"
                                >
                                    ⊙
                                </button>
                                <button
                                    className="text-xs text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] transition-colors disabled:opacity-50"
                                    onClick={handleRefresh}
                                    title="Refresh"
                                    disabled={refreshing}
                                    aria-busy={refreshing}
                                    data-testid="explorer-refresh-btn"
                                >
                                    ↻
                                </button>
                            </>
                        )}
                    </div>
                </div>
                {error && (
                    <div
                        className="px-3 py-1 text-xs text-[#d32f2f] border-b border-[#e0e0e0] dark:border-[#3c3c3c]"
                        data-testid="explorer-error"
                    >
                        {error}
                    </div>
                )}
                {view === 'search' ? (
                    <ContentSearchPanel
                        workspaceId={workspaceId}
                        focusQueryToken={searchFocusToken}
                        onOpenMatch={handleOpenMatch}
                        onOpenInEditor={handleOpenSearchInEditor}
                    />
                ) : (
                    <>
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
                        {serverSearchLoading && (
                            <div className="px-3 py-0.5 text-xs text-[#848484]" data-testid="explorer-server-search-loading">
                                Searching…
                            </div>
                        )}
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
                            scrollRef={treeScrollRef}
                        />
                    </>
                )}
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
                className={`flex-1 min-h-0 min-w-0 bg-white dark:bg-[#1e1e1e] overflow-hidden${previewFile || searchEditor ? '' : ' flex items-center justify-center'}`}
                style={isMobile && !previewFile && !searchEditor ? { display: 'none' } : undefined}
                data-testid="explorer-preview-pane"
            >
                {searchEditor
                    ? (
                        <SearchEditorPane
                            query={searchEditor.query}
                            text={searchEditor.text}
                            onClose={() => setSearchEditor(null)}
                        />
                    )
                    : previewFile
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
                                    revealLine={previewFile.line}
                                    onClose={isMobile ? undefined : () => setPreviewFile(null)}
                                    onDirtyChange={reportPreviewDirty}
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
