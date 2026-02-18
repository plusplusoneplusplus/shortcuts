/**
 * QueueTaskDetail — detail panel for a selected queue task.
 * Shows conversation turns with SSE streaming for running tasks.
 */

import { useEffect, useRef, useState } from 'react';
import { useQueue } from '../context/QueueContext';
import { useApp } from '../context/AppContext';
import { fetchApi } from '../hooks/useApi';
import { Badge, Spinner, Button } from '../shared';
import { ToolCallView } from '../processes/ToolCallView';
import { MarkdownView } from '../processes/MarkdownView';
import { formatDuration, statusIcon, statusLabel } from '../utils/format';
import type { ClientConversationTurn } from '../types/dashboard';

const CACHE_TTL_MS = 60 * 60 * 1000;

export function QueueTaskDetail() {
    const { state: queueState, dispatch: queueDispatch } = useQueue();
    const { state: appState, dispatch: appDispatch } = useApp();
    const { selectedTaskId } = queueState;
    const [loading, setLoading] = useState(false);
    const [turns, setTurns] = useState<ClientConversationTurn[]>([]);
    const [task, setTask] = useState<any>(null);
    const eventSourceRef = useRef<EventSource | null>(null);

    // Determine task object from queue state
    useEffect(() => {
        if (!selectedTaskId) { setTask(null); return; }
        const found = [...queueState.running, ...queueState.queued, ...queueState.history]
            .find(t => t.id === selectedTaskId);
        setTask(found || null);
    }, [selectedTaskId, queueState.running, queueState.queued, queueState.history]);

    // Fetch conversation on task selection
    useEffect(() => {
        if (!selectedTaskId) { setTurns([]); return; }

        // Check shared conversation cache
        const cached = appState.conversationCache[selectedTaskId];
        if (cached && (Date.now() - cached.cachedAt < CACHE_TTL_MS)) {
            setTurns(cached.turns);
            setLoading(false);
        } else {
            setLoading(true);
            fetchApi(`/queue/tasks/${encodeURIComponent(selectedTaskId)}`)
                .then((data: any) => {
                    const t = data?.conversation || data?.turns || [];
                    appDispatch({ type: 'CACHE_CONVERSATION', processId: selectedTaskId, turns: t });
                    setTurns(t);
                })
                .catch(() => setTurns([]))
                .finally(() => setLoading(false));
        }
    }, [selectedTaskId, appDispatch]); // eslint-disable-line react-hooks/exhaustive-deps

    // SSE streaming for running tasks
    useEffect(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }

        if (!selectedTaskId || task?.status !== 'running') return;

        const es = new EventSource(`/api/queue/tasks/${encodeURIComponent(selectedTaskId)}/stream`);
        eventSourceRef.current = es;

        es.onmessage = (event) => {
            try {
                const turn = JSON.parse(event.data);
                appDispatch({ type: 'APPEND_TURN', processId: selectedTaskId, turn });
                setTurns(prev => [...prev, turn]);
            } catch { /* ignore */ }
        };

        es.onerror = () => {
            es.close();
            eventSourceRef.current = null;
        };

        return () => {
            es.close();
            eventSourceRef.current = null;
        };
    }, [selectedTaskId, task?.status, appDispatch]);

    if (!selectedTaskId) return null;

    return (
        <div className="fixed inset-0 z-[10001] flex items-stretch justify-end bg-black/30 dark:bg-black/50"
             onClick={() => queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null })}>
            <div className="w-full max-w-2xl bg-white dark:bg-[#1e1e1e] border-l border-[#e0e0e0] dark:border-[#3c3c3c] flex flex-col overflow-hidden"
                 onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <div className="flex items-center gap-2">
                        {task && (
                            <Badge status={task.status}>
                                {statusIcon(task.status)} {statusLabel(task.status)}
                            </Badge>
                        )}
                        {task?.duration != null && (
                            <span className="text-xs text-[#848484]">{formatDuration(task.duration)}</span>
                        )}
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null })}
                    >
                        ✕
                    </Button>
                </div>

                {/* Prompt */}
                {task?.prompt && (
                    <div className="px-4 py-2 text-sm text-[#1e1e1e] dark:text-[#cccccc] border-b border-[#e0e0e0] dark:border-[#3c3c3c] break-words">
                        {task.prompt}
                    </div>
                )}

                {/* Conversation */}
                <div className="flex-1 overflow-y-auto p-4">
                    {loading ? (
                        <div className="flex items-center gap-2 text-[#848484] text-sm">
                            <Spinner size="sm" /> Loading conversation...
                        </div>
                    ) : turns.length === 0 ? (
                        <div className="text-[#848484] text-sm">No conversation data available.</div>
                    ) : (
                        <div className="space-y-3">
                            {turns.map((turn, i) => (
                                <div key={i} className="space-y-1">
                                    {turn.content && <MarkdownView html={turn.content} />}
                                    {turn.toolCalls?.map((tc, j) => (
                                        <ToolCallView key={tc.id || j} toolCall={tc} />
                                    ))}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
