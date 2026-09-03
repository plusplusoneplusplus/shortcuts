/**
 * ReplaceRow — the Search view's replace surface (goal §2.2), shaped like VS
 * Code's: a chevron column on the left spanning both rows, the query box on the
 * top row, and the replace field revealed underneath it.
 *
 * It takes the query row as `children` rather than sitting beside it, because
 * the chevron is one control for *both* rows — pinning it next to the query box
 * and rendering the replace field somewhere else would need the two to agree on
 * an indent they cannot see.
 *
 * Purely presentational: the panel owns the state and does the writing.
 */

import type { ReactNode } from 'react';
import { cn } from '../../../ui/cn';
import type { ContentSearchReplaceState } from './types';

export interface ReplaceRowProps {
    /** The query row — rendered on the top line, beside the chevron. */
    children: ReactNode;
    replace: ContentSearchReplaceState;
    onChange: (next: ContentSearchReplaceState) => void;
    expanded: boolean;
    onToggleExpanded: () => void;
    /**
     * Set when replacing is impossible for the current query — a multi-line
     * query, which the endpoint rejects outright. The field stays visible but
     * inert, with this as the explanation, so the reason is never a mystery.
     */
    disabledReason?: string;
    /** Prefix for every `data-testid`, matching the SearchBar's convention. */
    testIdPrefix?: string;
}

const FIELD_CLASS = cn(
    'w-full pl-2 pr-7 py-2.5 lg:py-1.5 text-base lg:text-sm rounded border border-[#e0e0e0] bg-white',
    'dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc]',
    'focus:outline-none focus:border-[#0078d4]',
    'disabled:opacity-60 disabled:cursor-not-allowed',
);

export function ReplaceRow({
    children,
    replace,
    onChange,
    expanded,
    onToggleExpanded,
    disabledReason,
    testIdPrefix = 'content-search',
}: ReplaceRowProps) {
    const disabled = disabledReason !== undefined;

    return (
        <div className="flex items-start" data-testid={`${testIdPrefix}-replace-row`}>
            <button
                type="button"
                onClick={onToggleExpanded}
                title={expanded ? 'Hide Replace' : 'Toggle Replace'}
                aria-label="Toggle Replace"
                aria-expanded={expanded}
                className={cn(
                    'shrink-0 pl-2 pr-0.5 py-2.5 lg:py-1.5 mt-1 leading-none text-[10px]',
                    'bg-transparent border-none cursor-pointer text-[#848484]',
                    'hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
                )}
                data-testid={`${testIdPrefix}-replace-toggle`}
            >
                {expanded ? '▾' : '▸'}
            </button>
            <div className="flex-1 min-w-0">
                {children}
                {expanded && (
                    <div className="px-2 pb-1" data-testid={`${testIdPrefix}-replace-fields`}>
                        <div className="relative flex items-center">
                            <input
                                type="text"
                                value={replace.replacement}
                                onChange={e => onChange({ ...replace, replacement: e.target.value })}
                                placeholder="Replace"
                                aria-label="Replace"
                                disabled={disabled}
                                className={FIELD_CLASS}
                                data-testid={`${testIdPrefix}-replace-input`}
                            />
                            <button
                                type="button"
                                onClick={() => onChange({ ...replace, preserveCase: !replace.preserveCase })}
                                title="Preserve Case"
                                aria-label="Preserve Case"
                                aria-pressed={replace.preserveCase}
                                disabled={disabled}
                                className={cn(
                                    'absolute right-1 px-1 py-0.5 rounded text-[11px] leading-none font-mono border cursor-pointer transition-colors',
                                    'disabled:opacity-60 disabled:cursor-not-allowed',
                                    replace.preserveCase
                                        ? 'bg-[#0078d4] text-white border-[#0078d4]'
                                        : 'bg-transparent text-[#848484] border-transparent hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
                                )}
                                data-testid={`${testIdPrefix}-preserve-case`}
                            >
                                AB
                            </button>
                        </div>
                        {disabledReason && (
                            <p
                                className="mt-0.5 text-[11px] text-[#848484]"
                                data-testid={`${testIdPrefix}-replace-disabled`}
                            >
                                {disabledReason}
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
