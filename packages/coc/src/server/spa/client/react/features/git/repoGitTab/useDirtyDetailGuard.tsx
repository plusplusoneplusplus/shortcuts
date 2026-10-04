/**
 * useDirtyDetailGuard — the Save / Don't Save / Cancel prompt for leaving a
 * Git detail view that holds unsaved edits (an edited working-tree diff).
 *
 * The detail reports its dirty state and save function through
 * `onDirtyChange` / `onRegisterSave` (the Explorer editor contract). `guard`
 * wraps a selection change: while the detail is clean it runs at once; while
 * dirty it waits for the prompt. Save runs it only after a successful write;
 * a failed write keeps the prompt (and the buffer) with the error.
 */

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ExplorerCloseTabsDialog } from '../../repo-detail/explorer/ExplorerCloseTabsDialog';

const SAVE_FAILED = 'Could not save the file. Your changes are still in the editor.';

export interface DirtyDetailGuard {
    onDirtyChange: (isDirty: boolean) => void;
    onRegisterSave: (save: (() => Promise<boolean>) | null) => void;
    /** Wrap a selection change so it asks first while the detail is dirty. */
    guard: <A extends unknown[]>(fn: (...args: A) => unknown) => (...args: A) => void;
    /** The prompt; render it once beside the detail. */
    dialog: ReactNode;
}

export function useDirtyDetailGuard(label: string | null): DirtyDetailGuard {
    const dirtyRef = useRef(false);
    const saveRef = useRef<(() => Promise<boolean>) | null>(null);
    const [pending, setPending] = useState<(() => void) | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const onDirtyChange = useCallback((isDirty: boolean) => { dirtyRef.current = isDirty; }, []);
    const onRegisterSave = useCallback((save: (() => Promise<boolean>) | null) => { saveRef.current = save; }, []);

    const guard = useCallback(<A extends unknown[]>(fn: (...args: A) => unknown) => (...args: A) => {
        if (!dirtyRef.current) {
            void fn(...args);
            return;
        }
        setError(null);
        setPending(() => () => { void fn(...args); });
    }, []);

    const cancel = useCallback(() => {
        setPending(null);
        setError(null);
    }, []);
    const discard = useCallback(() => {
        const run = pending;
        setPending(null);
        setError(null);
        // The detail unmounts with the change, taking the buffer with it.
        dirtyRef.current = false;
        run?.();
    }, [pending]);
    const save = useCallback(() => {
        const run = pending;
        if (!run || saving) return;
        const write = saveRef.current;
        setSaving(true);
        setError(null);
        void Promise.resolve(write ? write() : false)
            .catch(() => false)
            .then(saved => {
                setSaving(false);
                if (!saved) {
                    setError(SAVE_FAILED);
                    return;
                }
                setPending(null);
                dirtyRef.current = false;
                run();
            });
    }, [pending, saving]);

    const dialog = (
        <ExplorerCloseTabsDialog
            open={pending !== null}
            paths={label ? [label] : []}
            saving={saving}
            error={error}
            onSave={save}
            onDontSave={discard}
            onCancel={cancel}
        />
    );

    return { onDirtyChange, onRegisterSave, guard, dialog };
}
