import { useCallback, useRef } from 'react';
import { getApiBase } from '../utils/config';
import { clearDraft } from './useDraftStore';
import { useChatPrefs } from '../context/ChatPreferencesContext';
import { CLIENT_PASTE_THRESHOLD } from './useTextPaste';
import { formatAttachedContext } from './useAttachedContext';
import type { AttachedContextItem } from './useAttachedContext';
import type { ClientConversationTurn } from '../types/dashboard';
import type { DeliveryMode } from '@plusplusoneplusplus/forge';

type SetTurnsAndRef = (next: ClientConversationTurn[] | ((prev: ClientConversationTurn[]) => ClientConversationTurn[])) => void;

export interface UseSendMessageOptions {
    processId: string | null;
    taskId: string;
    inputDisabled: boolean;
    sending: boolean;
    setSending: (v: boolean) => void;
    setError: (v: string | null) => void;
    setSessionExpired: (v: boolean) => void;
    setSuggestions: (v: string[]) => void;
    setTurnsAndRef: SetTurnsAndRef;
    removeStreamingPlaceholder: () => void;
    refreshConversation: (pid: string) => Promise<void>;
    queueDispatch: (action: any) => void;
    slashCommands: {
        parseAndExtract: (input: string) => { skills: string[]; prompt: string };
        dismissMenu: () => void;
    };
    followUpInputRef: React.MutableRefObject<string>;
    setFollowUpInput: (v: string) => void;
    selectedMode: 'ask' | 'plan' | 'autopilot';
    selectedModeRef: React.MutableRefObject<'ask' | 'plan' | 'autopilot'>;
    images: string[];
    clearImages: () => void;
    /** Convert current attachments to wire format (includes non-image files) */
    toPayload?: () => Array<{ name: string; mimeType: string; size: number; dataUrl: string }>;
    lastFailedMessageRef: React.MutableRefObject<string>;
    setTask: (updater: (prev: any) => any) => void;
    /** Returns the currently attached context items. */
    getAttachedContext?: () => AttachedContextItem[];
    /** Clears attached context after send. */
    clearAttachedContext?: () => void;
}

export function useSendMessage({
    processId,
    taskId,
    inputDisabled,
    sending,
    setSending,
    setError,
    setSessionExpired,
    setSuggestions,
    setTurnsAndRef,
    removeStreamingPlaceholder,
    refreshConversation,
    queueDispatch,
    slashCommands,
    followUpInputRef,
    setFollowUpInput,
    selectedMode,
    selectedModeRef,
    images,
    clearImages,
    toPayload,
    lastFailedMessageRef,
    setTask,
    getAttachedContext,
    clearAttachedContext,
}: UseSendMessageOptions): {
    sendFollowUp: (overrideContent?: string, deliveryMode?: DeliveryMode) => Promise<void>;
    closeFollowUpStream: () => void;
    onSendComplete: () => void;
} {
    const { archivedChatIds, unarchiveChat } = useChatPrefs();
    const followUpEventSourceRef = useRef<EventSource | null>(null);
    const resolveCurrentSendRef = useRef<(() => void) | null>(null);

    const closeFollowUpStream = useCallback(() => {
        if (followUpEventSourceRef.current) {
            followUpEventSourceRef.current.close();
            followUpEventSourceRef.current = null;
        }
    }, []);

    /** Called by useChatSSE when the main SSE stream fires 'done'. */
    const onSendComplete = useCallback(() => {
        if (resolveCurrentSendRef.current) {
            resolveCurrentSendRef.current();
            resolveCurrentSendRef.current = null;
        }
    }, []);

    /** Returns a promise that resolves when the main SSE stream fires 'done' via onSendComplete. */
    const waitForSendCompletion = useCallback((pid: string): Promise<void> => {
        if (typeof EventSource === 'undefined') {
            return refreshConversation(pid);
        }
        return new Promise<void>(resolve => {
            let timeoutId: ReturnType<typeof setTimeout>;
            // Wrap resolve so both the timeout and onSendComplete share the same function
            // reference stored in the ref — avoids the stale-closure comparison bug where
            // the timeout checked `ref === resolve` after the ref was already overwritten.
            const wrappedResolve = () => {
                clearTimeout(timeoutId);
                if (resolveCurrentSendRef.current === wrappedResolve) {
                    resolveCurrentSendRef.current = null;
                }
                resolve();
            };
            resolveCurrentSendRef.current = wrappedResolve;
            // Safety timeout in case 'done' never fires (e.g. SSE connection dropped).
            timeoutId = setTimeout(wrappedResolve, 90_000);
        });
    }, [refreshConversation]);

    const sendFollowUp = useCallback(async (overrideContent?: string, deliveryMode: DeliveryMode = 'enqueue') => {
        const userText = (overrideContent ?? followUpInputRef.current).trim();
        const pastedContent = getPastedContent?.() ?? null;
        const contextItems = getAttachedContext?.() ?? [];
        const contextPrefix = formatAttachedContext(contextItems);
        const baseContent = pastedContent
            ? (userText ? userText + '\n\n' + pastedContent : pastedContent)
            : userText;
        const rawContent = contextPrefix ? contextPrefix + baseContent : baseContent;
        if (!rawContent || !processId || inputDisabled) return;

        if (archivedChatIds.has(taskId)) {
            unarchiveChat(taskId);
        }

        const { skills: extractedSkills } = slashCommands.parseAndExtract(rawContent);

        setSuggestions([]);
        setFollowUpInput('');
        clearDraft(taskId);
        slashCommands.dismissMenu();
        setError(null);

        // ── While AI is running: route through /message, let server decide ──
        if (sending) {
            if (deliveryMode === 'immediate') {
                // Steering messages must reach the server immediately to inject into the running session
                await fetch(`${getApiBase()}/processes/${encodeURIComponent(processId)}/message`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: rawContent,
                        images: images.length > 0 ? images : undefined,
                        attachments: toPayload && toPayload().length > 0 ? toPayload() : undefined,
                        mode: selectedMode,
                        deliveryMode,
                        optimisticId: qm.id,
                        ...(extractedSkills.length > 0 ? { skillNames: extractedSkills } : {}),
                    }),
                }).catch(() => {});
            }
            // Both immediate and enqueue: fire POST to /message and let the
            // server steer, buffer, or enqueue as appropriate.  No local
            // pending queue entry — the server is the source of truth.
            fetch(`${getApiBase()}/processes/${encodeURIComponent(processId)}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: rawContent,
                    images: images.length > 0 ? images : undefined,
                    mode: selectedMode,
                    deliveryMode,
                    ...(extractedSkills.length > 0 ? { skillNames: extractedSkills } : {}),
                }),
            }).catch(() => {});

            clearImages();
            clearPaste();
            clearAttachedContext?.();
            return;
        }

        // ── AI is idle: start a new streaming follow-up ──
        setSending(true);
        queueDispatch({ type: 'SET_FOLLOW_UP_STREAMING', value: true, turnIndex: null });

        const timestamp = new Date().toISOString();
        const pasteExternalized = rawContent.length > CLIENT_PASTE_THRESHOLD || undefined;
        setTurnsAndRef(prev => {
            const nextIdx = Math.max(0, ...prev.map(t => t.turnIndex ?? -1)) + 1;
            return [
                ...prev,
                { role: 'user' as const, content: rawContent, timestamp, timeline: [], turnIndex: nextIdx, pasteExternalized },
                { role: 'assistant' as const, content: '', timestamp, streaming: true, timeline: [], turnIndex: nextIdx + 1 },
            ];
        });

        try {
            const response = await fetch(`${getApiBase()}/processes/${encodeURIComponent(processId)}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: rawContent,
                    images: images.length > 0 ? images : undefined,
                    attachments: toPayload && toPayload().length > 0 ? toPayload() : undefined,
                    mode: selectedMode,
                    deliveryMode,
                    ...(extractedSkills.length > 0 ? { skillNames: extractedSkills } : {}),
                }),
            });

            if (response.status === 410) {
                setSessionExpired(true);
                setError('Session expired.');
                lastFailedMessageRef.current = rawContent;
                removeStreamingPlaceholder();
                return;
            }
            if (!response.ok) {
                const body = await response.json().catch(() => null);
                setError(body?.error || `Failed to send message (${response.status})`);
                lastFailedMessageRef.current = rawContent;
                removeStreamingPlaceholder();
                return;
            }

            lastFailedMessageRef.current = '';
            setTask((prev: any) => prev ? { ...prev, status: 'running' } : prev);
            clearImages();
            clearPaste();
            clearAttachedContext?.();
            await waitForSendCompletion(processId);
        } catch (err: any) {
            setError(err?.message || 'Failed to send follow-up message.');
            lastFailedMessageRef.current = rawContent;
            removeStreamingPlaceholder();
        } finally {
            setSending(false);
            queueDispatch({ type: 'SET_FOLLOW_UP_STREAMING', value: false, turnIndex: null });
            void refreshConversation(processId);
        }
    }, [processId, taskId, inputDisabled, sending, selectedMode, images, toPayload, archivedChatIds, unarchiveChat]); // eslint-disable-line react-hooks/exhaustive-deps

    return { sendFollowUp, closeFollowUpStream, onSendComplete };
}
