/**
 * ProcessDetail — main content area showing a process conversation.
 *
 * Connects to the CoC agent's SSE stream for real-time updates:
 *   1. Fetches initial process data via GET /api/agent/:agentId/processes/:processId
 *   2. Connects to SSE stream via GET /api/agent/:agentId/processes/:processId/stream
 *   3. Handles conversation-snapshot, chunk, tool-start, tool-complete, status, done events
 *   4. Renders turns with user/assistant messages, tool calls, streaming indicator
 *   5. Follow-up input sends POST /api/agent/:agentId/processes/:processId/message
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { fetchApi } from '../hooks/useAgents';
import type { ProcessDetail as ProcessDetailType, Turn, ToolCall } from '../types';

interface ProcessDetailProps {
    agentId: string;
    processId: string;
    streamEvents: any[];
    onSendFollowUp: (processId: string, message: string) => void;
}

interface ActiveToolCall {
    callId: string;
    name: string;
    result?: string;
}

export function ProcessDetail({ agentId, processId, streamEvents, onSendFollowUp }: ProcessDetailProps) {
    const [process, setProcess] = useState<ProcessDetailType | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [streamingContent, setStreamingContent] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [activeTools, setActiveTools] = useState<ActiveToolCall[]>([]);
    const [processStatus, setProcessStatus] = useState<string>('unknown');
    const [followUp, setFollowUp] = useState('');
    const conversationEndRef = useRef<HTMLDivElement>(null);
    const eventSourceRef = useRef<EventSource | null>(null);

    // Fetch initial process detail
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setStreamingContent('');
        setActiveTools([]);
        setIsStreaming(false);

        fetchApi(`/api/agent/${agentId}/processes/${processId}`)
            .then(data => {
                if (cancelled) return;
                const normalized = normalize(data);
                setProcess(normalized);
                setProcessStatus(normalized.status || 'unknown');
                setLoading(false);
            })
            .catch(err => {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : String(err));
                setLoading(false);
            });

        return () => { cancelled = true; };
    }, [agentId, processId]);

    // Connect to SSE stream
    useEffect(() => {
        // Close previous connection
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }

        const url = `/api/agent/${agentId}/processes/${processId}/stream`;
        const es = new EventSource(url);
        eventSourceRef.current = es;

        es.addEventListener('conversation-snapshot', (e: MessageEvent) => {
            try {
                const turns: Turn[] = JSON.parse(e.data);
                setProcess(prev => prev ? { ...prev, turns: normalizeTurns(turns) } : prev);
                setStreamingContent('');
                setActiveTools([]);
            } catch { /* ignore parse errors */ }
        });

        es.addEventListener('chunk', (e: MessageEvent) => {
            try {
                const data = JSON.parse(e.data);
                setStreamingContent(prev => prev + (data.content || ''));
                setIsStreaming(true);
            } catch { /* ignore */ }
        });

        es.addEventListener('tool-start', (e: MessageEvent) => {
            try {
                const data = JSON.parse(e.data);
                setActiveTools(prev => [...prev, { callId: data.callId, name: data.name }]);
            } catch { /* ignore */ }
        });

        es.addEventListener('tool-complete', (e: MessageEvent) => {
            try {
                const data = JSON.parse(e.data);
                setActiveTools(prev =>
                    prev.map(t => t.callId === data.callId ? { ...t, result: data.result } : t)
                );
            } catch { /* ignore */ }
        });

        es.addEventListener('status', (e: MessageEvent) => {
            try {
                const data = JSON.parse(e.data);
                setProcessStatus(data.status);
                setProcess(prev => prev ? { ...prev, status: data.status } : prev);
                if (data.status === 'completed' || data.status === 'failed') {
                    setIsStreaming(false);
                    // Re-fetch to get final conversation state
                    fetchApi(`/api/agent/${agentId}/processes/${processId}`)
                        .then(d => setProcess(normalize(d)))
                        .catch(() => {});
                }
            } catch { /* ignore */ }
        });

        es.addEventListener('done', () => {
            setIsStreaming(false);
            setStreamingContent('');
            // Re-fetch final state
            fetchApi(`/api/agent/${agentId}/processes/${processId}`)
                .then(d => setProcess(normalize(d)))
                .catch(() => {});
        });

        // Also handle generic message events (fallback)
        es.onmessage = (e: MessageEvent) => {
            try {
                const data = JSON.parse(e.data);
                if (data.type === 'conversation-snapshot' && Array.isArray(data.turns)) {
                    setProcess(prev => prev ? { ...prev, turns: normalizeTurns(data.turns) } : prev);
                    setStreamingContent('');
                } else if (data.type === 'chunk' && data.content) {
                    setStreamingContent(prev => prev + data.content);
                    setIsStreaming(true);
                } else if (data.type === 'status' && data.status) {
                    setProcessStatus(data.status);
                    setProcess(prev => prev ? { ...prev, status: data.status } : prev);
                }
            } catch { /* ignore */ }
        };

        es.onerror = () => {
            // SSE will auto-reconnect; just mark as not streaming
            setIsStreaming(false);
        };

        return () => {
            es.close();
            eventSourceRef.current = null;
        };
    }, [agentId, processId]);

    // Auto-scroll on new content
    useEffect(() => {
        conversationEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [process?.turns?.length, streamingContent]);

    const handleFollowUp = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        const msg = followUp.trim();
        if (!msg) return;
        onSendFollowUp(processId, msg);
        setFollowUp('');
    }, [followUp, processId, onSendFollowUp]);

    if (loading) {
        return <div className="detail-placeholder">Loading process…</div>;
    }
    if (error) {
        return <div className="detail-placeholder detail-error">Error: {error}</div>;
    }
    if (!process) {
        return <div className="detail-placeholder">Process not found.</div>;
    }

    const isActive = processStatus === 'running' || processStatus === 'queued';

    return (
        <div className="process-detail">
            {/* Header */}
            <div className="detail-header">
                <h2 className="detail-title">{process.title || process.prompt || process.id}</h2>
                <span className={`status-badge status-${processStatus}`}>
                    {processStatus}
                </span>
                {process.createdAt && (
                    <span className="detail-time">{new Date(process.createdAt).toLocaleString()}</span>
                )}
            </div>

            {/* Conversation */}
            <div className="conversation-scroll">
                {process.turns.map((turn, i) => (
                    <div key={i} className={`turn turn-${turn.role}`}>
                        <div className="turn-header">
                            <span className="turn-role-label">
                                {turn.role === 'user' ? '👤 User' : '🤖 Assistant'}
                            </span>
                            {turn.timestamp && (
                                <span className="turn-time">{new Date(turn.timestamp).toLocaleTimeString()}</span>
                            )}
                        </div>
                        <div className="turn-body">{turn.content}</div>
                        {turn.toolCalls && turn.toolCalls.length > 0 && (
                            <div className="tool-calls">
                                {turn.toolCalls.map((tc, j) => (
                                    <ToolCallView key={j} toolCall={tc} />
                                ))}
                            </div>
                        )}
                    </div>
                ))}

                {/* Active tool calls */}
                {activeTools.length > 0 && (
                    <div className="turn turn-assistant">
                        <div className="tool-calls">
                            {activeTools.map(tc => (
                                <ToolCallView key={tc.callId} toolCall={{
                                    name: tc.name,
                                    callId: tc.callId,
                                    result: tc.result,
                                }} />
                            ))}
                        </div>
                    </div>
                )}

                {/* Streaming indicator */}
                {(streamingContent || isStreaming) && (
                    <div className="turn turn-assistant streaming">
                        <div className="turn-header">
                            <span className="turn-role-label">🤖 Assistant</span>
                            <span className="streaming-indicator">● streaming</span>
                        </div>
                        <div className="turn-body">{streamingContent || '…'}</div>
                    </div>
                )}

                <div ref={conversationEndRef} />
            </div>

            {/* Follow-up input — always shown for active processes */}
            {isActive && (
                <form className="followup-form" onSubmit={handleFollowUp}>
                    <input
                        type="text"
                        className="followup-input"
                        placeholder="Send a follow-up message…"
                        value={followUp}
                        onChange={e => setFollowUp(e.target.value)}
                    />
                    <button type="submit" className="followup-btn" disabled={!followUp.trim()}>
                        Send
                    </button>
                </form>
            )}
        </div>
    );
}

function ToolCallView({ toolCall }: { toolCall: ToolCall }) {
    const [expanded, setExpanded] = useState(false);
    const name = toolCall.name || toolCall.type || 'tool';
    const hasResult = toolCall.result != null;

    return (
        <div className="tool-call">
            <div className="tool-call-header" onClick={() => hasResult && setExpanded(!expanded)}>
                <span className="tool-call-name">🔧 {name}</span>
                {!hasResult && <span className="tool-call-spinner">⟳</span>}
                {hasResult && (
                    <span className="tool-call-toggle">{expanded ? '▾' : '▸'}</span>
                )}
            </div>
            {expanded && toolCall.result && (
                <pre className="tool-call-result">
                    {typeof toolCall.result === 'string'
                        ? toolCall.result.slice(0, 2000)
                        : JSON.stringify(toolCall.result, null, 2).slice(0, 2000)}
                </pre>
            )}
        </div>
    );
}

function normalizeTurns(turns: any[]): Turn[] {
    if (!Array.isArray(turns)) return [];
    return turns.map((t: any) => ({
        role: t.role || (t.type === 'user' ? 'user' : 'assistant'),
        content: t.content || t.message || '',
        timestamp: t.timestamp,
        toolCalls: (t.toolCalls || t.tool_calls || []).map((tc: any) => ({
            name: tc.name || tc.type,
            callId: tc.callId || tc.call_id,
            type: tc.type,
            arguments: tc.arguments,
            result: tc.result,
        })),
    }));
}

function normalize(data: any): ProcessDetailType {
    return {
        id: data.id || '',
        title: data.title || data.prompt || data.id,
        prompt: data.prompt,
        status: data.status,
        createdAt: data.createdAt || data.created_at,
        updatedAt: data.updatedAt || data.updated_at,
        workspaceId: data.workspaceId || data.workspace_id,
        turns: normalizeTurns(data.turns),
    };
}
