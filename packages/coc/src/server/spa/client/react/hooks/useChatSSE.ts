import { useEffect, useRef, useCallback } from 'react';
import { getApiBase } from '../utils/config';
import type { ClientConversationTurn } from '../types/dashboard';
import type { QueuedMessage } from '../utils/chatUtils';

type SetTurnsAndRef = (next: ClientConversationTurn[] | ((prev: ClientConversationTurn[]) => ClientConversationTurn[])) => void;

/** Snapshot of active background tasks relayed from the SDK via SSE. */
export interface BackgroundTasksState {
    backgroundAgents: Array<{ id: string; type?: string; description?: string }>;
    backgroundShells: Array<{ id: string; type?: string; description?: string }>;
    backgroundTotalActive: number;
    backgroundWaitingForDrain: boolean;
}

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
    setBackgroundTasks: (v: BackgroundTasksState | null) => void;
    setTurnsAndRef: SetTurnsAndRef;
    refreshConversation: (pid: string) => Promise<void>;
    onSendComplete: () => void;
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
    setBackgroundTasks,
    setTurnsAndRef,
    refreshConversation,
    onSendComplete,
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
        if (typeof EventSource === 'undefined') return;

        const es = new EventSource(`${getApiBase()}/processes/${encodeURIComponent(processId)}/stream`);
        eventSourceRef.current = es;
        setIsStreaming(true);

        const ensureAssistantTurn = (prev: ClientConversationTurn[]): ClientConversationTurn[] => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') return prev;
            const nextIdx = Math.max(0, ...prev.map(t => t.turnIndex ?? -1)) + 1;
            return [...prev, { role: 'assistant', content: '', streaming: true, timeline: [], turnIndex: nextIdx }];
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
                setPendingQueue(prev => prev.map(m => {
                    if (m.id !== optimisticId) return m;
                    if (m.status === 'sent-immediate') return m;
                    return { ...m, status: 'queued' as const };
                }));
            } catch { /* ignore */ }
        });

        es.addEventListener('message-steering', (event: Event) => {
            try {
                const { optimisticId } = JSON.parse((event as MessageEvent).data);
                setPendingQueue(prev => prev.map(m => m.id === optimisticId ? { ...m, status: 'steering' as const } : m));
            } catch { /* ignore */ }
        });

        es.addEventListener('pending-message-added', (event: Event) => {
            try {
                const { pendingMessage } = JSON.parse((event as MessageEvent).data);
                if (pendingMessage?.id) {
                    setPendingQueue(prev => {
                        // Avoid duplicates — another tab may have already added this entry
                        if (prev.some(m => m.id === pendingMessage.id)) return prev;
                        return [...prev, {
                            id: pendingMessage.id,
                            content: pendingMessage.content,
                            deliveryMode: 'enqueue' as const,
                            status: 'queued' as const,
                        }];
                    });
                }
            } catch { /* ignore */ }
        });

        const closeSSE = () => {
            es.close();
            eventSourceRef.current = null;
            setIsStreaming(false);
        };

        const finish = (finalStatus: 'completed' | 'failed' | 'cancelled' = 'completed') => {
            closeSSE();
            setBackgroundTasks(null);
            setTask(prev => prev && prev.status === 'running' ? { ...prev, status: finalStatus } : prev);
            void refreshConversation(processId);
            setPendingQueue(prev => prev.filter(m => m.status !== 'steering' && m.status !== 'sent-immediate'));
            onSendComplete();
        };

        es.addEventListener('done', () => finish('completed'));
        es.addEventListener('status', (e: Event) => {
            try {
                const status = JSON.parse((e as MessageEvent).data)?.status;
                if (status && !['running', 'queued'].includes(status))
                    finish(status as 'completed' | 'failed' | 'cancelled');
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

        es.addEventListener('background-tasks', (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                setBackgroundTasks({
                    backgroundAgents: data.backgroundAgents ?? [],
                    backgroundShells: data.backgroundShells ?? [],
                    backgroundTotalActive: data.backgroundTotalActive ?? 0,
                    backgroundWaitingForDrain: data.backgroundWaitingForDrain ?? false,
                });
            } catch { /* ignore */ }
        });

        return () => { es.close(); eventSourceRef.current = null; setIsStreaming(false); };
    }, [taskId, task?.status, processId, refreshConversation]); // eslint-disable-line react-hooks/exhaustive-deps

    return { stopStreaming };
}
