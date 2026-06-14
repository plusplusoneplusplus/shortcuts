/**
 * RemoteTopBar — row 1 of the remote-first shell.
 *
 * Renders one tab per git remote (origin) instead of one per local clone, so
 * multiple clones of the same origin no longer pile up. Each tab shows a status
 * dot, the remote name, a clone-count chip, a running pulse and an unseen badge.
 * Clicking a remote selects one of its clones (the last-used one, else the first).
 *
 * Rendered inside TopBar in place of RepoTabStrip when the remote shell is on.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useQueue } from '../../contexts/QueueContext';
import { useRepos } from '../../contexts/ReposContext';
import { groupReposByRemote, groupKey } from '../../repos/repoGrouping';
import type { RepoGroup } from '../../repos/repoGrouping';
import { isHidden as isHiddenTask } from '../../queue/hooks/useRepoQueueStats';
import { computeCloneStatusMap, summarizeRemote } from './shellModel';
import { useShellNavigation } from './useShellNavigation';

function CloneGlyph() {
    return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
        </svg>
    );
}

export function RemoteTopBar() {
    const { state } = useApp();
    const { state: queueState } = useQueue();
    const { repos, unseenCounts } = useRepos();
    const { selectClone } = useShellNavigation();

    // Remember the last-selected clone per remote so re-selecting a remote
    // returns to the checkout you were last on rather than always the first.
    const lastCloneByRemote = useRef<Record<string, string>>({});

    const groups = useMemo(() => groupReposByRemote(repos, {}), [repos]);
    const cloneStatus = useMemo(
        () => computeCloneStatusMap(repos, queueState.repoQueueMap, isHiddenTask),
        [repos, queueState.repoQueueMap],
    );

    const selectedId = state.selectedRepoId;
    const activeGroupKey = useMemo(() => {
        for (const g of groups) {
            if (g.repos.some(r => String(r.workspace.id) === selectedId)) return groupKey(g);
        }
        return null;
    }, [groups, selectedId]);

    useEffect(() => {
        if (!selectedId) return;
        const g = groups.find(grp => grp.repos.some(r => String(r.workspace.id) === selectedId));
        if (g) lastCloneByRemote.current[groupKey(g)] = selectedId;
    }, [groups, selectedId]);

    const pickRemote = (g: RepoGroup) => {
        const key = groupKey(g);
        const remembered = lastCloneByRemote.current[key];
        const target = remembered && g.repos.some(r => String(r.workspace.id) === remembered)
            ? remembered
            : (g.repos[0] ? String(g.repos[0].workspace.id) : undefined);
        if (target) selectClone(target);
    };

    return (
        <div
            className="flex items-center gap-0.5 flex-1 min-w-0 px-1 overflow-x-auto scrollbar-hide"
            data-testid="remote-top-bar"
        >
            {groups.map(g => {
                const key = groupKey(g);
                const s = summarizeRemote(g, cloneStatus, unseenCounts);
                const isActive = key === activeGroupKey;
                return (
                    <button
                        key={key}
                        data-testid="remote-tab"
                        data-remote-key={key}
                        data-active={isActive ? 'true' : 'false'}
                        aria-pressed={isActive}
                        title={g.label}
                        onClick={() => pickRemote(g)}
                        className={
                            'relative inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-xs whitespace-nowrap shrink-0 transition-colors ' +
                            (isActive
                                ? 'bg-[#0078d4] text-white'
                                : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]')
                        }
                    >
                        <span
                            className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                            style={{ background: isActive ? 'rgba(255,255,255,0.8)' : s.color }}
                            aria-hidden
                        />
                        <span className="max-w-[140px] truncate">{s.name}</span>
                        {s.cloneCount > 1 && (
                            <span
                                className={
                                    'inline-flex items-center gap-0.5 h-[16px] px-1.5 rounded-full text-[10px] font-semibold leading-none ' +
                                    (isActive ? 'bg-white/20 text-white' : 'bg-black/[0.06] dark:bg-white/[0.10] text-[#555] dark:text-[#bbb]')
                                }
                                data-testid="remote-clone-count"
                            >
                                <CloneGlyph />
                                {s.cloneCount}
                            </span>
                        )}
                        {s.status === 'running' && (
                            <span
                                className="inline-block w-[7px] h-[7px] rounded-full bg-[#16a34a] animate-pulse flex-shrink-0"
                                data-testid="remote-running-pulse"
                                aria-hidden
                            />
                        )}
                        {s.unseen > 0 && (
                            <span
                                className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-[3px] rounded-full bg-[#d16969] text-white text-[8px] font-semibold flex items-center justify-center leading-none"
                                data-testid="remote-unseen-badge"
                                aria-label={`${s.unseen} unread`}
                            >
                                {s.unseen > 99 ? '99+' : s.unseen}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
