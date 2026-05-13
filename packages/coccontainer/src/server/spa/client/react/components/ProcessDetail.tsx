/**
 * ProcessDetail — main content area showing a process conversation.
 *
 * Mirrors CoC's process detail view:
 *   - Header with title, status badge, timestamps
 *   - Conversation turns (user / assistant) with tool calls
 *   - Live streaming indicator
 *   - Follow-up input for active processes
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

export function ProcessDetail({ agentId, processId, streamEvents, onSendFollowUp }: ProcessDetailProps) {
    const [process, setProcess] = useState<ProcessDetailType | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [streamingContent, setStreamingContent] = useState('');
    const [followUp, setFollowUp] = useState('');
    const conversationEndRef = useRef<HTMLDivElement>(null);

    // Fetch process detail
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setStreamingContent('');

        fetchApi(`/api/agent/${agentId}/processes/${processId}`)
            .then(data => {
                if (cancelled) return;
                setProcess(normalize(data));
                setLoading(false);
            })
            .catch(err => {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : String(err));
                setLoading(false);
            });

        return () => { cancelled = true; };
    }, [agentId, processId]);

    // Handle streaming events
    useEffect(() => {
        const last = streamEvents[streamEvents.length - 1];
        if (!last || last.agentId !== agentId) return;

        if (last.processId === processId || last.id === processId) {
            if (last.type === 'streaming-content' || last.type === 'content-delta') {
                setStreamingContent(prev => prev + (last.chunk || last.delta || ''));
            }
            if (last.type === 'process-updated' || last.type === 'process-completed' || last.type === 'turn-complete') {
                // Re-fetch to get latest turns
                setStreamingContent('');
                fetchApi(`/api/agent/${agentId}/processes/${processId}`)
                    .then(data => setProcess(normalize(data)))
                    .catch(() => {});
            }
        }
    }, [streamEvents, agentId, processId]);

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

    const isActive = process.status === 'running' || process.status === 'queued';

    return (
        <div className="process-detail">
            {/* Header */}
            <div className="detail-header">
                <h2 className="detail-title">{process.title || process.prompt || process.id}</h2>
                <span className={`status-badge status-${process.status || 'unknown'}`}>
                    {process.status || 'unknown'}
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

                {/* Streaming indicator */}
                {streamingContent && (
                    <div className="turn turn-assistant streaming">
                        <div className="turn-header">
                            <span className="turn-role-label">🤖 Assistant</span>
                            <span className="streaming-indicator">● streaming</span>
                        </div>
                        <div className="turn-body">{streamingContent}</div>
                    </div>
                )}

                <div ref={conversationEndRef} />
            </div>

            {/* Follow-up input */}
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

function normalize(data: any): ProcessDetailType {
    return {
        id: data.id || '',
        title: data.title || data.prompt || data.id,
        prompt: data.prompt,
        status: data.status,
        createdAt: data.createdAt || data.created_at,
        updatedAt: data.updatedAt || data.updated_at,
        workspaceId: data.workspaceId || data.workspace_id,
        turns: Array.isArray(data.turns)
            ? data.turns.map((t: any) => ({
                role: t.role || (t.type === 'user' ? 'user' : 'assistant'),
                content: t.content || t.message || '',
                timestamp: t.timestamp,
                toolCalls: (t.toolCalls || t.tool_calls || []).map((tc: any) => ({
                    name: tc.name || tc.type,
                    type: tc.type,
                    arguments: tc.arguments,
                    result: tc.result,
                })),
            }))
            : [],
    };
}
