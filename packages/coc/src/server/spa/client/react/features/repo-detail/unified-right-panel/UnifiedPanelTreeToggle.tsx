/**
 * UnifiedPanelTreeToggle — opens and closes the panel's navigator column.
 *
 * The control has two possible homes: the file toolbar while it exists, and
 * the tab strip beside "+" for every other active view. Both placements drive
 * the same panel-scoped state, so the Search/Explorer navigator is always one
 * click away without duplicating controls.
 */

import { cn } from '../../../ui/cn';

export interface UnifiedPanelTreeToggleProps {
    /** Whether the navigator column is open before the narrow-panel width gate. */
    open: boolean;
    onToggle: () => void;
    /** Which host renders the control, used for its border and dimensions. */
    placement: 'toolbar' | 'strip';
    className?: string;
}

export function UnifiedPanelTreeToggle({ open, onToggle, placement, className }: UnifiedPanelTreeToggleProps) {
    const label = open ? 'Hide navigator' : 'Show navigator';
    return (
        <button
            type="button"
            aria-label={label}
            aria-expanded={open}
            title={label}
            data-testid="unified-panel-tree-toggle"
            data-placement={placement}
            data-open={open ? 'true' : 'false'}
            onClick={onToggle}
            className={cn(
                'flex flex-shrink-0 cursor-pointer items-center justify-center border-none bg-transparent p-0',
                'text-[#616161] hover:text-[#1f1f1f] focus-visible:outline-none focus-visible:ring-1',
                'focus-visible:ring-inset focus-visible:ring-[#0078d4] dark:text-[#9d9d9d] dark:hover:text-white',
                'dark:focus-visible:ring-[#3794ff]',
                placement === 'strip'
                    ? 'h-[35px] w-8 border-l border-[#e5e5e5] dark:border-[#333]'
                    : 'h-5 w-5',
                open && 'text-[#0078d4] dark:text-[#3794ff]',
                className,
            )}
        >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
                <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.2" />
                <line x1="10" y1="2.75" x2="10" y2="13.25" />
                {open && <rect x="10" y="2.75" width="4.25" height="10.5" fill="currentColor" stroke="none" opacity="0.35" />}
            </svg>
        </button>
    );
}
