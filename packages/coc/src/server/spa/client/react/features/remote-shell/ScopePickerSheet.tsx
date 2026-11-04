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
import { BottomSheet } from '../../ui/BottomSheet';
import type { RepoData } from '../../repos/repoGrouping';
import { RemoteServerBadge } from './RemoteServerBadge';
import { WslBadge } from './WslBadge';
import { PickerEmpty, PickerRow, PickerSection } from './RepoPickerPopover';
import {
    CloneCountBadge,
    KebabGlyph,
    UnseenBadge,
} from './scopePickerGlyphs';
import { useScopePickerModel } from './useScopePickerModel';
import { FooterActionIcon, ScopeSearchIcon, useMobileScopePicker } from './mobileScopePicker';

export interface ScopePickerSheetProps {
    open: boolean;
    onClose: () => void;
    repos: RepoData[];
    /** The clone the sheet was opened from, if any — targets the Add actions. */
    repo?: RepoData;
}

export function ScopePickerSheet({ open, onClose, repos, repo }: ScopePickerSheetProps) {
    const model = useScopePickerModel(repos, { onClose, addTargetRepo: repo });
    const { renderSections, renderPinToggle, openRepoMenu, menus } = useMobileScopePicker(model);
    const {
        query,
        setQuery,
        remoteRows,
        footerActions,
    } = model;

    return (
        <>
            <BottomSheet isOpen={open} onClose={onClose} title="Workspaces" height={80}>
                <div data-testid="scope-picker-sheet" className="px-2 pb-4">
                    <div className="flex items-center gap-1.5 px-2 py-2 mx-1 rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-[#f6f8fa] dark:bg-[#252526]">
                        <ScopeSearchIcon />
                        <input
                            data-testid="scope-picker-search"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search workspaces and groups"
                            aria-label="Search workspaces and groups"
                            className="min-w-0 flex-1 bg-transparent outline-none text-[13px] text-[#1f2328] dark:text-[#cccccc] placeholder:text-[#848484]"
                        />
                    </div>

                    {renderSections('scope-picker')}

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
                                                openRepoMenu(row.soleClone!, e.currentTarget);
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

            {menus}
        </>
    );
}
