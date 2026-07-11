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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualWorkspaceHeader } from './useVirtualWorkspaceHeader';
import type { VirtualWorkspaceHeaderConfig } from './virtualWorkspaceHeader';
import type { RepoData } from '../../repos/repoGrouping';
import { isRemoteRepo } from '../../repos/repoGrouping';
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

function SearchIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M16 16l4 4" />
        </svg>
    );
}

function getServerName(repo: RepoData): string {
    const remote = (repo.workspace as any).remote as { serverLabel?: string; serverId?: string } | null;
    return String(remote?.serverLabel ?? remote?.serverId ?? (repo.workspace as any).baseUrl ?? 'remote');
}

function isRepoOffline(repo: RepoData): boolean {
    const remote = (repo.workspace as any).remote as { connection?: string } | null;
    if (!remote) return false;
    const connection = remote.connection ?? 'offline';
    return connection === 'offline' || connection === 'failed';
}

function shortPath(fullPath: string): string {
    if (!fullPath) return '';
    const parts = fullPath.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts.slice(-2).join('/');
}

export function VirtualWorkspaceShellHeader({ config, repos, onSelectRepo }: VirtualWorkspaceShellHeaderProps) {
    const { visibleTabs, activeTab, switchTab, statusMsg, isActionRunning, runAction } = useVirtualWorkspaceHeader(config);
    const prefix = config.testIdPrefix;

    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const rootRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setOpen(false);
                triggerRef.current?.focus();
            }
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    // Focus the search field after the dropdown renders
    useEffect(() => {
        if (open) {
            const id = setTimeout(() => searchRef.current?.focus(), 0);
            return () => clearTimeout(id);
        }
    }, [open]);

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
        setOpen(false);
        setQuery('');
    }, [onSelectRepo]);

    const renderRepoRow = (repo: RepoData, testId: string) => {
        const name = String(repo.workspace.name ?? repo.workspace.id ?? 'Unknown');
        const offline = isRepoOffline(repo);
        const remote = isRemoteRepo(repo);
        const sublabel = remote
            ? getServerName(repo)
            : shortPath(String(repo.workspace.rootPath ?? repo.workspace.path ?? ''));

        return (
            <button
                key={getRepoSelectionId(repo)}
                data-testid={testId}
                role="menuitem"
                disabled={offline}
                aria-disabled={offline}
                onClick={() => handleSelect(repo)}
                className={
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[12px] transition-colors ' +
                    (offline
                        ? 'opacity-50 cursor-not-allowed text-[#848484] dark:text-[#666]'
                        : 'text-[#1f2328] dark:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]')
                }
            >
                <span className="flex-1 min-w-0">
                    <span className="block font-semibold truncate">{name}</span>
                    {sublabel && (
                        <span className="block text-[10.5px] text-[#848484] dark:text-[#777] truncate">{sublabel}</span>
                    )}
                </span>
                {offline && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#848484]/10 text-[#848484] dark:text-[#666] flex-shrink-0">
                        offline
                    </span>
                )}
            </button>
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
                    onClick={() => setOpen(o => !o)}
                    className="inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-[#f6f8fa] dark:bg-[#2a2a2a] text-[13px] font-semibold text-[#1f2328] dark:text-[#cccccc] hover:bg-[#eaeef2] dark:hover:bg-[#333] transition-colors"
                >
                    <span aria-hidden>{config.icon}</span>
                    <span className="max-w-[140px] truncate">{config.label}</span>
                    <Chevron />
                </button>

                {open && (
                    <div
                        data-testid={`${prefix}-repo-dropdown`}
                        role="menu"
                        className="absolute left-0 top-full mt-1 z-50 w-[280px] rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-lg p-1.5"
                    >
                        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-[#f6f8fa] dark:bg-[#252526]">
                            <SearchIcon />
                            <input
                                ref={searchRef}
                                data-testid={`${prefix}-repo-search`}
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                placeholder="Filter repositories"
                                className="min-w-0 flex-1 bg-transparent outline-none text-[12px] text-[#1f2328] dark:text-[#cccccc] placeholder:text-[#848484]"
                                aria-label="Filter repositories"
                            />
                        </div>

                        <div className="max-h-[260px] overflow-y-auto mt-1">
                            {isEmpty ? (
                                <div className="px-2 py-3 text-[12px] text-[#848484] dark:text-[#777] text-center">
                                    {query.trim() ? 'No repositories match' : 'No repositories — use ☰ to add one'}
                                </div>
                            ) : (
                                <>
                                    {localRepos.length > 0 && (
                                        <>
                                            <div className="px-2 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-[0.07em] text-[#848484] dark:text-[#777]">
                                                Local
                                            </div>
                                            {localRepos.map(r => renderRepoRow(r, `${prefix}-repo-local-row`))}
                                        </>
                                    )}
                                    {remoteRepos.length > 0 && (
                                        <>
                                            <div className={`px-2 ${localRepos.length > 0 ? 'pt-2' : 'pt-1'} pb-0.5 text-[10px] font-bold uppercase tracking-[0.07em] text-[#848484] dark:text-[#777]`}>
                                                Remote
                                            </div>
                                            {remoteRepos.map(r => renderRepoRow(r, `${prefix}-repo-remote-row`))}
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                )}
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
