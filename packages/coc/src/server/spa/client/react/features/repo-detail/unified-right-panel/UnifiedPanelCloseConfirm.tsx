/**
 * UnifiedPanelCloseConfirm — the "this close destroys something" prompt (AC-05).
 *
 * Today its only caller is the terminal tab: everything else in the panel
 * detaches when it closes, while a terminal tab's ✕ would end live PTYs. The
 * component is deliberately kind-agnostic (message + confirm label are props) so
 * the dirty file/note/canvas guards can reuse it rather than growing a second
 * dialog.
 *
 * Two behaviors matter more than the chrome:
 *
 *  - **Cancel is the default.** Escape and the backdrop both cancel, focus lands
 *    on Cancel, and nothing has happened to the tab or the process until
 *    Confirm is pressed.
 *  - **A failed confirm keeps the dialog.** The error renders in place and
 *    Confirm becomes the retry, because dismissing on failure would leave the
 *    user believing a session ended when it did not.
 */

import { useEffect, useRef } from 'react';
import { cn } from '../../../ui/cn';

export interface UnifiedPanelCloseConfirmProps {
    /** What closing would destroy, in one sentence. */
    message: string;
    /** The destructive action's label, e.g. "Terminate". */
    confirmLabel: string;
    /** Failure text from the last confirm attempt, if any. */
    error?: string | null;
    /** True while the confirm action is in flight. */
    busy?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

export function UnifiedPanelCloseConfirm({
    message, confirmLabel, error = null, busy = false, onCancel, onConfirm,
}: UnifiedPanelCloseConfirmProps) {
    const cancelRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        cancelRef.current?.focus?.();
    }, []);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                onCancel();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [onCancel]);

    return (
        <div
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 p-3"
            onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}
            data-testid="unified-panel-close-confirm-backdrop"
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Confirm close"
                className={cn(
                    'w-full max-w-[280px] rounded border border-[#c8c8c8] bg-white p-3 shadow-lg',
                    'dark:border-[#3c3c3c] dark:bg-[#252526]',
                )}
                data-testid="unified-panel-close-confirm"
            >
                <p
                    className="text-xs text-[#1f1f1f] dark:text-[#cccccc]"
                    data-testid="unified-panel-close-confirm-message"
                >
                    {message}
                </p>
                {error !== null && (
                    <p
                        className="mt-2 text-xs text-[#a1260d] dark:text-[#f48771]"
                        role="alert"
                        data-testid="unified-panel-close-confirm-error"
                    >
                        {error}
                    </p>
                )}
                <div className="mt-3 flex justify-end gap-2">
                    <button
                        ref={cancelRef}
                        type="button"
                        onClick={onCancel}
                        data-testid="unified-panel-close-confirm-cancel"
                        className={cn(
                            'rounded border border-[#c8c8c8] px-2.5 py-1 text-xs text-[#1f1f1f] hover:bg-[#e8e8e8]',
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007acc]/40',
                            'dark:border-[#3c3c3c] dark:text-[#cccccc] dark:hover:bg-[#37373d]',
                        )}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={busy}
                        data-testid="unified-panel-close-confirm-confirm"
                        className={cn(
                            'rounded bg-[#a1260d] px-2.5 py-1 text-xs text-white hover:bg-[#8b2109]',
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007acc]/40',
                            'disabled:cursor-not-allowed disabled:opacity-60',
                        )}
                    >
                        {busy ? 'Working…' : error !== null ? 'Retry' : confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
