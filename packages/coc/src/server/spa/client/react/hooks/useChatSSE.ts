import { useEffect, useRef, useCallback } from 'react';
import { getApiBase } from '../utils/config';
import type { ClientConversationTurn } from '../types/dashboard';
import type { QueuedMessage } from '../utils/chatUtils';

type SetTurnsAndRef = (next: ClientConversationTurn[] | ((prev: ClientConversationTurn[]) => ClientConversationTurn[])) => void;

export interface UseChatSSEOptions {
    taskId: string;
    task: any;
    processId: string | null;
    setIsStreaming: (v: boolean) => void;
    setTask: (updater: (prev: any) => any) => void;
    setPendingQueue: (updater: (prev: QueuedMessage[]) => QueuedMessage[]) => void;
    setSuggestions: (v: string[]) => void;
    setSessionTokenLimit: (v: number | undefined) => void;
    setSessionCurrentTokens: (v: number | undefined) => void;
    setTurnsAndRef: SetTurnsAndRef;
    refreshConversation: (pid: string) => Promise<void>;
    flushQueueRef: React.MutableRefObject<(() => void) | null>;
}

/** Manages the SSE EventSource for a running process and drives all streaming state updates. */
export function useChatSSE({
    taskId,
    task,
    processId,
    setIsStreaming,
    setTask,
    setPendingQueue,
    setSuggestions,
    setSessionTokenLimit,
    setSessionCurrentTokens,
    setTurnsAndRef,
    refreshConversation,
    flushQueueRef,
}: UseChatSSEOptions): { stopStreaming: () => void } {
    const eventSourceRef = useRef<EventSource | null>(null);

    const stopStreaming = useCallback(() => {
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        setIsStreaming(false);
    }, [setIsStreaming]);

    useEffect(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
        if (!taskId || task?.status !== 'running' || !processId) return;

        const es = new EventSource(`${getApiBase()}/processes/${encodeURIComponent(processId)}/stream`);
        eventSourceRef.current = es;
        setIsStreaming(true);

        const ensureAssistantTurn = (prev: ClientConversationTurn[]): ClientConversationTurn[] => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') return prev;
            return [...prev, { role: 'assistant', content: '', streaming: true, timeline: [] }];
        };

        es.addEventListener('conversation-snapshot', (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                if (data.turns) setTurnsAndRef(data.turns);
                if (typeof data.sessionTokenLimit === 'number') setSessionTokenLimit(data.sessionTokenLimit);
                if (typeof data.sessionCurrentTokens === 'number') setSessionCurrentTokens(data.sessionCurrentTokens);
            } catch { /* ignore */ }
        });

        es.addEventListener('chunk', (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                const chunk = data.content || '';
                setTurnsAndRef((prev) => {
                    const turns = ensureAssistantTurn(prev);
                    const last = turns[turns.length - 1];
                    turns[turns.length - 1] = {
                        ...last,
                        content: (last.content || '') + chunk,
                        streaming: true,
                        timeline: (() => {
                            const tl = last.timeline || [];
                            const lastItem = tl[tl.length - 1];
                            if (lastItem && lastItem.type === 'content') {
                                return [...tl.slice(0, -1), { ...lastItem, content: (lastItem.content || '') + chunk }];
                            }
                            return [...tl, { type: 'content' as const, timestamp: new Date().toISOString(), content: chunk }];
                        })(),
                    };
                    return [...turns];
                });
            } catch { /* ignore */ }
        });

        const handleToolSSE = (eventType: 'tool-start' | 'tool-complete' | 'tool-failed') => (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                setTurnsAndRef((prev) => {
                    const turns = ensureAssistantTurn(prev);
                    const last = turns[turns.length - 1];
                    const toolCall: any = {
                        id: data.toolCallId,
                        toolName: data.toolName || 'unknown',
                        args: data.parameters || {},
                        status: eventType === 'tool-start' ? 'running' : eventType === 'tool-complete' ? 'completed' : 'failed',
                        startTime: new Date().toISOString(),
                        ...(eventType !== 'tool-start' ? { endTime: new Date().toISOString(), result: data.result, error: data.error } : {}),
                        ...(data.parentToolCallId ? { parentToolCallId: data.parentToolCallId } : {}),
                    };
                    turns[turns.length - 1] = {
                        ...last,
                        streaming: true,
                        timeline: [...(last.timeline || []), { type: eventType, timestamp: new Date().toISOString(), toolCall }],
                    };
                    return [...turns];
                });
            } catch { /* ignore */ }
        };

        es.addEventListener('tool-start', handleToolSSE('tool-start'));
        es.addEventListener('tool-complete', handleToolSSE('tool-complete'));
        es.addEventListener('tool-failed', handleToolSSE('tool-failed'));

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

        const closeSSE = () => {
            es.close();
            eventSourceRef.current = null;
            setIsStreaming(false);
        };

        const finish = () => {
            closeSSE();
            setTask(prev => prev && prev.status === 'running' ? { ...prev, status: 'completed' as const } : prev);
            void refreshConversation(processId);
            setPendingQueue(prev => prev.filter(m => m.status !== 'steering'));
            setTimeout(() => { flushQueueRef.current?.(); }, 0);
        };

        es.addEventListener('done', finish);
        es.addEventListener('status', (e: Event) => {
            try {
                const status = JSON.parse((e as MessageEvent).data)?.status;
                if (status && !['running', 'queued'].includes(status)) finish();
            } catch { /* ignore */ }
        });

        es.onerror = () => { closeSSE(); void refreshConversation(processId); };

        es.addEventListener('suggestions', (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                if (Array.isArray(data.suggestions)) setSuggestions(data.suggestions);
            } catch { /* ignore */ }
        });

        es.addEventListener('token-usage', (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                if (typeof data.sessionTokenLimit === 'number') setSessionTokenLimit(data.sessionTokenLimit);
                if (typeof data.sessionCurrentTokens === 'number') setSessionCurrentTokens(data.sessionCurrentTokens);
                if (data.tokenUsage && typeof data.turnIndex === 'number') {
                    setTurnsAndRef(prev => prev.map(t =>
                        t.turnIndex === data.turnIndex && t.role === 'assistant'
                            ? { ...t, tokenUsage: data.tokenUsage }
                            : t
                    ));
                }
            } catch { /* ignore */ }
        });

        return () => { es.close(); eventSourceRef.current = null; setIsStreaming(false); };
    }, [taskId, task?.status, processId, refreshConversation]); // eslint-disable-line react-hooks/exhaustive-deps

    return { stopStreaming };
}
