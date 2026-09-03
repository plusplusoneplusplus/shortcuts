/**
 * SearchBar — controlled search input with leading search icon and trailing clear button.
 * Styling matches ProcessFilters / TasksPanel search input patterns.
 *
 * Optionally renders a row of sticky mode toggles inside the input's right edge
 * (used by the content-search view for case-sensitive / whole-word / regex), so
 * the two search surfaces share one input rather than duplicating it.
 *
 * `multiline` swaps the `<input>` for an auto-growing `<textarea>` — VS Code's
 * search box shape, where a newline in the query means a multi-line match. It is
 * opt-in because the file-filter bar has no use for a second line.
 */

import type { KeyboardEvent, RefObject } from 'react';
import { cn } from '../../../ui/cn';

/** Tallest the multi-line query box grows before it starts scrolling. */
export const SEARCH_BAR_MAX_ROWS = 5;

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

export function SearchBar({
    value,
    onChange,
    onClear,
    inputRef,
    placeholder = 'Filter files…',
    toggles,
    testIdPrefix = 'explorer-search',
    multiline = false,
    onSubmit,
}: SearchBarProps) {
    const toggleCount = toggles?.length ?? 0;
    // Reserve room inside the input for the clear button plus each toggle so the
    // text never slides underneath them.
    const paddingRight = 28 + toggleCount * 26;

    // Enter submits; Shift+Enter falls through to the textarea's own newline.
    // preventDefault matters on the textarea only, but costs nothing on the
    // input, where Enter has no default to suppress outside a form.
    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== 'Enter' || event.shiftKey || !onSubmit) return;
        event.preventDefault();
        onSubmit();
    };

    const fieldClassName = cn(
        'w-full pl-7 pr-7 px-2 py-2.5 lg:py-1.5 text-base lg:text-sm rounded border border-[#e0e0e0] bg-white',
        'dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc]',
        'focus:outline-none focus:border-[#0078d4]',
        multiline && 'resize-none overflow-y-auto leading-5 font-mono',
    );

    return (
        <div className="relative flex items-center px-2 py-1" data-testid={`${testIdPrefix}-bar`}>
            {/* Search icon */}
            {/* The icon and the toggle strip centre themselves against a one-row
                field; once the box can grow they have to be pinned to its first
                row instead, as in VS Code. */}
            <span
                className={cn(
                    'absolute left-4 text-[#999] dark:text-[#888] pointer-events-none text-sm',
                    multiline && 'top-[15px] lg:top-[11px]',
                )}
            >
                🔍
            </span>
            {multiline ? (
                <textarea
                    ref={inputRef as React.Ref<HTMLTextAreaElement>}
                    rows={autoGrowRows(value)}
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder={placeholder}
                    style={toggleCount > 0 ? { paddingRight } : undefined}
                    className={fieldClassName}
                    data-testid={`${testIdPrefix}-input`}
                />
            ) : (
                <input
                    ref={inputRef as React.Ref<HTMLInputElement>}
                    type="text"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder={placeholder}
                    style={toggleCount > 0 ? { paddingRight } : undefined}
                    className={fieldClassName}
                    data-testid={`${testIdPrefix}-input`}
                />
            )}
            <div className={cn('absolute right-3.5 flex items-center gap-1', multiline && 'top-[13px] lg:top-[9px]')}>
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
                {toggles?.map(toggle => (
                    <button
                        key={toggle.id}
                        type="button"
                        onClick={toggle.onToggle}
                        title={toggle.title}
                        aria-label={toggle.title}
                        aria-pressed={toggle.active}
                        className={cn(
                            'px-1 py-0.5 rounded text-[11px] leading-none font-mono border cursor-pointer transition-colors',
                            toggle.active
                                ? 'bg-[#0078d4] text-white border-[#0078d4]'
                                : 'bg-transparent text-[#848484] border-transparent hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
                        )}
                        data-testid={`${testIdPrefix}-toggle-${toggle.id}`}
                    >
                        {toggle.label}
                    </button>
                ))}
            </div>
        </div>
    );
}
