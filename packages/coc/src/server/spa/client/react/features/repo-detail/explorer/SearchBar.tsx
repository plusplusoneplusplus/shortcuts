/**
 * SearchBar — controlled search input with leading search icon and trailing clear button.
 * Styling matches ProcessFilters / TasksPanel search input patterns.
 *
 * Optionally renders a row of sticky mode toggles inside the input's right edge
 * (used by the content-search view for case-sensitive / whole-word / regex), so
 * the two search surfaces share one input rather than duplicating it.
 */

import type { RefObject } from 'react';
import { cn } from '../../../ui/cn';

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
    inputRef?: RefObject<HTMLInputElement>;
    placeholder?: string;
    /** Mode toggles pinned inside the right edge of the input. */
    toggles?: SearchBarToggle[];
    /**
     * Prefix for every `data-testid` this renders — `<prefix>-bar`, `-input`,
     * `-clear`, `-toggle-<id>`. The default reproduces the file-filter bar's
     * long-standing ids; the content-search view passes `content-search`.
     */
    testIdPrefix?: string;
}

export function SearchBar({
    value,
    onChange,
    onClear,
    inputRef,
    placeholder = 'Filter files…',
    toggles,
    testIdPrefix = 'explorer-search',
}: SearchBarProps) {
    const toggleCount = toggles?.length ?? 0;
    // Reserve room inside the input for the clear button plus each toggle so the
    // text never slides underneath them.
    const paddingRight = 28 + toggleCount * 26;

    return (
        <div className="relative flex items-center px-2 py-1" data-testid={`${testIdPrefix}-bar`}>
            {/* Search icon */}
            <span className="absolute left-4 text-[#999] dark:text-[#888] pointer-events-none text-sm">🔍</span>
            <input
                ref={inputRef as React.Ref<HTMLInputElement>}
                type="text"
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder}
                style={toggleCount > 0 ? { paddingRight } : undefined}
                className={cn(
                    'w-full pl-7 pr-7 px-2 py-2.5 lg:py-1.5 text-base lg:text-sm rounded border border-[#e0e0e0] bg-white',
                    'dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc]',
                    'focus:outline-none focus:border-[#0078d4]',
                )}
                data-testid={`${testIdPrefix}-input`}
            />
            <div className="absolute right-3.5 flex items-center gap-1">
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
