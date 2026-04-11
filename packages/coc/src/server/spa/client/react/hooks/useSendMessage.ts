import { useCallback, useEffect, useRef } from 'react';
import { getApiBase } from '../utils/config';
import { clearDraft } from './useDraftStore';
import { useChatPrefs } from '../context/ChatPreferencesContext';
import { CLIENT_PASTE_THRESHOLD } from './useTextPaste';
import type { ClientConversationTurn } from '../types/dashboard';
import type { QueuedMessage } from '../utils/chatUtils';
import type { DeliveryMode } from '@plusplusoneplusplus/forge';

type SetTurnsAndRef = (next: ClientConversationTurn[] | ((prev: ClientConversationTurn[]) => ClientConversationTurn[])) => void;
type SetPendingQueue = (updater: ((prev: QueuedMessage[]) => QueuedMessage[]) | QueuedMessage[]) => void;

export interface UseSendMessageOptions {
    processId: string | null;
    taskId: string;
    inputDisabled: boolean;
    sending: boolean;
    setSending: (v: boolean) => void;
    setError: (v: string | null) => void;
    setSessionExpired: (v: boolean) => void;
    setSuggestions: (v: string[]) => void;
    pendingQueue: QueuedMessage[];
    setPendingQueue: SetPendingQueue;
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
    clearPaste: () => void;
    /** Returns the raw pasted content held by useTextPaste, or null if no large paste is active. */
    getPastedContent?: () => string | null;
    lastFailedMessageRef: React.MutableRefObject<string>;
    setTask: (updater: (prev: any) => any) => void;
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
    pendingQueue,
    setPendingQueue,
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
    clearPaste,
    getPastedContent,
    lastFailedMessageRef,
    setTask,
}: UseSendMessageOptions): {
    sendFollowUp: (overrideContent?: string, deliveryMode?: DeliveryMode) => Promise<void>;
    flushQueueRef: React.MutableRefObject<(() => void) | null>;
    closeFollowUpStream: () => void;
    onSendComplete: () => void;
} {
    const { archivedChatIds, unarchiveChat } = useChatPrefs();
    const followUpEventSourceRef = useRef<EventSource | null>(null);
    const flushQueueRef = useRef<(() => void) | null>(null);
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
            resolveCurrentSendRef.current = resolve;
            // Safety timeout in case 'done' never fires
            const timeout = setTimeout(() => {
                if (resolveCurrentSendRef.current === resolve) {
                    resolveCurrentSendRef.current = null;
                    resolve();
                }
            }, 90_000);
            const origResolve = resolve;
            resolveCurrentSendRef.current = () => {
                clearTimeout(timeout);
                origResolve();
            };
        });
    }, [refreshConversation]);

    // Keep flushQueueRef in sync with current pendingQueue for stale-closure-safe drain
    useEffect(() => {
        flushQueueRef.current = () => {
            if (pendingQueue.length === 0 || !processId) return;
            // Server drains 'enqueue' messages; client only drains 'immediate' (steering)
            const immediateMsg = pendingQueue.find(m => m.deliveryMode === 'immediate');
            if (!immediateMsg) return;
            setPendingQueue(prev => prev.filter(m => m.id !== immediateMsg.id));
            setSending(true);
            queueDispatch({ type: 'SET_FOLLOW_UP_STREAMING', value: true, turnIndex: null });
            const timestamp = new Date().toISOString();
            setTurnsAndRef(prev => {
                const nextIdx = Math.max(0, ...prev.map(t => t.turnIndex ?? -1)) + 1;
                return [
                    ...prev,
                    { role: 'user' as const, content: immediateMsg.content, timestamp, timeline: [], turnIndex: nextIdx },
                    { role: 'assistant' as const, content: '', timestamp, streaming: true, timeline: [], turnIndex: nextIdx + 1 },
                ];
            });
            const drainedMsgId = immediateMsg.id;
            fetch(`${getApiBase()}/processes/${encodeURIComponent(processId)}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: immediateMsg.content, mode: selectedModeRef.current, deliveryMode: immediateMsg.deliveryMode }),
            })
                .then(async (response) => {
                    if (!response.ok) { removeStreamingPlaceholder(); return; }
                    // Remove the consumed pending message from the server
                    fetch(`${getApiBase()}/processes/${encodeURIComponent(processId)}/pending-messages/${encodeURIComponent(drainedMsgId)}`, {
                        method: 'DELETE',
                    }).catch(() => {});
                    await waitForSendCompletion(processId);
                })
                .catch(() => { removeStreamingPlaceholder(); })
                .finally(() => {
                    setSending(false);
                    queueDispatch({ type: 'SET_FOLLOW_UP_STREAMING', value: false, turnIndex: null });
                    setPendingQueue(prev => prev.filter(m => m.status !== 'steering'));
                    setTimeout(() => { flushQueueRef.current?.(); }, 0);
                });
        };
    }, [pendingQueue, processId]); // eslint-disable-line react-hooks/exhaustive-deps

    const sendFollowUp = useCallback(async (overrideContent?: string, deliveryMode: DeliveryMode = 'enqueue') => {
        const userText = (overrideContent ?? followUpInputRef.current).trim();
        // Compose the full content: user text + pasted content (if any)
        const pastedContent = getPastedContent?.() ?? null;
        const rawContent = pastedContent
            ? (userText ? userText + '\n\n' + pastedContent : pastedContent)
            : userText;
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

        if (sending) {
            const qm: QueuedMessage = {
                id: crypto.randomUUID(),
                content: rawContent,
                deliveryMode,
                status: 'pending-send',
            };
            setPendingQueue(prev => [...prev, qm]);

            if (deliveryMode === 'immediate') {
                // Steering messages must reach the server immediately to inject into the running session
                await fetch(`${getApiBase()}/processes/${encodeURIComponent(processId)}/message`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: rawContent,
                        images: images.length > 0 ? images : undefined,
                        mode: selectedMode,
                        deliveryMode,
                        optimisticId: qm.id,
                        ...(extractedSkills.length > 0 ? { skillNames: extractedSkills } : {}),
                    }),
                }).catch(() => {});
            } else {
                // Persist enqueued message on the server so it survives chat switches / refreshes.
                // Server-side drain handles delivery — remove from local queue after persist.
                fetch(`${getApiBase()}/processes/${encodeURIComponent(processId)}/pending-messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: rawContent, mode: selectedMode }),
                })
                    .then(async (resp) => {
                        if (!resp.ok) return;
                        // Server now owns this message; remove from local drain queue
                        setPendingQueue(prev => prev.filter(m => m.id !== qm.id));
                    })
                    .catch(() => {});
            }
            clearImages();
            clearPaste();
            return;
        }

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
            await waitForSendCompletion(processId);
        } catch (err: any) {
            setError(err?.message || 'Failed to send follow-up message.');
            lastFailedMessageRef.current = rawContent;
            removeStreamingPlaceholder();
        } finally {
            setSending(false);
            queueDispatch({ type: 'SET_FOLLOW_UP_STREAMING', value: false, turnIndex: null });
            setPendingQueue(prev => prev.filter(m => m.status !== 'steering'));
            void refreshConversation(processId);
            setTimeout(() => { flushQueueRef.current?.(); }, 0);
        }
    }, [processId, taskId, inputDisabled, sending, selectedMode, images, archivedChatIds, unarchiveChat]); // eslint-disable-line react-hooks/exhaustive-deps

    return { sendFollowUp, flushQueueRef, closeFollowUpStream, onSendComplete };
}
