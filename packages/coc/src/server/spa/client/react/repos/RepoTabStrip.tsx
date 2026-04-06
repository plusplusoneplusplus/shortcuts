/**
 * RepoTabStrip — horizontal tab strip for repo switching in the TopBar.
 * Shows visible tabs that fit, with a "+N" overflow pill and dropdown for the rest.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { AddRepoDialog } from './AddRepoDialog';
import { AddFolderDialog } from './AddFolderDialog';
import type { RepoData, RepoGroup } from './repoGrouping';
import { groupReposByRemote, applyGroupOrder } from './repoGrouping';
import { useApp } from '../context/AppContext';
import { useQueue } from '../context/QueueContext';
import { isHidden as isHiddenTask } from '../hooks/useRepoQueueStats';
import { getApiBase } from '../utils/config';
import { fetchApi } from '../hooks/useApi';
import { GenerateTaskDialog } from '../tasks/GenerateTaskDialog';

export type QueueDotStatus = 'idle' | 'running' | 'queued' | 'paused';

/** Returns the extra CSS class(es) for a repo-tab dot based on its queue status. */
export function getDotAnimationClass(status: QueueDotStatus): string {
    switch (status) {
        case 'running': return ' animate-pulse';
        case 'queued': return ' animate-blink';
        case 'paused': return ' ring-1 ring-[#f14c4c]';
        default: return '';
    }
}

export interface RepoTabStripProps {
    repos: RepoData[];
    selectedRepoId: string | null;
    onSelect: (id: string) => void;
    unseenCounts: Record<string, number>;
    onRefresh: () => void;
}

interface ContextMenuState {
    repoId: string;
    x: number;
    y: number;
}

/**
 * Compute which repo IDs are visible given a container width.
 * Measures each tab's offsetWidth and accumulates until the budget runs out.
 * The selected repo is always included; if it doesn't fit naturally it replaces
 * the last visible tab.
 */
export function computeVisibleRepoIds(
    tabElements: HTMLElement[],
    containerWidth: number,
    selectedRepoId: string | null,
): Set<string> {
    if (containerWidth <= 0) {
        // Extremely narrow: show only the selected repo (if any)
        if (selectedRepoId) return new Set([selectedRepoId]);
        return new Set<string>();
    }

    const visible = new Set<string>();
    let usedWidth = 0;
    let lastVisibleId: string | null = null;

    for (const el of tabElements) {
        const id = el.getAttribute('data-repo-id');
        if (!id) continue;
        // Include the gap between tabs (approximate 2px for gap-0.5)
        const width = el.offsetWidth + 2;
        if (usedWidth + width <= containerWidth) {
            visible.add(id);
            usedWidth += width;
            lastVisibleId = id;
        } else {
            break;
        }
    }

    // Ensure selected repo is always visible
    if (selectedRepoId && !visible.has(selectedRepoId)) {
        if (lastVisibleId && visible.size > 0) {
            visible.delete(lastVisibleId);
        }
        visible.add(selectedRepoId);
    }

    return visible;
}

/**
 * Flatten grouped repos into a flat ordered list of repo IDs.
 */
function flattenGroups(groups: RepoGroup[]): string[] {
    const ids: string[] = [];
    for (const g of groups) {
        for (const r of g.repos) ids.push(r.workspace.id);
    }
    return ids;
}

export function RepoTabStrip({ repos, selectedRepoId, onSelect, unseenCounts, onRefresh }: RepoTabStripProps) {
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const [addFolderOpen, setAddFolderOpen] = useState(false);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [editRepoId, setEditRepoId] = useState<string | null>(null);
    const [generateDialog, setGenerateDialog] = useState<{
        open: boolean;
        minimized: boolean;
        wsId: string | undefined;
        targetFolder: string | undefined;
    }>({ open: false, minimized: false, wsId: undefined, targetFolder: undefined });
    const [overflowOpen, setOverflowOpen] = useState(false);
    const [overflowFilter, setOverflowFilter] = useState('');
    const [overflowHighlight, setOverflowHighlight] = useState(-1);
    const [visibleRepoIds, setVisibleRepoIds] = useState<Set<string> | null>(null);
    const [groupOrder, setGroupOrder] = useState<string[]>([]);

    const dropdownRef = useRef<HTMLDivElement>(null);
    const contextMenuRef = useRef<HTMLDivElement>(null);
    const overflowRef = useRef<HTMLDivElement>(null);
    const overflowFilterRef = useRef<HTMLInputElement>(null);
    const tabContainerRef = useRef<HTMLDivElement>(null);
    const measureContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let cancelled = false;
        fetchApi('/preferences').then((prefs: any) => {
            if (!cancelled && Array.isArray(prefs?.gitGroupOrder)) {
                setGroupOrder(prefs.gitGroupOrder);
            }
        });
        return () => { cancelled = true; };
    }, []);

    const rawGroups = useMemo(() => groupReposByRemote(repos, {}), [repos]);
    const groups = useMemo(() => applyGroupOrder(rawGroups, groupOrder), [rawGroups, groupOrder]);
    const allRepoIds = useMemo(() => flattenGroups(groups), [groups]);
    const { dispatch } = useApp();
    const { state: queueState, dispatch: queueDispatch } = useQueue();

    /** Pre-computed queue-dot status for each repo. */
    const repoQueueStatusMap = useMemo<Record<string, QueueDotStatus>>(() => {
        const map: Record<string, QueueDotStatus> = {};
        for (const repo of repos) {
            const wsId = repo.workspace.id;
            const entry = queueState.repoQueueMap?.[wsId];
            if (!entry) { map[wsId] = 'idle'; continue; }
            if (entry.stats?.isPaused) { map[wsId] = 'paused'; continue; }
            const running = (entry.running ?? []).filter(t => !isHiddenTask(t)).length;
            if (running > 0) { map[wsId] = 'running'; continue; }
            const queued = (entry.queued ?? []).filter(t => !isHiddenTask(t)).length;
            if (queued > 0) { map[wsId] = 'queued'; continue; }
            map[wsId] = 'idle';
        }
        return map;
    }, [repos, queueState.repoQueueMap]);

    const handleRemove = async (repoId: string) => {
        if (!confirm('Remove this repo from the dashboard? Processes will be preserved.')) return;
        await fetch(getApiBase() + '/workspaces/' + encodeURIComponent(repoId), { method: 'DELETE' });
        dispatch({ type: 'SET_SELECTED_REPO', id: null });
        location.hash = '';
        onRefresh();
    };

    // Overflow detection via ResizeObserver
    const recalcOverflow = useCallback(() => {
        const measureEl = measureContainerRef.current;
        const containerEl = tabContainerRef.current;
        if (!measureEl || !containerEl) return;
        const containerWidth = containerEl.clientWidth;
        if (containerWidth <= 0) {
            // No layout engine (e.g., jsdom, hidden container) — show all tabs
            setVisibleRepoIds(prev => prev === null ? prev : null);
            return;
        }
        const tabEls = Array.from(measureEl.querySelectorAll<HTMLElement>('[data-repo-id]'));
        if (tabEls.length === 0) {
            setVisibleRepoIds(null);
            return;
        }
        const vis = computeVisibleRepoIds(tabEls, containerWidth, selectedRepoId);
        if (vis.size >= allRepoIds.length) {
            setVisibleRepoIds(prev => prev === null ? prev : null);
        } else {
            setVisibleRepoIds(prev => {
                if (prev !== null && prev.size === vis.size && [...vis].every(id => prev.has(id))) {
                    return prev;
                }
                return vis;
            });
        }
    }, [selectedRepoId, allRepoIds]);

    useEffect(() => {
        const el = tabContainerRef.current;
        if (!el) return;
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(recalcOverflow);
        ro.observe(el);
        recalcOverflow();
        return () => ro.disconnect();
    }, [recalcOverflow]);

    // Recalc when repos change
    useEffect(() => {
        recalcOverflow();
    }, [repos, recalcOverflow]);

    const overflowCount = visibleRepoIds ? allRepoIds.length - visibleRepoIds.size : 0;
    const hasOverflow = overflowCount > 0;
    const overflowHasUnseen = hasOverflow && allRepoIds.some(
        id => !visibleRepoIds!.has(id) && (unseenCounts[id] ?? 0) > 0
    );
    const selectedIsHidden = hasOverflow && selectedRepoId != null && !visibleRepoIds!.has(selectedRepoId);

    // Filtered repos for overflow dropdown (all repos, filtered by search)
    const filteredReposForDropdown = useMemo(() => {
        const lowerFilter = overflowFilter.toLowerCase();
        const result: { group: RepoGroup; repos: RepoData[] }[] = [];
        for (const g of groups) {
            const matched = lowerFilter
                ? g.repos.filter(r => r.workspace.name.toLowerCase().includes(lowerFilter))
                : g.repos;
            if (matched.length > 0) {
                result.push({ group: g, repos: matched });
            }
        }
        return result;
    }, [groups, overflowFilter]);

    const flatFilteredRepos = useMemo(
        () => filteredReposForDropdown.flatMap(g => g.repos),
        [filteredReposForDropdown]
    );

    // Close handlers for add dropdown
    useEffect(() => {
        if (!dropdownOpen) return;
        const handleMouseDown = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setDropdownOpen(false);
        };
        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [dropdownOpen]);

    // Close handlers for context menu
    useEffect(() => {
        if (!contextMenu) return;
        const handleMouseDown = (e: MouseEvent) => {
            if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
                setContextMenu(null);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setContextMenu(null);
        };
        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [contextMenu]);

    // Close handlers for overflow dropdown
    useEffect(() => {
        if (!overflowOpen) return;
        const handleMouseDown = (e: MouseEvent) => {
            if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
                setOverflowOpen(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setOverflowOpen(false);
            }
        };
        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [overflowOpen]);

    // Focus search when overflow dropdown opens
    useEffect(() => {
        if (overflowOpen && overflowFilterRef.current) {
            overflowFilterRef.current.focus();
        }
        if (!overflowOpen) {
            setOverflowFilter('');
            setOverflowHighlight(-1);
        }
    }, [overflowOpen]);

    const handleOverflowKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOverflowHighlight(prev => Math.min(prev + 1, flatFilteredRepos.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setOverflowHighlight(prev => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter' && overflowHighlight >= 0 && overflowHighlight < flatFilteredRepos.length) {
            e.preventDefault();
            onSelect(flatFilteredRepos[overflowHighlight].workspace.id);
            setOverflowOpen(false);
        }
    };

    const isRepoVisible = (id: string) => !visibleRepoIds || visibleRepoIds.has(id);

    const renderTab = (repo: RepoData) => {
        const ws = repo.workspace;
        const isSelected = ws.id === selectedRepoId;
        const unseenCount = unseenCounts[ws.id] ?? 0;
        const color = ws.color || '#848484';
        return (
            <button
                key={ws.id}
                data-testid="repo-tab"
                data-repo-id={ws.id}
                className={
                    'relative flex items-center gap-1.5 px-2.5 h-7 rounded text-xs whitespace-nowrap shrink-0 transition-colors ' +
                    (isSelected
                        ? 'bg-[#0078d4] text-white'
                        : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]')
                }
                aria-pressed={isSelected}
                aria-label={ws.name}
                title={ws.name}
                onClick={() => onSelect(ws.id)}
                onContextMenu={e => {
                    e.preventDefault();
                    setContextMenu({ repoId: ws.id, x: e.clientX, y: e.clientY });
                }}
            >
                <span
                    className={"inline-block w-2 h-2 rounded-full flex-shrink-0" + getDotAnimationClass(repoQueueStatusMap[ws.id] ?? 'idle')}
                    style={{ background: isSelected ? 'rgba(255,255,255,0.7)' : color }}
                    data-testid="repo-tab-dot"
                />
                <span className="max-w-[100px] truncate">{ws.name}</span>
                {unseenCount > 0 && (
                    <span
                        className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-[3px] rounded-full bg-[#d16969] text-white text-[8px] font-semibold flex items-center justify-center leading-none"
                        data-testid="repo-tab-unseen-badge"
                        aria-label={`${unseenCount} unread`}
                    >
                        {unseenCount > 99 ? '99+' : unseenCount}
                    </span>
                )}
            </button>
        );
    };

    // Measurement elements — lightweight divs that mirror tab sizing for width measurement
    const renderMeasureTab = (repo: RepoData) => {
        const ws = repo.workspace;
        return (
            <span
                key={ws.id}
                data-repo-id={ws.id}
                className="inline-flex items-center gap-1.5 px-2.5 h-7 text-xs whitespace-nowrap shrink-0"
            >
                <span className="inline-block w-2 h-2" />
                <span className="max-w-[100px] truncate">{ws.name}</span>
            </span>
        );
    };

    return (
        <div
            className="flex items-center flex-1 min-w-0"
            data-testid="repo-tab-strip"
        >
        {/* Hidden measurement container — lightweight spans to measure natural widths */}
        <div
            ref={measureContainerRef}
            className="flex items-center gap-0.5 absolute invisible overflow-hidden h-0"
            style={{ pointerEvents: 'none' }}
            aria-hidden="true"
            data-testid="repo-tab-measure-container"
        >
            {groups.map((group, groupIndex) => (
                <div key={group.normalizedUrl ?? `ungrouped-${groupIndex}`} className="contents">
                    {group.repos.map(repo => renderMeasureTab(repo))}
                </div>
            ))}
        </div>
        {/* Visible tab container */}
        <div
            ref={tabContainerRef}
            className="flex items-center gap-0.5 overflow-hidden flex-1 min-w-0 px-1"
            data-testid="repo-tab-visible-container"
        >
            {groups.map((group, groupIndex) => {
                const visibleInGroup = group.repos.filter(r => isRepoVisible(r.workspace.id));
                if (visibleInGroup.length === 0) return null;
                return (
                    <div key={group.normalizedUrl ?? `ungrouped-${groupIndex}`} className="contents">
                        {groupIndex > 0 && groups.slice(0, groupIndex).some(g => g.repos.some(r => isRepoVisible(r.workspace.id))) && (
                            <div
                                className="h-5 w-px bg-gray-300 dark:bg-gray-600 mx-1 flex-shrink-0"
                                data-testid="repo-group-separator"
                                title={group.normalizedUrl ? group.label : undefined}
                            />
                        )}
                        {visibleInGroup.map(repo => renderTab(repo))}
                    </div>
                );
            })}
        </div>
        {/* "+N" overflow pill */}
        {hasOverflow && (
            <div ref={overflowRef} className="relative flex-shrink-0 px-0.5" data-testid="overflow-pill-container">
                <button
                    data-testid="overflow-pill"
                    className={
                        'relative flex items-center justify-center h-7 px-2.5 rounded-full text-xs font-medium transition-colors cursor-pointer ' +
                        (selectedIsHidden
                            ? 'bg-[#0078d4]/15 dark:bg-[#3794ff]/20 text-[#0078d4] dark:text-[#3794ff] border-l-2 border-[#0078d4] dark:border-[#3794ff] '
                            : 'bg-gray-200 dark:bg-gray-700 text-[#1e1e1e] dark:text-[#cccccc] ') +
                        'hover:bg-gray-300 dark:hover:bg-gray-600'
                    }
                    aria-label={`${overflowCount} more repositories — click to see all`}
                    title={`${overflowCount} more repositories — click to see all`}
                    onClick={() => setOverflowOpen(prev => !prev)}
                >
                    +{overflowCount}
                    {overflowHasUnseen && (
                        <span
                            className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#d16969]"
                            data-testid="overflow-pill-unseen-dot"
                        />
                    )}
                </button>
                {overflowOpen && (
                    <div
                        data-testid="overflow-dropdown"
                        className="absolute right-0 top-full mt-1 z-50 min-w-[240px] max-w-[360px] bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded shadow-lg py-1"
                        role="menu"
                        onKeyDown={handleOverflowKeyDown}
                    >
                        {/* Search field */}
                        <div className="px-2 pb-1">
                            <input
                                ref={overflowFilterRef}
                                data-testid="overflow-filter-input"
                                type="text"
                                placeholder="Filter repos..."
                                className="w-full h-7 px-2 text-xs rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4]"
                                value={overflowFilter}
                                onChange={e => { setOverflowFilter(e.target.value); setOverflowHighlight(-1); }}
                            />
                        </div>
                        {/* Repo list */}
                        <div className="max-h-[320px] overflow-y-auto" data-testid="overflow-repo-list">
                            {filteredReposForDropdown.length === 0 ? (
                                <div
                                    className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500"
                                    data-testid="overflow-no-results"
                                >
                                    No matching repos
                                </div>
                            ) : (
                                filteredReposForDropdown.map(({ group, repos: groupRepos }, gIdx) => (
                                    <div key={group.normalizedUrl ?? `overflow-group-${gIdx}`}>
                                        {gIdx > 0 && (
                                            <hr className="my-1 border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="overflow-group-divider" />
                                        )}
                                        {groupRepos.map(repo => {
                                            const ws = repo.workspace;
                                            const isSelected = ws.id === selectedRepoId;
                                            const unseenCount = unseenCounts[ws.id] ?? 0;
                                            const color = ws.color || '#848484';
                                            const flatIdx = flatFilteredRepos.indexOf(repo);
                                            const isHighlighted = flatIdx === overflowHighlight;
                                            return (
                                                <button
                                                    key={ws.id}
                                                    data-testid="overflow-repo-item"
                                                    data-repo-id={ws.id}
                                                    className={
                                                        'w-full flex items-center gap-2 h-8 px-3 text-xs text-left cursor-pointer transition-colors ' +
                                                        (isHighlighted
                                                            ? 'bg-[#0078d4]/10 dark:bg-[#3794ff]/10 '
                                                            : isSelected
                                                                ? 'bg-[#0078d4]/5 '
                                                                : '') +
                                                        'hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 text-[#1e1e1e] dark:text-[#cccccc]'
                                                    }
                                                    role="menuitem"
                                                    onClick={() => { onSelect(ws.id); setOverflowOpen(false); }}
                                                    onContextMenu={e => {
                                                        e.preventDefault();
                                                        setContextMenu({ repoId: ws.id, x: e.clientX, y: e.clientY });
                                                        setOverflowOpen(false);
                                                    }}
                                                >
                                                    <span
                                                        className={"inline-block w-2 h-2 rounded-full flex-shrink-0" + getDotAnimationClass(repoQueueStatusMap[ws.id] ?? 'idle')}
                                                        style={{ background: color }}
                                                        data-testid="overflow-repo-dot"
                                                    />
                                                    <span className="flex-1 truncate">{ws.name}</span>
                                                    {isSelected && (
                                                        <span className="text-[#0078d4] dark:text-[#3794ff]" data-testid="overflow-selected-check">✓</span>
                                                    )}
                                                    {unseenCount > 0 && (
                                                        <span
                                                            className="min-w-[14px] h-[14px] px-[3px] rounded-full bg-[#d16969] text-white text-[8px] font-semibold flex items-center justify-center leading-none"
                                                            data-testid="overflow-unseen-badge"
                                                        >
                                                            {unseenCount > 99 ? '99+' : unseenCount}
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}
            </div>
        )}
        {/* "+" button is outside overflow-x-auto so its dropdown is not clipped */}
        <div ref={dropdownRef} className="relative flex-shrink-0 px-1">
            <button
                data-testid="repo-tab-add-btn"
                className="h-7 w-7 rounded flex items-center justify-center text-base hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#1e1e1e] dark:text-[#cccccc]"
                aria-label="Add repository"
                aria-haspopup="true"
                aria-expanded={dropdownOpen}
                title="Add repository"
                onClick={() => setDropdownOpen(prev => !prev)}
            >
                +
            </button>
            {dropdownOpen && (
                <div
                    data-testid="repo-tab-add-dropdown"
                    className="absolute right-0 top-full mt-1 z-50 min-w-[190px] bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded shadow-lg py-1"
                    role="menu"
                >
                    <button
                        data-testid="repo-tab-add-folder-option"
                        className="w-full text-left px-3 py-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 cursor-pointer"
                        role="menuitem"
                        onClick={() => { setDropdownOpen(false); setAddFolderOpen(true); }}
                    >
                        📁 Add workspace folder
                    </button>
                    <button
                        data-testid="repo-tab-add-repo-option"
                        className="w-full text-left px-3 py-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 cursor-pointer"
                        role="menuitem"
                        onClick={() => { setDropdownOpen(false); setAddOpen(true); }}
                    >
                        ＋ Add specific repository
                    </button>
                </div>
            )}
        </div>
            <AddRepoDialog
                open={addOpen}
                onClose={() => setAddOpen(false)}
                repos={repos}
                onSuccess={() => { setAddOpen(false); onRefresh(); }}
            />
            <AddFolderDialog
                open={addFolderOpen}
                onClose={() => setAddFolderOpen(false)}
                onAdded={() => { setAddFolderOpen(false); onRefresh(); }}
            />
            <AddRepoDialog
                open={editRepoId !== null}
                onClose={() => setEditRepoId(null)}
                editId={editRepoId}
                repos={repos}
                onSuccess={() => { setEditRepoId(null); onRefresh(); }}
            />
            {contextMenu !== null && (() => {                const ws = repos.flatMap(r => [r.workspace]).find(w => w.id === contextMenu.repoId);
                if (!ws) return null;
                return (
                    <div
                        ref={contextMenuRef}
                        data-testid="repo-tab-context-menu"
                        className="fixed z-50 min-w-[160px] bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded shadow-lg py-1"
                        role="menu"
                        style={{ left: contextMenu.x, top: contextMenu.y }}
                    >
                        <button
                            data-testid="repo-tab-context-queue-task"
                            className="w-full text-left px-3 py-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 cursor-pointer"
                            role="menuitem"
                            onClick={() => {
                                queueDispatch({ type: 'OPEN_DIALOG', workspaceId: ws.id });
                                setContextMenu(null);
                            }}
                        >
                            🤖 Queue Task
                        </button>
                        <button
                            data-testid="repo-tab-context-ask"
                            className="w-full text-left px-3 py-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 cursor-pointer"
                            role="menuitem"
                            onClick={() => {
                                queueDispatch({ type: 'OPEN_DIALOG', workspaceId: ws.id, mode: 'ask' });
                                setContextMenu(null);
                            }}
                        >
                            💡 Ask
                        </button>
                        <button
                            data-testid="repo-tab-context-run-script"
                            className="w-full text-left px-3 py-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 cursor-pointer"
                            role="menuitem"
                            onClick={() => {
                                queueDispatch({ type: 'OPEN_SCRIPT_DIALOG', workspaceId: ws.id });
                                setContextMenu(null);
                            }}
                        >
                            ⚡ Run Script
                        </button>
                        <button
                            data-testid="repo-tab-context-generate-plan"
                            className="w-full text-left px-3 py-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 cursor-pointer"
                            role="menuitem"
                            onClick={() => {
                                setGenerateDialog({ open: true, minimized: false, wsId: ws.id, targetFolder: ws.rootPath });
                                setContextMenu(null);
                            }}
                        >
                            📋 Generate Plan
                        </button>
                        <hr className="my-1 border-[#e0e0e0] dark:border-[#3c3c3c]" />
                        <button
                            data-testid="repo-tab-context-edit"
                            className="w-full text-left px-3 py-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 cursor-pointer"
                            role="menuitem"
                            onClick={() => {
                                setEditRepoId(contextMenu.repoId);
                                setContextMenu(null);
                            }}
                        >
                            Edit
                        </button>
                        <button
                            data-testid="repo-tab-context-remove"
                            className="w-full text-left px-3 py-1.5 text-xs text-[#d16969] hover:bg-[#d16969]/10 cursor-pointer"
                            role="menuitem"
                            onClick={() => {
                                setContextMenu(null);
                                handleRemove(contextMenu.repoId);
                            }}
                        >
                            Remove
                        </button>
                        <hr className="my-1 border-[#e0e0e0] dark:border-[#3c3c3c]" />
                        <button
                            data-testid="repo-tab-context-copy-info"
                            className="w-full text-left px-3 py-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 cursor-pointer"
                            role="menuitem"
                            onClick={() => {
                                navigator.clipboard.writeText(`${ws.name}: ${ws.rootPath ?? ''}${ws.description ? '\n' + ws.description : ''}`);
                                setContextMenu(null);
                            }}
                        >
                            Copy Repo Info
                        </button>
                    </div>
                );
            })()}
            {generateDialog.open && generateDialog.wsId && (
                <GenerateTaskDialog
                    wsId={generateDialog.wsId}
                    initialFolder={generateDialog.targetFolder}
                    minimized={generateDialog.minimized}
                    onMinimize={() => setGenerateDialog(prev => ({ ...prev, minimized: true }))}
                    onRestore={() => setGenerateDialog(prev => ({ ...prev, minimized: false }))}
                    onClose={() => setGenerateDialog({ open: false, minimized: false, wsId: undefined, targetFolder: undefined })}
                    onSuccess={() => setGenerateDialog({ open: false, minimized: false, wsId: undefined, targetFolder: undefined })}
                />
            )}
        </div>
    );
}
