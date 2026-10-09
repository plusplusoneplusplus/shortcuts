/**
 * useConversationPin — pin state and toggle for the chat header's
 * "Pin conversation" action.
 *
 * State starts from the persisted `pinnedAt` on the process and follows the
 * chat list's pin state (`ChatPreferencesContext`) whenever the list pins or
 * unpins this chat. Mutations go through the list's own `setChatPinned` when a
 * provider is present (so the Pinned section updates at once) and otherwise
 * through the same clone-routed `pinArchiveApi` helper, using the chat's owning
 * workspace so remote clones and repo groups land on their own server.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOptionalChatPrefs } from '../../../contexts/chatPrefsConsumer';
import { pinProcess, unpinProcess } from '../../../queue/hooks/pinArchiveApi';

export interface UseConversationPinOptions {
    /** Process id of the conversation (the id the pin endpoint and list rows use). */
    processId: string | null | undefined;
    /** Owning workspace / clone key used when no chat-list provider is mounted. */
    workspaceId?: string;
    /** Persisted pin state from the process record; `undefined` while unknown. */
    persistedPinned: boolean | undefined;
    /** Called when the owning server rejects the change (state is already rolled back). */
    onError?: (error: unknown, pinned: boolean) => void;
}

export interface UseConversationPinResult {
    /** False until the pin state is known (no process yet). */
    available: boolean;
    isPinned: boolean;
    pending: boolean;
    togglePin: () => void;
}

export function useConversationPin({ processId, workspaceId, persistedPinned, onError }: UseConversationPinOptions): UseConversationPinResult {
    const prefs = useOptionalChatPrefs();
    const id = processId ?? '';
    const listPinned = prefs?.loaded && id ? prefs.pinnedChatIds.has(id) : undefined;

    // Local value set by our own toggle or by a list-side change, scoped to the id.
    const [override, setOverride] = useState<{ id: string; pinned: boolean } | null>(null);
    const [pendingId, setPendingId] = useState<string | null>(null);

    // Follow list-side pin changes for the same conversation. Switching
    // conversations or the list's first load (a page that may not include this
    // chat) is not a pin change.
    const lastListRef = useRef<{ id: string; pinned: boolean | undefined }>({ id, pinned: listPinned });
    useEffect(() => {
        const last = lastListRef.current;
        lastListRef.current = { id, pinned: listPinned };
        if (last.id !== id || last.pinned === undefined || listPinned === undefined || last.pinned === listPinned) return;
        setOverride({ id, pinned: listPinned });
    }, [id, listPinned]);

    const isPinned = override?.id === id
        ? override.pinned
        : Boolean(listPinned) || Boolean(persistedPinned);

    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;

    const togglePin = useCallback(() => {
        if (!id || pendingId === id) return;
        const next = !isPinned;
        setOverride({ id, pinned: next });
        setPendingId(id);
        const request = prefs
            ? prefs.setChatPinned(id, next)
            : (next ? pinProcess : unpinProcess)(id, workspaceId);
        request
            .catch((err: unknown) => {
                setOverride({ id, pinned: !next });
                onErrorRef.current?.(err, next);
            })
            .finally(() => setPendingId(current => (current === id ? null : current)));
    }, [id, isPinned, pendingId, prefs, workspaceId]);

    return {
        available: Boolean(id) && (persistedPinned !== undefined || listPinned !== undefined),
        isPinned,
        pending: pendingId === id,
        togglePin,
    };
}
