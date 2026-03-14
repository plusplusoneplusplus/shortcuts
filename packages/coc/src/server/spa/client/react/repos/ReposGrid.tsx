/**
 * ReposGrid — left sidebar listing repos grouped by remote URL.
 * Owns data fetching and enrichment for all repo sub-tabs.
 * Supports drag-and-drop reordering of groups persisted via /api/preferences.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { useQueue } from '../context/QueueContext';
import { fetchApi } from '../hooks/useApi';
import { Button, cn } from '../shared';
import { RepoCard } from './RepoCard';
import { AddRepoDialog } from './AddRepoDialog';
import { AddFolderDialog } from './AddFolderDialog';
import { groupReposByRemote, applyGroupOrder, groupKey } from './repoGrouping';
import type { RepoData, RepoGroup } from './repoGrouping';
import { getApiBase } from '../utils/config';

const GROUP_DRAG_MIME = 'application/x-git-group-drag';
const GROUP_EXPANDED_KEY = 'coc-git-group-expanded-state';

export function loadGroupExpandedState(): Record<string, boolean> {
    try {
        const raw = localStorage.getItem(GROUP_EXPANDED_KEY);
        if (raw) return JSON.parse(raw) as Record<string, boolean>;
    } catch { /* SSR / test */ }
    return {};
}

export function saveGroupExpandedState(state: Record<string, boolean>): void {
    try {
        localStorage.setItem(GROUP_EXPANDED_KEY, JSON.stringify(state));
    } catch { /* SSR / test */ }
}

interface ReposGridProps {
    repos: RepoData[];
    onRefresh: () => void;
}

export function ReposGrid({ repos, onRefresh }: ReposGridProps) {
    const { state, dispatch } = useApp();
    const { dispatch: queueDispatch } = useQueue();
    const [expandedState, setExpandedState] = useState<Record<string, boolean>>(loadGroupExpandedState);
    const [addOpen, setAddOpen] = useState(false);
    const [addFolderOpen, setAddFolderOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Group order (persisted via /api/preferences)
    const [groupOrder, setGroupOrder] = useState<string[]>([]);

    // Drag state
    const [draggingIdx, setDraggingIdx] = useState<number>(-1);
    const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);
    const [dropPosition, setDropPosition] = useState<'above' | 'below' | null>(null);
    const draggingIdxRef = useRef<number>(-1);
    const enterCountRef = useRef<Map<number, number>>(new Map());

    // Load persisted group order from global preferences
    useEffect(() => {
        let cancelled = false;
        fetchApi('/preferences').then((prefs: any) => {
            if (!cancelled && Array.isArray(prefs?.gitGroupOrder)) {
                setGroupOrder(prefs.gitGroupOrder);
            }
        }).catch(() => {});
        return () => { cancelled = true; };
    }, []);

    // Close dropdown on outside click
    useEffect(() => {
        if (!menuOpen) return;
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [menuOpen]);

    const rawGroups = groupReposByRemote(repos, expandedState);
    const groups = applyGroupOrder(rawGroups, groupOrder);

    const toggleGroup = (url: string) => {
        setExpandedState(prev => {
            const next = { ...prev, [url]: prev[url] === false };
            saveGroupExpandedState(next);
            return next;
        });
    };

    const selectRepo = (id: string) => {
        dispatch({ type: 'SET_SELECTED_REPO', id });
        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null });
        location.hash = '#repos/' + encodeURIComponent(id);
    };

    // ── Drag handlers ──────────────────────────────────────────────────

    const handleDragStart = useCallback((e: React.DragEvent, idx: number) => {
        e.dataTransfer.setData(GROUP_DRAG_MIME, String(idx));
        e.dataTransfer.effectAllowed = 'move';
        setDraggingIdx(idx);
        draggingIdxRef.current = idx;
    }, []);

    const handleDragEnd = useCallback(() => {
        setDraggingIdx(-1);
        setDropTargetIdx(null);
        setDropPosition(null);
        enterCountRef.current.clear();
        draggingIdxRef.current = -1;
    }, []);

    const handleDragEnter = useCallback((e: React.DragEvent, idx: number) => {
        e.preventDefault();
        e.stopPropagation();
        if (!e.dataTransfer.types.includes(GROUP_DRAG_MIME)) return;
        const count = (enterCountRef.current.get(idx) ?? 0) + 1;
        enterCountRef.current.set(idx, count);
        if (count === 1) setDropTargetIdx(idx);
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
        e.preventDefault();
        e.stopPropagation();
        if (!e.dataTransfer.types.includes(GROUP_DRAG_MIME)) {
            e.dataTransfer.dropEffect = 'none';
            return;
        }
        e.dataTransfer.dropEffect = 'move';
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        setDropTargetIdx(idx);
        setDropPosition(e.clientY < midY ? 'above' : 'below');
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent, idx: number) => {
        e.preventDefault();
        e.stopPropagation();
        const count = Math.max(0, (enterCountRef.current.get(idx) ?? 0) - 1);
        enterCountRef.current.set(idx, count);
        if (count === 0) {
            enterCountRef.current.delete(idx);
            setDropTargetIdx(prev => (prev === idx ? null : prev));
            setDropPosition(null);
        }
    }, []);

    const handleDrop = useCallback((e: React.DragEvent, idx: number) => {
        e.preventDefault();
        e.stopPropagation();
        if (!e.dataTransfer.types.includes(GROUP_DRAG_MIME)) return;

        const srcIdx = draggingIdxRef.current;

        // Clean up drag state
        setDraggingIdx(-1);
        setDropTargetIdx(null);
        setDropPosition(null);
        enterCountRef.current.clear();
        draggingIdxRef.current = -1;

        if (srcIdx < 0 || srcIdx === idx) return;

        // Compute insertion position
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const droppedBelow = e.clientY >= rect.top + rect.height / 2;
        let targetIdx = droppedBelow
            ? (srcIdx < idx ? idx : idx + 1)
            : (srcIdx > idx ? idx : idx - 1);
        targetIdx = Math.max(0, Math.min(groups.length - 1, targetIdx));

        if (targetIdx === srcIdx) return;

        // Reorder
        const reordered = [...groups];
        const [moved] = reordered.splice(srcIdx, 1);
        reordered.splice(targetIdx, 0, moved);

        const newOrder = reordered.map(g => groupKey(g));
        setGroupOrder(newOrder);

        // Persist (fire-and-forget)
        fetch(getApiBase() + '/preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gitGroupOrder: newOrder }),
        }).catch(() => {});
    }, [groups]);

    // ── Footer stats ───────────────────────────────────────────────────

    const cloneGroups = groups.filter(g => g.repos.length >= 2);
    const totalRunning = repos.reduce((s, r) => s + (r.stats?.running || 0), 0);
    const totalCompleted = repos.reduce((s, r) => s + (r.stats?.success || 0), 0);
    let footerText = `${repos.length} repo${repos.length !== 1 ? 's' : ''}`;
    if (cloneGroups.length > 0) {
        const cloneCount = cloneGroups.reduce((s, g) => s + g.repos.length, 0);
        footerText += ` | ${cloneCount} clone${cloneCount !== 1 ? 's' : ''} in ${cloneGroups.length} group${cloneGroups.length !== 1 ? 's' : ''}`;
    }
    footerText += ` | ${totalRunning} running | ${totalCompleted} completed`;

    // ── Render ─────────────────────────────────────────────────────────

    const renderGroup = (group: RepoGroup, idx: number) => {
        const isDragging = idx === draggingIdx;
        const isDropTarget = idx === dropTargetIdx;
        const showAbove = isDropTarget && dropPosition === 'above';
        const showBelow = isDropTarget && dropPosition === 'below';

        const dragHandleProps = {
            draggable: true,
            onDragStart: (e: React.DragEvent) => handleDragStart(e, idx),
            onDragEnd: handleDragEnd,
            onDragEnter: (e: React.DragEvent) => handleDragEnter(e, idx),
            onDragOver: (e: React.DragEvent) => handleDragOver(e, idx),
            onDragLeave: (e: React.DragEvent) => handleDragLeave(e, idx),
            onDrop: (e: React.DragEvent) => handleDrop(e, idx),
        };

        const dropIndicatorClass = 'h-0.5 bg-[#0078d4] dark:bg-[#3794ff] rounded mx-1 my-0.5';

        if (group.normalizedUrl) {
            return (
                <div key={group.normalizedUrl} className={cn(isDragging && 'opacity-50')}>
                    {showAbove && <div className={dropIndicatorClass} />}
                    <div {...dragHandleProps}>
                        <button
                            className="flex items-center gap-1.5 w-full text-left px-1 py-1 text-[11px] text-[#616161] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] transition-colors group"
                            onClick={() => toggleGroup(group.normalizedUrl!)}
                        >
                            <span
                                className="drag-handle text-[#c0c0c0] dark:text-[#555] opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing select-none flex-shrink-0 mr-0.5"
                                title="Drag to reorder"
                                aria-hidden="true"
                            >⠿</span>
                            <span>{group.expanded ? '▾' : '▸'}</span>
                            <span>📦</span>
                            <span className="font-medium truncate">{group.label}</span>
                            <span className="ml-auto text-[10px] bg-[#e0e0e0] dark:bg-[#3c3c3c] px-1 py-px rounded">{group.repos.length}</span>
                        </button>
                    </div>
                    {group.expanded && (
                        <div className="flex flex-col gap-1 mt-0.5">
                            {group.repos.map(repo => (
                                <RepoCard
                                    key={repo.workspace.id}
                                    repo={repo}
                                    isSelected={repo.workspace.id === state.selectedRepoId}
                                    inGroup
                                    onClick={() => selectRepo(repo.workspace.id)}
                                />
                            ))}
                        </div>
                    )}
                    {showBelow && <div className={dropIndicatorClass} />}
                </div>
            );
        }

        // Ungrouped repos
        return group.repos.map((repo, repoIdx) => (
            <div
                key={repo.workspace.id}
                className={cn(isDragging && repoIdx === 0 && 'opacity-50')}
                {...(repoIdx === 0 ? dragHandleProps : {})}
            >
                {showAbove && repoIdx === 0 && <div className={dropIndicatorClass} />}
                <div className="relative group">
                    <span
                        className="drag-handle absolute left-0 top-1/2 -translate-y-1/2 text-[#c0c0c0] dark:text-[#555] opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing select-none z-10 pl-0.5 text-[10px]"
                        title="Drag to reorder"
                        aria-hidden="true"
                    >⠿</span>
                    <RepoCard
                        repo={repo}
                        isSelected={repo.workspace.id === state.selectedRepoId}
                        onClick={() => selectRepo(repo.workspace.id)}
                    />
                </div>
                {showBelow && repoIdx === group.repos.length - 1 && <div className={dropIndicatorClass} />}
            </div>
        ));
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header with add button */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <span className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Repositories</span>
                <div className="relative" ref={menuRef}>
                    <Button
                        variant="primary"
                        size="sm"
                        id="add-repo-btn"
                        data-testid="add-repo-btn"
                        onClick={() => setMenuOpen(prev => !prev)}
                    >
                        + Add ▾
                    </Button>
                    {menuOpen && (
                        <ul className="absolute right-0 top-full mt-1 z-50 min-w-[160px] bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded shadow-md text-xs py-1">
                            <li>
                                <button
                                    type="button"
                                    className="w-full text-left px-3 py-1.5 hover:bg-[#e8e8e8] dark:hover:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#cccccc]"
                                    data-testid="add-single-repo-item"
                                    onClick={() => { setMenuOpen(false); setAddOpen(true); }}
                                >
                                    Add Repository
                                </button>
                            </li>
                            <li>
                                <button
                                    type="button"
                                    className="w-full text-left px-3 py-1.5 hover:bg-[#e8e8e8] dark:hover:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#cccccc]"
                                    data-testid="add-workspace-folder-item"
                                    onClick={() => { setMenuOpen(false); setAddFolderOpen(true); }}
                                >
                                    Add Workspace Folder
                                </button>
                            </li>
                        </ul>
                    )}
                </div>
            </div>

            {/* Repo list */}
            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
                {repos.length === 0 ? (
                    <div id="repos-empty" data-testid="repos-empty" className="text-center text-xs text-[#848484] py-8">
                        No repositories registered.
                        <br />Click "+ Add" to register a workspace.
                    </div>
                ) : (
                    groups.map((group, idx) => renderGroup(group, idx))
                )}
            </div>

            {/* Footer */}
            {repos.length > 0 && (
                <div className="px-3 py-1.5 text-[10px] text-[#848484] border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                    {footerText}
                </div>
            )}

            {/* Add dialogs */}
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
        </div>
    );
}
