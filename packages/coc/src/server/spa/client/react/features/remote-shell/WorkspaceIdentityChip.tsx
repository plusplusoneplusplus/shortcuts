/**
 * WorkspaceIdentityChip — the active-workspace identity pill: status dot,
 * provider badge, remote-group name, `⧉N` clone-count badge, and a chevron that
 * opens the remote-group picker (`RepoPickerPopover`) with the add-repository
 * actions. Extracted from `RemoteScopeCluster` so the chip renders exactly once
 * whether identity lives in the cluster (legacy header) or in the
 * `ScopeSlideSwitcher`'s workspace segment.
 *
 * The picker's rows, sections, search predicate, dialogs and row menus come from
 * the shared `useScopePickerModel` hook — the same model the mobile
 * `ScopePickerSheet` and `MobileScopeList` render — so the desktop and mobile
 * shells cannot drift into different picker behavior.
 */
import { useCallback, useRef, useState } from 'react';
import type { RepoData } from '../../repos/repoGrouping';
import { ContextMenu, type ContextMenuItem } from '../../tasks/comments/ContextMenu';
import { RemoteProviderBadge } from './RemoteProviderBadge';
import { RemoteServerBadge } from './RemoteServerBadge';
import { useDropdownPopover } from './useDropdownPopover';
import { WslBadge } from './WslBadge';
import { PickerEmpty, PickerRow, PickerSection, RepoPickerPopover } from './RepoPickerPopover';
import type { PinnedScopeRef } from './pinnedScopes';
import {
    CloneCountBadge,
    CloneGlyph,
    Chevron,
    KebabGlyph,
    PinGlyph,
    PlusIcon,
    RepoGroupGlyph,
    UnseenBadge,
} from './scopePickerGlyphs';
import {
    useScopePickerModel,
    type ScopePickerFooterAction,
    type ScopePickerGroupRow,
    type ScopePickerRemoteRow,
} from './useScopePickerModel';

export { resolveRepoCopyPath } from './useScopePickerModel';

export interface WorkspaceIdentityChipProps {
    repo?: RepoData;
    repos: RepoData[];
    /**
     * When set, the chip is showing an *inactive* workspace (a virtual scope like
     * My Work / My Life is the active scope). Clicking the identity body then
     * switches back to this workspace instead of opening the picker; the chevron
     * keeps opening the remote-group picker. When unset (workspace is the active
     * scope), the whole chip toggles the picker as before. (AC-02)
     */
    onSwitchBack?: () => void;
    /**
     * When set, the chip shows a *repo-group virtual workspace*'s identity
     * (🗂️ + group name) instead of the repo's: neutral status dot, no provider
     * badge and no `⧉N` clone badge, since none of those describe the group —
     * they belong to whatever repo happens to be remembered underneath. The
     * chevron/picker is unchanged.
     *
     * Note this is a repo-*group virtual workspace*, unrelated to the `RepoGroup`
     * git-remote clustering that `activeGroupKey` / `data-remote-key` refer to;
     * the group id therefore gets its own `data-repo-group-id` attribute.
     */
    groupIdentity?: { id: string; name: string };
    /**
     * When true the chip renders as a bare picker trigger (chevron only, no dot /
     * name / badges). Set by `ScopeSlideSwitcher` when a *pinned* segment is
     * already showing this exact identity — otherwise the same remote name would
     * appear twice in one bar, once as the active pin and once here.
     */
    identitySuppressed?: boolean;
}

/** Footer-action leading glyph, keyed off the model's icon token. */
function FooterActionIcon({ icon }: { icon: ScopePickerFooterAction['icon'] }) {
    if (icon === 'clone') return <CloneGlyph />;
    if (icon === 'group') return <RepoGroupGlyph />;
    return <PlusIcon />;
}

export function WorkspaceIdentityChip({ repo, repos, onSwitchBack, groupIdentity, identitySuppressed }: WorkspaceIdentityChipProps) {
    const [rowMenu, setRowMenu] = useState<{ repo: RepoData; x: number; y: number } | null>(null);
    const [groupMenu, setGroupMenu] = useState<{ workspace: any; x: number; y: number } | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const { open, toggle, close, searchRef } = useDropdownPopover(rootRef, triggerRef);

    const model = useScopePickerModel(repos, { onClose: close, addTargetRepo: repo });
    const {
        query,
        setQuery,
        showAll,
        setShowAll,
        showAllCount,
        activeGroupKey,
        activeGroup,
        activeSummary,
        groupRows,
        remoteRows,
        pinnedScopesEnabled,
        isPinned,
        pinsFull,
        togglePin,
        footerActions,
    } = model;

    /**
     * The pin toggle rendered on a picker row. `kind` is what keeps the two
     * "repo group" key spaces apart: `repo` carries a `groupKey` (git-remote
     * clustering), `group` carries a repo-group virtual workspace id. Storing
     * either as a bare string would let a remote named like a group id resolve
     * to the wrong scope.
     */
    const renderPinToggle = useCallback((ref: PinnedScopeRef, label: string) => {
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
                title={blocked ? 'Pin limit reached' : pinned ? 'Unpin from the scope switcher' : 'Pin to the scope switcher'}
                onClick={e => { e.stopPropagation(); togglePin(ref); }}
                className={
                    'flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded transition-opacity '
                    + (pinned
                        ? 'text-[#0969da] dark:text-[#79c0ff] opacity-100'
                        : 'text-[#848484] dark:text-[#777] opacity-0 group-hover/row:opacity-100 focus:opacity-100 disabled:opacity-0')
                    + ' hover:bg-black/[0.06] dark:hover:bg-white/[0.10]'
                }
            >
                <PinGlyph filled={pinned} />
            </button>
        );
    }, [pinnedScopesEnabled, isPinned, pinsFull, togglePin]);

    // The model's menu items close the popover; clearing the menu itself stays
    // with the surface that opened it.
    const withMenuDismiss = useCallback((items: ContextMenuItem[], dismiss: () => void): ContextMenuItem[] =>
        items.map(item => ({ ...item, onClick: () => { dismiss(); item.onClick(); } })), []);

    // Group rows never surface an offline state: a remote group aggregates clones
    // with independent connection states, so offline is only meaningful per-clone
    // (handled by the virtual repo picker). The aggregate status color dot is shown
    // instead. See repo-picker-convergence plan, open question 3.
    const renderRemoteRow = (row: ScopePickerRemoteRow) => {
        const pinToggle = renderPinToggle(row.pinRef, row.summary.name);
        // Removal is per clone, never per group: a group row only offers Remove
        // when it *is* a single clone. Multi-clone groups drill into the clone
        // list (the clone popover), which offers Remove per clone. (AC-01)
        const kebab = row.soleClone ? (
            <button
                data-testid="remote-dropdown-row-menu"
                data-remote-key={row.key}
                aria-label={`More actions for ${row.summary.name}`}
                title="More actions"
                onClick={e => {
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setRowMenu({ repo: row.soleClone!, x: rect.left, y: rect.bottom });
                }}
                className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 mr-1 rounded text-[#848484] dark:text-[#777] hover:bg-black/[0.06] dark:hover:bg-white/[0.10]"
            >
                <KebabGlyph />
            </button>
        ) : null;
        return (
            <PickerRow
                key={row.key}
                testId="remote-dropdown-item"
                remoteKey={row.key}
                active={row.active}
                colorDot={row.summary.color}
                name={row.summary.name}
                sublabel={row.group.label}
                onClick={() => model.chooseGroup(row.group)}
                rowMenu={pinToggle || kebab ? <>{pinToggle}{kebab}</> : undefined}
                badges={
                    <>
                        {row.remoteServers.length > 0 && <RemoteServerBadge servers={row.remoteServers} />}
                        {row.wsl && <WslBadge distro={row.wsl.distro} />}
                        {row.summary.cloneCount > 1 && <CloneCountBadge count={row.summary.cloneCount} />}
                        {row.summary.unseen > 0 && <UnseenBadge count={row.summary.unseen} />}
                    </>
                }
            />
        );
    };

    const renderGroupRow = (row: ScopePickerGroupRow) => {
        // A remote group carries the aggregation's marker; a local one has none.
        // `offline` follows the contributing server, and an offline group is
        // read-only — no ⋮ menu, so Edit and Delete are simply unavailable until
        // it reconnects. (AC-04)
        const pinToggle = renderPinToggle(row.pinRef, row.name);
        // Offline groups are read-only, so they keep no ⋮ menu — but pinning is
        // local state and stays available.
        const kebab = row.offline ? null : (
            <button
                data-testid="repo-group-row-menu"
                data-remote-key={row.id}
                aria-label={`More actions for ${row.name}`}
                title="More actions"
                onClick={e => {
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setGroupMenu({ workspace: row.workspace, x: rect.left, y: rect.bottom });
                }}
                className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 mr-1 rounded text-[#848484] dark:text-[#777] hover:bg-black/[0.06] dark:hover:bg-white/[0.10]"
            >
                <KebabGlyph />
            </button>
        );
        return (
            // Row click switches the dashboard to the group's virtual workspace
            // (RepoGroupView) through the same target-aware navigation repos use;
            // for a remote group the clone registry already maps its id to the
            // owning server's baseUrl, so every request from the view routes
            // there. The ⋮ menu edits/deletes on that same server. (AC-02)
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
                rowMenu={pinToggle || kebab ? <>{pinToggle}{kebab}</> : undefined}
            />
        );
    };

    const displayName = groupIdentity
        ? groupIdentity.name
        : (activeSummary?.name ?? (repo?.workspace.name ?? 'Select repository'));
    const chipTitle = groupIdentity
        ? groupIdentity.name
        : (activeGroup?.label ?? (repo?.workspace.name ?? 'Select repository'));
    // The dot + provider badge + name + `⧉N` cluster, shared by the single-button
    // (workspace active) and split (virtual scope active) layouts.
    //
    // In group mode every repo-derived part is dropped rather than reused: the
    // remembered repo's health color, its provider and its clone count would all
    // read as facts about the group. The chip has no member data of its own, so
    // it shows a neutral dot and the 🗂️ marker every other repo-group surface
    // (`getRepoGroupHeaderConfig`, the inline and shell headers) already uses.
    const identityInner = (
        <>
            <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: groupIdentity ? '#848484' : (activeSummary?.color ?? '#848484') }} aria-hidden />
            {groupIdentity ? (
                <span data-testid="remote-chip-group-icon" aria-hidden>🗂️</span>
            ) : (
                <RemoteProviderBadge
                    normalizedUrl={activeGroup?.normalizedUrl}
                    testId="remote-provider-badge"
                    className="hidden xl:inline-flex items-center text-[9.5px] font-bold uppercase tracking-[0.08em] text-[#848484] dark:text-[#777]"
                />
            )}
            <span className="truncate">{displayName}</span>
            {!groupIdentity && activeSummary && activeSummary.cloneCount > 1 && (
                <CloneCountBadge count={activeSummary.cloneCount} className="hidden lg:inline-flex" />
            )}
        </>
    );

    return (
        <div className="relative flex items-center min-w-0 flex-shrink-0" ref={rootRef}>
            {identitySuppressed ? (
                // A pinned segment already owns this identity — render only the
                // affordance the pin cannot replace: the picker trigger.
                <button
                    ref={triggerRef}
                    data-testid="remote-chip"
                    data-identity-suppressed="true"
                    data-remote-key={activeGroupKey ?? ''}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    aria-label="Open remote picker"
                    title="Switch remote"
                    onClick={toggle}
                    className="relative inline-flex items-center h-[26px] px-1.5 rounded-md text-[#656d76] dark:text-[#999] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                >
                    <Chevron />
                </button>
            ) : onSwitchBack ? (
                // Inactive workspace under a virtual scope: identity body switches
                // back to this workspace, chevron opens the picker. (AC-02)
                <div className="relative inline-flex items-center rounded-md text-[12.5px] font-semibold text-[#1f2328] dark:text-[#cccccc] max-w-[190px]">
                    <button
                        data-testid="remote-chip"
                        data-remote-key={activeGroupKey ?? ''}
                        data-repo-group-id={groupIdentity?.id}
                        title={`Switch to ${chipTitle}`}
                        aria-label={`Switch to ${displayName}`}
                        onClick={onSwitchBack}
                        className="relative inline-flex items-center gap-1.5 h-[26px] pl-2 pr-1 rounded-l-md min-w-0 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                    >
                        {identityInner}
                    </button>
                    <button
                        ref={triggerRef}
                        data-testid="remote-chip-chevron"
                        aria-haspopup="menu"
                        aria-expanded={open}
                        aria-label="Open remote picker"
                        title="Switch remote"
                        onClick={toggle}
                        className="relative inline-flex items-center h-[26px] pl-1 pr-2 rounded-r-md hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                    >
                        <Chevron />
                    </button>
                </div>
            ) : (
                <button
                    ref={triggerRef}
                    data-testid="remote-chip"
                    data-remote-key={activeGroupKey ?? ''}
                    data-repo-group-id={groupIdentity?.id}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    title={chipTitle}
                    onClick={toggle}
                    className="relative inline-flex items-center gap-1.5 h-[26px] px-2 rounded-md text-[12.5px] font-semibold text-[#1f2328] dark:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] max-w-[190px]"
                >
                    {identityInner}
                    <Chevron />
                </button>
            )}

            <RepoPickerPopover
                open={open}
                dropdownTestId="remote-dropdown"
                searchTestId="remote-search-input"
                searchRef={searchRef}
                searchPlaceholder="Search remotes and groups"
                query={query}
                onQueryChange={setQuery}
                footer={
                    <div className="mt-1 pt-1 border-t border-[#eaeef2] dark:border-[#3c3c3c]">
                        <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.07em] text-[#848484] dark:text-[#777]">Add repository</div>
                        {footerActions.map(action => (
                            <button
                                key={action.key}
                                data-testid={action.testId}
                                role="menuitem"
                                className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-md text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10"
                                onClick={action.onClick}
                            >
                                <FooterActionIcon icon={action.icon} />
                                {action.label}
                            </button>
                        ))}
                    </div>
                }
            >
                <PickerSection label="Repo groups" />
                {groupRows.length > 0 ? (
                    groupRows.map(row => renderGroupRow(row))
                ) : (
                    <PickerEmpty>No repo groups</PickerEmpty>
                )}

                <div className="mt-1 border-t border-[#eaeef2] dark:border-[#3c3c3c]" />

                <PickerSection label={query.trim() ? 'Search results' : 'Recent remotes'} />
                {remoteRows.length > 0 ? (
                    remoteRows.map(row => renderRemoteRow(row))
                ) : (
                    <PickerEmpty>No remotes found</PickerEmpty>
                )}
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
            </RepoPickerPopover>

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
