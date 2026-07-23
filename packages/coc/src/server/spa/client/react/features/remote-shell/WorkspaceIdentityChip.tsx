/**
 * WorkspaceIdentityChip — the active-workspace identity pill: status dot,
 * provider badge, remote-group name, `⧉N` clone-count badge, and a chevron that
 * opens the remote-group picker (`RepoPickerPopover`) with the add-repository
 * actions. Extracted from `RemoteScopeCluster` so the chip renders exactly once
 * whether identity lives in the cluster (legacy header) or in the
 * `ScopeSlideSwitcher`'s workspace segment.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueue } from '../../contexts/QueueContext';
import { useRepos } from '../../contexts/ReposContext';
import { isHidden as isHiddenTask } from '../../queue/hooks/useRepoQueueStats';
import { AddFolderDialog } from '../../repos/AddFolderDialog';
import { AddRepoDialog } from '../../repos/AddRepoDialog';
import { CloneRepoDialog } from '../../repos/CloneRepoDialog';
import { getRepoSelectionId, isRepoSelected } from '../../repos/cloneIdentity';
import { groupKey, groupReposByRemote, type RepoData, type RepoGroup } from '../../repos/repoGrouping';
import { computeCloneStatusMap, summarizeRemote } from './shellModel';
import { RemoteProviderBadge } from './RemoteProviderBadge';
import { useDropdownPopover } from './useDropdownPopover';
import { PickerEmpty, PickerRow, PickerSection, RepoPickerPopover } from './RepoPickerPopover';
import { useRecentRemotes } from './useRecentRemotes';
import { useShellNavigation } from './useShellNavigation';

export interface WorkspaceIdentityChipProps {
    repo?: RepoData;
    repos: RepoData[];
}

function Chevron() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
        </svg>
    );
}

function PlusIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
        </svg>
    );
}

function CloneGlyph() {
    return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
        </svg>
    );
}

const unreadBadgeClass = 'min-w-[14px] h-[14px] px-[3px] rounded-full bg-[#d16969] text-white text-[8px] font-semibold flex items-center justify-center leading-none';

function formatUnreadCount(count: number): string {
    return count > 99 ? '99+' : String(count);
}

function groupMatchesSearch(group: RepoGroup, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return group.label.toLowerCase().includes(q)
        || groupKey(group).toLowerCase().includes(q)
        || group.repos.some(repo => String(repo.workspace.name ?? '').toLowerCase().includes(q));
}

export function WorkspaceIdentityChip({ repo, repos }: WorkspaceIdentityChipProps) {
    const cloneId = repo ? getRepoSelectionId(repo) : '';
    const { state: queueState } = useQueue();
    const { fetchRepos, unseenCounts } = useRepos();
    const { selectClone } = useShellNavigation();

    const [showAll, setShowAll] = useState(false);
    const [query, setQuery] = useState('');
    const [addFolderOpen, setAddFolderOpen] = useState(false);
    const [addRepoOpen, setAddRepoOpen] = useState(false);
    const [cloneOpen, setCloneOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const lastCloneByRemote = useRef<Record<string, string>>({});
    const { open, toggle, close, searchRef } = useDropdownPopover(rootRef, triggerRef);

    const groups = useMemo(() => groupReposByRemote(repos, {}), [repos]);
    const cloneStatus = useMemo(
        () => computeCloneStatusMap(repos, queueState.repoQueueMap, isHiddenTask),
        [repos, queueState.repoQueueMap],
    );
    const activeGroup = useMemo(() => {
        return groups.find(g => g.repos.some(r => isRepoSelected(r, repos, cloneId))) ?? null;
    }, [groups, repos, cloneId]);
    const activeGroupKey = activeGroup ? groupKey(activeGroup) : null;
    const activeSummary = activeGroup ? summarizeRemote(activeGroup, cloneStatus, unseenCounts) : null;
    const { recentGroups, remainingGroups, recordUse } = useRecentRemotes(groups);

    useEffect(() => {
        if (activeGroupKey) {
            lastCloneByRemote.current[activeGroupKey] = cloneId;
        }
    }, [activeGroupKey, cloneId]);

    const chooseGroup = useCallback((group: RepoGroup) => {
        const key = groupKey(group);
        const remembered = lastCloneByRemote.current[key];
        const target = remembered && group.repos.some(r => isRepoSelected(r, repos, remembered))
            ? remembered
            : (group.repos[0] ? getRepoSelectionId(group.repos[0]) : undefined);
        if (target) {
            recordUse(key);
            selectClone(target);
        }
        close();
        setShowAll(false);
        setQuery('');
    }, [repos, recordUse, selectClone, close]);

    const filteredGroups = query.trim()
        ? groups.filter(group => groupMatchesSearch(group, query))
        : [...recentGroups, ...(showAll ? remainingGroups : [])];
    const showAllCount = remainingGroups.length;

    // Group rows never surface an offline state: a remote group aggregates clones
    // with independent connection states, so offline is only meaningful per-clone
    // (handled by the virtual repo picker). The aggregate status color dot is shown
    // instead. See repo-picker-convergence plan, open question 3.
    const renderGroupRow = (group: RepoGroup) => {
        const key = groupKey(group);
        const summary = summarizeRemote(group, cloneStatus, unseenCounts);
        const isActive = key === activeGroupKey;
        return (
            <PickerRow
                key={key}
                testId="remote-dropdown-item"
                remoteKey={key}
                active={isActive}
                colorDot={summary.color}
                name={summary.name}
                sublabel={group.label}
                onClick={() => chooseGroup(group)}
                badges={
                    <>
                        {summary.cloneCount > 1 && (
                            <span className="inline-flex items-center gap-0.5 h-[16px] px-1.5 rounded-full text-[10px] font-semibold leading-none bg-black/[0.06] dark:bg-white/[0.10] text-[#555] dark:text-[#bbb]">
                                <CloneGlyph />
                                {summary.cloneCount}
                            </span>
                        )}
                        {summary.unseen > 0 && (
                            <span
                                className={unreadBadgeClass}
                                data-testid="remote-unseen-badge"
                                aria-label={`${summary.unseen} unread`}
                            >
                                {formatUnreadCount(summary.unseen)}
                            </span>
                        )}
                    </>
                }
            />
        );
    };

    return (
        <div className="relative flex items-center min-w-0 flex-shrink-0" ref={rootRef}>
            <button
                ref={triggerRef}
                data-testid="remote-chip"
                data-remote-key={activeGroupKey ?? ''}
                aria-haspopup="menu"
                aria-expanded={open}
                title={activeGroup?.label ?? (repo?.workspace.name ?? 'Select repository')}
                onClick={toggle}
                className="relative inline-flex items-center gap-1.5 h-[26px] px-2 rounded-md text-[12.5px] font-semibold text-[#1f2328] dark:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] max-w-[190px]"
            >
                <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: activeSummary?.color ?? '#848484' }} aria-hidden />
                <RemoteProviderBadge
                    normalizedUrl={activeGroup?.normalizedUrl}
                    testId="remote-provider-badge"
                    className="hidden xl:inline-flex items-center text-[9.5px] font-bold uppercase tracking-[0.08em] text-[#848484] dark:text-[#777]"
                />
                <span className="truncate">{activeSummary?.name ?? (repo?.workspace.name ?? 'Select repository')}</span>
                {activeSummary && activeSummary.cloneCount > 1 && (
                    <span className="hidden lg:inline-flex items-center gap-0.5 h-[16px] px-1.5 rounded-full text-[10px] font-semibold leading-none bg-black/[0.06] dark:bg-white/[0.10] text-[#555] dark:text-[#bbb]">
                        <CloneGlyph />
                        {activeSummary.cloneCount}
                    </span>
                )}
                <Chevron />
            </button>

            <RepoPickerPopover
                open={open}
                dropdownTestId="remote-dropdown"
                searchTestId="remote-search-input"
                searchRef={searchRef}
                searchPlaceholder="Search remotes"
                query={query}
                onQueryChange={setQuery}
                footer={
                    <>
                        {!query.trim() && showAllCount > 0 && (
                            <button
                                data-testid="remote-show-all-btn"
                                role="menuitem"
                                onClick={() => setShowAll(v => !v)}
                                className="mt-1 w-full flex items-center justify-between px-2 py-1.5 rounded-md text-[12px] font-semibold text-[#656d76] dark:text-[#999] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                            >
                                <span>{showAll ? 'Hide all' : `Show all (${showAllCount})`}</span>
                                <Chevron />
                            </button>
                        )}

                        <div className="mt-1 pt-1 border-t border-[#eaeef2] dark:border-[#3c3c3c]">
                            <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.07em] text-[#848484] dark:text-[#777]">Add repository</div>
                            <button
                                data-testid="remote-add-folder-option"
                                role="menuitem"
                                className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-md text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10"
                                onClick={() => { close(); setAddFolderOpen(true); }}
                            >
                                <PlusIcon />
                                Add workspace folder
                            </button>
                            <button
                                data-testid="remote-add-repo-option"
                                role="menuitem"
                                className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-md text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10"
                                onClick={() => { close(); setAddRepoOpen(true); }}
                            >
                                <PlusIcon />
                                Add specific repository
                            </button>
                            <button
                                data-testid="remote-clone-repo-option"
                                role="menuitem"
                                className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-md text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10"
                                onClick={() => { close(); setCloneOpen(true); }}
                            >
                                <CloneGlyph />
                                Clone repository
                            </button>
                        </div>
                    </>
                }
            >
                <PickerSection label={query.trim() ? 'Search results' : 'Recent remotes'} />
                {filteredGroups.length > 0 ? (
                    filteredGroups.map(group => renderGroupRow(group))
                ) : (
                    <PickerEmpty>No remotes found</PickerEmpty>
                )}
            </RepoPickerPopover>

            <AddFolderDialog
                open={addFolderOpen}
                onClose={() => setAddFolderOpen(false)}
                onAdded={() => { setAddFolderOpen(false); fetchRepos(); }}
            />
            <AddRepoDialog
                open={addRepoOpen}
                onClose={() => setAddRepoOpen(false)}
                repos={repos}
                onSuccess={() => { setAddRepoOpen(false); fetchRepos(); }}
            />
            <CloneRepoDialog
                open={cloneOpen}
                onClose={() => setCloneOpen(false)}
                onSuccess={() => { setCloneOpen(false); fetchRepos(); }}
            />
        </div>
    );
}
