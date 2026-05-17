/**
 * RepoTabStrip — horizontal tab strip for repo switching in the TopBar.
 * Shows visible tabs that fit, with a "+N" overflow pill and dropdown for the rest.
 */

import { useState, useRef, useEffect, useCallback, useMemo, useContext, type DragEvent as ReactDragEvent } from 'react';
import { AddRepoDialog } from '../../repos/AddRepoDialog';
import { AddFolderDialog } from '../../repos/AddFolderDialog';
import { AddAgentDialog } from '../../repos/AddAgentDialog';
import type { RepoData, RepoGroup } from '../../repos/repoGrouping';
import { groupReposByRemote, groupReposByAgent, applyGroupOrder } from '../../repos/repoGrouping';
import { moveRepoTabOrder, moveRepoTabOrderToIndex, resolveRepoTabOrder, sanitizeRepoTabOrder } from '../../repos/repoOrder';
import { useApp } from '../../contexts/AppContext';
import { useQueue } from '../../contexts/QueueContext';
import { useContainerAgents } from '../../contexts/ContainerAgentContext';
import { ToastContext } from '../../contexts/ToastContext';
import { isHidden as isHiddenTask } from '../../queue/hooks/useRepoQueueStats';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { isContainerMode } from '../../utils/config';
import { useUiLayoutMode } from '../../hooks/preferences/useUiLayoutMode';
import { GenerateTaskDialog } from '../../tasks/GenerateTaskDialog';

export type RepoQueueStatus = 'idle' | 'running' | 'queued' | 'paused';

export interface RepoQueueStatusInfo {
    status: RepoQueueStatus;
    label: string;
    icon: 'play' | 'pause' | 'pending' | null;
}

export function getRepoQueueStatusInfo(status: RepoQueueStatus): RepoQueueStatusInfo {
    switch (status) {
        case 'running':
            return { status, label: 'running jobs', icon: 'play' };
        case 'queued':
            return { status, label: 'queued jobs', icon: 'pending' };
        case 'paused':
            return { status, label: 'queue paused', icon: 'pause' };
        default:
            return { status: 'idle', label: 'idle', icon: null };
    }
}

function getRepoQueueAccessibleLabel(repoName: string, status: RepoQueueStatus): string {
    const info = getRepoQueueStatusInfo(status);
    return status === 'idle' ? repoName : `${repoName}, ${info.label}`;
}

function RepoQueueStatusIcon({ icon }: { icon: NonNullable<RepoQueueStatusInfo['icon']> }) {
    if (icon === 'play') {
        return (
            <svg viewBox="0 0 12 12" className="w-3 h-3" fill="currentColor" aria-hidden="true" data-testid="repo-queue-play-icon">
                <path d="M3.5 2.25v7.5L9 6 3.5 2.25z" />
            </svg>
        );
    }
    if (icon === 'pause') {
        return (
            <svg viewBox="0 0 12 12" className="w-3 h-3" fill="currentColor" aria-hidden="true" data-testid="repo-queue-pause-icon">
                <path d="M3 2.25h2.1v7.5H3v-7.5zm3.9 0H9v7.5H6.9v-7.5z" />
            </svg>
        );
    }
    return (
        <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-testid="repo-queue-pending-icon">
            <circle cx="6" cy="6" r="4.25" />
            <path d="M6 3.75v2.5l1.75 1" />
        </svg>
    );
}

function RepoQueueStatusIndicator({
    status,
    color,
    idleShape,
    isSelected,
    testId,
}: {
    status: RepoQueueStatus;
    color: string;
    idleShape: string;
    isSelected?: boolean;
    testId: string;
}) {
    const info = getRepoQueueStatusInfo(status);
    if (info.icon === null) {
        return (
            <span
                className={`inline-block w-2 h-2 ${idleShape} flex-shrink-0`}
                style={{ background: isSelected ? 'rgba(255,255,255,0.7)' : color }}
                data-testid={testId}
                data-status={status}
            />
        );
    }

    const statusColor = status === 'paused'
        ? (isSelected ? 'rgba(255,255,255,0.88)' : '#f14c4c')
        : (isSelected ? 'rgba(255,255,255,0.85)' : color);

    return (
        <span
            className="inline-flex w-3 h-3 flex-shrink-0 items-center justify-center"
            style={{ color: statusColor }}
            data-testid={testId}
            data-status={status}
            title={info.label}
        >
            <RepoQueueStatusIcon icon={info.icon} />
        </span>
    );
}

/** Display name for a workspace: prefix agent name for container repos to disambiguate same-named repos across agents. */
export function getRepoDisplayName(ws: any): string {
    if (ws.agentName) {
        return `${ws.agentName}:${ws.name}`;
    }
    return ws.name;
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

type RepoDropIndicator = { targetId: string; position: 'before' | 'after' } | null;

const REPO_TAB_DRAG_MIME = 'application/x-coc-repo-tab';

function getHorizontalDropPosition(event: ReactDragEvent<HTMLElement>): 'before' | 'after' {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
}

function getVerticalDropPosition(event: ReactDragEvent<HTMLElement>): 'before' | 'after' {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
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
 * Compute which agent group IDs are visible given a container width.
 * Works like computeVisibleRepoIds but for agent pill elements.
 * The agent containing the selected repo is always included.
 */
export function computeVisibleAgentIds(
    pillElements: HTMLElement[],
    containerWidth: number,
    selectedAgentId: string | null,
): Set<string> {
    if (containerWidth <= 0) {
        if (selectedAgentId) return new Set([selectedAgentId]);
        return new Set<string>();
    }

    const visible = new Set<string>();
    let usedWidth = 0;
    let lastVisibleId: string | null = null;

    for (const el of pillElements) {
        const id = el.getAttribute('data-agent-id');
        if (!id) continue;
        const width = el.offsetWidth + 2;
        if (usedWidth + width <= containerWidth) {
            visible.add(id);
            usedWidth += width;
            lastVisibleId = id;
        } else {
            break;
        }
    }

    // Ensure agent with selected repo is always visible
    if (selectedAgentId && !visible.has(selectedAgentId)) {
        if (lastVisibleId && visible.size > 0) {
            visible.delete(lastVisibleId);
        }
        visible.add(selectedAgentId);
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
    const [uiLayoutMode] = useUiLayoutMode();
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const [addFolderOpen, setAddFolderOpen] = useState(false);
    const [addAgentOpen, setAddAgentOpen] = useState(false);
    const containerAgentCtx = useContainerAgents();
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
    const [repoTabOrder, setRepoTabOrder] = useState<string[] | undefined>();
    const [customizeRepoTabs, setCustomizeRepoTabs] = useState(false);
    const [draggedRepoId, setDraggedRepoId] = useState<string | null>(null);
    const [repoDropIndicator, setRepoDropIndicator] = useState<RepoDropIndicator>(null);
    const [repoLiveMessage, setRepoLiveMessage] = useState('');
    const [openAgentDropdown, setOpenAgentDropdown] = useState<string | null>(null);
    const [agentOverflowOpen, setAgentOverflowOpen] = useState(false);
    const agentDropdownRef = useRef<HTMLDivElement>(null);

    const dropdownRef = useRef<HTMLDivElement>(null);
    const contextMenuRef = useRef<HTMLDivElement>(null);
    const overflowRef = useRef<HTMLDivElement>(null);
    const overflowFilterRef = useRef<HTMLInputElement>(null);
    const tabContainerRef = useRef<HTMLDivElement>(null);
    const measureContainerRef = useRef<HTMLDivElement>(null);
    const toast = useContext(ToastContext);

    useEffect(() => {
        let cancelled = false;
        getSpaCocClient().preferences.getGlobal().then((prefs) => {
            if (!cancelled) {
                if (Array.isArray(prefs?.gitGroupOrder)) {
                    setGroupOrder(prefs.gitGroupOrder);
                }
                setRepoTabOrder(Array.isArray(prefs?.repoTabOrder) ? prefs.repoTabOrder : undefined);
            }
        }).catch((error) => {
            if (!cancelled) {
                console.warn('Failed to load repo tab preferences', error);
            }
        });
        return () => { cancelled = true; };
    }, []);

    const repoIds = useMemo(() => repos.map(repo => String(repo.workspace.id)), [repos]);
    const hasCustomRepoOrder = useMemo(
        () => sanitizeRepoTabOrder(repoTabOrder, repoIds).length > 0,
        [repoIds, repoTabOrder],
    );
    const orderedRepos = useMemo(() => resolveRepoTabOrder(repos, repoTabOrder), [repos, repoTabOrder]);
    const rawGroups = useMemo<RepoGroup[]>(() => {
        if (isContainerMode()) {
            const repoGroups = groupReposByAgent(repos, {});
            // Ensure agents with 0 repos still appear as empty pills
            const seen = new Set(repoGroups.map(g => g.normalizedUrl));
            for (const agent of containerAgentCtx.agents) {
                if (!seen.has(agent.id)) {
                    repoGroups.push({
                        normalizedUrl: agent.id,
                        label: agent.name || agent.address,
                        repos: [],
                        expanded: true,
                    });
                }
            }
            return repoGroups;
        }
        if (hasCustomRepoOrder) {
            return [{ normalizedUrl: null, label: 'Repositories', repos: orderedRepos, expanded: true }];
        }
        return groupReposByRemote(repos, {});
    }, [hasCustomRepoOrder, orderedRepos, repos, containerAgentCtx.agents]);
    const groups = useMemo(
        () => isContainerMode() ? rawGroups : hasCustomRepoOrder ? rawGroups : applyGroupOrder(rawGroups, groupOrder),
        [groupOrder, hasCustomRepoOrder, rawGroups],
    );
    const allRepoIds = useMemo(() => flattenGroups(groups), [groups]);
    const { state: appState, dispatch } = useApp();
    const { state: queueState, dispatch: queueDispatch } = useQueue();

    /** Pre-computed queue status for each repo. */
    const repoQueueStatusMap = useMemo<Record<string, RepoQueueStatus>>(() => {
        const map: Record<string, RepoQueueStatus> = {};
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
        await getSpaCocClient().workspaces.delete(repoId);
        dispatch({ type: 'SET_SELECTED_REPO', id: null });
        location.hash = '';
        onRefresh();
    };

    const persistRepoTabOrder = useCallback(async (nextOrder: string[]) => {
        const sanitized = sanitizeRepoTabOrder(nextOrder, repoIds);
        setRepoTabOrder(sanitized);
        try {
            await getSpaCocClient().preferences.patchGlobal({ repoTabOrder: sanitized });
        } catch (error) {
            console.warn('Failed to save repo tab order', error);
            toast?.addToast(`${getSpaCocClientErrorMessage(error, 'Failed to save repo tab order')}. The order will stay for this session and retry on the next reorder.`, 'error');
        }
    }, [repoIds, toast]);

    const finishRepoReorder = useCallback((nextOrder: string[]) => {
        setDraggedRepoId(null);
        setRepoDropIndicator(null);
        void persistRepoTabOrder(nextOrder);
        setRepoLiveMessage('Repository tab order updated.');
    }, [persistRepoTabOrder]);

    const resetRepoTabOrder = useCallback(async () => {
        setRepoTabOrder(undefined);
        try {
            const prefs = await getSpaCocClient().preferences.getGlobal();
            const { repoTabOrder: _repoTabOrder, ...rest } = prefs;
            await getSpaCocClient().preferences.replaceGlobal(rest);
            setCustomizeRepoTabs(false);
            toast?.addToast('Repo tab order reset', 'success');
            setRepoLiveMessage('Repository tab order reset.');
        } catch (error) {
            console.warn('Failed to reset repo tab order', error);
            toast?.addToast(getSpaCocClientErrorMessage(error, 'Failed to reset repo tab order'), 'error');
        }
    }, [toast]);

    const enterCustomizeRepoTabs = useCallback(() => {
        setCustomizeRepoTabs(true);
        setContextMenu(null);
        setRepoLiveMessage('Repo tab customize mode started.');
    }, []);

    useEffect(() => {
        const handler = () => enterCustomizeRepoTabs();
        window.addEventListener('coc-customize-repo-tabs', handler);
        return () => window.removeEventListener('coc-customize-repo-tabs', handler);
    }, [enterCustomizeRepoTabs]);

    useEffect(() => {
        if (!customizeRepoTabs && !draggedRepoId) {
            return;
        }
        const handler = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') {
                return;
            }
            event.preventDefault();
            setDraggedRepoId(null);
            setRepoDropIndicator(null);
            setCustomizeRepoTabs(false);
            setRepoLiveMessage('Repo tab customize mode finished.');
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [customizeRepoTabs, draggedRepoId]);

    const moveRepoToIndex = useCallback((repoId: string, targetIndex: number) => {
        finishRepoReorder(moveRepoTabOrderToIndex(allRepoIds, repoId, targetIndex));
    }, [allRepoIds, finishRepoReorder]);

    const startRepoDrag = useCallback((event: ReactDragEvent<HTMLElement>, repoId: string) => {
        if (!customizeRepoTabs) {
            return;
        }
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(REPO_TAB_DRAG_MIME, repoId);
        event.dataTransfer.setData('text/plain', repoId);
        setDraggedRepoId(repoId);
    }, [customizeRepoTabs]);

    const updateRepoDropTarget = useCallback((event: ReactDragEvent<HTMLElement>, targetId: string, orientation: 'horizontal' | 'vertical') => {
        if (!draggedRepoId || draggedRepoId === targetId) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setRepoDropIndicator({
            targetId,
            position: orientation === 'horizontal' ? getHorizontalDropPosition(event) : getVerticalDropPosition(event),
        });
    }, [draggedRepoId]);

    const dropRepoOnTarget = useCallback((event: ReactDragEvent<HTMLElement>, targetId: string, orientation: 'horizontal' | 'vertical') => {
        if (!draggedRepoId || draggedRepoId === targetId) {
            setDraggedRepoId(null);
            setRepoDropIndicator(null);
            return;
        }
        event.preventDefault();
        const sourceId = event.dataTransfer.getData(REPO_TAB_DRAG_MIME) || event.dataTransfer.getData('text/plain') || draggedRepoId;
        const position = repoDropIndicator?.targetId === targetId
            ? repoDropIndicator.position
            : (orientation === 'horizontal' ? getHorizontalDropPosition(event) : getVerticalDropPosition(event));
        finishRepoReorder(moveRepoTabOrder(allRepoIds, sourceId, targetId, position));
    }, [allRepoIds, draggedRepoId, finishRepoReorder, repoDropIndicator]);

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
        if (isContainerMode()) return; // container mode uses agent pill layout, not repo overflow
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
        if (isContainerMode()) return;
        recalcOverflow();
    }, [repos, recalcOverflow]);

    // Container mode agent pill overflow detection — show first 10, "..." for rest
    const AGENT_PILL_MAX = 10;
    const visibleAgentGroups = useMemo(
        () => isContainerMode() ? groups.slice(0, AGENT_PILL_MAX) : groups,
        [groups],
    );
    const hiddenAgentGroups = useMemo(
        () => isContainerMode() && groups.length > AGENT_PILL_MAX ? groups.slice(AGENT_PILL_MAX) : [],
        [groups],
    );
    const hasAgentOverflow = hiddenAgentGroups.length > 0;

    const overflowCount = visibleRepoIds ? allRepoIds.length - visibleRepoIds.size : 0;
    const hasOverflow = overflowCount > 0;
    const showOverflowControl = !isContainerMode() && (hasOverflow || customizeRepoTabs);
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

    // Close agent dropdown on outside click
    useEffect(() => {
        if (!openAgentDropdown) return;
        const handleMouseDown = (e: MouseEvent) => {
            if (agentDropdownRef.current && !agentDropdownRef.current.contains(e.target as Node)) {
                setOpenAgentDropdown(null);
            }
        };
        document.addEventListener('mousedown', handleMouseDown);
        return () => document.removeEventListener('mousedown', handleMouseDown);
    }, [openAgentDropdown]);
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
            const targetWs = flatFilteredRepos[overflowHighlight].workspace;
            if (targetWs.agentId) dispatch({ type: 'SET_CURRENT_AGENT', agentId: targetWs.agentId });
            const sw = targetWs.agentId && appState.currentAgentId !== targetWs.agentId;
            onSelect(targetWs.id);
            setOverflowOpen(false);
            if (sw && targetWs.id === selectedRepoId) onRefresh();
        }
    };

    const isRepoVisible = (id: string) => !visibleRepoIds || visibleRepoIds.has(id);

    const renderTab = (repo: RepoData) => {
        const ws = repo.workspace;
        const isSelected = ws.id === selectedRepoId && (!ws.agentId || !appState.currentAgentId || ws.agentId === appState.currentAgentId);
        const unseenCount = unseenCounts[ws.id] ?? 0;
        const color = ws.color || '#848484';
        const dotShape = (repo.gitInfoLoading || repo.gitInfo?.isGitRepo !== false) ? 'rounded-full' : 'rounded-sm';
        const queueStatus = repoQueueStatusMap[ws.id] ?? 'idle';
        const accessibleLabel = getRepoQueueAccessibleLabel(getRepoDisplayName(ws), queueStatus);
        const showBefore = repoDropIndicator?.targetId === ws.id && repoDropIndicator.position === 'before';
        const showAfter = repoDropIndicator?.targetId === ws.id && repoDropIndicator.position === 'after';
        const isDragging = draggedRepoId === ws.id;
        return (
            <div
                key={ws.id}
                className={`relative group flex-shrink-0 ${isDragging ? 'opacity-50 outline outline-1 outline-dashed outline-[#8c8c8c]' : ''}`}
                draggable={customizeRepoTabs}
                onDragStart={event => startRepoDrag(event, ws.id)}
                onDragOver={event => updateRepoDropTarget(event, ws.id, 'horizontal')}
                onDragEnter={event => updateRepoDropTarget(event, ws.id, 'horizontal')}
                onDrop={event => dropRepoOnTarget(event, ws.id, 'horizontal')}
                onDragEnd={() => {
                    setDraggedRepoId(null);
                    setRepoDropIndicator(null);
                }}
            >
                {showBefore && <span className="absolute -left-0.5 top-1 bottom-1 w-0.5 rounded bg-[#0078d4] dark:bg-[#60b4ff]" aria-hidden />}
                <button
                    data-testid="repo-tab"
                    data-repo-id={ws.id}
                    className={
                        'relative flex items-center gap-1.5 px-2.5 h-7 rounded text-xs whitespace-nowrap shrink-0 transition-colors ' +
                        (customizeRepoTabs ? 'outline outline-1 outline-dashed outline-[#c0c0c0] dark:outline-[#555] ' : '') +
                        (isSelected
                            ? 'bg-[#0078d4] text-white'
                            : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]')
                    }
                    aria-pressed={isSelected}
                    aria-label={customizeRepoTabs ? `${accessibleLabel}. Drag to reorder.` : accessibleLabel}
                    title={customizeRepoTabs ? `${accessibleLabel}. Drag to reorder.` : accessibleLabel}
                    onClick={event => {
                        if (customizeRepoTabs) {
                            event.preventDefault();
                            return;
                        }
                        const switchingAgent = ws.agentId && appState.currentAgentId !== ws.agentId;
                        if (ws.agentId) dispatch({ type: 'SET_CURRENT_AGENT', agentId: ws.agentId });
                        onSelect(ws.id);
                        if (switchingAgent && ws.id === selectedRepoId) onRefresh();
                    }}
                    onContextMenu={e => {
                        e.preventDefault();
                        setContextMenu({ repoId: ws.id, x: e.clientX, y: e.clientY });
                    }}
                >
                    <span
                        className={`text-[10px] leading-none text-[#616161] dark:text-[#999] ${customizeRepoTabs ? 'inline' : 'hidden group-hover:inline group-focus-within:inline'}`}
                        aria-hidden
                    >
                        ⠿
                    </span>
                    <RepoQueueStatusIndicator
                        status={queueStatus}
                        color={color}
                        idleShape={dotShape}
                        isSelected={isSelected}
                        testId="repo-tab-dot"
                    />
                    <span className="max-w-[140px] truncate">{getRepoDisplayName(ws)}</span>
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
                {showAfter && <span className="absolute -right-0.5 top-1 bottom-1 w-0.5 rounded bg-[#0078d4] dark:bg-[#60b4ff]" aria-hidden />}
            </div>
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
                <span className="inline-block w-3 h-3" />
                <span className="max-w-[140px] truncate">{getRepoDisplayName(ws)}</span>
            </span>
        );
    };

    return (
        <div
            className="flex items-center flex-1 min-w-0"
            data-testid="repo-tab-strip"
        >
        {/* Hidden measurement container — lightweight spans to measure natural widths (non-container mode only) */}
        {!isContainerMode() && (
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
        )}
        {/* Visible tab container */}
        <div
            ref={tabContainerRef}
            className={
                isContainerMode()
                    ? 'flex items-center gap-0.5 px-1'
                    : 'flex items-center gap-0.5 flex-1 min-w-0 px-1'
            }
            data-testid="repo-tab-visible-container"
        >
            {isContainerMode() ? (
                /* Container mode: agent pills with hover submenu (max 10 visible) */
                visibleAgentGroups.map((group) => {
                    const agentId = group.normalizedUrl ?? 'unknown';
                    const isOpen = openAgentDropdown === agentId;
                    const isActiveAgent = appState.currentAgentId === agentId;
                    const selectedInGroup = isActiveAgent && group.repos.find(r => r.workspace.id === selectedRepoId);
                    const totalUnseen = group.repos.reduce((sum, r) => sum + (unseenCounts[r.workspace.id] ?? 0), 0);
                    return (
                        <div
                            key={agentId}
                            className="relative flex-shrink-0 group/agent"
                            ref={isOpen ? agentDropdownRef : undefined}
                            onMouseEnter={() => setOpenAgentDropdown(agentId)}
                            onMouseLeave={() => setOpenAgentDropdown(prev => prev === agentId ? null : prev)}
                        >
                            <button
                                data-testid="agent-pill"
                                className={
                                    'flex items-center gap-1 px-2.5 h-7 rounded text-xs whitespace-nowrap transition-colors cursor-pointer ' +
                                    (selectedInGroup
                                        ? 'bg-[#0078d4] text-white'
                                        : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]')
                                }
                                onClick={() => {
                                    // If only one repo, select it directly
                                    if (group.repos.length === 1) {
                                        const switchingAgent = appState.currentAgentId !== agentId;
                                        dispatch({ type: 'SET_CURRENT_AGENT', agentId });
                                        onSelect(group.repos[0].workspace.id);
                                        if (switchingAgent && group.repos[0].workspace.id === selectedRepoId) {
                                            onRefresh();
                                        }
                                    } else {
                                        setOpenAgentDropdown(isOpen ? null : agentId);
                                    }
                                }}
                            >
                                <span>{group.label}</span>
                                {group.repos.length > 0 && <span className="text-[9px] opacity-70">▾</span>}
                                {totalUnseen > 0 && (
                                    <span className="min-w-[14px] h-[14px] px-[3px] rounded-full bg-[#d16969] text-white text-[8px] font-semibold flex items-center justify-center leading-none">
                                        {totalUnseen > 99 ? '99+' : totalUnseen}
                                    </span>
                                )}
                            </button>
                            {isOpen && group.repos.length > 0 && (
                                <div className="absolute top-full left-0 pt-1 z-[9999]">
                                <div className="min-w-[200px] max-w-[320px] rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-lg py-1">
                                    {group.repos.map(repo => {
                                        const ws = repo.workspace;
                                        const isSelected = ws.id === selectedRepoId;
                                        const color = ws.color || '#848484';
                                        const queueStatus = repoQueueStatusMap[ws.id] ?? 'idle';
                                        const unseenCount = unseenCounts[ws.id] ?? 0;
                                        return (
                                            <button
                                                key={ws.id}
                                                className={
                                                    'w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer ' +
                                                    (isSelected
                                                        ? 'bg-[#0078d4]/10 dark:bg-[#3794ff]/15 text-[#0078d4] dark:text-[#60b4ff] font-medium'
                                                        : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/5 dark:hover:bg-[#3794ff]/10')
                                                }
                                                onClick={() => {
                                                    // Switch to this agent before selecting the repo
                                                    const switchingAgent = appState.currentAgentId !== agentId;
                                                    dispatch({ type: 'SET_CURRENT_AGENT', agentId });
                                                    onSelect(ws.id);
                                                    setOpenAgentDropdown(null);
                                                    // If same repo ID is already selected but agent changed, force data refresh
                                                    if (switchingAgent && ws.id === selectedRepoId) {
                                                        onRefresh();
                                                    }
                                                }}
                                                onContextMenu={e => {
                                                    e.preventDefault();
                                                    dispatch({ type: 'SET_CURRENT_AGENT', agentId });
                                                    setContextMenu({ repoId: ws.id, x: e.clientX, y: e.clientY });
                                                }}
                                            >
                                                <RepoQueueStatusIndicator status={queueStatus} color={color} idleShape="rounded-full" isSelected={isSelected} testId="agent-repo-dot" />
                                                <span className="truncate">{getRepoDisplayName(ws)}</span>
                                                {unseenCount > 0 && (
                                                    <span className="ml-auto min-w-[14px] h-[14px] px-[3px] rounded-full bg-[#d16969] text-white text-[8px] font-semibold flex items-center justify-center leading-none">
                                                        {unseenCount > 99 ? '99+' : unseenCount}
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                                </div>
                            )}
                        </div>
                    );
                })
            ) : (
                /* Normal mode: flat repo tabs with group separators */
                groups.map((group, groupIndex) => {
                    const visibleInGroup = group.repos.filter(r => isRepoVisible(r.workspace.id));
                    if (visibleInGroup.length === 0) return null;
                    return (
                        <div key={group.normalizedUrl ?? `ungrouped-${groupIndex}`} className="contents">
                            {!hasCustomRepoOrder && groupIndex > 0 && groups.slice(0, groupIndex).some(g => g.repos.some(r => isRepoVisible(r.workspace.id))) && (
                                <div
                                    className="h-5 w-px bg-gray-300 dark:bg-gray-600 mx-1 flex-shrink-0"
                                    data-testid="repo-group-separator"
                                    title={group.normalizedUrl ? group.label : undefined}
                                />
                            )}
                            {visibleInGroup.map(repo => renderTab(repo))}
                        </div>
                    );
                })
            )}
        </div>
        {/* Agent overflow "..." for container mode (more than 10 agents) */}
        {isContainerMode() && hasAgentOverflow && (
            <div className="relative flex-shrink-0 px-0.5" data-testid="agent-overflow-pill-container">
                <button
                    data-testid="agent-overflow-pill"
                    className={
                        'relative flex items-center justify-center h-7 px-2.5 rounded text-xs font-medium transition-colors cursor-pointer ' +
                        'bg-gray-200 dark:bg-gray-700 text-[#1e1e1e] dark:text-[#cccccc] ' +
                        'hover:bg-gray-300 dark:hover:bg-gray-600'
                    }
                    aria-label={`${hiddenAgentGroups.length} more agents`}
                    title={`${hiddenAgentGroups.length} more agents`}
                    onClick={() => setAgentOverflowOpen(prev => !prev)}
                >
                    +{hiddenAgentGroups.length}
                </button>
                {agentOverflowOpen && (
                    <div
                        data-testid="agent-overflow-dropdown"
                        className="absolute right-0 top-full mt-1 z-[9999] min-w-[200px] max-w-[320px] bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded shadow-lg py-1"
                        role="menu"
                    >
                        {hiddenAgentGroups.map(group => {
                            const agentId = group.normalizedUrl ?? 'unknown';
                            const isActiveAgent = appState.currentAgentId === agentId;
                            const selectedInGroup = isActiveAgent && group.repos.find(r => r.workspace.id === selectedRepoId);
                            const totalUnseen = group.repos.reduce((sum, r) => sum + (unseenCounts[r.workspace.id] ?? 0), 0);
                            return (
                                <div key={agentId} className="relative px-1 py-0.5 group/overflow-agent">
                                    <button
                                        className={
                                            'w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs rounded cursor-pointer ' +
                                            (selectedInGroup
                                                ? 'bg-[#0078d4]/10 dark:bg-[#3794ff]/15 text-[#0078d4] dark:text-[#60b4ff] font-medium'
                                                : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/5 dark:hover:bg-[#3794ff]/10')
                                        }
                                        onMouseEnter={() => setOpenAgentDropdown(agentId)}
                                        onMouseLeave={() => setOpenAgentDropdown(prev => prev === agentId ? null : prev)}
                                        onClick={() => {
                                            if (group.repos.length === 1) {
                                                onSelect(group.repos[0].workspace.id);
                                                setAgentOverflowOpen(false);
                                                setOpenAgentDropdown(null);
                                            }
                                        }}
                                    >
                                        <span className="truncate">{group.label}</span>
                                        <span className="text-[10px] opacity-60 ml-auto">{group.repos.length}</span>
                                        {totalUnseen > 0 && (
                                            <span className="min-w-[14px] h-[14px] px-[3px] rounded-full bg-[#d16969] text-white text-[8px] font-semibold flex items-center justify-center leading-none">
                                                {totalUnseen > 99 ? '99+' : totalUnseen}
                                            </span>
                                        )}
                                    </button>
                                    {openAgentDropdown === agentId && group.repos.length > 0 && (
                                        <div
                                            className="absolute right-full top-0 pr-1 z-[10000]"
                                            onMouseEnter={() => setOpenAgentDropdown(agentId)}
                                            onMouseLeave={() => setOpenAgentDropdown(null)}
                                        >
                                        <div className="min-w-[180px] max-w-[280px] rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-lg py-1">
                                            {group.repos.map(repo => {
                                                const ws = repo.workspace;
                                                const isSelected = ws.id === selectedRepoId;
                                                const color = ws.color || '#848484';
                                                const queueStatus = repoQueueStatusMap[ws.id] ?? 'idle';
                                                return (
                                                    <button
                                                        key={ws.id}
                                                        className={
                                                            'w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer ' +
                                                            (isSelected
                                                                ? 'bg-[#0078d4]/10 dark:bg-[#3794ff]/15 text-[#0078d4] dark:text-[#60b4ff] font-medium'
                                                                : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/5 dark:hover:bg-[#3794ff]/10')
                                                        }
                                                        onClick={() => { const sw = appState.currentAgentId !== agentId; dispatch({ type: 'SET_CURRENT_AGENT', agentId }); onSelect(ws.id); setOpenAgentDropdown(null); setAgentOverflowOpen(false); if (sw && ws.id === selectedRepoId) onRefresh(); }}
                                                    >
                                                        <RepoQueueStatusIndicator status={queueStatus} color={color} idleShape="rounded-full" isSelected={isSelected} testId="agent-overflow-repo-dot" />
                                                        <span className="truncate">{getRepoDisplayName(ws)}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        )}
        {/* "+N" overflow pill / customize order list */}
        {showOverflowControl && (
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
                    aria-label={hasOverflow ? `${overflowCount} more repositories - click to see all` : 'Customize repository order'}
                    title={hasOverflow ? `${overflowCount} more repositories - click to see all` : 'Customize repository order'}
                    onClick={() => setOverflowOpen(prev => !prev)}
                >
                    {hasOverflow ? `+${overflowCount}` : 'Order'}
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
                        <div className="px-2 pb-1 flex items-center gap-2">
                            <button
                                type="button"
                                data-testid="overflow-customize-order"
                                className="text-xs text-[#0078d4] dark:text-[#60b4ff] hover:underline"
                                onClick={() => setCustomizeRepoTabs(true)}
                            >
                                Customize order
                            </button>
                            {customizeRepoTabs && (
                                <button
                                    type="button"
                                    data-testid="overflow-reset-order"
                                    className="text-xs text-[#0078d4] dark:text-[#60b4ff] hover:underline"
                                    onClick={() => void resetRepoTabOrder()}
                                >
                                    Reset order
                                </button>
                            )}
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
                                            const isSelected = ws.id === selectedRepoId && (!ws.agentId || !appState.currentAgentId || ws.agentId === appState.currentAgentId);
                                            const unseenCount = unseenCounts[ws.id] ?? 0;
                                            const color = ws.color || '#848484';
                                            const queueStatus = repoQueueStatusMap[ws.id] ?? 'idle';
                                            const dotShape = (repo.gitInfoLoading || repo.gitInfo?.isGitRepo !== false) ? 'rounded-full' : 'rounded-sm';
                                            const accessibleLabel = getRepoQueueAccessibleLabel(getRepoDisplayName(ws), queueStatus);
                                            const flatIdx = flatFilteredRepos.indexOf(repo);
                                            const isHighlighted = flatIdx === overflowHighlight;
                                            const orderIndex = allRepoIds.indexOf(ws.id);
                                            const showBefore = repoDropIndicator?.targetId === ws.id && repoDropIndicator.position === 'before';
                                            const showAfter = repoDropIndicator?.targetId === ws.id && repoDropIndicator.position === 'after';
                                            const rowClassName =
                                                'w-full flex items-center gap-2 h-8 px-3 text-xs text-left transition-colors ' +
                                                (isHighlighted
                                                    ? 'bg-[#0078d4]/10 dark:bg-[#3794ff]/10 '
                                                    : isSelected
                                                        ? 'bg-[#0078d4]/5 '
                                                        : '') +
                                                'hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 text-[#1e1e1e] dark:text-[#cccccc]';
                                            const rowContent = (
                                                <>
                                                    {customizeRepoTabs && (
                                                        <span className="text-[10px] text-[#616161] dark:text-[#999] cursor-grab active:cursor-grabbing" aria-hidden>⠿</span>
                                                    )}
                                                    <RepoQueueStatusIndicator
                                                        status={queueStatus}
                                                        color={color}
                                                        idleShape={dotShape}
                                                        testId="overflow-repo-dot"
                                                    />
                                                    <span className="flex-1 truncate">{getRepoDisplayName(ws)}</span>
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
                                                </>
                                            );
                                            if (customizeRepoTabs) {
                                                return (
                                                    <div key={ws.id} className="relative">
                                                        {showBefore && <div className="h-0.5 bg-[#0078d4] dark:bg-[#60b4ff] rounded mx-2" aria-hidden />}
                                                        <div
                                                            data-testid="overflow-repo-item"
                                                            data-repo-id={ws.id}
                                                            className={`${rowClassName} cursor-grab active:cursor-grabbing`}
                                                            role="menuitem"
                                                            aria-label={`${accessibleLabel}. Drag or use move buttons to reorder.`}
                                                            title={`${accessibleLabel}. Drag or use move buttons to reorder.`}
                                                            draggable
                                                            onDragStart={event => startRepoDrag(event, ws.id)}
                                                            onDragOver={event => updateRepoDropTarget(event, ws.id, 'vertical')}
                                                            onDragEnter={event => updateRepoDropTarget(event, ws.id, 'vertical')}
                                                            onDrop={event => dropRepoOnTarget(event, ws.id, 'vertical')}
                                                            onDragEnd={() => {
                                                                setDraggedRepoId(null);
                                                                setRepoDropIndicator(null);
                                                            }}
                                                        >
                                                            {rowContent}
                                                            <button
                                                                type="button"
                                                                data-testid="overflow-move-to-top"
                                                                className="text-[10px] text-[#0078d4] dark:text-[#60b4ff] hover:underline disabled:opacity-40"
                                                                disabled={orderIndex <= 0}
                                                                onClick={() => moveRepoToIndex(ws.id, 0)}
                                                            >
                                                                Top
                                                            </button>
                                                            <button
                                                                type="button"
                                                                data-testid="overflow-move-up"
                                                                aria-label={`Move ${getRepoDisplayName(ws)} up`}
                                                                className="text-[10px] text-[#0078d4] dark:text-[#60b4ff] hover:underline disabled:opacity-40"
                                                                disabled={orderIndex <= 0}
                                                                onClick={() => moveRepoToIndex(ws.id, orderIndex - 1)}
                                                            >
                                                                Up
                                                            </button>
                                                            <button
                                                                type="button"
                                                                data-testid="overflow-move-down"
                                                                aria-label={`Move ${getRepoDisplayName(ws)} down`}
                                                                className="text-[10px] text-[#0078d4] dark:text-[#60b4ff] hover:underline disabled:opacity-40"
                                                                disabled={orderIndex < 0 || orderIndex >= allRepoIds.length - 1}
                                                                onClick={() => moveRepoToIndex(ws.id, orderIndex + 1)}
                                                            >
                                                                Down
                                                            </button>
                                                        </div>
                                                        {showAfter && <div className="h-0.5 bg-[#0078d4] dark:bg-[#60b4ff] rounded mx-2" aria-hidden />}
                                                    </div>
                                                );
                                            }
                                            return (
                                                <button
                                                    key={ws.id}
                                                    data-testid="overflow-repo-item"
                                                    data-repo-id={ws.id}
                                                    className={rowClassName + ' cursor-pointer'}
                                                    role="menuitem"
                                                    aria-label={accessibleLabel}
                                                    title={accessibleLabel}
                                                    onClick={() => { if (ws.agentId) dispatch({ type: 'SET_CURRENT_AGENT', agentId: ws.agentId }); const sw = ws.agentId && appState.currentAgentId !== ws.agentId; onSelect(ws.id); setOverflowOpen(false); if (sw && ws.id === selectedRepoId) onRefresh(); }}
                                                    onContextMenu={e => {
                                                        e.preventDefault();
                                                        setContextMenu({ repoId: ws.id, x: e.clientX, y: e.clientY });
                                                        setOverflowOpen(false);
                                                    }}
                                                >
                                                    {rowContent}
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
                    {isContainerMode() && (
                        <>
                            <hr className="my-1 border-[#e0e0e0] dark:border-[#3c3c3c]" />
                            <button
                                data-testid="repo-tab-add-agent-option"
                                className="w-full text-left px-3 py-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 cursor-pointer"
                                role="menuitem"
                                onClick={() => { setDropdownOpen(false); setAddAgentOpen(true); }}
                            >
                                🔗 Add agent
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
        <div className="sr-only" aria-live="polite">{repoLiveMessage}</div>
        {customizeRepoTabs && (
            <div
                data-testid="repo-tab-customize-banner"
                className="fixed top-12 left-1/2 -translate-x-1/2 z-[9000] flex items-center gap-2 rounded-full border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] shadow px-3 py-1 text-xs text-[#1e1e1e] dark:text-[#cccccc]"
            >
                <span>Drag repos to reorder. Use the overflow list for hidden repos.</span>
                <button className="text-[#0078d4] dark:text-[#60b4ff] hover:underline" onClick={() => void resetRepoTabOrder()}>Reset order</button>
                <button className="text-[#0078d4] dark:text-[#60b4ff] hover:underline" onClick={() => setCustomizeRepoTabs(false)}>Done</button>
            </div>
        )}
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
        {isContainerMode() && (
            <AddAgentDialog
                open={addAgentOpen}
                onClose={() => setAddAgentOpen(false)}
                onAdd={async (address, name) => { await containerAgentCtx.addAgent(address, name); setAddAgentOpen(false); containerAgentCtx.refreshAgents(); onRefresh(); }}
            />
        )}
        <AddRepoDialog
            open={editRepoId !== null}
            onClose={() => setEditRepoId(null)}
            editId={editRepoId}
            repos={repos}
            onSuccess={() => { setEditRepoId(null); onRefresh(); }}
        />
        {contextMenu !== null && (() => {
            const ws = repos.flatMap(r => [r.workspace]).find(w => w.id === contextMenu.repoId);
            if (!ws) return null;
            return (
                <div
                        ref={contextMenuRef}
                        data-testid="repo-tab-context-menu"
                        className="fixed z-[10001] min-w-[160px] bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded shadow-lg py-1"
                        role="menu"
                        style={{ left: contextMenu.x, top: contextMenu.y }}
                    >
                        {uiLayoutMode === 'classic' && (
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
                        )}
                        {uiLayoutMode === 'classic' && (
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
                        )}
                        <button
                            data-testid="repo-tab-context-run-script"
                            className="w-full text-left px-3 py-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 cursor-pointer"
                            role="menuitem"
                            onClick={() => {
                                queueDispatch({ type: 'OPEN_SCRIPT_DIALOG', workspaceId: ws.id });
                                setContextMenu(null);
                            }}
                        >
                            🛠️ Prompt & Script
                        </button>
                        {uiLayoutMode === 'classic' && (
                            <button
                                data-testid="repo-tab-context-generate-plan"
                                className="w-full text-left px-3 py-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 cursor-pointer"
                                role="menuitem"
                                onClick={() => {
                                    setGenerateDialog({ open: true, minimized: false, wsId: ws.id, targetFolder: undefined });
                                    setContextMenu(null);
                                }}
                            >
                                📋 Generate Plan
                            </button>
                        )}
                        <hr className="my-1 border-[#e0e0e0] dark:border-[#3c3c3c]" />
                        <button
                            data-testid="repo-tab-context-customize-order"
                            className="w-full text-left px-3 py-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 cursor-pointer"
                            role="menuitem"
                            onClick={enterCustomizeRepoTabs}
                        >
                            Customize repo tabs
                        </button>
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
                                navigator.clipboard.writeText(`${getRepoDisplayName(ws)}: ${ws.rootPath ?? ''}${ws.description ? '\n' + ws.description : ''}`);
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
