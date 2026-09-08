/**
 * ScopePickerSheet — the mobile presentation of the desktop scope picker.
 *
 * Same model (`useScopePickerModel`), same section order, same footer actions
 * and the same `PickerSection` / `PickerRow` / `PickerEmpty` primitives as
 * `WorkspaceIdentityChip`'s dropdown; only the container differs — a
 * `BottomSheet` instead of an absolutely-positioned popover, because a 300px
 * dropdown anchored to a 40px bar is unusable at 390px wide.
 *
 * Row actions are the same too, but they open through the shared `ContextMenu`,
 * which already renders as a bottom sheet on mobile.
 */
import { useCallback, useState } from 'react';
import { BottomSheet } from '../../ui/BottomSheet';
import { ContextMenu, type ContextMenuItem } from '../../tasks/comments/ContextMenu';
import type { RepoData } from '../../repos/repoGrouping';
import { RemoteServerBadge } from './RemoteServerBadge';
import { WslBadge } from './WslBadge';
import { PickerEmpty, PickerRow, PickerSection } from './RepoPickerPopover';
import {
    CloneCountBadge,
    CloneGlyph,
    KebabGlyph,
    PinGlyph,
    PlusIcon,
    RepoGroupGlyph,
    UnseenBadge,
} from './scopePickerGlyphs';
import { useScopePickerModel, type ScopePickerFooterAction } from './useScopePickerModel';

export interface ScopePickerSheetProps {
    open: boolean;
    onClose: () => void;
    repos: RepoData[];
    /** The clone the sheet was opened from, if any — targets the Add actions. */
    repo?: RepoData;
}

function FooterActionIcon({ icon }: { icon: ScopePickerFooterAction['icon'] }) {
    if (icon === 'clone') return <CloneGlyph />;
    if (icon === 'group') return <RepoGroupGlyph />;
    return <PlusIcon />;
}

function SearchIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M16 16l4 4" />
        </svg>
    );
}

export function ScopePickerSheet({ open, onClose, repos, repo }: ScopePickerSheetProps) {
    const [rowMenu, setRowMenu] = useState<{ repo: RepoData; x: number; y: number } | null>(null);
    const [groupMenu, setGroupMenu] = useState<{ workspace: any; x: number; y: number } | null>(null);

    const model = useScopePickerModel(repos, { onClose, addTargetRepo: repo });
    const {
        query,
        setQuery,
        pinnedRows,
        virtualRows,
        groupRows,
        remoteRows,
        footerActions,
        pinnedScopesEnabled,
        isPinned,
        pinsFull,
        togglePin,
    } = model;

    const withMenuDismiss = useCallback((items: ContextMenuItem[], dismiss: () => void): ContextMenuItem[] =>
        items.map(item => ({ ...item, onClick: () => { dismiss(); item.onClick(); } })), []);

    // On a touch surface a hover-revealed control is unreachable, so the pin
    // toggle is always visible here (the desktop row fades it in on hover).
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

    return (
        <>
            <BottomSheet isOpen={open} onClose={onClose} title="Workspaces" height={80}>
                <div data-testid="scope-picker-sheet" className="px-2 pb-4">
                    <div className="flex items-center gap-1.5 px-2 py-2 mx-1 rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-[#f6f8fa] dark:bg-[#252526]">
                        <SearchIcon />
                        <input
                            data-testid="scope-picker-search"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search workspaces and groups"
                            aria-label="Search workspaces and groups"
                            className="min-w-0 flex-1 bg-transparent outline-none text-[13px] text-[#1f2328] dark:text-[#cccccc] placeholder:text-[#848484]"
                        />
                    </div>

                    {pinnedRows.length > 0 && (
                        <>
                            <PickerSection label="Pinned" />
                            {pinnedRows.map(pin => (
                                <PickerRow
                                    key={pin.id}
                                    testId="scope-picker-pinned-item"
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
                                    testId="scope-picker-virtual-item"
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
                                    {/* Offline groups are read-only: no ⋮, so Edit and
                                        Delete stay unavailable until the owning server
                                        reconnects. Pinning is local and stays. */}
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

                    <PickerSection label={query.trim() ? 'Search results' : 'Repositories'} />
                    {remoteRows.length > 0 ? remoteRows.map(row => (
                        <PickerRow
                            key={row.key}
                            testId="remote-dropdown-item"
                            remoteKey={row.key}
                            active={row.active}
                            colorDot={row.summary.color}
                            name={row.summary.name}
                            sublabel={row.group.label}
                            onClick={() => model.chooseGroup(row.group)}
                            badges={
                                <>
                                    {row.remoteServers.length > 0 && <RemoteServerBadge servers={row.remoteServers} />}
                                    {row.wsl && <WslBadge distro={row.wsl.distro} />}
                                    {row.summary.cloneCount > 1 && <CloneCountBadge count={row.summary.cloneCount} />}
                                    {row.summary.unseen > 0 && <UnseenBadge count={row.summary.unseen} />}
                                </>
                            }
                            rowMenu={
                                <>
                                    {renderPinToggle(row.pinRef, row.summary.name)}
                                    {row.soleClone && (
                                        <button
                                            data-testid="remote-dropdown-row-menu"
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
                                    )}
                                </>
                            }
                        />
                    )) : (
                        <PickerEmpty>No remotes found</PickerEmpty>
                    )}

                    <div className="mt-2 pt-2 border-t border-[#eaeef2] dark:border-[#3c3c3c]">
                        <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.07em] text-[#848484] dark:text-[#777]">Add repository</div>
                        {footerActions.map(action => (
                            <button
                                key={action.key}
                                data-testid={action.testId}
                                role="menuitem"
                                className="w-full flex items-center gap-2 text-left px-2 min-h-[44px] rounded-md text-[13px] text-[#1e1e1e] dark:text-[#cccccc]"
                                onClick={action.onClick}
                            >
                                <FooterActionIcon icon={action.icon} />
                                {action.label}
                            </button>
                        ))}
                    </div>
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
        </>
    );
}
