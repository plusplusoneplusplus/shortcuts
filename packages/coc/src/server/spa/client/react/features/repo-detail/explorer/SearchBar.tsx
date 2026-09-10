/**
 * SearchBar — controlled search input with a trailing clear button.
 * Styling matches ProcessFilters / TasksPanel search input patterns.
 *
 * Optionally renders a row of sticky mode toggles (used by the content-search
 * view for case-sensitive / whole-word / regex), so the two search surfaces
 * share one input rather than duplicating it. The toggles and any trailing
 * control sit inside the input's right edge by default;
 * `togglePlacement="below"` moves them to their own row underneath, which is
 * what a narrow sidebar needs.
 *
 * `multiline` swaps the `<input>` for an auto-growing `<textarea>` — VS Code's
 * search box shape, where a newline in the query means a multi-line match. It is
 * opt-in because the file-filter bar has no use for a second line.
 */

import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { cn } from '../../../ui/cn';

/** Tallest the multi-line query box grows before it starts scrolling. */
export const SEARCH_BAR_MAX_ROWS = 5;

/** Room the clear button needs inside the right edge of the field, in px. */
const CLEAR_BUTTON_WIDTH = 28;

/** Room one mode toggle needs inside the right edge of the field, in px. */
const TOGGLE_WIDTH = 26;

/** Where the mode toggles live relative to the query field. */
export type SearchBarTogglePlacement = 'inside' | 'below';

/**
 * Rows the auto-growing query box needs for `value`: one per line, at least one,
 * capped at `maxRows` so a pasted file scrolls inside the box instead of eating
 * the results list. Line counting rather than measuring `scrollHeight` keeps the
 * growth deterministic (and testable in jsdom, where layout is always zero).
 */
export function autoGrowRows(value: string, maxRows: number = SEARCH_BAR_MAX_ROWS): number {
    const lines = value.split('\n').length;
    return Math.min(Math.max(lines, 1), maxRows);
}

/**
 * Space to reserve inside the field's right edge: the clear button always, plus
 * one slot per toggle only while the toggles are *in* the field. Moving them
 * below is worth 78px of typing room at three toggles.
 */
export function searchBarPaddingRight(
    toggleCount: number,
    placement: SearchBarTogglePlacement = 'inside',
    trailingControlCount = 0,
): number {
    return CLEAR_BUTTON_WIDTH
        + (placement === 'below' ? 0 : (toggleCount + trailingControlCount) * TOGGLE_WIDTH);
}

/** A sticky on/off button rendered inside the input, VS Code style. */
export interface SearchBarToggle {
    /** Stable id, also used for the button's `data-testid` suffix. */
    id: string;
    /** Short glyph shown on the button, e.g. `Aa`. */
    label: string;
    /** Tooltip / accessible name. */
    title: string;
    active: boolean;
    onToggle: () => void;
}

export interface SearchBarProps {
    value: string;
    onChange: (value: string) => void;
    onClear: () => void;
    /**
     * Focus handle. A union rather than a widened `RefObject` because the two
     * hosts hold different elements: the file filter an `<input>`, the content
     * search a `<textarea>`.
     */
    inputRef?: RefObject<HTMLInputElement> | RefObject<HTMLTextAreaElement>;
    placeholder?: string;
    /** Mode toggles pinned inside the right edge of the input. */
    toggles?: SearchBarToggle[];
    /**
     * Where the toggles go. `below` puts them on their own left-aligned row
     * under the field, freeing the width they were taking from the query.
     */
    togglePlacement?: SearchBarTogglePlacement;
    /**
     * Rendered after the toggles, so a host with one more control (the Search
     * view's `…`) can share their row in either placement.
     */
    children?: ReactNode;
    /**
     * Leave a gutter on the left of the field for a control the *owner* draws
     * there — the Search view's replace chevron, which spans this row and the
     * replace field below it.
     */
    leftGutter?: boolean;
    /**
     * Prefix for every `data-testid` this renders — `<prefix>-bar`, `-input`,
     * `-clear`, `-toggle-<id>`. The default reproduces the file-filter bar's
     * long-standing ids; the content-search view passes `content-search`.
     */
    testIdPrefix?: string;
    /**
     * Render an auto-growing `<textarea>` instead of an `<input>`, so the query
     * can span lines. `Shift+Enter` inserts one; plain `Enter` submits.
     */
    multiline?: boolean;
    /**
     * Run the query as it stands, right now. Bound to `Enter`, which exists so
     * the user can skip the debounce; a host that omits it makes `Enter` inert.
     */
    onSubmit?: () => void;
}

/** Shared look for a mode toggle, wherever it is rendered. */
function toggleClassName(active: boolean): string {
    return cn(
        'px-1 py-0.5 rounded text-[11px] leading-none font-mono border cursor-pointer transition-colors',
        active
            ? 'bg-[#0078d4] text-white border-[#0078d4]'
            : 'bg-transparent text-[#848484] border-transparent hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
    );
}

export function SearchBar({
    value,
    onChange,
    onClear,
    inputRef,
    placeholder = 'Filter files…',
    toggles,
    togglePlacement = 'inside',
    children,
    leftGutter = false,
    testIdPrefix = 'explorer-search',
    multiline = false,
    onSubmit,
}: SearchBarProps) {
    const toggleCount = toggles?.length ?? 0;
    const togglesBelow = togglePlacement === 'below' && (toggleCount > 0 || children !== undefined);
    // Reserve room inside the input for the clear button plus each toggle still
    // sitting in there, so the text never slides underneath them.
    const paddingRight = searchBarPaddingRight(toggleCount, togglePlacement, children ? 1 : 0);

    // Enter submits; Shift+Enter falls through to the textarea's own newline.
    // preventDefault matters on the textarea only, but costs nothing on the
    // input, where Enter has no default to suppress outside a form.
    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== 'Enter' || event.shiftKey || !onSubmit) return;
        event.preventDefault();
        onSubmit();
    };

    const fieldClassName = cn(
        'w-full pr-7 py-2.5 lg:py-1.5 text-base lg:text-sm rounded border border-[#e0e0e0] bg-white',
        leftGutter ? 'pl-6' : 'pl-2',
        'dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc]',
        'focus:outline-none focus:border-[#0078d4]',
        multiline && 'resize-none overflow-x-auto overflow-y-auto whitespace-pre leading-5 font-mono',
    );

    const fieldProps = {
        value,
        onChange: (e: { target: { value: string } }) => onChange(e.target.value),
        onKeyDown,
        placeholder,
        style: { paddingRight },
        className: fieldClassName,
        'data-testid': `${testIdPrefix}-input`,
    };

    return (
        <div className="px-2 py-1" data-testid={`${testIdPrefix}-bar`}>
            <div className="relative flex items-center">
                {multiline ? (
                    <textarea
                        {...fieldProps}
                        ref={inputRef as React.Ref<HTMLTextAreaElement>}
                        rows={autoGrowRows(value)}
                    />
                ) : (
                    <input {...fieldProps} ref={inputRef as React.Ref<HTMLInputElement>} type="text" />
                )}
                {/* The clear button and any in-field toggles centre themselves
                    against a one-row field; once the box can grow they have to be
                    pinned to its first row instead, as in VS Code. */}
                <div
                    className={cn(
                        'absolute right-1.5 flex items-center gap-1',
                        multiline && 'top-[9px] lg:top-[5px]',
                    )}
                >
                    {/* Clear button — visible only when value is non-empty */}
                    {value && (
                        <button
                            className="text-[#999] hover:text-[#333] dark:hover:text-[#eee] text-sm leading-none bg-transparent border-none p-0 cursor-pointer"
                            onClick={onClear}
                            title="Clear search"
                            data-testid={`${testIdPrefix}-clear`}
                        >
                            ✕
                        </button>
                    )}
                    {!togglesBelow && toggles?.map(toggle => (
                        <button
                            key={toggle.id}
                            type="button"
                            onClick={toggle.onToggle}
                            title={toggle.title}
                            aria-label={toggle.title}
                            aria-pressed={toggle.active}
                            className={toggleClassName(toggle.active)}
                            data-testid={`${testIdPrefix}-toggle-${toggle.id}`}
                        >
                            {toggle.label}
                        </button>
                    ))}
                    {!togglesBelow && children}
                </div>
            </div>
            {togglesBelow && (
                <div
                    className="flex items-center gap-1 pt-1"
                    data-testid={`${testIdPrefix}-toggle-row`}
                >
                    {toggles?.map(toggle => (
                        <button
                            key={toggle.id}
                            type="button"
                            onClick={toggle.onToggle}
                            title={toggle.title}
                            aria-label={toggle.title}
                            aria-pressed={toggle.active}
                            className={toggleClassName(toggle.active)}
                            data-testid={`${testIdPrefix}-toggle-${toggle.id}`}
                        >
                            {toggle.label}
                        </button>
                    ))}
                    {children && <div className="ml-auto flex items-center">{children}</div>}
                </div>
            )}
        </div>
    );
}
