/**
 * MobileScopeList — the narrow-viewport (`breakpoint === 'mobile'`) replacement
 * for `ReposGrid` on the Repos tab.
 *
 * Where the grid only ever showed git-remote clusters of *registered repos*, this
 * list is the full scope model the desktop shell works in: pinned scopes, the
 * virtual scopes (My Work / My Life), repo-*group* virtual workspaces, and the
 * git-remote clusters — in that order, in one scroll container. Repo groups were
 * previously unreachable on mobile except by deep link, because `ReposContext`
 * filters virtual workspaces out of `repos`.
 *
 * Every row goes through `useScopePickerModel`, so selection runs the desktop
 * path (`selectClone` → target-aware route restore, the unsaved-Explorer guard,
 * and the `RECORD_REMOTE_CLONE` bookkeeping). The old grid called
 * `navigateToWorkspace` directly and skipped that bookkeeping, which is why a
 * pick made on the phone did not carry back to the desktop shell.
 *
 * Cluster ordering and expansion stay shared with the desktop grid: the same
 * `gitGroupOrder` preference and the same `coc-git-group-expanded-state` key. A
 * single-clone cluster navigates straight into the clone — the extra tap to
 * expand a list of one buys nothing.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { useRepos } from '../contexts/ReposContext';
import { BottomSheet } from '../ui/BottomSheet';
import { ContextMenu, type ContextMenuItem } from '../tasks/comments/ContextMenu';
import { PickerEmpty, PickerRow, PickerSection } from '../features/remote-shell/RepoPickerPopover';
import { RemoteServerBadge } from '../features/remote-shell/RemoteServerBadge';
import { WslBadge } from '../features/remote-shell/WslBadge';
import { cloneStatusColor } from '../features/remote-shell/shellModel';
import {
    CloneCountBadge,
    CloneGlyph,
    KebabGlyph,
    PinGlyph,
    PlusIcon,
    RepoGroupGlyph,
    UnseenBadge,
    unreadBadgeClass,
    formatUnreadCount,
} from '../features/remote-shell/scopePickerGlyphs';
import {
    groupMatchesSearch,
    useScopePickerModel,
    type ScopePickerFooterAction,
    type ScopePickerRemoteRow,
} from '../features/remote-shell/useScopePickerModel';
import { getRepoSelectionId, isRepoSelected } from './cloneIdentity';
import {
    applyGroupOrder,
    getRepoHashColor,
    getServerHashColor,
    groupKey,
    groupReposByRemote,
    isRemoteRepo,
    truncatePath,
    type RepoData,
    type RepoGroup,
} from './repoGrouping';
import { ReposEmptyState } from './ReposEmptyState';
import { loadGroupExpandedState, saveGroupExpandedState } from './ReposGrid';
import { getGlobalPreferences } from './repositoryService';

/** Fired by the desktop tab strip's customize mode; surfaced here in the `+` sheet. */
function openRepoTabCustomizeMode(): void {
    window.dispatchEvent(new Event('coc-customize-repo-tabs'));
}

function SearchIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M16 16l4 4" />
        </svg>
    );
}

function FooterActionIcon({ icon }: { icon: ScopePickerFooterAction['icon'] }) {
    if (icon === 'clone') return <CloneGlyph />;
    if (icon === 'group') return <RepoGroupGlyph />;
    return <PlusIcon />;
}

/**
 * The footer stat line. Names repo groups alongside repos and clones, because a
 * group is now a first-class row in the list above it.
 */
export function buildScopeListFooterText(
    repoCount: number,
    cloneGroups: readonly RepoGroup[],
    groupCount: number,
    runningCount: number,
): string {
    const parts = [`${repoCount} repo${repoCount !== 1 ? 's' : ''}`];
    if (cloneGroups.length > 0) {
        const clones = cloneGroups.reduce((sum, g) => sum + g.repos.length, 0);
        parts.push(`${clones} clone${clones !== 1 ? 's' : ''} in ${cloneGroups.length} remote${cloneGroups.length !== 1 ? 's' : ''}`);
    }
    if (groupCount > 0) {
        parts.push(`${groupCount} group${groupCount !== 1 ? 's' : ''}`);
    }
    parts.push(`${runningCount} running`);
    return parts.join(' · ');
}

export interface MobileScopeListProps {
    repos: RepoData[];
}

export function MobileScopeList({ repos }: MobileScopeListProps) {
    const { state } = useApp();
    const { unseenCounts } = useRepos();
    const [expandedState, setExpandedState] = useState<Record<string, boolean>>(loadGroupExpandedState);
    const [groupOrder, setGroupOrder] = useState<string[]>([]);
    const [addSheetOpen, setAddSheetOpen] = useState(false);
    const [rowMenu, setRowMenu] = useState<{ repo: RepoData; x: number; y: number } | null>(null);
    const [groupMenu, setGroupMenu] = useState<{ workspace: any; x: number; y: number } | null>(null);

    const model = useScopePickerModel(repos);
    const {
        query,
        setQuery,
        pinnedRows,
        virtualRows,
        groupRows,
        cloneStatus,
        footerActions,
        pinnedScopesEnabled,
        isPinned,
        pinsFull,
        togglePin,
        buildRemoteRow,
    } = model;

    // Same persisted order the desktop grid uses, so a reorder on either surface
    // is visible on both.
    useEffect(() => {
        let cancelled = false;
        getGlobalPreferences().then((prefs: any) => {
            if (!cancelled && Array.isArray(prefs?.gitGroupOrder)) {
                setGroupOrder(prefs.gitGroupOrder);
            }
        }).catch(() => {});
        return () => { cancelled = true; };
    }, []);

    const orderedGroups = useMemo(
        () => applyGroupOrder(groupReposByRemote(repos, expandedState), groupOrder),
        [repos, expandedState, groupOrder],
    );
    const visibleGroups = useMemo(
        () => (query.trim() ? orderedGroups.filter(g => groupMatchesSearch(g, query)) : orderedGroups),
        [orderedGroups, query],
    );

    const toggleGroup = useCallback((key: string) => {
        setExpandedState(prev => {
            const next = { ...prev, [key]: prev[key] === false };
            saveGroupExpandedState(next);
            return next;
        });
    }, []);

    const withMenuDismiss = useCallback((items: ContextMenuItem[], dismiss: () => void): ContextMenuItem[] =>
        items.map(item => ({ ...item, onClick: () => { dismiss(); item.onClick(); } })), []);

    // On a touch surface a hover-revealed control is unreachable, so the pin
    // toggle is always visible (the desktop picker row fades it in on hover).
    const renderPinToggle = (ref: { kind: 'repo' | 'group'; key: string }, label: string) => {
        if (!pinnedScopesEnabled) return null;
        const pinned = isPinned(ref);
        const blocked = !pinned && pinsFull;
        return (
            <button
                data-testid="scope-pin-toggle"
                data-pin-kind={ref.kind}
                data-pin-key={ref.key}
                aria-pressed={pinned}
                disabled={blocked}
                aria-label={`${pinned ? 'Unpin' : 'Pin'} ${label}`}
                onClick={e => { e.stopPropagation(); togglePin(ref); }}
                className={
                    'flex-shrink-0 inline-flex items-center justify-center w-9 h-9 rounded '
                    + (pinned ? 'text-[#0969da] dark:text-[#79c0ff]' : 'text-[#848484] dark:text-[#777] disabled:opacity-30')
                }
            >
                <PinGlyph filled={pinned} />
            </button>
        );
    };

    /**
     * One clone under an expanded cluster. Mirrors the desktop clone popover's
     * contract rather than `RepoCard`, because an offline remote clone has to
     * stay visible but disabled (`data-offline` + `clone-offline-badge`) and the
     * card has no such state.
     */
    const renderCloneRow = (clone: RepoData) => {
        const selectionId = getRepoSelectionId(clone);
        const status = cloneStatus[String(clone.workspace.id)];
        const isRemote = isRemoteRepo(clone);
        const isOffline = isRemote && status === 'offline';
        const serverLabel = isRemote
            ? String((clone.workspace as { remote?: { serverLabel?: unknown } }).remote?.serverLabel ?? 'remote')
            : null;
        const unseen = unseenCounts[selectionId] ?? 0;
        const selected = isRepoSelected(clone, repos, state.selectedRepoId);
        return (
            <div key={selectionId} className="flex items-center pl-4">
                <button
                    data-testid="scope-list-clone"
                    data-remote={isRemote ? 'true' : 'false'}
                    data-clone-status={status ?? 'idle'}
                    data-offline={isOffline ? 'true' : 'false'}
                    disabled={isOffline}
                    aria-disabled={isOffline}
                    title={isOffline ? `${clone.workspace.name} · offline (server unreachable)` : undefined}
                    onClick={() => { if (!isOffline) model.selectScope(selectionId); }}
                    className={
                        'repo-item flex-1 min-w-0 flex items-center gap-2 px-2 min-h-[44px] rounded-md text-left '
                        + (isOffline
                            ? 'opacity-50 grayscale cursor-not-allowed'
                            : selected ? 'bg-[#ddf4ff] dark:bg-[#3794ff]/15' : '')
                    }
                >
                    <span
                        className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ background: cloneStatusColor(status, getRepoHashColor(clone.workspace)) }}
                        aria-hidden
                    />
                    <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-1.5 min-w-0">
                            <span className={'min-w-0 text-[12.5px] font-semibold truncate ' + (selected && !isOffline ? 'text-[#0969da] dark:text-[#79c0ff]' : 'text-[#1e1e1e] dark:text-[#cccccc]')}>
                                {clone.workspace.name}
                            </span>
                            {serverLabel && (
                                <span
                                    data-testid="clone-remote-badge"
                                    title={`Remote · ${serverLabel}`}
                                    style={{ color: getServerHashColor(serverLabel), backgroundColor: `${getServerHashColor(serverLabel)}1f` }}
                                    className="inline-flex items-center max-w-[96px] truncate text-[9px] font-bold uppercase tracking-[0.04em] px-1.5 py-px rounded"
                                >
                                    {serverLabel}
                                </span>
                            )}
                            {isOffline && (
                                <span
                                    data-testid="clone-offline-badge"
                                    title="Server offline - showing last-known state"
                                    className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.04em] px-1.5 py-px rounded bg-[#8c959f]/15 text-[#6e7781] dark:text-[#8c959f]"
                                >
                                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#8c959f]" aria-hidden />
                                    offline
                                </span>
                            )}
                            {unseen > 0 && (
                                <span className={`${unreadBadgeClass} flex-shrink-0`} data-testid="clone-row-unseen-badge" aria-label={`${unseen} unread`}>
                                    {formatUnreadCount(unseen)}
                                </span>
                            )}
                        </span>
                        <span className="block font-mono text-[10.5px] text-[#848484] dark:text-[#777] truncate mt-0.5">
                            {truncatePath(clone.workspace.rootPath || '', 32)}
                        </span>
                    </span>
                </button>
                <button
                    data-testid="scope-list-clone-menu"
                    aria-label={`More actions for ${clone.workspace.name}`}
                    onClick={e => {
                        e.stopPropagation();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setRowMenu({ repo: clone, x: rect.left, y: rect.bottom });
                    }}
                    className="flex-shrink-0 inline-flex items-center justify-center w-9 h-9 rounded text-[#848484] dark:text-[#777]"
                >
                    <KebabGlyph />
                </button>
            </div>
        );
    };

    /**
     * A git-remote cluster. One clone → tapping the row opens it. Several →
     * tapping expands, and the state persists in the same key the desktop grid
     * writes.
     */
    const renderClusterRow = (row: ScopePickerRemoteRow) => {
        const multi = row.summary.cloneCount > 1;
        const expanded = row.group.expanded;
        const pinToggle = renderPinToggle(row.pinRef, row.summary.name);
        const kebab = row.soleClone ? (
            <button
                data-testid="scope-list-cluster-menu"
                data-remote-key={row.key}
                aria-label={`More actions for ${row.summary.name}`}
                onClick={e => {
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setRowMenu({ repo: row.soleClone!, x: rect.left, y: rect.bottom });
                }}
                className="flex-shrink-0 inline-flex items-center justify-center w-9 h-9 rounded text-[#848484] dark:text-[#777]"
            >
                <KebabGlyph />
            </button>
        ) : null;
        return (
            <div key={row.key} data-testid="scope-list-cluster" data-remote-key={row.key} data-expanded={multi ? String(expanded) : undefined}>
                <PickerRow
                    testId="scope-list-cluster-row"
                    // `.repo-item` is the shared "tap to open a workspace" hook.
                    // A multi-clone row only expands, so it does not claim it.
                    className={'min-h-[44px]' + (multi ? '' : ' repo-item')}
                    remoteKey={row.key}
                    active={row.active}
                    colorDot={row.summary.color}
                    name={row.summary.name}
                    sublabel={row.group.label}
                    onClick={() => (multi ? toggleGroup(row.key) : model.chooseGroup(row.group))}
                    rowMenu={pinToggle || kebab ? <>{pinToggle}{kebab}</> : undefined}
                    badges={
                        <>
                            {row.remoteServers.length > 0 && <RemoteServerBadge servers={row.remoteServers} />}
                            {row.wsl && <WslBadge distro={row.wsl.distro} />}
                            {multi && <CloneCountBadge count={row.summary.cloneCount} />}
                            {row.summary.unseen > 0 && <UnseenBadge count={row.summary.unseen} />}
                            {multi && <span className="text-[10px] text-[#848484]" aria-hidden>{expanded ? '▾' : '▸'}</span>}
                        </>
                    }
                />
                {multi && expanded && (
                    <div className="flex flex-col">{row.group.repos.map(renderCloneRow)}</div>
                )}
            </div>
        );
    };

    const cloneGroups = orderedGroups.filter(g => g.repos.length >= 2);
    const totalRunning = repos.reduce((sum, r) => sum + (r.stats?.running || 0), 0);
    const footerText = buildScopeListFooterText(repos.length, cloneGroups, groupRows.length, totalRunning);

    return (
        <div className="flex flex-col h-full" data-testid="mobile-scope-list">
            {/* Header — title, search, and the `+` sheet holding every add action. */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <span className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc] flex-shrink-0">Workspaces</span>
                <div className="flex items-center gap-1.5 flex-1 min-w-0 px-2 py-1 rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-[#f6f8fa] dark:bg-[#252526]">
                    <SearchIcon />
                    <input
                        data-testid="scope-list-search"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search"
                        aria-label="Search workspaces and groups"
                        className="min-w-0 flex-1 bg-transparent outline-none text-[12px] text-[#1f2328] dark:text-[#cccccc] placeholder:text-[#848484]"
                    />
                </div>
                <button
                    data-testid="scope-list-add-btn"
                    aria-label="Add"
                    onClick={() => setAddSheetOpen(true)}
                    className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md bg-[#0078d4] text-white"
                >
                    <PlusIcon />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto px-1 pb-2">
                {pinnedRows.length > 0 && (
                    <>
                        <PickerSection label="Pinned" />
                        {pinnedRows.map(pin => (
                            <PickerRow
                                key={pin.id}
                                testId="scope-list-pinned-item"
                                remoteKey={pin.ref.key}
                                colorDot={pin.color}
                                name={pin.label}
                                onClick={() => model.selectScope(pin.targetId)}
                                badges={pin.unseen > 0 ? <UnseenBadge count={pin.unseen} /> : undefined}
                                rowMenu={renderPinToggle(pin.ref, pin.label)}
                            />
                        ))}
                    </>
                )}

                {virtualRows.length > 0 && (
                    <>
                        <PickerSection label="Scopes" />
                        {virtualRows.map(row => (
                            <PickerRow
                                key={row.id}
                                testId="scope-list-virtual-item"
                                remoteKey={row.id}
                                active={row.active}
                                name={`${row.icon} ${row.label}`}
                                onClick={row.onSelect}
                            />
                        ))}
                    </>
                )}

                <PickerSection label="Repo groups" />
                {groupRows.length > 0 ? groupRows.map(row => (
                    <PickerRow
                        key={row.id}
                        testId="repo-group-item"
                        remoteKey={row.id}
                        active={row.active}
                        name={row.name}
                        sublabel={row.sublabel}
                        offline={row.offline}
                        onClick={() => model.selectScope(row.id)}
                        badges={
                            <>
                                <RepoGroupGlyph />
                                {row.isRemote && (
                                    <RemoteServerBadge
                                        testId="repo-group-server-badge"
                                        servers={row.serverLabel ? [row.serverLabel] : []}
                                    />
                                )}
                            </>
                        }
                        rowMenu={
                            <>
                                {renderPinToggle(row.pinRef, row.name)}
                                {/* An offline group is read-only — no ⋮, so Edit and
                                    Delete stay unavailable until it reconnects. */}
                                {!row.offline && (
                                    <button
                                        data-testid="repo-group-row-menu"
                                        data-remote-key={row.id}
                                        aria-label={`More actions for ${row.name}`}
                                        onClick={e => {
                                            e.stopPropagation();
                                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                            setGroupMenu({ workspace: row.workspace, x: rect.left, y: rect.bottom });
                                        }}
                                        className="flex-shrink-0 inline-flex items-center justify-center w-9 h-9 rounded text-[#848484] dark:text-[#777]"
                                    >
                                        <KebabGlyph />
                                    </button>
                                )}
                            </>
                        }
                    />
                )) : (
                    <PickerEmpty>No repo groups</PickerEmpty>
                )}

                <PickerSection label="Repositories" />
                {visibleGroups.length > 0 ? (
                    visibleGroups.map(group => renderClusterRow(buildRemoteRow(group)))
                ) : repos.length === 0 ? (
                    // Nothing registered yet — offer the same first-run affordances
                    // the desktop grid does rather than a bare "no results" line.
                    <ReposEmptyState
                        onAddRepo={() => footerActions.find(a => a.key === 'add-repo')?.onClick()}
                        onCloneRepo={() => footerActions.find(a => a.key === 'clone-repo')?.onClick()}
                    />
                ) : (
                    <PickerEmpty>No repositories found</PickerEmpty>
                )}
            </div>

            <div className="px-3 py-1.5 text-[10px] text-[#848484] border-t border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="scope-list-footer">
                {footerText}
            </div>

            <BottomSheet isOpen={addSheetOpen} onClose={() => setAddSheetOpen(false)} title="Add" height={50}>
                <div data-testid="scope-list-add-sheet" className="pb-4">
                    {footerActions.map(action => (
                        <button
                            key={action.key}
                            data-testid={action.testId}
                            className="w-full flex items-center gap-2 text-left px-4 min-h-[44px] text-sm text-[#1e1e1e] dark:text-[#cccccc]"
                            onClick={() => { setAddSheetOpen(false); action.onClick(); }}
                        >
                            <FooterActionIcon icon={action.icon} />
                            {action.label}
                        </button>
                    ))}
                    <div className="h-px bg-[#e0e0e0] dark:bg-[#3c3c3c] mx-4 my-1" />
                    {/* Reordering targets the desktop tab strip; it is noise in the
                        header at this width, so it lives in the sheet. */}
                    <button
                        data-testid="customize-repo-tabs-button"
                        className="w-full text-left px-4 min-h-[44px] flex items-center text-sm text-[#1e1e1e] dark:text-[#cccccc]"
                        onClick={() => { setAddSheetOpen(false); openRepoTabCustomizeMode(); }}
                    >
                        Reorder repo tabs
                    </button>
                </div>
            </BottomSheet>

            {model.dialogs}

            {rowMenu && (
                <ContextMenu
                    position={{ x: rowMenu.x, y: rowMenu.y }}
                    items={withMenuDismiss(model.buildRowMenuItems(rowMenu.repo), () => setRowMenu(null))}
                    onClose={() => setRowMenu(null)}
                />
            )}
            {groupMenu && (
                <ContextMenu
                    position={{ x: groupMenu.x, y: groupMenu.y }}
                    items={withMenuDismiss(model.buildGroupMenuItems(groupMenu.workspace), () => setGroupMenu(null))}
                    onClose={() => setGroupMenu(null)}
                />
            )}
        </div>
    );
}
