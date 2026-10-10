/**
 * useAdminSaveShortcut — Ctrl/Cmd+S for the admin configuration pages.
 *
 * While `active`, the shortcut always blocks the browser's "Save page" dialog.
 * A page passes one save target per draft card it shows (e.g. a section card
 * plus its registry feature card); the shortcut saves each target that is
 * dirty and not already saving. Pages without draft cards (they persist on
 * change or use per-item actions) pass no targets and get the dialog
 * suppression only.
 */
import { useEffect, useRef } from 'react';

export interface AdminSaveShortcutTarget {
    dirty: boolean;
    saving: boolean;
    onSave: () => void | Promise<void>;
}

export function useAdminSaveShortcut(active: boolean, targets: readonly AdminSaveShortcutTarget[]): void {
    // Targets are rebuilt every render; read the latest through a ref so the
    // listener is only re-attached when `active` flips.
    const targetsRef = useRef(targets);
    targetsRef.current = targets;

    useEffect(() => {
        if (!active) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (
                !(event.ctrlKey || event.metaKey)
                || event.altKey
                || event.shiftKey
                || event.key.toLowerCase() !== 's'
            ) {
                return;
            }

            event.preventDefault();
            for (const target of targetsRef.current) {
                if (target.dirty && !target.saving) void target.onSave();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [active]);
}
