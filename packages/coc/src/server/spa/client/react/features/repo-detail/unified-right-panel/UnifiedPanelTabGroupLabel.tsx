import type { KeyboardEvent, PointerEvent } from 'react';
import { cn } from '../../../ui/cn';
import type { UnifiedTabStripGroup } from './unifiedPanelTabGroups';

export const TAB_GROUP_LABELS: Record<UnifiedTabStripGroup, string> = {
    tools: 'Tools', files: 'Files', web: 'Web', canvas: 'Canvas',
};

/**
 * A group's pill. When `onPointerDown` is supplied the pill is also the
 * group's drag handle and Alt+Arrow moves the whole block (`onKeyDown`).
 */
export function UnifiedPanelTabGroupLabel({ group, count, folded, active, dragging = false, onToggle, onPointerDown, onKeyDown }: {
    group: UnifiedTabStripGroup;
    count: number;
    folded: boolean;
    active: boolean;
    dragging?: boolean;
    onToggle: () => void;
    onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void;
    onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
    return (
        <button
            type="button"
            data-strip-stop
            data-testid={`unified-panel-group-${group}`}
            aria-label={`${TAB_GROUP_LABELS[group]}, ${count} tabs`}
            aria-expanded={!folded}
            aria-keyshortcuts={onPointerDown ? 'Alt+ArrowLeft Alt+ArrowRight' : undefined}
            title={onPointerDown ? `${TAB_GROUP_LABELS[group]}: click to ${folded ? 'expand' : 'fold'}, drag or Alt+Arrow to move` : undefined}
            data-active={active || undefined}
            data-dragging={dragging || undefined}
            onClick={onToggle}
            onPointerDown={onPointerDown}
            onKeyDown={onKeyDown}
            className={cn(
                'unified-panel-group-label mx-2 flex flex-shrink-0 items-center gap-1 self-center rounded-md px-2 py-1 text-[11px]',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#0078d4]',
                dragging && 'cursor-grabbing',
            )}
        >
            <span>{TAB_GROUP_LABELS[group]}</span>
            <span aria-hidden="true" className="unified-panel-group-count">{count}</span>
        </button>
    );
}
