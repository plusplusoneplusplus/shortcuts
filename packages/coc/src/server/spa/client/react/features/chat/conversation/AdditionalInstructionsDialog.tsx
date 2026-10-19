import { useCallback, useEffect, useState, type RefObject } from 'react';
import { SENTINEL_ADDITIONAL_INSTRUCTIONS_MAX_CHARS, type CocClient } from '@plusplusoneplusplus/coc-client';
import { Dialog } from '../../../ui/Dialog';
import { Button } from '../../../ui/Button';

/** The Sentinel chat whose instructions are edited, addressed on its exact owner. */
export interface AdditionalInstructionsTarget {
    /** The conversation's exact owner client; edits never fall back to another server. */
    client: Pick<CocClient, 'processes'>;
    workspaceId: string;
    processId: string;
}

export interface AdditionalInstructionsDialogProps extends AdditionalInstructionsTarget {
    open: boolean;
    onClose: () => void;
    returnFocusRef?: RefObject<HTMLElement | null>;
}

export const ADDITIONAL_INSTRUCTIONS_TIMING_COPY = 'Applies when initial context is built or after the next compression.';

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };

function errorMessage(error: unknown, fallback: string): string {
    const message = error instanceof Error ? error.message.trim() : '';
    return message ? `${fallback} ${message}` : fallback;
}

/**
 * Editor for one Sentinel chat's saved additional instructions. The draft is
 * loaded fresh from the owning server on every open; Cancel or dismiss drops
 * it, and a failed save keeps it so nothing typed is lost.
 */
export function AdditionalInstructionsDialog({ open, onClose, client, workspaceId, processId, returnFocusRef }: AdditionalInstructionsDialogProps) {
    const [load, setLoad] = useState<LoadState>({ status: 'loading' });
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoad({ status: 'loading' });
        setDraft('');
        setSaveError(null);
        setSaving(false);
        client.processes.getAdditionalInstructions(processId, { workspace: workspaceId })
            .then(response => {
                if (cancelled) return;
                setDraft(response.additionalInstructions?.text ?? '');
                setLoad({ status: 'ready' });
            })
            .catch(error => {
                if (!cancelled) setLoad({ status: 'error', message: errorMessage(error, 'Could not load additional instructions.') });
            });
        return () => { cancelled = true; };
    }, [open, client, workspaceId, processId, attempt]);

    const handleSave = useCallback(async () => {
        if (load.status !== 'ready' || saving) return;
        setSaving(true);
        setSaveError(null);
        try {
            await client.processes.updateAdditionalInstructions(processId, draft, { workspace: workspaceId });
            setSaving(false);
            onClose();
        } catch (error) {
            setSaving(false);
            setSaveError(errorMessage(error, 'Could not save additional instructions.'));
        }
    }, [load.status, saving, client, processId, draft, workspaceId, onClose]);

    const tooLong = draft.length > SENTINEL_ADDITIONAL_INSTRUCTIONS_MAX_CHARS;

    return (
        <Dialog
            id="additional-instructions-dialog"
            open={open}
            onClose={onClose}
            title="Additional instructions"
            className="max-w-[640px]"
            trapFocus
            returnFocusRef={returnFocusRef}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button onClick={() => { void handleSave(); }} disabled={load.status !== 'ready' || saving || tooLong}>
                        {saving ? 'Saving…' : 'Save'}
                    </Button>
                </>
            }
        >
            <div className="space-y-2">
                <label htmlFor="additional-instructions-text" className="block text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                    Additional instructions
                </label>
                <p className="text-xs text-[#848484]">{ADDITIONAL_INSTRUCTIONS_TIMING_COPY}</p>
                {load.status === 'error' ? (
                    <div className="space-y-2">
                        <p role="alert" className="text-xs text-[#f14c4c]">{load.message}</p>
                        <Button variant="secondary" size="sm" onClick={() => setAttempt(value => value + 1)}>Retry</Button>
                    </div>
                ) : (
                    <>
                        <textarea
                            id="additional-instructions-text"
                            data-dialog-initial-focus
                            value={draft}
                            disabled={load.status === 'loading' || saving}
                            placeholder={load.status === 'loading' ? 'Loading…' : 'Plain-text instructions for this Sentinel chat'}
                            onChange={event => { setDraft(event.target.value); setSaveError(null); }}
                            onKeyDown={event => {
                                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                                    event.preventDefault();
                                    void handleSave();
                                }
                            }}
                            rows={8}
                            spellCheck={false}
                            className="w-full min-h-[160px] max-h-[50vh] resize-y px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[var(--vscode-foreground,#1e1e1e)] outline-none focus:border-[#0078d4] disabled:opacity-60"
                        />
                        <div className="flex items-start justify-between gap-2 text-xs">
                            <span role={load.status === 'loading' ? 'status' : undefined} className="text-[#848484]">
                                {load.status === 'loading' ? 'Loading additional instructions…' : 'Saving empty text clears the instructions.'}
                            </span>
                            <span className={tooLong ? 'text-[#f14c4c]' : 'text-[#848484]'}>
                                {draft.length.toLocaleString()} / {SENTINEL_ADDITIONAL_INSTRUCTIONS_MAX_CHARS.toLocaleString()}
                            </span>
                        </div>
                        {saveError && <p role="alert" className="text-xs text-[#f14c4c]">{saveError}</p>}
                    </>
                )}
            </div>
        </Dialog>
    );
}
