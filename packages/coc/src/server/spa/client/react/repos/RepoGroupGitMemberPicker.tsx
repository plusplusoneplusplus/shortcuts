/** Rich member selector for a repo group's Git toolbar. */

import { createPortal } from 'react-dom';
import {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type Ref,
} from 'react';
import { cn } from '../ui/cn';
import type { RepoGroupMember } from './repoGroupService';
import type { RepoGroupMemberGitInfo } from './useRepoGroupMemberGitInfo';

export interface RepoGroupGitMemberPickerProps {
    members: readonly RepoGroupMember[];
    /** Currently hosted member id; undefined when no member is usable. */
    selectedId: string | undefined;
    onSelect: (memberId: string) => void;
    gitInfo: RepoGroupMemberGitInfo;
    selectRef?: Ref<HTMLButtonElement>;
}

interface PickerPosition {
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
}

const VIEWPORT_MARGIN = 8;
const PICKER_WIDTH = 344;
const PICKER_MAX_HEIGHT = 360;
function optionId(listboxId: string, memberId: string): string {
    return `${listboxId}-option-${encodeURIComponent(memberId)}`;
}

function staleReason(member: RepoGroupMember): string {
    return member.staleReason === 'workspace-removed' ? 'Workspace removed' : 'Folder not found';
}

function memberLabel(member: RepoGroupMember): string {
    return member.name || member.workspaceId;
}

function memberSearchText(member: RepoGroupMember, gitInfo: RepoGroupMemberGitInfo): string {
    const info = gitInfo[member.workspaceId];
    return [memberLabel(member), member.rootPath, info?.branch].filter(Boolean).join(' ').toLowerCase();
}

function RepoIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5 shrink-0">
            <path d="M3 1.5h8.5A1.5 1.5 0 0113 3v10.5a.5.5 0 01-.76.43L10 12.58l-2.24 1.35a.5.5 0 01-.52 0L5 12.58l-2.24 1.35A.5.5 0 012 13.5v-11a1 1 0 011-1zm0 1v10.1l2-1.2 2.5 1.5 2.5-1.5 2 1.2V3a.5.5 0 00-.5-.5H3z" />
        </svg>
    );
}

function BranchIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="h-2.5 w-2.5 shrink-0">
            <path d="M4 1a2 2 0 11-1 3.73v6.54A2 2 0 114 15a2 2 0 01-1-3.73V4.73A2 2 0 014 1zm7.5 0a2 2 0 11-1 3.73V6A2.5 2.5 0 018 8.5H6.5A1.5 1.5 0 005 10v1H4v-1a2.5 2.5 0 012.5-2.5H8A1.5 1.5 0 009.5 6V4.73A2 2 0 0111.5 1zM4 2a1 1 0 100 2 1 1 0 000-2zm7.5 0a1 1 0 100 2 1 1 0 000-2zM4 12a1 1 0 100 2 1 1 0 000-2z" />
        </svg>
    );
}

function GitStatus({ memberId, gitInfo }: { memberId: string; gitInfo: RepoGroupMemberGitInfo }) {
    const info = gitInfo[memberId];
    if (!info?.isGitRepo) {
        return null;
    }
    return (
        <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[10px] tabular-nums">
            {info.dirty && (
                <span
                    className="h-1.5 w-1.5 rounded-full bg-[#b86400] dark:bg-[#d19a66]"
                    title="Uncommitted changes"
                    aria-label="Uncommitted changes"
                />
            )}
            {(info.ahead ?? 0) > 0 && <span className="text-[#16825d] dark:text-[#4ec9b0]">↑{info.ahead}</span>}
            {(info.behind ?? 0) > 0 && <span className="text-[#c42b1c] dark:text-[#f48771]">↓{info.behind}</span>}
        </span>
    );
}

export function RepoGroupGitMemberPicker({
    members,
    selectedId,
    onSelect,
    gitInfo,
    selectRef,
}: RepoGroupGitMemberPickerProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [cursor, setCursor] = useState(0);
    const [position, setPosition] = useState<PickerPosition | null>(null);
    const listboxId = `repo-group-git-member-options-${useId().replace(/:/g, '')}`;
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const pickerRef = useRef<HTMLDivElement | null>(null);
    const searchRef = useRef<HTMLInputElement | null>(null);

    const setTriggerRef = useCallback((element: HTMLButtonElement | null) => {
        triggerRef.current = element;
        if (typeof selectRef === 'function') {
            selectRef(element);
        } else if (selectRef) {
            selectRef.current = element;
        }
    }, [selectRef]);

    const selected = members.find(member => member.workspaceId === selectedId);
    const selectable = useMemo(() => members.filter(member => !member.stale), [members]);
    const filtered = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) {
            return members;
        }
        return members.filter(member => memberSearchText(member, gitInfo).includes(normalized));
    }, [members, query, gitInfo]);
    const filteredSelectable = useMemo(() => filtered.filter(member => !member.stale), [filtered]);

    const updatePosition = useCallback(() => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) {
            return;
        }
        const width = Math.min(PICKER_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
        const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN));
        const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
        const spaceAbove = rect.top - VIEWPORT_MARGIN;
        const opensAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
        const maxHeight = Math.min(PICKER_MAX_HEIGHT, Math.max(160, opensAbove ? spaceAbove - 4 : spaceBelow - 4));
        setPosition({
            ...(opensAbove
                ? { bottom: window.innerHeight - rect.top + 4 }
                : { top: rect.bottom + 4 }),
            left,
            width,
            maxHeight,
        });
    }, []);

    const close = useCallback((restoreFocus = false) => {
        setOpen(false);
        setQuery('');
        if (restoreFocus) {
            triggerRef.current?.focus();
        }
    }, []);

    const openPicker = useCallback(() => {
        if (members.length === 0) {
            return;
        }
        const selectedIndex = selectable.findIndex(member => member.workspaceId === selectedId);
        setCursor(selectedIndex < 0 ? 0 : selectedIndex);
        updatePosition();
        setOpen(true);
    }, [members.length, selectable, selectedId, updatePosition]);

    useEffect(() => {
        if (!open) {
            return;
        }
        updatePosition();
        const onPointerDown = (event: MouseEvent | TouchEvent) => {
            const target = event.target as Node;
            if (!triggerRef.current?.contains(target) && !pickerRef.current?.contains(target)) {
                close();
            }
        };
        const onViewportChange = () => updatePosition();
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('touchstart', onPointerDown);
        window.addEventListener('resize', onViewportChange);
        window.addEventListener('scroll', onViewportChange, true);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('touchstart', onPointerDown);
            window.removeEventListener('resize', onViewportChange);
            window.removeEventListener('scroll', onViewportChange, true);
        };
    }, [open, close, updatePosition]);

    useEffect(() => {
        if (!open) {
            return;
        }
        const selectedIndex = filteredSelectable.findIndex(member => member.workspaceId === selectedId);
        setCursor(selectedIndex < 0 ? 0 : selectedIndex);
    }, [open, query, filteredSelectable, selectedId]);

    useEffect(() => {
        if (open && members.length >= 5) {
            searchRef.current?.focus();
        }
    }, [open, members.length]);

    const choose = useCallback((member: RepoGroupMember) => {
        if (member.stale) {
            return;
        }
        // Focus the trigger before selection remounts the keyed Git panel. The
        // parent ref callback then carries focus to the new member's trigger.
        triggerRef.current?.focus();
        close();
        onSelect(member.workspaceId);
    }, [close, onSelect]);

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape' && open) {
            event.preventDefault();
            close(true);
            return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') {
            return;
        }
        if (!open) {
            event.preventDefault();
            openPicker();
            return;
        }
        if (filteredSelectable.length === 0) {
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            choose(filteredSelectable[cursor] ?? filteredSelectable[0]);
            return;
        }
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setCursor(current => (current + step + filteredSelectable.length) % filteredSelectable.length);
    };

    const selectedLabel = selected ? memberLabel(selected) : 'No usable repositories';
    const activeOptionId = open && filteredSelectable[cursor]
        ? optionId(listboxId, filteredSelectable[cursor].workspaceId)
        : undefined;

    return (
        <div
            className="relative min-w-0 shrink"
            data-testid="repo-group-git-member-picker"
            data-selected-member={selectedId ?? ''}
            onKeyDown={onKeyDown}
        >
            <button
                ref={setTriggerRef}
                type="button"
                disabled={members.length === 0}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? listboxId : undefined}
                aria-activedescendant={members.length < 5 ? activeOptionId : undefined}
                aria-label={`Member repository: ${selectedLabel}`}
                title={selected?.rootPath || selectedLabel}
                onClick={() => open ? close() : openPicker()}
                data-testid="repo-group-git-member-trigger"
                className={cn(
                    // Borderless: reads as the first segment of the header's `repo / branch` breadcrumb.
                    'inline-flex h-6 min-w-0 max-w-[10rem] items-center gap-1 rounded px-1',
                    'bg-transparent text-xs text-[#1e1e1e] dark:text-[#cccccc]',
                    'hover:bg-black/[0.06] dark:hover:bg-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    open && 'bg-black/[0.06] dark:bg-white/[0.08]',
                )}
            >
                <span className="text-[#0078d4] dark:text-[#3794ff]"><RepoIcon /></span>
                <span className="min-w-0 truncate font-medium" data-testid="repo-group-git-member-label">
                    {selectedLabel}
                </span>
                {selected && <GitStatus memberId={selected.workspaceId} gitInfo={gitInfo} />}
                <svg viewBox="0 0 8 6" fill="none" aria-hidden="true" className="h-1.5 w-2 shrink-0 opacity-60">
                    <path d="M1 1l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>

            {open && position && createPortal(
                <div
                    ref={pickerRef}
                    id={listboxId}
                    role="listbox"
                    aria-label="Member repository"
                    data-testid="repo-group-git-member-list"
                    className={cn(
                        'fixed z-[10000] flex flex-col overflow-hidden rounded-lg border text-xs shadow-xl',
                        'border-[#d0d0d0] bg-white text-[#1e1e1e] dark:border-[#454545] dark:bg-[#252526] dark:text-[#cccccc]',
                    )}
                    style={{
                        top: position.top,
                        bottom: position.bottom,
                        left: position.left,
                        width: position.width,
                        maxHeight: position.maxHeight,
                    }}
                >
                    <div className="flex items-center justify-between px-2.5 pb-1 pt-2">
                        <span className="font-semibold">Switch repository</span>
                        <span className="text-[10px] text-[#848484] dark:text-[#999]">{selectable.length} available</span>
                    </div>
                    {members.length >= 5 && (
                        <label className="mx-2 mb-1.5 flex h-7 items-center gap-1.5 rounded border border-[#d0d0d0] bg-[#f7f7f7] px-2 focus-within:border-[#0078d4] focus-within:ring-1 focus-within:ring-[#0078d4]/30 dark:border-[#454545] dark:bg-[#1f1f1f]">
                            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="h-3 w-3 shrink-0 text-[#848484]">
                                <path d="M11.4 10.7l3.1 3.1-.7.7-3.1-3.1a5.5 5.5 0 11.7-.7zM7 11.5A4.5 4.5 0 107 2a4.5 4.5 0 000 9.5z" />
                            </svg>
                            <input
                                ref={searchRef}
                                value={query}
                                onChange={event => setQuery(event.target.value)}
                                placeholder="Search repositories…"
                                aria-label="Search repositories"
                                role="combobox"
                                aria-expanded="true"
                                aria-controls={listboxId}
                                aria-activedescendant={activeOptionId}
                                data-testid="repo-group-git-member-search"
                                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[11px] text-inherit outline-none placeholder:text-[#999]"
                            />
                            {query && (
                                <button
                                    type="button"
                                    aria-label="Clear repository search"
                                    onClick={() => setQuery('')}
                                    className="text-sm leading-none text-[#848484] hover:text-[#1e1e1e] dark:hover:text-white"
                                >×</button>
                            )}
                        </label>
                    )}
                    <div className="min-h-0 flex-1 overflow-y-auto p-1">
                        {filtered.length === 0 ? (
                            <div className="px-3 py-6 text-center text-[11px] text-[#848484] dark:text-[#999]" data-testid="repo-group-git-member-empty-search">
                                No repositories match “{query}”.
                            </div>
                        ) : filtered.map(member => {
                            const memberId = member.workspaceId;
                            const info = gitInfo[memberId];
                            const isSelected = memberId === selectedId;
                            const atCursor = !member.stale && filteredSelectable[cursor]?.workspaceId === memberId;
                            return (
                                <button
                                    key={memberId}
                                    id={optionId(listboxId, memberId)}
                                    type="button"
                                    role="option"
                                    aria-selected={isSelected}
                                    aria-disabled={member.stale}
                                    disabled={member.stale}
                                    title={member.stale ? `${memberLabel(member)} — ${staleReason(member)}` : member.rootPath || memberLabel(member)}
                                    data-testid={`repo-group-git-member-${memberId}`}
                                    onClick={() => choose(member)}
                                    className={cn(
                                        'flex min-h-[43px] w-full items-center gap-1.5 rounded-md border-0 px-1.5 py-1.5 text-left',
                                        member.stale
                                            ? 'cursor-not-allowed text-[#999] opacity-65 dark:text-[#777]'
                                            : 'cursor-pointer hover:bg-[#f0f4f8] dark:hover:bg-[#2a3440]',
                                        atCursor && !member.stale && 'bg-[#0078d4]/10 dark:bg-[#0078d4]/25',
                                    )}
                                >
                                    <span aria-hidden="true" className="w-3 shrink-0 text-center font-semibold text-[#0078d4] dark:text-[#3794ff]">
                                        {isSelected ? '✓' : ''}
                                    </span>
                                    <span className="shrink-0 text-[#616161] dark:text-[#999]"><RepoIcon /></span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex min-w-0 items-center gap-1.5">
                                            <span className="truncate font-medium">{memberLabel(member)}</span>
                                            {member.stale && (
                                                <span className="shrink-0 rounded-full bg-[#b86400]/10 px-1.5 py-0.5 text-[9px] text-[#9a5200] dark:text-[#d19a66]">
                                                    Unavailable
                                                </span>
                                            )}
                                        </span>
                                        <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[10px] text-[#848484] dark:text-[#999]">
                                            {member.stale ? (
                                                <span className="truncate">{staleReason(member)}{member.rootPath ? ` · ${member.rootPath}` : ''}</span>
                                            ) : (
                                                <>
                                                    {info?.isGitRepo && info.branch && (
                                                        <span className="flex max-w-[42%] shrink-0 items-center gap-0.5 truncate text-[#616161] dark:text-[#aaa]">
                                                            <BranchIcon />
                                                            <span className="truncate">{info.branch}</span>
                                                        </span>
                                                    )}
                                                    {info?.isGitRepo === false && <span className="shrink-0">Not a Git repo</span>}
                                                    {member.rootPath && <span className="truncate">{member.rootPath}</span>}
                                                </>
                                            )}
                                        </span>
                                    </span>
                                    {!member.stale && <GitStatus memberId={memberId} gitInfo={gitInfo} />}
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex items-center gap-3 border-t border-[#e0e0e0] bg-[#f7f7f7] px-2.5 py-1 text-[9px] text-[#848484] dark:border-[#3c3c3c] dark:bg-[#2a2a2b] dark:text-[#999]">
                        <span>↑↓ navigate</span><span>↵ select</span><span>Esc close</span>
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
}
