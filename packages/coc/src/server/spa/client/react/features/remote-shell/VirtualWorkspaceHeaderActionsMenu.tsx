/**
 * VirtualWorkspaceHeaderActionsMenu — the mobile `⋯` collapse of the virtual
 * workspace header actions (Sync Work IQ / Generate Summary).
 *
 * At 375px the two labelled action buttons plus the sub-tab strip cannot share
 * one row, so on mobile `VirtualWorkspaceInlineHeader` swaps them for this
 * single trigger. The menu rows carry the same `data-testid`s as the desktop
 * buttons, so anything that drives an action by test id works at either size.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../ui';
import type { VirtualWorkspaceHeaderAction } from './virtualWorkspaceHeader';

export interface VirtualWorkspaceHeaderActionsMenuProps {
    actions: VirtualWorkspaceHeaderAction[];
    /** Test-id prefix of the owning header (e.g. `my-work`). */
    prefix: string;
    isActionRunning: (key: string) => boolean;
    runAction: (action: VirtualWorkspaceHeaderAction) => void;
}

export function VirtualWorkspaceHeaderActionsMenu({
    actions,
    prefix,
    isActionRunning,
    runAction,
}: VirtualWorkspaceHeaderActionsMenuProps) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    // Close on outside click / Escape. Mirrors ChatHeaderOverflowMenu, minus the
    // portal — this menu anchors to a header row that is never clipped.
    useEffect(() => {
        if (!open) return;
        const onPointer = (e: MouseEvent | TouchEvent) => {
            const target = e.target as Node | null;
            if (target && rootRef.current?.contains(target)) return;
            setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onPointer);
        document.addEventListener('touchstart', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onPointer);
            document.removeEventListener('touchstart', onPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const handleRun = useCallback((action: VirtualWorkspaceHeaderAction) => {
        setOpen(false);
        runAction(action);
    }, [runAction]);

    if (actions.length === 0) return null;

    return (
        <div className="relative flex-shrink-0" ref={rootRef}>
            <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="More actions"
                title="More actions"
                data-testid={`${prefix}-actions-overflow-btn`}
                onClick={() => setOpen(o => !o)}
                className="touch-target inline-flex items-center justify-center px-2 py-1 rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#3c3c3c] hover:bg-[#e8e8e8] dark:hover:bg-[#4a4a4a] text-[#333] dark:text-[#ccc] transition-colors"
            >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <circle cx="3" cy="8" r="1.5" fill="currentColor" />
                    <circle cx="8" cy="8" r="1.5" fill="currentColor" />
                    <circle cx="13" cy="8" r="1.5" fill="currentColor" />
                </svg>
            </button>

            {open && (
                <div
                    role="menu"
                    data-testid={`${prefix}-actions-overflow-menu`}
                    className={cn(
                        'absolute right-0 top-full mt-1 z-[10003] min-w-[200px] rounded-md py-1',
                        'border border-[#e0e0e0] dark:border-[#3c3c3c]',
                        'bg-white dark:bg-[#252526] shadow-lg',
                    )}
                >
                    {actions.map(action => {
                        const running = isActionRunning(action.key);
                        return (
                            <button
                                key={action.key}
                                type="button"
                                role="menuitem"
                                data-testid={action.testId}
                                title={action.title}
                                disabled={running}
                                onClick={() => handleRun(action)}
                                className="w-full min-h-[44px] flex items-center px-3 py-2 text-left text-sm text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {running ? action.busyLabel : action.idleLabel}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
