/**
 * RemoteSubBar — row 2 of the remote-first shell.
 *
 * Splits into two scopes:
 *   • Remote scope (shared across clones): Work Items, Pull Requests — shown once
 *     and unchanged when you switch clones.
 *   • Clone scope (follows the active checkout): a clone-switcher popover + the
 *     primary clone tabs (Activity, CLI Sessions, Git, Terminal). Less-used tabs
 *     (Explorer, Schedules, …) collapse under a ⋯ overflow.
 *
 * Compact Ask / Queue actions sit at the right edge, targeting the active clone.
 * Rendered above a chromeless RepoDetail in ReposView when the shell is on.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useQueue } from '../../contexts/QueueContext';
import { useWorkItems } from '../../contexts/WorkItemContext';
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
import { groupReposByRemote, truncatePath } from '../../repos/repoGrouping';
import { CloneRepoDialog } from '../../repos/CloneRepoDialog';
import {
    partitionShellTabs, computeCloneStatusMap, cloneStatusColor, summarizeRemote,
} from './shellModel';
import { useShellNavigation } from './useShellNavigation';
import type { RepoData } from '../../repos/repoGrouping';
import type { RepoSubTab } from '../../types/dashboard';

interface RemoteSubBarProps {
    repo: RepoData;
    repos: RepoData[];
    onRefresh: () => void;
}

function Chevron() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
        </svg>
    );
}

const scopeLabelClass = 'hidden lg:inline-flex items-center text-[9.5px] font-bold uppercase tracking-[0.08em] text-[#848484] dark:text-[#777] px-1 select-none flex-shrink-0';

export function RemoteSubBar({ repo, repos, onRefresh }: RemoteSubBarProps) {
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

    const { running: runningCount, queued: queuedCount } = useRepoQueueStats(cloneId);
    const { ahead: gitAhead, behind: gitBehind } = useGitInfo(cloneId);
    const unseenWorkItemCount = (workItemState.unseenByRepo[cloneId] || []).length;
    const activeTab = state.activeRepoSubTab;

    const tabs = useMemo(() => computeVisibleSubTabs({
        isGitRepo, terminalEnabled, notesEnabled, workflowsEnabled,
        pullRequestsEnabled, dreamsEnabled, nativeCliSessionsEnabled, uiLayoutMode,
    }), [isGitRepo, terminalEnabled, notesEnabled, workflowsEnabled, pullRequestsEnabled, dreamsEnabled, nativeCliSessionsEnabled, uiLayoutMode]);
    const { remote: remoteTabs, clone: cloneTabs, overflow: overflowTabs } = useMemo(() => partitionShellTabs(tabs), [tabs]);
    const overflowActive = overflowTabs.some(t => t.key === activeTab);

    const group = useMemo(() => {
        const groups = groupReposByRemote(repos, {});
        return groups.find(g => g.repos.some(r => String(r.workspace.id) === cloneId)) ?? null;
    }, [repos, cloneId]);
    const clones = group?.repos ?? [repo];
    const cloneStatus = useMemo(
        () => computeCloneStatusMap(repos, queueState.repoQueueMap, isHiddenTask),
        [repos, queueState.repoQueueMap],
    );
    const remoteColor = (clones[0]?.workspace.color as string) || '#848484';
    const remoteLabel = group ? summarizeRemote(group, cloneStatus, {}).name : ws.name;
    const branch = repo.gitInfo?.branch || null;

    const [cloneOpen, setCloneOpen] = useState(false);
    const [ovOpen, setOvOpen] = useState(false);
    const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
    const cloneRef = useRef<HTMLDivElement>(null);
    const ovRef = useRef<HTMLDivElement>(null);

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

    const onTab = (key: RepoSubTab) => {
        if (key === 'work-items') workItemDispatch({ type: 'MARK_WORK_ITEMS_SEEN', repoId: cloneId });
        switchSubTab(key);
        setOvOpen(false);
    };

    const badge = (key: RepoSubTab) => {
        if ((key === 'activity' || key === 'chats') && runningCount > 0) {
            return <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[17px] text-[10px] font-mono bg-[#16825d] text-white px-1 rounded-full" data-testid="subbar-running-badge">{runningCount}</span>;
        }
        if ((key === 'activity' || key === 'chats') && queuedCount > 0) {
            return <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[17px] text-[10px] font-mono bg-[#0078d4] text-white px-1 rounded-full" data-testid="subbar-queued-badge">{queuedCount}</span>;
        }
        if (key === 'work-items' && unseenWorkItemCount > 0) {
            return <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[17px] text-[10px] font-mono bg-[#0078d4] text-white px-1 rounded-full" data-testid="subbar-work-items-badge">{unseenWorkItemCount}</span>;
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
            className="flex items-center gap-0.5 h-[42px] flex-shrink-0 px-3 border-b border-[#d0d7de] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] overflow-x-auto scrollbar-hide"
            data-testid="remote-sub-bar"
        >
            {/* ── Remote scope ── */}
            {remoteTabs.length > 0 && <span className={scopeLabelClass} data-testid="scope-label-remote">Remote</span>}
            {remoteTabs.map(t => renderTab(t, 'remote-scope-tab'))}

            {/* divider */}
            <span className="w-px h-[22px] bg-[#d8dee4] dark:bg-[#3c3c3c] mx-2 flex-shrink-0" aria-hidden />

            {/* ── Clone scope ── */}
            <span className={scopeLabelClass} data-testid="scope-label-clone">Clone</span>
            <div className="relative flex-shrink-0" ref={cloneRef}>
                <button
                    data-testid="clone-switch"
                    onClick={() => setCloneOpen(o => !o)}
                    aria-haspopup="menu"
                    aria-expanded={cloneOpen}
                    title={`${ws.name}${branch ? ' · ' + branch : ''}`}
                    className="inline-flex items-center gap-1.5 h-[30px] px-2.5 rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-[#f6f8fa] dark:bg-[#2a2a2a] text-[13px] font-semibold text-[#1f2328] dark:text-[#cccccc] hover:border-[#0078d4] dark:hover:border-[#0078d4] transition-colors"
                >
                    <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: cloneStatusColor(cloneStatus[cloneId], remoteColor) }} aria-hidden />
                    <span className="max-w-[160px] truncate">{ws.name}</span>
                    {branch && <span className="font-mono text-[11px] text-[#848484] dark:text-[#777] font-normal">{branch}</span>}
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
                            return (
                                <button
                                    key={cid}
                                    data-testid="clone-popover-item"
                                    role="menuitem"
                                    onClick={() => { selectClone(cid); setCloneOpen(false); }}
                                    className={
                                        'w-full flex items-center gap-2.5 px-2 py-2 rounded-md text-left transition-colors ' +
                                        (isSel ? 'bg-[#ddf4ff] dark:bg-[#3794ff]/15' : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]')
                                    }
                                >
                                    <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5" style={{ background: cloneStatusColor(st, (c.workspace.color as string) || remoteColor) }} aria-hidden />
                                    <span className="flex-1 min-w-0">
                                        <span className="flex items-center gap-1.5">
                                            <span className={'text-[12.5px] font-semibold truncate ' + (isSel ? 'text-[#0969da] dark:text-[#79c0ff]' : 'text-[#1e1e1e] dark:text-[#cccccc]')}>{c.workspace.name}</span>
                                            {i === 0 && clones.length > 1 && <span className="text-[9px] font-bold uppercase px-1.5 py-px rounded bg-[#ddf4ff] dark:bg-[#3794ff]/20 text-[#0969da] dark:text-[#79c0ff]">primary</span>}
                                            {st === 'running' && <span className="text-[9px] font-bold uppercase px-1.5 py-px rounded bg-[#16a34a]/15 text-[#16a34a]">running</span>}
                                        </span>
                                        <span className="block font-mono text-[10.5px] text-[#848484] dark:text-[#777] truncate mt-0.5">{truncatePath(c.workspace.rootPath || '', 36)}</span>
                                    </span>
                                    <span className="flex items-center gap-1.5 flex-shrink-0">
                                        {c.gitInfo?.branch && <span className="font-mono text-[10.5px] text-[#656d76] dark:text-[#999]">{c.gitInfo.branch}</span>}
                                    </span>
                                </button>
                            );
                        })}
                        <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] mt-1.5 pt-1.5">
                            <button
                                data-testid="clone-add-worktree"
                                onClick={() => { setCloneDialogOpen(true); setCloneOpen(false); }}
                                className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-[12px] font-medium text-[#656d76] dark:text-[#999] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
                            >
                                <span className="text-[15px] leading-none">+</span>
                                Clone again / add worktree…
                            </button>
                        </div>
                    </div>
                )}
            </div>
            {cloneTabs.map(t => renderTab(t, 'clone-scope-tab'))}

            {/* overflow ⋯ */}
            {overflowTabs.length > 0 && (
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
                            className="absolute z-50 top-full left-0 mt-1 min-w-[190px] rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-lg p-1.5"
                            role="menu"
                            data-testid="subbar-overflow-menu"
                        >
                            <div className="px-2 pt-1 pb-2 text-[10px] font-bold uppercase tracking-[0.07em] text-[#848484] dark:text-[#777]">More · this clone</div>
                            {overflowTabs.map(t => {
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
            <span className="flex-1" />
            <button
                data-testid="subbar-ask"
                title={`Ask AI about ${ws.name} (read-only)`}
                onClick={() => queueDispatch({ type: 'OPEN_DIALOG', workspaceId: cloneId, mode: 'ask' })}
                className="inline-flex items-center gap-1 h-[28px] px-2.5 rounded-md text-[12px] font-semibold bg-yellow-500 hover:bg-yellow-600 dark:bg-yellow-400 dark:hover:bg-yellow-300 text-[#1e1e1e] transition-colors flex-shrink-0"
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

            <CloneRepoDialog
                open={cloneDialogOpen}
                onClose={() => setCloneDialogOpen(false)}
                onSuccess={() => { setCloneDialogOpen(false); onRefresh(); }}
            />
        </div>
    );
}
