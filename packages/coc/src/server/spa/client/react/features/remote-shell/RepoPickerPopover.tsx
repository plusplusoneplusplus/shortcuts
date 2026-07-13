/**
 * RepoPickerPopover — the shared, presentational shell for both remote
 * repo-picker dropdowns. It owns the consistent chrome (fixed width, search box,
 * scroll container, popover border/shadow) so the two callers only supply their
 * own item model, rows, and (for the Repo tab) an Add-repository footer.
 *
 * Companion primitives `PickerSection`, `PickerRow`, and `PickerEmpty` give the
 * two callers one source of truth for section-header typography, row layout
 * (color dot · name · sublabel · badges · offline/active state), and the
 * empty-state style.
 */
import type { ReactNode, RefObject } from 'react';

function SearchIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M16 16l4 4" />
        </svg>
    );
}

export interface RepoPickerPopoverProps {
    /** Whether the popover is open (renders nothing when closed). */
    open: boolean;
    /** testid for the popover root (`remote-dropdown` / `<prefix>-repo-dropdown`). */
    dropdownTestId: string;
    /** testid for the search input (`remote-search-input` / `<prefix>-repo-search`). */
    searchTestId: string;
    /** Ref for the search input (from `useDropdownPopover`) so it auto-focuses on open. */
    searchRef?: RefObject<HTMLInputElement>;
    searchPlaceholder: string;
    /** Optional explicit aria-label for the search input; defaults to the placeholder. */
    searchAriaLabel?: string;
    query: string;
    onQueryChange: (value: string) => void;
    /** Rows + section headers + empty state, rendered inside the scroll container. */
    children: ReactNode;
    /** Optional content rendered below the scroll area (e.g. Show-all + Add-repository). */
    footer?: ReactNode;
}

export function RepoPickerPopover({
    open,
    dropdownTestId,
    searchTestId,
    searchRef,
    searchPlaceholder,
    searchAriaLabel,
    query,
    onQueryChange,
    children,
    footer,
}: RepoPickerPopoverProps) {
    if (!open) return null;
    return (
        <div
            data-testid={dropdownTestId}
            role="menu"
            className="absolute left-0 top-full mt-1 z-50 w-[300px] rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-lg p-1.5"
        >
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-[#f6f8fa] dark:bg-[#252526]">
                <SearchIcon />
                <input
                    ref={searchRef}
                    data-testid={searchTestId}
                    value={query}
                    onChange={e => onQueryChange(e.target.value)}
                    placeholder={searchPlaceholder}
                    aria-label={searchAriaLabel ?? searchPlaceholder}
                    className="min-w-0 flex-1 bg-transparent outline-none text-[12px] text-[#1f2328] dark:text-[#cccccc] placeholder:text-[#848484]"
                />
            </div>

            <div className="max-h-[280px] overflow-y-auto mt-1">{children}</div>

            {footer}
        </div>
    );
}

/** Uppercase section label shared by both pickers (Recent / Search / Local / Remote). */
export function PickerSection({ label }: { label: string }) {
    return (
        <div className="px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-[0.07em] text-[#848484] dark:text-[#777]">
            {label}
        </div>
    );
}

/** Empty / no-results placeholder shared by both pickers. */
export function PickerEmpty({ children }: { children: ReactNode }) {
    return <div className="px-2 py-3 text-[12px] text-[#848484] dark:text-[#777] text-center">{children}</div>;
}

export interface PickerRowProps {
    testId: string;
    /** Primary row label. */
    name: string;
    /** Secondary muted line under the name. */
    sublabel?: string;
    /** Optional leading status/color dot (group rows); omit for no dot. */
    colorDot?: string;
    /** Trailing badges (clone-count pill, unseen badge, offline pill). */
    badges?: ReactNode;
    /** Disabled + dimmed offline affordance (repo rows). */
    offline?: boolean;
    /** Highlighted active state; when defined also emits `data-active`. */
    active?: boolean;
    /** Optional `data-remote-key` used by the group picker. */
    remoteKey?: string;
    onClick?: () => void;
}

/**
 * One row in either picker. The base layout/typography/hover is identical; each
 * caller varies it through the optional slots — the group picker passes a
 * `colorDot`, `remoteKey`, `active`, and clone/unseen `badges`; the repo picker
 * passes `offline` and an offline `badge`.
 */
export function PickerRow({
    testId,
    name,
    sublabel,
    colorDot,
    badges,
    offline,
    active,
    remoteKey,
    onClick,
}: PickerRowProps) {
    const stateClass = offline
        ? 'opacity-50 cursor-not-allowed text-[#848484] dark:text-[#666]'
        : active
            ? 'bg-[#ddf4ff] dark:bg-[#3794ff]/15 text-[#0969da] dark:text-[#79c0ff]'
            : 'text-[#1f2328] dark:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]';
    return (
        <button
            data-testid={testId}
            data-remote-key={remoteKey}
            data-active={active === undefined ? undefined : active ? 'true' : 'false'}
            role="menuitem"
            disabled={offline}
            aria-disabled={offline}
            onClick={onClick}
            className={'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ' + stateClass}
        >
            {colorDot && (
                <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: colorDot }} aria-hidden />
            )}
            <span className="flex-1 min-w-0">
                <span className="block text-[12.5px] font-semibold truncate">{name}</span>
                {sublabel && (
                    <span className="block text-[10.5px] text-[#848484] dark:text-[#777] truncate">{sublabel}</span>
                )}
            </span>
            {badges}
        </button>
    );
}
