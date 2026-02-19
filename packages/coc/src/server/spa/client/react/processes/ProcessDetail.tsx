/**
 * ProcessDetail — right panel showing detail for the selected process.
 * Replaces renderProcessDetail from detail.ts.
 */

import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { fetchApi } from '../hooks/useApi';
import { Badge, Spinner } from '../shared';
import { ToolCallView } from './ToolCallView';
import { MarkdownView } from './MarkdownView';
import { formatDuration, statusIcon, statusLabel } from '../utils/format';
import type { ClientConversationTurn } from '../types/dashboard';

const CACHE_TTL_MS = 60 * 60 * 1000;

function getConversationTurns(data: any): ClientConversationTurn[] {
    const process = data?.process;
    if (process?.conversationTurns && Array.isArray(process.conversationTurns) && process.conversationTurns.length > 0) {
        return process.conversationTurns;
    }
    if (Array.isArray(data?.conversation) && data.conversation.length > 0) {
        return data.conversation;
    }
    if (Array.isArray(data?.turns) && data.turns.length > 0) {
        return data.turns;
    }

    // Backward-compatible fallback for older persisted processes.
    if (process) {
        const synthetic: ClientConversationTurn[] = [];
        const userContent = process.fullPrompt || process.promptPreview;
        if (userContent) {
            synthetic.push({
                role: 'user',
                content: userContent,
                timestamp: process.startTime || undefined,
                timeline: [],
            });
        }
        if (process.result) {
            synthetic.push({
                role: 'assistant',
                content: process.result,
                timestamp: process.endTime || undefined,
                timeline: [],
            });
        }
        return synthetic;
    }

    return [];
}

export function ProcessDetail() {
    const { state, dispatch } = useApp();
    const { selectedId, conversationCache, processes } = state;
    const [loading, setLoading] = useState(false);
    const [turns, setTurns] = useState<ClientConversationTurn[]>([]);
    const eventSourceRef = useRef<EventSource | null>(null);
    const [now, setNow] = useState(Date.now());

    const process = processes.find((p: any) => p.id === selectedId);

    // Live timer for running process
    useEffect(() => {
        if (process?.status !== 'running') return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [process?.status]);

    // Fetch or load conversation on selectedId change
    useEffect(() => {
        if (!selectedId) {
            setTurns([]);
            return;
        }

        // Check cache
        const cached = conversationCache[selectedId];
        if (cached && (Date.now() - cached.cachedAt < CACHE_TTL_MS)) {
            setTurns(cached.turns);
            setLoading(false);
        } else {
            setLoading(true);
            fetchApi(`/processes/${encodeURIComponent(selectedId)}`)
                .then((data: any) => {
                    const t = getConversationTurns(data);
                    dispatch({ type: 'CACHE_CONVERSATION', processId: selectedId, turns: t });
                    setTurns(t);
                })
                .catch(() => setTurns([]))
                .finally(() => setLoading(false));
        }
    }, [selectedId, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

    // SSE streaming for running processes
    useEffect(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }

        if (!selectedId || process?.status !== 'running') return;

        const es = new EventSource(`/api/processes/${encodeURIComponent(selectedId)}/stream`);
        eventSourceRef.current = es;

        es.onmessage = (event) => {
            try {
                const turn = JSON.parse(event.data);
                dispatch({ type: 'APPEND_TURN', processId: selectedId, turn });
                setTurns(prev => [...prev, turn]);
            } catch { /* ignore parse errors */ }
        };

        es.onerror = () => {
            es.close();
            eventSourceRef.current = null;
        };

        return () => {
            es.close();
            eventSourceRef.current = null;
        };
    }, [selectedId, process?.status, dispatch]);

    if (!selectedId || !process) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-[#848484]">
                <div className="text-4xl mb-2">👈</div>
                <div className="text-sm">Select a process to view details</div>
            </div>
        );
    }

    const duration = process.status === 'running' && process.startTime
        ? formatDuration(now - new Date(process.startTime).getTime())
        : process.duration != null
            ? formatDuration(process.duration)
            : '';

    return (
        <div className="flex-1 overflow-y-auto p-4">
            {/* Header */}
            <div className="mb-4 pb-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <div className="flex items-center gap-2 mb-2">
                    <Badge status={process.status}>
                        {statusIcon(process.status)} {statusLabel(process.status)}
                    </Badge>
                    {duration && (
                        <span className="text-xs text-[#848484]">{duration}</span>
                    )}
                </div>
                <div className="text-sm text-[#1e1e1e] dark:text-[#cccccc] break-words">
                    {process.fullPrompt || process.promptPreview || process.id}
                </div>
            </div>

            {/* Conversation turns */}
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
                            {turn.content && (
                                <MarkdownView html={turn.content} />
                            )}
                            {turn.toolCalls?.map((tc, j) => (
                                <ToolCallView key={tc.id || j} toolCall={tc} />
                            ))}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
