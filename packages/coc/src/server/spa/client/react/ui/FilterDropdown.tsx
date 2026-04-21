import { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from './cn';

export interface FilterItem {
    value: string;
    label: string;
    children?: FilterItem[];
}

export interface FilterDropdownProps {
    items: FilterItem[];
    excludedValues: Set<string>;
    onChange: (excluded: Set<string>) => void;
    label?: string;
    'data-testid'?: string;
}

export function FilterDropdown({ items, excludedValues, onChange, label = 'Filter', ...rest }: FilterDropdownProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    // Close on Escape
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open]);

    const toggle = useCallback((value: string, item?: FilterItem) => {
        const next = new Set(excludedValues);
        if (next.has(value)) {
            next.delete(value);
            // Re-enabling a parent also clears any child exclusions
            if (item?.children) {
                for (const child of item.children) next.delete(child.value);
            }
        } else {
            next.add(value);
            // Excluding a parent clears child exclusions (parent covers all children)
            if (item?.children) {
                for (const child of item.children) next.delete(child.value);
            }
        }
        onChange(next);
    }, [excludedValues, onChange]);

    const selectAll = useCallback(() => onChange(new Set()), [onChange]);

    const clearAll = useCallback(() => {
        const next = new Set<string>();
        for (const item of items) {
            next.add(item.value);
            if (item.children) {
                for (const child of item.children) next.add(child.value);
            }
        }
        onChange(next);
    }, [items, onChange]);

    const activeCount = excludedValues.size;

    return (
        <div ref={ref} className="relative" data-testid={rest['data-testid']}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className={cn(
                    'text-xs rounded px-2 py-0.5 border transition-colors flex items-center gap-1',
                    activeCount > 0
                        ? 'border-[#0078d4] dark:border-[#3794ff] text-[#0078d4] dark:text-[#3794ff] bg-[#0078d4]/10 dark:bg-[#3794ff]/10'
                        : 'border-[#e0e0e0] dark:border-[#474749] text-[#616161] dark:text-[#a0a0a0]',
                )}
                data-testid="filter-dropdown-trigger"
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <span>⚙ {label}</span>
                {activeCount > 0 && (
                    <span
                        className="rounded-full bg-[#0078d4] dark:bg-[#3794ff] text-white px-1 leading-none text-[10px]"
                        data-testid="filter-dropdown-badge"
                    >
                        {activeCount}
                    </span>
                )}
                <span>{open ? '▴' : '▾'}</span>
            </button>

            {open && (
                <div
                    className="absolute left-0 top-full mt-1 z-50 min-w-[160px] rounded border border-[#e0e0e0] dark:border-[#474749] bg-white dark:bg-[#252526] shadow-lg py-1"
                    data-testid="filter-dropdown-popover"
                >
                    {items.map(item => {
                        const parentExcluded = excludedValues.has(item.value);
                        return (
                            <div key={item.value}>
                                <label className="flex items-center gap-2 px-3 py-1 cursor-pointer hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] text-xs select-none">
                                    <input
                                        type="checkbox"
                                        checked={!parentExcluded}
                                        onChange={() => toggle(item.value, item)}
                                        className="accent-[#0078d4]"
                                        data-testid={`filter-checkbox-${item.value}`}
                                    />
                                    {item.label}
                                </label>
                                {item.children && item.children.map(child => (
                                    <label
                                        key={child.value}
                                        className={cn(
                                            'flex items-center gap-2 pl-7 pr-3 py-1 cursor-pointer hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] text-xs select-none',
                                            parentExcluded && 'opacity-50 cursor-not-allowed',
                                        )}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={!excludedValues.has(child.value) && !parentExcluded}
                                            onChange={() => !parentExcluded && toggle(child.value)}
                                            disabled={parentExcluded}
                                            className="accent-[#0078d4]"
                                            data-testid={`filter-checkbox-${child.value}`}
                                        />
                                        {child.label}
                                    </label>
                                ))}
                            </div>
                        );
                    })}
                    <div className="border-t border-[#e0e0e0] dark:border-[#474749] mt-1 pt-1 px-3 flex gap-2">
                        <button
                            type="button"
                            onClick={selectAll}
                            className="text-xs text-[#0078d4] dark:text-[#3794ff] hover:underline"
                            data-testid="filter-dropdown-select-all"
                        >
                            Select All
                        </button>
                        <button
                            type="button"
                            onClick={clearAll}
                            className="text-xs text-[#616161] dark:text-[#a0a0a0] hover:underline"
                            data-testid="filter-dropdown-clear"
                        >
                            ✕ Clear
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
