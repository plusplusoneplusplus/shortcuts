/**
 * UnifiedPanelTreeToggle — the one control that opens and closes the panel's
 * file-tree column (AC-02).
 *
 * It is a single component with two homes rather than two buttons: the toolbar
 * row hosts it while a file tab is active, and the tab strip hosts it — beside
 * the "+" — whenever that row is not rendered. Both drive the same panel-level
 * state, so there is always exactly one visible way to reach the tree and never
 * two that could disagree.
 *
 * `aria-expanded` carries the state, and the label says what the press will do,
 * so the control is legible without seeing the icon fill in.
 */

import { cn } from '../../../ui/cn';

export interface UnifiedPanelTreeToggleProps {
    /** Whether the column is currently open — the user's bit, not visibility. */
    open: boolean;
    onToggle: () => void;
    /** Which host is rendering it, for tests and for the border it needs. */
    placement: 'toolbar' | 'strip';
    className?: string;
}

export function UnifiedPanelTreeToggle({ open, onToggle, placement, className }: UnifiedPanelTreeToggleProps) {
    const label = open ? 'Hide file tree' : 'Show file tree';
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
            {/* A panel outline with its right column filled when the tree is open. */}
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
                <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.2" />
                <line x1="10" y1="2.75" x2="10" y2="13.25" />
                {open && <rect x="10" y="2.75" width="4.25" height="10.5" fill="currentColor" stroke="none" opacity="0.35" />}
            </svg>
        </button>
    );
}
