import { useCallback, useRef, useState } from 'react';
import { getSpaCocClientErrorMessage } from '../../../api/cocClient';
import { rewindImagesToAttachments } from '../utils/rewindImages';
import type { ChatAttachment } from '../../../types/attachments';

/** Minimal shape of the rewind response this hook consumes. */
interface RewindResultLike {
    restored?: { content?: string; images?: string[] };
    turnsRemoved?: number;
}

/** Minimal client surface the hook needs (a subset of the SPA coc client). */
export interface RewindCapableClient {
    processes: {
        rewindTurn: (processId: string, turnIndex: number) => Promise<RewindResultLike>;
    };
}

export interface UseRewindTurnOptions {
    client: RewindCapableClient;
    processId: string | null;
    /**
     * Restore the rewound user message's text + attachments into the composer.
     * Called only on a successful rewind.
     */
    restoreComposer: (content: string, attachments: ChatAttachment[]) => void;
    /** Re-fetch the conversation after the server hard-deleted the truncated turns. */
    refreshConversation: (processId: string) => Promise<void> | void;
    /**
     * Surface a backend rejection to the user (typically an error toast).
     * Rejections include non-copilot provider, non-idle conversation, and
     * ineligible turn (no captured anchor).
     */
    onError: (message: string) => void;
}

export interface UseRewindTurnResult {
    /** turnIndex of the user turn pending confirmation, or null when no dialog is open. */
    targetIndex: number | null;
    /** True while the destructive rewind request is in flight. */
    pending: boolean;
    /** Open the confirm dialog for a user turn. */
    requestRewind: (turnIndex: number) => void;
    /** Dismiss the confirm dialog (no-op while a request is in flight). */
    cancel: () => void;
    /** Execute the confirmed rewind. */
    confirm: () => Promise<void>;
}

/**
 * Orchestrates the "Rewind to here" action: confirm-dialog state plus the
 * destructive truncate request and its side effects.
 *
 * On confirm it calls `client.processes.rewindTurn(...)` (the backend truncates
 * the SDK session history AND hard-deletes the CoC turns at/after the target),
 * then restores the removed message's text + images into the composer and
 * re-fetches the conversation. Backend rejections are routed to `onError` and
 * leave the conversation untouched. The UI does no provider/idle filtering —
 * the backend is the single enforcement point.
 */
export function useRewindTurn({ client, processId, restoreComposer, refreshConversation, onError }: UseRewindTurnOptions): UseRewindTurnResult {
    const [targetIndex, setTargetIndex] = useState<number | null>(null);
    const [pending, setPending] = useState(false);
    // Synchronous in-flight latch — guards against a double-submit within a
    // single burst (the `pending` state update is async and would be stale).
    const inFlightRef = useRef(false);

    const requestRewind = useCallback((turnIndex: number) => {
        setTargetIndex(turnIndex);
    }, []);

    const cancel = useCallback(() => {
        if (!inFlightRef.current) setTargetIndex(null);
    }, []);

    const confirm = useCallback(async () => {
        if (targetIndex == null || !processId || inFlightRef.current) return;
        inFlightRef.current = true;
        setPending(true);
        try {
            const result = await client.processes.rewindTurn(processId, targetIndex);
            const content = result?.restored?.content ?? '';
            restoreComposer(content, rewindImagesToAttachments(result?.restored?.images));
            await refreshConversation(processId);
            setTargetIndex(null);
        } catch (err) {
            onError(getSpaCocClientErrorMessage(err, 'Failed to rewind conversation.'));
            setTargetIndex(null);
        } finally {
            inFlightRef.current = false;
            setPending(false);
        }
    }, [client, processId, targetIndex, restoreComposer, refreshConversation, onError]);

    return { targetIndex, pending, requestRewind, cancel, confirm };
}
