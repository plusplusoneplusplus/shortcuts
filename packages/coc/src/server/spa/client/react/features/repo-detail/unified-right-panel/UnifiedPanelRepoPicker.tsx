/**
 * UnifiedPanelRepoPicker — the unified right panel's repo scope, shown on the
 * tab strip beside the "+" instead of hidden inside its popover.
 *
 * The panel's target is what "New Terminal", "Explorer" and file search act on,
 * so it has to be readable without opening a menu and switchable in one click.
 * Two things the component insists on:
 *
 *  - **One repo means no control.** A single-target panel renders nothing, and
 *    that check lives here so neither the strip nor the panel repeats it.
 *  - **The label is never a lie.** It is derived from the `target` prop, so a
 *    switch the dock refuses (`onSelectTarget` returning `false` — the discard
 *    prompt on unsaved Explorer edits) leaves the trigger reading the repo the
 *    panel is still pointing at, with the list still open to try again.
 *
 * At the panel's minimum width the label collapses away and the trigger is a
 * chevron with the repo name on `aria-label`/`title`, so the chrome row still
 * fits "+" and the navigator toggles. That is a container query against the
 * strip, not a resize observer: the panel's width, not the viewport's, is what
 * decides.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../../ui/cn';
import type { DockTarget } from '../WorkspaceDockToggle';

export interface UnifiedPanelRepoPickerProps {
    /** The repo new resources and file search act on. */
    target: string;
    /** Repo options for a group; one or none renders nothing. */
    targets: readonly DockTarget[];
    /** Point the dock at another repo; `false` means the switch was refused. */
    onSelectTarget: (workspaceId: string) => boolean;
}

/** The label for a target, matching how the option list renders it. */
function optionLabel(option: DockTarget): string {
    return option.disabled === true ? `${option.label} (unavailable)` : option.label;
}

export function UnifiedPanelRepoPicker({
    target,
    targets,
    onSelectTarget,
}: UnifiedPanelRepoPickerProps) {
    const [open, setOpen] = useState(false);
    const [cursor, setCursor] = useState(0);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);

    const selectable = targets.filter(option => option.disabled !== true);

    const close = useCallback((restoreFocus: boolean) => {
        setOpen(false);
        if (restoreFocus) triggerRef.current?.focus?.();
    }, []);

    // Seat the cursor on the current repo each time the list opens: that is the
    // row Enter should re-confirm, and the one arrows should move away from.
    useEffect(() => {
        if (!open) return;
        const index = selectable.findIndex(option => option.workspaceId === target);
        setCursor(index === -1 ? 0 : index);
        // Only the open/target pair re-seats the cursor; `selectable` is rebuilt
        // on every render by the caller's mapped target list.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, target]);

    useEffect(() => {
        if (!open) return;
        const onMouseDown = (event: MouseEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onMouseDown);
        return () => document.removeEventListener('mousedown', onMouseDown);
    }, [open]);

    const select = useCallback((option: DockTarget) => {
        if (option.disabled === true) return;
        // A refused switch keeps the list open: the user still has to choose,
        // and the label below still reports where the panel actually points.
        if (onSelectTarget(option.workspaceId)) close(true);
    }, [onSelectTarget, close]);

    const current = targets.find(option => option.workspaceId === target);
    if (targets.length <= 1) return null;

    const label = current?.label ?? 'Repository';

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close(true);
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) {
                setOpen(true);
                return;
            }
            if (selectable.length === 0) return;
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setCursor(prev => (prev + step + selectable.length) % selectable.length);
        } else if (open && event.key === 'Enter') {
            event.preventDefault();
            const option = selectable[cursor];
            if (option) select(option);
        }
    };

    return (
        <div ref={rootRef} className="relative flex flex-shrink-0 items-stretch" onKeyDown={onKeyDown}>
            <button
                ref={triggerRef}
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={`Repository: ${label}. New resources open here.`}
                title={`New resources open in ${label}`}
                data-testid="unified-panel-repo-picker"
                data-target={target}
                onClick={() => setOpen(prev => !prev)}
                className={cn(
                    'flex h-[35px] flex-shrink-0 items-center gap-1 border-l border-[#e5e5e5] px-1.5 dark:border-[#333]',
                    'cursor-pointer border-y-0 border-r-0 bg-transparent text-[11px] leading-none text-[#616161]',
                    'hover:text-[#1f1f1f] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset',
                    'focus-visible:ring-[#0078d4] dark:text-[#9d9d9d] dark:hover:text-white dark:focus-visible:ring-[#3794ff]',
                )}
            >
                <span
                    className="max-w-[88px] truncate [@container_unified-panel-strip_(max-width:339px)]:hidden"
                    data-testid="unified-panel-repo-picker-label"
                >
                    {label}
                </span>
                <span aria-hidden="true" className="text-[8px] leading-none opacity-70">▾</span>
            </button>

            {open && (
                <div
                    role="listbox"
                    aria-label="Repository"
                    data-testid="unified-panel-repo-picker-list"
                    className={cn(
                        'absolute left-0 top-[35px] z-30 flex max-h-[300px] w-[220px] max-w-[70vw] flex-col overflow-y-auto',
                        'rounded border border-[#c8c8c8] bg-white py-1 text-xs shadow-lg dark:border-[#3c3c3c] dark:bg-[#252526]',
                    )}
                >
                    {targets.map(option => {
                        const isCurrent = option.workspaceId === target;
                        const disabled = option.disabled === true;
                        const atCursor = !disabled && selectable[cursor]?.workspaceId === option.workspaceId;
                        return (
                            <button
                                key={option.workspaceId}
                                type="button"
                                role="option"
                                aria-selected={isCurrent}
                                aria-disabled={disabled}
                                disabled={disabled}
                                title={optionLabel(option)}
                                data-testid={`unified-panel-repo-picker-option-${option.workspaceId}`}
                                onClick={() => select(option)}
                                className={cn(
                                    'flex w-full items-center gap-1.5 border-none bg-transparent px-2 py-1 text-left',
                                    disabled
                                        ? 'cursor-default text-[#a0a0a0] dark:text-[#666]'
                                        : 'cursor-pointer text-[#1f1f1f] hover:bg-[#f0f0f0] dark:text-[#cccccc] dark:hover:bg-[#37373d]',
                                    atCursor && !disabled && 'bg-[#0078d4]/10 dark:bg-[#0078d4]/25',
                                )}
                            >
                                <span aria-hidden="true" className="w-3 flex-shrink-0 text-center">
                                    {isCurrent ? '✓' : ''}
                                </span>
                                <span className="min-w-0 flex-1 truncate">{optionLabel(option)}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
