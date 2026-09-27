/**
 * useAdminSaveShortcut — Ctrl/Cmd+S for the admin Settings sections.
 *
 * While `active`, the shortcut always blocks the browser's "Save page" dialog.
 * When the active section has a save target, it saves only if the section is
 * dirty and not already saving. Sections without a Save button (they persist
 * on change) pass `null` and get the dialog suppression only.
 */
import { useEffect } from 'react';

export interface AdminSaveShortcutTarget {
    dirty: boolean;
    saving: boolean;
    onSave: () => void | Promise<void>;
}

export function useAdminSaveShortcut(active: boolean, target: AdminSaveShortcutTarget | null): void {
    const dirty = target?.dirty ?? false;
    const saving = target?.saving ?? false;
    const onSave = target?.onSave;

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
            if (!onSave || !dirty || saving) return;
            void onSave();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [active, dirty, saving, onSave]);
}
