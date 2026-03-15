import { useCallback, useEffect, useRef } from 'react';
import { getApiBase } from '../utils/config';
import { clearDraft } from './useDraftStore';
import type { ClientConversationTurn } from '../types/dashboard';
import type { QueuedMessage } from '../utils/chatUtils';
import type { DeliveryMode } from '@plusplusoneplusplus/pipeline-core';

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
    lastFailedMessageRef: React.MutableRefObject<string>;
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
    lastFailedMessageRef,
}: UseSendMessageOptions): {
    sendFollowUp: (overrideContent?: string, deliveryMode?: DeliveryMode) => Promise<void>;
    flushQueueRef: React.MutableRefObject<(() => void) | null>;
    closeFollowUpStream: () => void;
} {
    const followUpEventSourceRef = useRef<EventSource | null>(null);
    const flushQueueRef = useRef<(() => void) | null>(null);

    const closeFollowUpStream = useCallback(() => {
        if (followUpEventSourceRef.current) {
            followUpEventSourceRef.current.close();
            followUpEventSourceRef.current = null;
        }
    }, []);

    const waitForFollowUpCompletion = useCallback(async (pid: string) => {
        if (typeof EventSource === 'undefined') {
            await refreshConversation(pid);
            return;
        }
        closeFollowUpStream();
        await new Promise<void>(resolve => {
            const es = new EventSource(`${getApiBase()}/processes/${encodeURIComponent(pid)}/stream`);
            followUpEventSourceRef.current = es;
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                es.close();
                if (followUpEventSourceRef.current === es) followUpEventSourceRef.current = null;
                void refreshConversation(pid).finally(() => resolve());
            };
            const timeout = setTimeout(finish, 90_000);
            es.addEventListener('done', () => { clearTimeout(timeout); finish(); });
            es.addEventListener('status', (e: Event) => {
                try {
                    const status = JSON.parse((e as MessageEvent).data)?.status;
                    if (status && !['running', 'queued'].includes(status)) { clearTimeout(timeout); finish(); }
                } catch { /* ignore */ }
            });
            es.onerror = () => { clearTimeout(timeout); finish(); };
            es.addEventListener('suggestions', (event: Event) => {
                try {
                    const data = JSON.parse((event as MessageEvent).data);
                    if (Array.isArray(data.suggestions)) setSuggestions(data.suggestions);
                } catch { /* ignore */ }
            });
            es.addEventListener('message-queued', (event: Event) => {
                try {
                    const { optimisticId } = JSON.parse((event as MessageEvent).data);
                    setPendingQueue(prev => prev.map(m => m.id === optimisticId ? { ...m, status: 'queued' as const } : m));
                } catch { /* ignore */ }
            });
            es.addEventListener('message-steering', (event: Event) => {
                try {
                    const { optimisticId } = JSON.parse((event as MessageEvent).data);
                    setPendingQueue(prev => prev.map(m => m.id === optimisticId ? { ...m, status: 'steering' as const } : m));
                } catch { /* ignore */ }
            });
        });
    }, [closeFollowUpStream, refreshConversation, setSuggestions, setPendingQueue]);

    // Keep flushQueueRef in sync with current pendingQueue for stale-closure-safe drain
    useEffect(() => {
        flushQueueRef.current = () => {
            if (pendingQueue.length === 0 || !processId) return;
            const [next, ...rest] = pendingQueue;
            setPendingQueue(rest);
            setSending(true);
            queueDispatch({ type: 'SET_FOLLOW_UP_STREAMING', value: true, turnIndex: null });
            const timestamp = new Date().toISOString();
            setTurnsAndRef(prev => ([
                ...prev,
                { role: 'user' as const, content: next.content, timestamp, timeline: [] },
                { role: 'assistant' as const, content: '', timestamp, streaming: true, timeline: [] },
            ]));
            fetch(`${getApiBase()}/processes/${encodeURIComponent(processId)}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: next.content, mode: selectedModeRef.current, deliveryMode: next.deliveryMode }),
            })
                .then(async (response) => {
                    if (!response.ok) { removeStreamingPlaceholder(); return; }
                    await waitForFollowUpCompletion(processId);
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
        const rawContent = (overrideContent ?? followUpInputRef.current).trim();
        if (!rawContent || !processId || inputDisabled) return;

        const { skills: extractedSkills, prompt: cleanedPrompt } = slashCommands.parseAndExtract(rawContent);
        const content = cleanedPrompt || rawContent;

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
            await fetch(`${getApiBase()}/processes/${encodeURIComponent(processId)}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content,
                    images: images.length > 0 ? images : undefined,
                    mode: selectedMode,
                    deliveryMode,
                    optimisticId: qm.id,
                    ...(extractedSkills.length > 0 ? { skillNames: extractedSkills } : {}),
                }),
            }).catch(() => {});
            clearImages();
            return;
        }

        setSending(true);
        queueDispatch({ type: 'SET_FOLLOW_UP_STREAMING', value: true, turnIndex: null });

        const timestamp = new Date().toISOString();
        setTurnsAndRef(prev => ([
            ...prev,
            { role: 'user' as const, content: rawContent, timestamp, timeline: [] },
            { role: 'assistant' as const, content: '', timestamp, streaming: true, timeline: [] },
        ]));

        try {
            const response = await fetch(`${getApiBase()}/processes/${encodeURIComponent(processId)}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content,
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
            clearImages();
            await waitForFollowUpCompletion(processId);
        } catch (err: any) {
            setError(err?.message || 'Failed to send follow-up message.');
            lastFailedMessageRef.current = rawContent;
            removeStreamingPlaceholder();
        } finally {
            setSending(false);
            queueDispatch({ type: 'SET_FOLLOW_UP_STREAMING', value: false, turnIndex: null });
            setPendingQueue(prev => prev.filter(m => m.status !== 'steering'));
            setTimeout(() => { flushQueueRef.current?.(); }, 0);
        }
    }, [processId, taskId, inputDisabled, sending, selectedMode, images]); // eslint-disable-line react-hooks/exhaustive-deps

    return { sendFollowUp, flushQueueRef, closeFollowUpStream };
}
