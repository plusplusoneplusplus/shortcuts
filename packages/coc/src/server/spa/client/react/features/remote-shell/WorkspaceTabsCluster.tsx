import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useQueue } from '../../contexts/QueueContext';
import { useRepos } from '../../contexts/ReposContext';
import { useTerminalEnabled } from '../../hooks/feature-flags/useTerminalEnabled';
import { useWorkflowsEnabled } from '../../hooks/feature-flags/useWorkflowsEnabled';
import { useDreamsEnabled } from '../../hooks/feature-flags/useDreamsEnabled';
import { useShowPlanDepTab } from '../../hooks/feature-flags/useShowPlanDepTab';
import { useSchedulesInScheduledSlideEnabled } from '../../hooks/feature-flags/useSchedulesInScheduledSlideEnabled';
import { isHidden as isHiddenTask } from '../../queue/hooks/useRepoQueueStats';
import { useGitInfo } from '../git/hooks/useGitInfo';
import { computeVisibleSubTabs, subTabClickTarget, type SubTabDef } from '../repo-detail/repoSubTabs';
import { getRepoHashColor, getServerHashColor, groupKey, groupReposByRemote, isRemoteRepo, truncatePath } from '../../repos/repoGrouping';
import { getRepoSelectionId } from '../../repos/cloneIdentity';
import { cloneStatusColor, computeCloneActivity, computeCloneStatusMap, computeVisibleTabKeys, describeRemoveBlock, partitionShellTabs, summarizeRemote } from './shellModel';
import { useShellNavigation } from './useShellNavigation';
import { useRecentRemotes } from './useRecentRemotes';
import { useWorkspaceRemoval } from './useWorkspaceRemoval';
import { ContextMenu, type ContextMenuItem } from '../../tasks/comments/ContextMenu';
import { Dialog } from '../../ui/Dialog';
import { ToastContainer, useToast } from '../../ui/Toast';
import { getWorkspaceCloneLabel, getWorkspaceMachineName } from './WorkspaceCloneLabel';
import { isRepoOffline, shortPath } from '../../repos/repoPickerModel';
import { getHostname } from '../../utils/config';
import type { RepoData } from '../../repos/repoGrouping';
import type { RepoSubTab } from '../../types/dashboard';

export interface WorkspaceTabsClusterProps {
    repo: RepoData;
    repos: RepoData[];
}

const unreadBadgeClass = 'min-w-[14px] h-[14px] px-[3px] rounded-full bg-[#d16969] text-white text-[8px] font-semibold flex items-center justify-center leading-none';

function formatUnreadCount(count: number): string {
    return count > 99 ? '99+' : String(count);
}

export function WorkspaceTabsCluster({ repo, repos }: WorkspaceTabsClusterProps) {
    const ws = repo.workspace;
    const workspaceId = String(ws.id);
    const cloneId = getRepoSelectionId(repo);
    const { state } = useApp();
    const { state: queueState } = useQueue();
    const { selectClone, switchSubTab } = useShellNavigation();
    const { badgeCounts, unseenCounts: processUnseenCounts } = useRepos();
    const unseenCounts = badgeCounts ?? processUnseenCounts;
    const { toasts, addToast, removeToast } = useToast();

    const terminalEnabled = useTerminalEnabled();
    const workflowsEnabled = useWorkflowsEnabled();
    const dreamsEnabled = useDreamsEnabled();
    const showPlanDepTab = useShowPlanDepTab();
    const schedulesInScheduledSlideEnabled = useSchedulesInScheduledSlideEnabled();
    const isGitRepo = !!repo.gitInfo?.isGitRepo;
    // The Workspace surface has no header tab; 'chats' normalizes to its
    // 'activity' alias. Top-level pages have no active workspace sub-tab.
    const rawActiveTab = state.activeTab === 'repos' ? state.activeRepoSubTab : null;
    const activeTab = rawActiveTab === 'chats' ? 'activity' : rawActiveTab;

    const { ahead: gitAhead, behind: gitBehind } = useGitInfo(workspaceId);

    const tabs = useMemo(() => computeVisibleSubTabs({
        isGitRepo, terminalEnabled, workflowsEnabled,
        dreamsEnabled, showPlanDepTab,
        schedulesInScheduledSlideEnabled,
    }), [isGitRepo, terminalEnabled, workflowsEnabled, dreamsEnabled, showPlanDepTab, schedulesInScheduledSlideEnabled]);
    const { clone: cloneTabs } = useMemo(() => partitionShellTabs(tabs), [tabs]);

    const group = useMemo(() => {
        const groups = groupReposByRemote(repos, {});
        return groups.find(g => g.repos.some(r => getRepoSelectionId(r) === getRepoSelectionId(repo))) ?? null;
    }, [repos, repo]);
    const { recordUse: recordRemoteUse } = useRecentRemotes(group ? [group] : []);
    const clones = group?.repos ?? [repo];
    const cloneStatus = useMemo(
        () => computeCloneStatusMap(repos, queueState.repoQueueMap, isHiddenTask),
        [repos, queueState.repoQueueMap],
    );
    const remoteLabel = group ? summarizeRemote(group, cloneStatus, {}).name : ws.name;
    // Clones whose "name / machine" text collides also show their short path.
    const duplicateLabels = useMemo(() => {
        const seen = new Set<string>();
        const dup = new Set<string>();
        for (const c of clones) {
            const label = getWorkspaceCloneLabel(c);
            if (seen.has(label)) dup.add(label);
            seen.add(label);
        }
        return dup;
    }, [clones]);

    const [hoverPill, setHoverPill] = useState<{ id: string; left: number } | null>(null);
    const pillTooltipId = useId();
    const [ovOpen, setOvOpen] = useState(false);
    const [ctxMenu, setCtxMenu] = useState<{ repo: RepoData; x: number; y: number } | null>(null);
    const [infoRepo, setInfoRepo] = useState<RepoData | null>(null);
    const { requestRemove, removeDialog } = useWorkspaceRemoval({ repos, selectedRepo: repo, addToast });
    const [visibleKeys, setVisibleKeys] = useState<Set<string> | null>(null);
    const stripRef = useRef<HTMLDivElement>(null);
    const ovRef = useRef<HTMLDivElement>(null);
    const cloneRegionRef = useRef<HTMLDivElement>(null);
    const measureRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!ovOpen) return;
        const onDown = (e: MouseEvent) => {
            const target = e.target as Element | null;
            if (target?.closest?.('[data-testid="context-menu"]')) return;
            if (ovRef.current && !ovRef.current.contains(e.target as Node)) setOvOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOvOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [ovOpen]);

    // Keep the selected clone visible when the strip scrolls horizontally.
    useEffect(() => {
        const pills = stripRef.current?.querySelectorAll<HTMLElement>('[data-testid="clone-pill"]') ?? [];
        const pill = Array.from(pills).find(el => el.dataset.selectionId === cloneId);
        pill?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }, [cloneId, clones.length]);

    const hoverRepo = hoverPill ? clones.find(c => getRepoSelectionId(c) === hoverPill.id) ?? null : null;
    const showPillTooltip = (id: string, el: HTMLElement) => {
        const cluster = el.closest('[data-testid="workspace-tabs-cluster"]');
        setHoverPill({ id, left: el.getBoundingClientRect().left - (cluster?.getBoundingClientRect().left ?? 0) });
    };

    // Arrow/Home/End move focus across enabled pills; ContextMenu or Shift+F10
    // opens the clone menu from the keyboard.
    const onPillKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
            e.preventDefault();
            const target = clones.find(c => getRepoSelectionId(c) === e.currentTarget.dataset.selectionId);
            const rect = e.currentTarget.getBoundingClientRect();
            if (target) setCtxMenu({ repo: target, x: rect.left, y: rect.bottom });
            return;
        }
        const pills = Array.from(stripRef.current?.querySelectorAll<HTMLButtonElement>('[data-testid="clone-pill"]:not(:disabled)') ?? []);
        const i = pills.indexOf(e.currentTarget);
        const next = e.key === 'ArrowRight' ? pills[i + 1]
            : e.key === 'ArrowLeft' ? pills[i - 1]
            : e.key === 'Home' ? pills[0]
            : e.key === 'End' ? pills[pills.length - 1]
            : undefined;
        if (!next) return;
        e.preventDefault();
        next.focus();
    };

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

    const buildMenuItems = useCallback((menuRepo: RepoData): ContextMenuItem[] => {
        // A remote repo is owned by the CoC server that contributed it, so removal
        // is routed there. When that server is unreachable the DELETE cannot land —
        // disable up front rather than failing after the confirm.
        const removeBlock = describeRemoveBlock(menuRepo, cloneStatus[String(menuRepo.workspace.id)]);
        const close = () => setCtxMenu(null);
        return [
            {
                label: 'Repo info',
                icon: 'i',
                onClick: () => { close(); setInfoRepo(menuRepo); },
            },
            {
                label: 'Copy path',
                icon: 'Copy',
                onClick: () => {
                    close();
                    navigator.clipboard.writeText(menuRepo.workspace.rootPath ?? '').catch(() => {});
                },
            },
            { label: '', separator: true, onClick: () => {} },
            {
                label: 'Remove from CoC',
                icon: 'X',
                disabled: !!removeBlock,
                title: removeBlock ?? undefined,
                onClick: () => { close(); requestRemove(menuRepo); },
            },
        ];
    }, [cloneStatus, requestRemove]);

    const onTab = (key: RepoSubTab) => {
        const next = subTabClickTarget(activeTab, key);
        if (cloneId === workspaceId) {
            switchSubTab(next);
        } else {
            selectClone(cloneId, next);
        }
        setOvOpen(false);
    };

    const badge = (key: RepoSubTab, forMeasure = false) => {
        const tid = (id: string) => (forMeasure ? {} : { 'data-testid': id });
        if (key === 'git' && (gitAhead > 0 || gitBehind > 0)) {
            return (
                <span className="ml-0.5 font-mono text-[10px] opacity-70">
                    {gitAhead > 0 && <span>↑{gitAhead}</span>}
                    {gitBehind > 0 && <span>↓{gitBehind}</span>}
                </span>
            );
        }
        if (key === 'tasks' && (repo.taskCount || 0) > 0) {
            return <span {...tid('subbar-tasks-badge')} className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[17px] text-[10px] font-mono bg-[#0078d4] text-white px-1 rounded-full">{repo.taskCount}</span>;
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
                    'relative inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-md text-[13px] whitespace-nowrap shrink-0 transition-colors ' +
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
        <div className="relative flex items-center gap-0.5 flex-1 min-w-0" data-testid="workspace-tabs-cluster">
            <div ref={measureRef} aria-hidden className="absolute invisible h-0 overflow-hidden flex items-center gap-0.5 pointer-events-none">
                {cloneTabs.map(t => (
                    <span
                        key={t.key}
                        data-measure-key={t.key}
                        className={'inline-flex items-center gap-1.5 h-[26px] px-2.5 text-[13px] whitespace-nowrap ' + (activeTab === t.key ? 'font-bold' : 'font-semibold')}
                    >
                        {t.label}
                        {badge(t.key, true)}
                    </span>
                ))}
            </div>

            <div
                ref={stripRef}
                role="group"
                aria-label={`${remoteLabel} clones`}
                data-testid="clone-strip"
                onScroll={() => setHoverPill(null)}
                className="flex flex-1 items-center gap-1 min-w-0 overflow-x-auto overflow-y-hidden py-0.5 [scrollbar-width:thin]"
            >
                {clones.map(c => {
                    const selectionId = getRepoSelectionId(c);
                    const isSel = selectionId === cloneId;
                    const { status: st, running, queued } = computeCloneActivity(c, queueState.repoQueueMap, isHiddenTask);
                    const isRemote = isRemoteRepo(c);
                    const isOffline = isRemote && st === 'offline';
                    const machine = getWorkspaceMachineName(c);
                    const label = getWorkspaceCloneLabel(c);
                    const cloneUnreadCount = unseenCounts[selectionId] ?? 0;
                    const activity = [running > 0 && `${running} running`, queued > 0 && `${queued} queued`, cloneUnreadCount > 0 && `${cloneUnreadCount} needing attention`]
                        .filter(Boolean).join(', ');
                    return (
                        <button
                            key={selectionId}
                            type="button"
                            data-testid="clone-pill"
                            data-selection-id={selectionId}
                            data-active={isSel ? 'true' : 'false'}
                            data-remote={isRemote ? 'true' : 'false'}
                            data-clone-status={st}
                            data-offline={isOffline ? 'true' : 'false'}
                            aria-current={isSel ? 'true' : undefined}
                            aria-label={[label, isOffline && 'offline', activity].filter(Boolean).join(', ')}
                            aria-describedby={hoverPill?.id === selectionId ? pillTooltipId : undefined}
                            disabled={isOffline && !isSel}
                            onMouseEnter={(e) => showPillTooltip(selectionId, e.currentTarget)}
                            onMouseLeave={() => setHoverPill(null)}
                            onFocus={(e) => showPillTooltip(selectionId, e.currentTarget)}
                            onBlur={() => setHoverPill(null)}
                            onKeyDown={onPillKeyDown}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                setCtxMenu({ repo: c, x: e.clientX, y: e.clientY });
                            }}
                            onClick={() => {
                                if (isOffline && !isSel) return;
                                if (group) recordRemoteUse(groupKey(group));
                                selectClone(selectionId);
                            }}
                            className={
                                'inline-flex items-center gap-1.5 h-[26px] px-2 rounded-md border text-[12.5px] whitespace-nowrap shrink-0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4] ' +
                                (isSel
                                    ? 'border-[#0969da] dark:border-[#3794ff] bg-[#ddf4ff] dark:bg-[#3794ff]/15 text-[#0969da] dark:text-[#79c0ff] font-semibold'
                                    : isOffline
                                        ? 'border-[#d0d7de] dark:border-[#3c3c3c] text-[#656d76] dark:text-[#999] opacity-50 grayscale cursor-not-allowed'
                                        : 'border-[#d0d7de] dark:border-[#3c3c3c] text-[#1f2328] dark:text-[#cccccc] hover:border-[#0078d4] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2a2a]')
                            }
                        >
                            <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: cloneStatusColor(st, getRepoHashColor(c.workspace, getHostname() ?? 'local')) }} aria-hidden />
                            <span data-testid="clone-pill-name" className="truncate max-w-[200px]">{c.workspace.name}</span>
                            <span
                                data-testid="clone-pill-machine"
                                aria-hidden
                                style={isRemote ? { color: getServerHashColor(machine) } : undefined}
                                className={'truncate max-w-[140px] text-[11px] font-normal ' + (isRemote ? '' : 'text-[#656d76] dark:text-[#999]')}
                            >
                                {machine}
                            </span>
                            {duplicateLabels.has(label) && (
                                <span data-testid="clone-pill-path" aria-hidden className="truncate max-w-[110px] font-mono text-[10.5px] font-normal text-[#848484] dark:text-[#777]">{shortPath(c.workspace.rootPath || '')}</span>
                            )}
                            {isOffline && (
                                <span
                                    data-testid="clone-offline-badge"
                                    aria-hidden
                                    className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.04em] px-1.5 py-px rounded bg-[#8c959f]/15 text-[#6e7781] dark:text-[#8c959f]"
                                >
                                    offline
                                </span>
                            )}
                            {!isOffline && running > 0 && <span data-testid="clone-pill-running" aria-hidden className="text-[10px] font-mono font-semibold text-[#16a34a]">▶{running}</span>}
                            {!isOffline && queued > 0 && <span data-testid="clone-pill-queued" aria-hidden className="text-[10px] font-mono font-semibold text-[#c98410]">⏸{queued}</span>}
                            {!isOffline && isRemote && st === 'running' && <span data-testid="clone-pill-running" aria-hidden className="text-[9px] font-bold uppercase px-1 py-px rounded bg-[#16a34a]/15 text-[#16a34a]">running</span>}
                            {cloneUnreadCount > 0 && (
                                <span className={`${unreadBadgeClass} flex-shrink-0`} data-testid="clone-pill-unseen-badge" aria-hidden>
                                    {formatUnreadCount(cloneUnreadCount)}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
            {hoverRepo && hoverPill && (
                <span
                    id={pillTooltipId}
                    role="tooltip"
                    data-testid="clone-pill-tooltip"
                    style={{ left: hoverPill.left }}
                    className="absolute z-50 top-full mt-1 pointer-events-none w-max max-w-[min(28rem,80vw)] whitespace-normal break-all rounded border border-[#d0d7de] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] px-2 py-1 text-xs text-[#1f2328] dark:text-[#cccccc] shadow-lg"
                >
                    <span className="block font-semibold">{getWorkspaceCloneLabel(hoverRepo)}{isRepoOffline(hoverRepo) ? ' · offline (server unreachable)' : ''}</span>
                    <span className="block font-mono text-[11px] text-[#656d76] dark:text-[#999]">{hoverRepo.workspace.rootPath || '-'}</span>
                </span>
            )}

            {cloneTabs.length > 0 && (
                <div ref={cloneRegionRef} className="flex items-center gap-0.5 flex-1 min-w-0 overflow-hidden" data-testid="clone-tab-region">
                    {visibleCloneTabs.map(t => renderTab(t, 'clone-scope-tab'))}
                </div>
            )}

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
                            'inline-flex items-center justify-center h-[26px] px-2 rounded-md text-[15px] leading-none transition-colors ' +
                            (overflowActive
                                ? 'font-bold text-[#0969da] dark:text-[#79c0ff] shadow-[inset_0_-2px_0_#0969da] dark:shadow-[inset_0_-2px_0_#3794ff]'
                                : 'text-[#656d76] dark:text-[#999] hover:text-[#1f2328] dark:hover:text-[#cccccc] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2a2a]')
                        }
                    >
                        <span aria-hidden className="-mt-1">...</span>
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

            {ctxMenu && (
                <ContextMenu
                    position={{ x: ctxMenu.x, y: ctxMenu.y }}
                    items={buildMenuItems(ctxMenu.repo)}
                    onClose={() => setCtxMenu(null)}
                />
            )}

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
                            <span className="font-mono text-[12px] break-all" data-testid="clone-info-path">{infoRepo.workspace.rootPath ?? '-'}</span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-[#848484] dark:text-[#777]">Branch</span>
                            <span className="font-mono text-[12px]" data-testid="clone-info-branch">{infoRepo.gitInfo?.branch ?? '-'}</span>
                        </div>
                        {(infoRepo.workspace.remoteUrl || infoRepo.gitInfo?.remoteUrl) && (
                            <div className="flex flex-col gap-0.5">
                                <span className="text-[10px] font-bold uppercase tracking-wide text-[#848484] dark:text-[#777]">Remote URL</span>
                                <span className="font-mono text-[12px] break-all">{infoRepo.workspace.remoteUrl ?? infoRepo.gitInfo?.remoteUrl ?? '-'}</span>
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

            {removeDialog}

            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </div>
    );
}
