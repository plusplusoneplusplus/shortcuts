/**
 * VirtualWorkspaceShellHeader — the single-row remote-first TopBar header for a
 * virtual workspace (My Work / My Life). Mirrors `RemoteShellHeader`'s visual
 * shell (identity chip · divider · tabs) but, since a virtual workspace has no
 * repo/git context, renders its own identity + sub-tab set and action buttons
 * (Sync / Generate Summary) instead of the repo-picker / clone-switcher clusters.
 *
 * The identity chip doubles as a repository picker: clicking it opens a compact
 * dropdown of all available real repositories so the user can switch without
 * visiting the hamburger manager. Both My Work and My Life share the same picker
 * logic; the blue shortcut buttons in TopBar retain their direct-navigation role.
 *
 * Rendered by `TopBar` in the remote-first desktop shell; the matching in-body
 * header (`VirtualWorkspaceInlineHeader`) covers classic shell / mobile.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useVirtualWorkspaceHeader } from './useVirtualWorkspaceHeader';
import { useDropdownPopover } from './useDropdownPopover';
import { PickerEmpty, PickerRow, PickerSection, RepoPickerPopover } from './RepoPickerPopover';
import type { VirtualWorkspaceHeaderConfig } from './virtualWorkspaceHeader';
import type { RepoData } from '../../repos/repoGrouping';
import { isRemoteRepo } from '../../repos/repoGrouping';
import { getServerName, isRepoOffline, shortPath } from '../../repos/repoPickerModel';
import { getRepoSelectionId } from '../../repos/cloneIdentity';

export interface VirtualWorkspaceShellHeaderProps {
    config: VirtualWorkspaceHeaderConfig;
    repos: RepoData[];
    onSelectRepo: (id: string) => void;
}

function Chevron() {
    return (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
        </svg>
    );
}

export function VirtualWorkspaceShellHeader({ config, repos, onSelectRepo }: VirtualWorkspaceShellHeaderProps) {
    const { visibleTabs, activeTab, switchTab, statusMsg, isActionRunning, runAction } = useVirtualWorkspaceHeader(config);
    const prefix = config.testIdPrefix;

    const [query, setQuery] = useState('');
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const { open, toggle, close, searchRef } = useDropdownPopover(rootRef, triggerRef);

    const filteredRepos = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return repos;
        return repos.filter(r => {
            const name = String(r.workspace.name ?? '').toLowerCase();
            const path = String(r.workspace.rootPath ?? r.workspace.path ?? '').toLowerCase();
            const server = isRemoteRepo(r) ? getServerName(r).toLowerCase() : '';
            return name.includes(q) || path.includes(q) || server.includes(q);
        });
    }, [repos, query]);

    const localRepos = useMemo(() => filteredRepos.filter(r => !isRemoteRepo(r)), [filteredRepos]);
    const remoteRepos = useMemo(() => filteredRepos.filter(isRemoteRepo), [filteredRepos]);

    const handleSelect = useCallback((repo: RepoData) => {
        if (isRepoOffline(repo)) return;
        onSelectRepo(getRepoSelectionId(repo));
        close();
        setQuery('');
    }, [onSelectRepo, close]);

    const renderRepoRow = (repo: RepoData, testId: string) => {
        const name = String(repo.workspace.name ?? repo.workspace.id ?? 'Unknown');
        const offline = isRepoOffline(repo);
        const sublabel = isRemoteRepo(repo)
            ? getServerName(repo)
            : shortPath(String(repo.workspace.rootPath ?? repo.workspace.path ?? ''));

        return (
            <PickerRow
                key={getRepoSelectionId(repo)}
                testId={testId}
                name={name}
                sublabel={sublabel}
                offline={offline}
                onClick={() => handleSelect(repo)}
                badges={offline ? (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#848484]/10 text-[#848484] dark:text-[#666] flex-shrink-0">
                        offline
                    </span>
                ) : undefined}
            />
        );
    };

    const isEmpty = filteredRepos.length === 0;

    return (
        <div
            className="hidden md:flex items-center gap-1.5 min-w-0 flex-1"
            data-testid="virtual-workspace-shell-header"
            data-workspace={config.workspaceId}
        >
            {/* Identity chip — repo picker trigger. */}
            <div className="relative flex-shrink-0" ref={rootRef}>
                <button
                    ref={triggerRef}
                    data-testid={`${prefix}-shell-identity`}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    aria-label={`${config.label} — switch repository`}
                    title="Switch repository"
                    onClick={toggle}
                    className="inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-[#f6f8fa] dark:bg-[#2a2a2a] text-[13px] font-semibold text-[#1f2328] dark:text-[#cccccc] hover:bg-[#eaeef2] dark:hover:bg-[#333] transition-colors"
                >
                    <span aria-hidden>{config.icon}</span>
                    <span className="max-w-[140px] truncate">{config.label}</span>
                    <Chevron />
                </button>

                <RepoPickerPopover
                    open={open}
                    dropdownTestId={`${prefix}-repo-dropdown`}
                    searchTestId={`${prefix}-repo-search`}
                    searchRef={searchRef}
                    searchPlaceholder="Search repositories"
                    query={query}
                    onQueryChange={setQuery}
                >
                    {isEmpty ? (
                        <PickerEmpty>
                            {query.trim() ? 'No repositories match' : 'No repositories — use ☰ to add one'}
                        </PickerEmpty>
                    ) : (
                        <>
                            {localRepos.length > 0 && (
                                <>
                                    <PickerSection label="Local" />
                                    {localRepos.map(r => renderRepoRow(r, `${prefix}-repo-local-row`))}
                                </>
                            )}
                            {remoteRepos.length > 0 && (
                                <>
                                    <PickerSection label="Remote" />
                                    {remoteRepos.map(r => renderRepoRow(r, `${prefix}-repo-remote-row`))}
                                </>
                            )}
                        </>
                    )}
                </RepoPickerPopover>
            </div>

            <span className="w-px h-[18px] bg-[#d8dee4] dark:bg-[#3c3c3c] flex-shrink-0" aria-hidden />

            <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto">
                {visibleTabs.map(t => {
                    const isActive = activeTab === t.key;
                    return (
                        <button
                            key={t.key}
                            data-testid={`${prefix}-shell-tab-${t.key}`}
                            data-subtab={t.key}
                            data-active={isActive ? 'true' : 'false'}
                            aria-current={isActive ? 'page' : undefined}
                            title={t.shortcut}
                            onClick={() => switchTab(t.key)}
                            className={
                                'relative inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-md text-[13px] whitespace-nowrap shrink-0 transition-colors ' +
                                (isActive
                                    ? 'font-bold text-[#0969da] dark:text-[#79c0ff] shadow-[inset_0_-2px_0_#0969da] dark:shadow-[inset_0_-2px_0_#3794ff]'
                                    : 'font-semibold text-[#656d76] dark:text-[#999] hover:text-[#1f2328] dark:hover:text-[#cccccc] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2a2a]')
                            }
                        >
                            {t.label}
                        </button>
                    );
                })}
            </div>

            <div className="flex items-center gap-1.5 flex-shrink-0">
                {config.actions.map(action => {
                    const running = isActionRunning(action.key);
                    return (
                        <button
                            key={action.key}
                            data-testid={action.testId}
                            title={action.title}
                            onClick={() => runAction(action)}
                            disabled={running}
                            className="inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[12px] font-semibold text-[#1f2328] dark:text-[#cccccc] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2a2a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {running ? action.busyLabel : action.idleLabel}
                        </button>
                    );
                })}
                {statusMsg && (
                    <span
                        data-testid={`${prefix}-shell-status`}
                        className="text-[11px] text-[#656d76] dark:text-[#999] ml-0.5 whitespace-nowrap"
                    >
                        {statusMsg}
                    </span>
                )}
            </div>
        </div>
    );
}
