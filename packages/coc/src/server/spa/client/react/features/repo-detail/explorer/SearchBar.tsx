/**
 * SearchBar — controlled search input with leading search icon and trailing clear button.
 * Styling matches ProcessFilters / TasksPanel search input patterns.
 */

import type { RefObject } from 'react';
import { cn } from '../../shared/cn';

export interface SearchBarProps {
    value: string;
    onChange: (value: string) => void;
    onClear: () => void;
    inputRef?: RefObject<HTMLInputElement>;
    placeholder?: string;
}

export function SearchBar({ value, onChange, onClear, inputRef, placeholder = 'Filter files…' }: SearchBarProps) {
    return (
        <div className="relative flex items-center px-2 py-1" data-testid="explorer-search-bar">
            {/* Search icon */}
            <span className="absolute left-4 text-[#999] dark:text-[#888] pointer-events-none text-sm">🔍</span>
            <input
                ref={inputRef as React.Ref<HTMLInputElement>}
                type="text"
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder}
                className={cn(
                    'w-full pl-7 pr-7 px-2 py-2.5 lg:py-1.5 text-base lg:text-sm rounded border border-[#e0e0e0] bg-white',
                    'dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc]',
                    'focus:outline-none focus:border-[#0078d4]',
                )}
                data-testid="explorer-search-input"
            />
            {/* Clear button — visible only when value is non-empty */}
            {value && (
                <button
                    className="absolute right-3.5 text-[#999] hover:text-[#333] dark:hover:text-[#eee] text-sm leading-none bg-transparent border-none p-0 cursor-pointer"
                    onClick={onClear}
                    title="Clear search"
                    data-testid="explorer-search-clear"
                >
                    ✕
                </button>
            )}
        </div>
    );
}
