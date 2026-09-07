import { useCallback, useRef, useState } from 'react';
import { getEditTurnRewindErrorMessage } from '../utils/editTurnErrors';
import type { InlineTurnEditorSubmission } from '../conversation/InlineTurnEditor';
import type { ChatAttachment } from '../../../types/attachments';

/** Minimal client surface the hook needs (a subset of the SPA coc client). */
export interface EditTurnCapableClient {
    processes: {
        rewindTurn: (processId: string, turnIndex: number) => Promise<unknown>;
    };
}

export interface UseEditTurnOptions {
    client: EditTurnCapableClient;
    processId: string | null;
    /** Re-fetch the conversation after the server hard-deleted the truncated turns. */
    refreshConversation: (processId: string) => Promise<void> | void;
    /**
     * Send the edited message as a normal follow-up. Resolves once the send has
     * settled — successfully or not; failures are reported by `didSendFail`,
     * because the underlying `sendFollowUp` surfaces its own error and never
     * rejects.
     */
    sendEdited: (text: string, attachments: ChatAttachment[]) => Promise<void>;
    /** True when the send that just settled failed. */
    didSendFail: () => boolean;
    /** Park text + attachments in the main composer so a failed send loses nothing. */
    restoreComposer: (content: string, attachments: ChatAttachment[]) => void;
    /** Surface a post-rewind send failure (typically an error toast). */
    onError: (message: string) => void;
}

export interface UseEditTurnResult {
    /** turnIndex of the turn being edited in place, or null when no editor is open. */
    editingTurnIndex: number | null;
    /** True between "Save & Send" and the end of the rewind+send round trip. */
    pending: boolean;
    /** Inline error shown under the editor (a rejected rewind), or null. */
    error: string | null;
    /** Open the inline editor on a user turn, closing any other open editor. */
    startEdit: (turnIndex: number) => void;
    /** Discard the edit. Inert — no rewind has run at this point. */
    cancelEdit: () => void;
    /** Commit the edit: rewind to this turn, then send the edited content. */
    submitEdit: (turnIndex: number, submission: InlineTurnEditorSubmission) => Promise<void>;
}

/**
 * Orchestrates "Edit message": one turn is editable in place at a time, and
 * saving means *rewind, then send* as a single user action.
 *
 * The two steps split the failure handling. Before the rewind lands nothing has
 * changed, so a rejection just keeps the editor open with the draft intact and
 * sends nothing. After it lands the old turns are gone, so the edit has to end
 * up somewhere even when the send fails — it is parked in the main composer,
 * exactly as a plain rewind would have left it.
 *
 * The rewind's `restored` payload is ignored: the editor already holds the
 * user's version of that message.
 */
export function useEditTurn({
    client,
    processId,
    refreshConversation,
    sendEdited,
    didSendFail,
    restoreComposer,
    onError,
}: UseEditTurnOptions): UseEditTurnResult {
    const [editingTurnIndex, setEditingTurnIndex] = useState<number | null>(null);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Synchronous in-flight latch: `pending` only disables the editor on the
    // next render, which a double-click would slip past.
    const inFlightRef = useRef(false);

    const startEdit = useCallback((turnIndex: number) => {
        if (inFlightRef.current) return;
        setEditingTurnIndex(turnIndex);
        setError(null);
    }, []);

    const cancelEdit = useCallback(() => {
        if (inFlightRef.current) return;
        setEditingTurnIndex(null);
        setError(null);
    }, []);

    const submitEdit = useCallback(async (turnIndex: number, submission: InlineTurnEditorSubmission) => {
        if (!processId || inFlightRef.current) return;
        inFlightRef.current = true;
        setPending(true);
        setError(null);

        try {
            await client.processes.rewindTurn(processId, turnIndex);
        } catch (err) {
            setError(getEditTurnRewindErrorMessage(err));
            inFlightRef.current = false;
            setPending(false);
            return;
        }

        // Drop the truncated turns before sending, so the optimistic user turn
        // lands at the position the edited one occupied. A refresh failure must
        // not block the send.
        try {
            await refreshConversation(processId);
        } catch {
            // ignore — the send runs its own refresh afterwards
        }

        try {
            await sendEdited(submission.text, submission.attachments);
        } finally {
            setEditingTurnIndex(null);
            setPending(false);
            inFlightRef.current = false;
        }

        if (didSendFail()) {
            restoreComposer(submission.text, submission.attachments);
            onError('Message edited but not sent — restored into the composer.');
        }
    }, [client, processId, refreshConversation, sendEdited, didSendFail, restoreComposer, onError]);

    return { editingTurnIndex, pending, error, startEdit, cancelEdit, submitEdit };
}
