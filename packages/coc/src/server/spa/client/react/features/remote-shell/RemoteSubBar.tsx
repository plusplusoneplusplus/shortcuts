/**
 * RemoteSubBar — row 2 of the remote-first shell.
 *
 * Splits into two scopes:
 *   • Remote scope (shared across clones): Work Items, Pull Requests — shown once
 *     and unchanged when you switch clones.
 *   • Clone scope (follows the active checkout): a clone-switcher popover + the
 *     clone tabs (Activity, CLI Sessions, Git, Terminal, Explorer, Schedules, …).
 *     As many clone tabs as fit are shown inline; the rest collapse into a ⋯
 *     overflow that is measured responsively against the available width.
 *
 * Compact Ask / Queue actions sit at the right edge, targeting the active clone.
 * Rendered above a chromeless RepoDetail in ReposView when the shell is on.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useQueue } from '../../contexts/QueueContext';
import { useWorkItems } from '../../contexts/WorkItemContext';
import { useRepos } from '../../contexts/ReposContext';
import { useTerminalEnabled } from '../../hooks/feature-flags/useTerminalEnabled';
import { useNotesEnabled } from '../notes/hooks/useNotesEnabled';
import { useWorkflowsEnabled } from '../../hooks/feature-flags/useWorkflowsEnabled';
import { usePullRequestsEnabled } from '../../hooks/feature-flags/usePullRequestsEnabled';
import { useDreamsEnabled } from '../../hooks/feature-flags/useDreamsEnabled';
import { useNativeCliSessionsEnabled } from '../../hooks/feature-flags/useNativeCliSessionsEnabled';
import { useUiLayoutMode } from '../../hooks/preferences/useUiLayoutMode';
import { useRepoQueueStats, isHidden as isHiddenTask } from '../../queue/hooks/useRepoQueueStats';
import { useGitInfo } from '../git/hooks/useGitInfo';
import { computeVisibleSubTabs, type SubTabDef } from '../repo-detail/repoSubTabs';
import { groupReposByRemote, isRemoteRepo, truncatePath, getRepoHashColor } from '../../repos/repoGrouping';
import {
    partitionShellTabs, computeCloneStatusMap, cloneStatusColor, summarizeRemote, computeVisibleTabKeys,
    remoteProviderLabel,
} from './shellModel';
import { useShellNavigation } from './useShellNavigation';
import type { RepoData } from '../../repos/repoGrouping';
import type { RepoSubTab } from '../../types/dashboard';
import { resolveRepoWorkItemOriginScope } from '../work-items/workItemOriginScope';
import { getHostname } from '../../utils/config';
import { ContextMenu, type ContextMenuItem } from '../../tasks/comments/ContextMenu';
import { Dialog } from '../../ui/Dialog';
import { useToast, ToastContainer } from '../../ui/Toast';
import { removeWorkspace } from '../../repos/repositoryService';

interface RemoteSubBarProps {
    repo: RepoData;
    repos: RepoData[];
}

function Chevron() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
        </svg>
    );
}

const scopeLabelClass = 'hidden lg:inline-flex items-center text-[9.5px] font-bold uppercase tracking-[0.08em] text-[#848484] dark:text-[#777] px-1 select-none flex-shrink-0';

export function RemoteSubBar({ repo, repos }: RemoteSubBarProps) {
    const ws = repo.workspace;
    const cloneId = String(ws.id);
    const { state } = useApp();
    const { state: queueState, dispatch: queueDispatch } = useQueue();
    const { state: workItemState, dispatch: workItemDispatch } = useWorkItems();
    const { selectClone, switchSubTab } = useShellNavigation();

    const terminalEnabled = useTerminalEnabled();
    const notesEnabled = useNotesEnabled();
    const workflowsEnabled = useWorkflowsEnabled();
    const pullRequestsEnabled = usePullRequestsEnabled();
    const dreamsEnabled = useDreamsEnabled();
    const nativeCliSessionsEnabled = useNativeCliSessionsEnabled();
    const [uiLayoutMode] = useUiLayoutMode();
    const isGitRepo = !!repo.gitInfo?.isGitRepo;
    const workItemOriginId = useMemo(() => resolveRepoWorkItemOriginScope(repo).originId, [repo]);

    const { running: runningCount, queued: queuedCount } = useRepoQueueStats(cloneId);
    const { ahead: gitAhead, behind: gitBehind } = useGitInfo(cloneId);
    const unseenWorkItemCount = (workItemState.unseenByRepo[workItemOriginId] || []).length;
    const activeTab = state.activeRepoSubTab;

    const tabs = useMemo(() => computeVisibleSubTabs({
        isGitRepo, terminalEnabled, notesEnabled, workflowsEnabled,
        pullRequestsEnabled, dreamsEnabled, nativeCliSessionsEnabled, uiLayoutMode,
    }), [isGitRepo, terminalEnabled, notesEnabled, workflowsEnabled, pullRequestsEnabled, dreamsEnabled, nativeCliSessionsEnabled, uiLayoutMode]);
    const { remote: remoteTabs, clone: cloneTabs } = useMemo(() => partitionShellTabs(tabs), [tabs]);

    const group = useMemo(() => {
        const groups = groupReposByRemote(repos, {});
        return groups.find(g => g.repos.some(r => String(r.workspace.id) === cloneId)) ?? null;
    }, [repos, cloneId]);
    const clones = group?.repos ?? [repo];
    const cloneStatus = useMemo(
        () => computeCloneStatusMap(repos, queueState.repoQueueMap, isHiddenTask),
        [repos, queueState.repoQueueMap],
    );
    const remoteColor = getRepoHashColor(clones[0]?.workspace, getHostname() ?? 'local');
    const remoteLabel = group ? summarizeRemote(group, cloneStatus, {}).name : ws.name;
    const providerLabel = remoteProviderLabel(group?.normalizedUrl);
    const branch = repo.gitInfo?.branch || null;

    const { fetchRepos } = useRepos();
    const { toasts, addToast, removeToast } = useToast();

    const [cloneOpen, setCloneOpen] = useState(false);
    const [ovOpen, setOvOpen] = useState(false);
    const [ctxMenu, setCtxMenu] = useState<{ repo: RepoData; x: number; y: number } | null>(null);
    const [infoRepo, setInfoRepo] = useState<RepoData | null>(null);
    const [removeRepo, setRemoveRepo] = useState<RepoData | null>(null);
    const [removing, setRemoving] = useState(false);
    // Which clone-tab keys fit inline; null means "show all" (no overflow / no layout yet).
    const [visibleKeys, setVisibleKeys] = useState<Set<string> | null>(null);
    const cloneRef = useRef<HTMLDivElement>(null);
    const ovRef = useRef<HTMLDivElement>(null);
    const cloneRegionRef = useRef<HTMLDivElement>(null);
    const measureRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!cloneOpen && !ovOpen) return;
        const onDown = (e: MouseEvent) => {
            if (cloneOpen && cloneRef.current && !cloneRef.current.contains(e.target as Node)) setCloneOpen(false);
            if (ovOpen && ovRef.current && !ovRef.current.contains(e.target as Node)) setOvOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { setCloneOpen(false); setOvOpen(false); }
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [cloneOpen, ovOpen]);

    // ── Responsive overflow: show as many clone tabs as fit; collapse the rest ──
    const recomputeOverflow = useCallback(() => {
        const region = cloneRegionRef.current;
        const measure = measureRef.current;
        if (!region || !measure) return;
        const containerWidth = region.clientWidth;
        const els = Array.from(measure.querySelectorAll<HTMLElement>('[data-measure-key]'));
        const measured = els.map(el => ({ key: el.getAttribute('data-measure-key') || '', width: el.offsetWidth }));
        const next = computeVisibleTabKeys(measured, containerWidth, activeTab);
        setVisibleKeys(prev => {
            if (next === null) return prev === null ? prev : null;
            if (prev !== null && prev.size === next.size && [...next].every(k => prev.has(k))) return prev;
            return next;
        });
    }, [activeTab]);

    useEffect(() => {
        const region = cloneRegionRef.current;
        if (!region) return;
        recomputeOverflow();
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(recomputeOverflow);
        ro.observe(region);
        return () => ro.disconnect();
    }, [recomputeOverflow, cloneTabs]);

    const visibleCloneTabs = cloneTabs.filter(t => !visibleKeys || visibleKeys.has(t.key));
    const hiddenCloneTabs = visibleKeys ? cloneTabs.filter(t => !visibleKeys.has(t.key)) : [];
    const hasOverflow = hiddenCloneTabs.length > 0;
    const overflowActive = hiddenCloneTabs.some(t => t.key === activeTab);

    const buildMenuItems = useCallback((repo: RepoData): ContextMenuItem[] => {
        const isRemote = isRemoteRepo(repo);
        return [
            {
                label: 'Repo info',
                icon: 'ℹ',
                onClick: () => { setCtxMenu(null); setInfoRepo(repo); },
            },
            {
                label: 'Copy path',
                icon: '📋',
                onClick: () => {
                    setCtxMenu(null);
                    navigator.clipboard.writeText(repo.workspace.rootPath ?? '').catch(() => {});
                },
            },
            { label: '', separator: true, onClick: () => {} },
            {
                label: 'Remove from CoC',
                icon: '🗑',
                disabled: isRemote,
                onClick: () => { setCtxMenu(null); setRemoveRepo(repo); },
            },
        ];
    }, []);

    const doRemove = useCallback(async (repo: RepoData) => {
        setRemoving(true);
        try {
            const removingSelected = String(repo.workspace.id) === cloneId;
            await removeWorkspace(String(repo.workspace.id));
            if (removingSelected) {
                const sibling = clones.find(c => String(c.workspace.id) !== String(repo.workspace.id));
                if (sibling) {
                    selectClone(String(sibling.workspace.id));
                }
            }
            setRemoveRepo(null);
            await fetchRepos();
            addToast(`Removed ${repo.workspace.name}`, 'success');
        } catch {
            addToast(`Failed to remove ${repo.workspace.name}`, 'error');
        } finally {
            setRemoving(false);
        }
    }, [cloneId, clones, selectClone, fetchRepos, addToast]);

    const onTab = (key: RepoSubTab) => {
        if (key === 'work-items') workItemDispatch({ type: 'MARK_WORK_ITEMS_SEEN', repoId: workItemOriginId });
        switchSubTab(key);
        setOvOpen(false);
    };

    const badge = (key: RepoSubTab, forMeasure = false) => {
        const tid = (id: string) => (forMeasure ? {} : { 'data-testid': id });
        if ((key === 'activity' || key === 'chats') && runningCount > 0) {
            return <span {...tid('subbar-running-badge')} className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[17px] text-[10px] font-mono bg-[#16825d] text-white px-1 rounded-full">{runningCount}</span>;
        }
        if ((key === 'activity' || key === 'chats') && queuedCount > 0) {
            return <span {...tid('subbar-queued-badge')} className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[17px] text-[10px] font-mono bg-[#0078d4] text-white px-1 rounded-full">{queuedCount}</span>;
        }
        if (key === 'work-items' && unseenWorkItemCount > 0) {
            return <span {...tid('subbar-work-items-badge')} className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[17px] text-[10px] font-mono bg-[#0078d4] text-white px-1 rounded-full">{unseenWorkItemCount}</span>;
        }
        if (key === 'git' && (gitAhead > 0 || gitBehind > 0)) {
            return (
                <span className="ml-0.5 font-mono text-[10px] opacity-70">
                    {gitAhead > 0 && <span>↑{gitAhead}</span>}
                    {gitBehind > 0 && <span>↓{gitBehind}</span>}
                </span>
            );
        }
        return null;
    };

    const renderTab = (t: SubTabDef, testid: string) => {
        const isActive = activeTab === t.key;
        return (
            <button
                key={t.key}
                data-testid={testid}
                data-subtab={t.key}
                data-active={isActive ? 'true' : 'false'}
                aria-current={isActive ? 'page' : undefined}
                title={t.shortcut}
                onClick={() => onTab(t.key)}
                className={
                    'relative inline-flex items-center gap-1.5 h-[30px] px-2.5 rounded-md text-[13px] whitespace-nowrap shrink-0 transition-colors ' +
                    (isActive
                        ? 'font-bold text-[#0969da] dark:text-[#79c0ff] shadow-[inset_0_-2px_0_#0969da] dark:shadow-[inset_0_-2px_0_#3794ff]'
                        : 'font-semibold text-[#656d76] dark:text-[#999] hover:text-[#1f2328] dark:hover:text-[#cccccc] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2a2a]')
                }
            >
                {t.label}
                {badge(t.key)}
            </button>
        );
    };

    return (
        <div
            className="relative flex items-center gap-0.5 h-[42px] flex-shrink-0 px-3 border-b border-[#d0d7de] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e]"
            data-testid="remote-sub-bar"
        >
            {/* Hidden width-measurement mirror of every clone tab (drives overflow). */}
            <div ref={measureRef} aria-hidden className="absolute invisible h-0 overflow-hidden flex items-center gap-0.5 pointer-events-none">
                {cloneTabs.map(t => (
                    <span
                        key={t.key}
                        data-measure-key={t.key}
                        className={'inline-flex items-center gap-1.5 h-[30px] px-2.5 text-[13px] whitespace-nowrap ' + (activeTab === t.key ? 'font-bold' : 'font-semibold')}
                    >
                        {t.label}
                        {badge(t.key, true)}
                    </span>
                ))}
            </div>

            {/* ── Remote scope ── */}
            {remoteTabs.length > 0 && <span className={scopeLabelClass} data-testid="scope-label-remote">{providerLabel}</span>}
            {remoteTabs.map(t => renderTab(t, 'remote-scope-tab'))}

            {/* divider */}
            <span className="w-px h-[22px] bg-[#d8dee4] dark:bg-[#3c3c3c] mx-2 flex-shrink-0" aria-hidden />

            {/* ── Clone scope ── */}
            <div className="relative flex-shrink-0" ref={cloneRef}>
                <button
                    data-testid="clone-switch"
                    onClick={() => setCloneOpen(o => !o)}
                    aria-haspopup="menu"
                    aria-expanded={cloneOpen}
                    title={ws.name}
                    className="inline-flex items-center gap-1.5 h-[30px] px-2.5 rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-[#f6f8fa] dark:bg-[#2a2a2a] text-[13px] font-semibold text-[#1f2328] dark:text-[#cccccc] hover:border-[#0078d4] dark:hover:border-[#0078d4] transition-colors"
                >
                    <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: cloneStatusColor(cloneStatus[cloneId], remoteColor) }} aria-hidden />
                    <span className="max-w-[160px] truncate">{ws.name}</span>
                    {clones.length > 1 && <span className="text-[11px] text-[#848484] dark:text-[#777]">· {clones.length}</span>}
                    <Chevron />
                </button>
                {cloneOpen && (
                    <div
                        className="absolute z-50 top-full left-0 mt-1 min-w-[280px] rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-lg p-1.5"
                        role="menu"
                        data-testid="clone-popover"
                    >
                        <div className="flex items-center justify-between px-2 pt-1 pb-2 text-[10px] font-bold uppercase tracking-[0.07em] text-[#848484] dark:text-[#777]">
                            <span className="truncate">{remoteLabel} · clones</span>
                            <span className="font-mono">{clones.length}</span>
                        </div>
                        {clones.map((c, i) => {
                            const cid = String(c.workspace.id);
                            const isSel = cid === cloneId;
                            const st = cloneStatus[cid];
                            const isRemote = isRemoteRepo(c);
                            // Offline (AC-06): reuse the AC-05 blended status — a remote
                            // clone whose server is offline/failed resolves to 'offline'.
                            // An offline row is greyed + non-interactive so its live tabs
                            // are never opened; it flips back the moment the marker reports
                            // online again (aggregateRemoteWorkspaces re-run).
                            const isOffline = isRemote && st === 'offline';
                            // Anchor the LOCAL badge on the first LOCAL clone; clones are
                            // sorted local-first by groupReposByRemote. The "Local" label is
                            // shown only when the group has both local and remote clones.
                            const serverLabel = isRemote
                                ? String((c.workspace as { remote?: { serverLabel?: unknown } }).remote?.serverLabel ?? 'remote')
                                : null;
                            return (
                                <button
                                    key={cid}
                                    data-testid="clone-popover-item"
                                    data-remote={isRemote ? 'true' : 'false'}
                                    data-clone-status={st ?? 'idle'}
                                    data-offline={isOffline ? 'true' : 'false'}
                                    disabled={isOffline}
                                    aria-disabled={isOffline}
                                    role="menuitem"
                                    title={isOffline ? `${c.workspace.name} · offline (server unreachable)` : undefined}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        setCloneOpen(false);
                                        setCtxMenu({ repo: c, x: e.clientX, y: e.clientY });
                                    }}
                                    onClick={() => {
                                        // Block selection/navigation for offline clones so a
                                        // dead remote server's tabs are never opened.
                                        if (isOffline) return;
                                        selectClone(cid);
                                        setCloneOpen(false);
                                    }}
                                    className={
                                        'w-full flex items-center gap-2.5 px-2 py-2 rounded-md text-left transition-colors ' +
                                        (isOffline
                                            ? 'opacity-50 grayscale cursor-not-allowed'
                                            : (isSel ? 'bg-[#ddf4ff] dark:bg-[#3794ff]/15' : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'))
                                    }
                                >
                                    <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5" style={{ background: cloneStatusColor(st, getRepoHashColor(c.workspace, getHostname() ?? 'local')) }} aria-hidden />
                                    <span className="flex-1 min-w-0">
                                        <span className="flex items-center gap-1.5">
                                            <span className={'text-[12.5px] font-semibold truncate ' + (isSel && !isOffline ? 'text-[#0969da] dark:text-[#79c0ff]' : 'text-[#1e1e1e] dark:text-[#cccccc]')}>{c.workspace.name}</span>
                                            {!isRemote && clones.length > 1 && clones.some(cl => isRemoteRepo(cl)) && <span className="text-[9px] font-bold uppercase px-1.5 py-px rounded bg-[#ddf4ff] dark:bg-[#3794ff]/20 text-[#0969da] dark:text-[#79c0ff]">Local</span>}
                                            {serverLabel && (
                                                <span
                                                    data-testid="clone-remote-badge"
                                                    title={`Remote · ${serverLabel}`}
                                                    className="inline-flex items-center max-w-[110px] truncate text-[9px] font-bold uppercase tracking-[0.04em] px-1.5 py-px rounded bg-[#8250df]/12 text-[#8250df] dark:bg-[#a371f7]/15 dark:text-[#a371f7]"
                                                >
                                                    {serverLabel}
                                                </span>
                                            )}
                                            {isOffline && (
                                                <span
                                                    data-testid="clone-offline-badge"
                                                    title="Server offline — showing last-known state"
                                                    className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.04em] px-1.5 py-px rounded bg-[#8c959f]/15 text-[#6e7781] dark:text-[#8c959f]"
                                                >
                                                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#8c959f]" aria-hidden />
                                                    offline
                                                </span>
                                            )}
                                            {!isOffline && st === 'running' && <span className="text-[9px] font-bold uppercase px-1.5 py-px rounded bg-[#16a34a]/15 text-[#16a34a]">running</span>}
                                        </span>
                                        <span className="block font-mono text-[10.5px] text-[#848484] dark:text-[#777] truncate mt-0.5">{truncatePath(c.workspace.rootPath || '', 36)}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Clone tabs — fill the available space; the tail overflows into ⋯. */}
            <div ref={cloneRegionRef} className="flex items-center gap-0.5 flex-1 min-w-0 overflow-hidden" data-testid="clone-tab-region">
                {visibleCloneTabs.map(t => renderTab(t, 'clone-scope-tab'))}
            </div>

            {/* overflow ⋯ (only when some clone tabs don't fit) */}
            {hasOverflow && (
                <div className="relative flex-shrink-0" ref={ovRef}>
                    <button
                        data-testid="subbar-overflow-toggle"
                        data-active={overflowActive ? 'true' : 'false'}
                        aria-label="More clone tabs"
                        aria-expanded={ovOpen}
                        aria-haspopup="menu"
                        title="More"
                        onClick={() => setOvOpen(o => !o)}
                        className={
                            'inline-flex items-center justify-center h-[30px] px-2 rounded-md text-[15px] leading-none transition-colors ' +
                            (overflowActive
                                ? 'font-bold text-[#0969da] dark:text-[#79c0ff] shadow-[inset_0_-2px_0_#0969da] dark:shadow-[inset_0_-2px_0_#3794ff]'
                                : 'text-[#656d76] dark:text-[#999] hover:text-[#1f2328] dark:hover:text-[#cccccc] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2a2a]')
                        }
                    >
                        <span aria-hidden className="-mt-1">…</span>
                    </button>
                    {ovOpen && (
                        <div
                            className="absolute z-50 top-full right-0 mt-1 min-w-[190px] rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-lg p-1.5"
                            role="menu"
                            data-testid="subbar-overflow-menu"
                        >
                            <div className="px-2 pt-1 pb-2 text-[10px] font-bold uppercase tracking-[0.07em] text-[#848484] dark:text-[#777]">More · this clone</div>
                            {hiddenCloneTabs.map(t => {
                                const isActive = activeTab === t.key;
                                return (
                                    <button
                                        key={t.key}
                                        data-testid="overflow-menu-item"
                                        data-subtab={t.key}
                                        role="menuitem"
                                        onClick={() => onTab(t.key)}
                                        className={
                                            'w-full text-left flex items-center px-2 py-2 rounded-md text-[12.5px] transition-colors ' +
                                            (isActive
                                                ? 'bg-[#ddf4ff] dark:bg-[#3794ff]/15 text-[#0969da] dark:text-[#79c0ff] font-semibold'
                                                : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]')
                                        }
                                    >
                                        {t.label}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* ── Clone-scoped actions ── */}
            <button
                data-testid="subbar-ask"
                title={`Ask AI about ${ws.name} (read-only)`}
                onClick={() => queueDispatch({ type: 'OPEN_DIALOG', workspaceId: cloneId, mode: 'ask' })}
                className="inline-flex items-center gap-1 h-[28px] px-2.5 rounded-md text-[12px] font-semibold bg-yellow-500 hover:bg-yellow-600 dark:bg-yellow-400 dark:hover:bg-yellow-300 text-[#1e1e1e] transition-colors flex-shrink-0 ml-1"
            >
                Ask
            </button>
            <button
                data-testid="subbar-queue"
                title={`Queue a task on ${ws.name}${branch ? ' (' + branch + ')' : ''}`}
                onClick={() => queueDispatch({ type: 'OPEN_DIALOG', workspaceId: cloneId })}
                className="inline-flex items-center gap-1 h-[28px] px-2.5 rounded-md text-[12px] font-semibold bg-[#1f883d] hover:bg-[#1a7f37] dark:bg-[#238636] dark:hover:bg-[#2ea043] text-white transition-colors flex-shrink-0"
            >
                <span className="text-[14px] leading-none">+</span>
                Queue
            </button>

            {/* ── Clone context menu (portal, outside popover) ── */}
            {ctxMenu && (
                <ContextMenu
                    position={{ x: ctxMenu.x, y: ctxMenu.y }}
                    items={buildMenuItems(ctxMenu.repo)}
                    onClose={() => setCtxMenu(null)}
                />
            )}

            {/* ── Repo info dialog ── */}
            {infoRepo && (
                <Dialog
                    open={true}
                    onClose={() => setInfoRepo(null)}
                    title="Repo info"
                    data-testid="clone-info-dialog"
                    footer={
                        <button
                            onClick={() => setInfoRepo(null)}
                            className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[#f6f8fa] dark:bg-[#2a2a2a] border border-[#d0d7de] dark:border-[#3c3c3c] text-[#1f2328] dark:text-[#cccccc] hover:bg-[#eaeef2] dark:hover:bg-[#3c3c3c] transition-colors"
                        >
                            Close
                        </button>
                    }
                >
                    <div className="flex flex-col gap-2 text-[13px]" data-testid="clone-info-content">
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-[#848484] dark:text-[#777]">Name</span>
                            <span className="font-semibold">{infoRepo.workspace.name}</span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-[#848484] dark:text-[#777]">Path</span>
                            <span className="font-mono text-[12px] break-all" data-testid="clone-info-path">{infoRepo.workspace.rootPath ?? '—'}</span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-[#848484] dark:text-[#777]">Branch</span>
                            <span className="font-mono text-[12px]" data-testid="clone-info-branch">{infoRepo.gitInfo?.branch ?? '—'}</span>
                        </div>
                        {(infoRepo.workspace.remoteUrl || infoRepo.gitInfo?.remoteUrl) && (
                            <div className="flex flex-col gap-0.5">
                                <span className="text-[10px] font-bold uppercase tracking-wide text-[#848484] dark:text-[#777]">Remote URL</span>
                                <span className="font-mono text-[12px] break-all">{infoRepo.workspace.remoteUrl ?? infoRepo.gitInfo?.remoteUrl ?? '—'}</span>
                            </div>
                        )}
                        {(infoRepo.gitInfo?.ahead != null || infoRepo.gitInfo?.behind != null || infoRepo.gitInfo?.dirty != null) && (
                            <div className="flex flex-col gap-0.5">
                                <span className="text-[10px] font-bold uppercase tracking-wide text-[#848484] dark:text-[#777]">Git status</span>
                                <span className="font-mono text-[12px]">
                                    {infoRepo.gitInfo?.dirty ? 'dirty · ' : 'clean · '}
                                    {infoRepo.gitInfo?.ahead != null && <>↑{infoRepo.gitInfo.ahead} </>}
                                    {infoRepo.gitInfo?.behind != null && <>↓{infoRepo.gitInfo.behind}</>}
                                </span>
                            </div>
                        )}
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-[#848484] dark:text-[#777]">Workspace ID</span>
                            <span className="font-mono text-[12px] text-[#848484] dark:text-[#777]">{infoRepo.workspace.id}</span>
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                            {isRemoteRepo(infoRepo) ? (
                                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-[#8250df]/12 text-[#8250df] dark:bg-[#a371f7]/15 dark:text-[#a371f7]">Remote</span>
                            ) : (
                                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-[#ddf4ff] dark:bg-[#3794ff]/20 text-[#0969da] dark:text-[#79c0ff]">Local</span>
                            )}
                        </div>
                    </div>
                </Dialog>
            )}

            {/* ── Remove confirmation dialog ── */}
            {removeRepo && (
                <Dialog
                    open={true}
                    onClose={() => !removing && setRemoveRepo(null)}
                    title="Remove from CoC?"
                    data-testid="clone-remove-dialog"
                    footer={
                        <>
                            <button
                                onClick={() => setRemoveRepo(null)}
                                disabled={removing}
                                className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[#f6f8fa] dark:bg-[#2a2a2a] border border-[#d0d7de] dark:border-[#3c3c3c] text-[#1f2328] dark:text-[#cccccc] hover:bg-[#eaeef2] dark:hover:bg-[#3c3c3c] transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                data-testid="clone-remove-confirm-btn"
                                onClick={() => doRemove(removeRepo)}
                                disabled={removing}
                                className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[#cf222e] hover:bg-[#a40e26] text-white transition-colors disabled:opacity-50"
                            >
                                {removing ? 'Removing…' : 'Remove'}
                            </button>
                        </>
                    }
                >
                    <p className="text-[13px]">
                        Remove <strong>{removeRepo.workspace.name}</strong> from CoC?
                    </p>
                    <p className="text-[12px] text-[#848484] dark:text-[#777] mt-1">
                        The folder on disk is left untouched — only the CoC registration is removed.
                    </p>
                </Dialog>
            )}

            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </div>
    );
}
