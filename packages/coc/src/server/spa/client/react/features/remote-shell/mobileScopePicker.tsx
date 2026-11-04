import { useState } from 'react';
import type { RepoData } from '../../repos/repoGrouping';
import { ContextMenu, type ContextMenuItem } from '../../tasks/comments/ContextMenu';
import { PickerEmpty, PickerRow, PickerSection } from './RepoPickerPopover';
import { RemoteServerBadge } from './RemoteServerBadge';
import { CloneGlyph, KebabGlyph, PinGlyph, PlusIcon, RepoGroupGlyph, UnseenBadge } from './scopePickerGlyphs';
import type { ScopePickerFooterAction, useScopePickerModel } from './useScopePickerModel';

type Model = ReturnType<typeof useScopePickerModel>;

export function FooterActionIcon({ icon }: { icon: ScopePickerFooterAction['icon'] }) {
    if (icon === 'clone') return <CloneGlyph />;
    if (icon === 'group') return <RepoGroupGlyph />;
    return <PlusIcon />;
}

export function ScopeSearchIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M16 16l4 4" />
        </svg>
    );
}

/** Touch controls remain visible; only the desktop picker uses hover disclosure. */
export function useMobileScopePicker(model: Model) {
    const [rowMenu, setRowMenu] = useState<{ repo: RepoData; x: number; y: number } | null>(null);
    const [groupMenu, setGroupMenu] = useState<{ workspace: Model['groupRows'][number]['workspace']; x: number; y: number } | null>(null);

    const openRepoMenu = (repo: RepoData, anchor: HTMLElement) => {
        const rect = anchor.getBoundingClientRect();
        setRowMenu({ repo, x: rect.left, y: rect.bottom });
    };

    const renderPinToggle = (ref: { kind: 'repo' | 'group'; key: string }, label: string) => {
        if (!model.pinnedScopesEnabled) return null;
        const pinned = model.isPinned(ref);
        return (
            <button
                data-testid="scope-pin-toggle"
                data-pin-kind={ref.kind}
                data-pin-key={ref.key}
                aria-pressed={pinned}
                disabled={!pinned && model.pinsFull}
                aria-label={`${pinned ? 'Unpin' : 'Pin'} ${label}`}
                onClick={e => { e.stopPropagation(); model.togglePin(ref); }}
                className={
                    'flex-shrink-0 inline-flex items-center justify-center w-9 h-9 rounded '
                    + (pinned ? 'text-[#0969da] dark:text-[#79c0ff]' : 'text-[#848484] dark:text-[#777] disabled:opacity-30')
                }
            >
                <PinGlyph filled={pinned} />
            </button>
        );
    };

    const renderSections = (prefix: 'scope-picker' | 'scope-list') => (
        <>
            {model.pinnedRows.length > 0 && (
                <>
                    <PickerSection label="Pinned" />
                    {model.pinnedRows.map(pin => (
                        <PickerRow
                            key={pin.id}
                            testId={`${prefix}-pinned-item`}
                            remoteKey={pin.ref.key}
                            colorDot={pin.color}
                            name={pin.label}
                            onClick={() => model.selectScope(pin.targetId)}
                            badges={pin.unseen > 0 || pin.partial ? <UnseenBadge count={pin.unseen} partial={pin.partial} /> : undefined}
                            rowMenu={renderPinToggle(pin.ref, pin.label)}
                        />
                    ))}
                </>
            )}
            {model.virtualRows.length > 0 && (
                <>
                    <PickerSection label="Scopes" />
                    {model.virtualRows.map(row => (
                        <PickerRow
                            key={row.id}
                            testId={`${prefix}-virtual-item`}
                            remoteKey={row.id}
                            active={row.active}
                            name={`${row.icon} ${row.label}`}
                            onClick={row.onSelect}
                        />
                    ))}
                </>
            )}
            <PickerSection label="Repo groups" />
            {model.groupRows.length > 0 ? model.groupRows.map(row => (
                <PickerRow
                    key={row.id}
                    testId="repo-group-item"
                    remoteKey={row.id}
                    active={row.active}
                    name={row.name}
                    sublabel={row.sublabel}
                    offline={row.offline}
                    onClick={() => model.selectScope(row.id)}
                    badges={<><RepoGroupGlyph />{row.isRemote && <RemoteServerBadge testId="repo-group-server-badge" servers={row.serverLabel ? [row.serverLabel] : []} />}</>}
                    rowMenu={
                        <>
                            {renderPinToggle(row.pinRef, row.name)}
                            {!row.offline && (
                                <button
                                    data-testid="repo-group-row-menu"
                                    data-remote-key={row.id}
                                    aria-label={`More actions for ${row.name}`}
                                    onClick={e => {
                                        e.stopPropagation();
                                        const rect = e.currentTarget.getBoundingClientRect();
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
            )) : <PickerEmpty>No repo groups</PickerEmpty>}
        </>
    );

    const withDismiss = (items: ContextMenuItem[], dismiss: () => void) =>
        items.map(item => ({ ...item, onClick: () => { dismiss(); item.onClick(); } }));
    const menus = (
        <>
            {rowMenu && <ContextMenu position={rowMenu} items={withDismiss(model.buildRowMenuItems(rowMenu.repo), () => setRowMenu(null))} onClose={() => setRowMenu(null)} />}
            {groupMenu && <ContextMenu position={groupMenu} items={withDismiss(model.buildGroupMenuItems(groupMenu.workspace), () => setGroupMenu(null))} onClose={() => setGroupMenu(null)} />}
        </>
    );
    return { renderSections, renderPinToggle, openRepoMenu, menus };
}
