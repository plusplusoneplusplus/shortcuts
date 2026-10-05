/**
 * UnifiedPanelExpandToggle — expands the right panel over the chat and left
 * column, or restores it to its own width. Always rendered at the far right of
 * the tab strip.
 */

import { cn } from '../../../ui/cn';

export interface UnifiedPanelExpandToggleProps {
    expanded: boolean;
    onToggle: () => void;
}

export function UnifiedPanelExpandToggle({ expanded, onToggle }: UnifiedPanelExpandToggleProps) {
    const label = expanded ? 'Restore panel size' : 'Expand panel';
    return (
        <button
            type="button"
            aria-label={label}
            aria-pressed={expanded}
            title={label}
            data-testid="unified-panel-expand-toggle"
            data-expanded={expanded ? 'true' : 'false'}
            onClick={onToggle}
            className={cn(
                'flex h-[35px] w-8 flex-shrink-0 cursor-pointer items-center justify-center border-y-0 border-r-0 border-l bg-transparent p-0',
                'border-[#e5e5e5] text-[#616161] hover:text-[#1f1f1f] focus-visible:outline-none focus-visible:ring-1',
                'focus-visible:ring-inset focus-visible:ring-[#0078d4] dark:border-[#333] dark:text-[#9d9d9d] dark:hover:text-white',
                'dark:focus-visible:ring-[#3794ff]',
                expanded && 'text-[#0078d4] dark:text-[#3794ff]',
            )}
        >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {expanded ? (
                    <>
                        <path d="M2.5 6.5h4v-4" />
                        <path d="M13.5 9.5h-4v4" />
                    </>
                ) : (
                    <>
                        <path d="M9.5 2.5h4v4" />
                        <path d="M6.5 13.5h-4v-4" />
                    </>
                )}
            </svg>
        </button>
    );
}
