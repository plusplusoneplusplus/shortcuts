/**
 * Process View — shows process detail from a remote agent.
 *
 * Fetches process data via the proxy API and renders conversation turns,
 * with live streaming updates from SSE/WS events.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../hooks/useAgents';

interface ProcessViewProps {
    agentId: string;
    processId: string;
    events: any[];
}

interface Turn {
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
    toolCalls?: any[];
}

interface ProcessData {
    id: string;
    title?: string;
    status?: string;
    turns: Turn[];
    createdAt?: string;
}

export function ProcessView({ agentId, processId, events }: ProcessViewProps) {
    const [process, setProcess] = useState<ProcessData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [streamingContent, setStreamingContent] = useState('');

    // Fetch process data
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        fetchApi(`/api/agent/${agentId}/processes/${processId}`)
            .then(data => {
                if (!cancelled) {
                    setProcess(normalizeProcess(data));
                    setLoading(false);
                }
            })
            .catch(err => {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : String(err));
                    setLoading(false);
                }
            });

        return () => { cancelled = true; };
    }, [agentId, processId]);

    // Listen for streaming events for this process
    useEffect(() => {
        const relevantEvents = events.filter(
            e => e.agentId === agentId && e.data?.processId === processId
        );
        if (relevantEvents.length > 0) {
            const last = relevantEvents[relevantEvents.length - 1];
            if (last.data?.type === 'streaming-content') {
                setStreamingContent(prev => prev + (last.data.chunk || ''));
            }
            if (last.data?.type === 'process-updated') {
                // Re-fetch
                fetchApi(`/api/agent/${agentId}/processes/${processId}`)
                    .then(data => setProcess(normalizeProcess(data)))
                    .catch(() => {});
            }
        }
    }, [events, agentId, processId]);

    if (loading) {
        return <div className="process-view loading-text">Loading process…</div>;
    }

    if (error) {
        return <div className="process-view error-text">Error: {error}</div>;
    }

    if (!process) {
        return <div className="process-view empty-text">Process not found.</div>;
    }

    return (
        <div className="process-view">
            <div className="process-header">
                <h2>{process.title || process.id}</h2>
                <span className={`process-status-badge ${process.status || 'unknown'}`}>
                    {process.status || 'unknown'}
                </span>
                {process.createdAt && (
                    <span className="process-created">
                        {new Date(process.createdAt).toLocaleString()}
                    </span>
                )}
            </div>

            <div className="conversation">
                {process.turns.map((turn, i) => (
                    <div key={i} className={`turn turn-${turn.role}`}>
                        <div className="turn-role">{turn.role === 'user' ? '👤 User' : '🤖 Assistant'}</div>
                        <div className="turn-content">
                            {turn.content}
                        </div>
                        {turn.toolCalls && turn.toolCalls.length > 0 && (
                            <div className="tool-calls">
                                {turn.toolCalls.map((tc: any, j: number) => (
                                    <div key={j} className="tool-call">
                                        <span className="tool-name">🔧 {tc.name || tc.type || 'tool'}</span>
                                        {tc.result && (
                                            <pre className="tool-result">{
                                                typeof tc.result === 'string'
                                                    ? tc.result.slice(0, 500)
                                                    : JSON.stringify(tc.result, null, 2).slice(0, 500)
                                            }</pre>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}

                {streamingContent && (
                    <div className="turn turn-assistant streaming">
                        <div className="turn-role">🤖 Assistant (streaming…)</div>
                        <div className="turn-content">{streamingContent}</div>
                    </div>
                )}
            </div>
        </div>
    );
}

function normalizeProcess(data: any): ProcessData {
    return {
        id: data.id || '',
        title: data.title || data.prompt || data.id,
        status: data.status,
        createdAt: data.createdAt || data.created_at,
        turns: Array.isArray(data.turns)
            ? data.turns.map((t: any) => ({
                role: t.role || (t.type === 'user' ? 'user' : 'assistant'),
                content: t.content || t.message || '',
                timestamp: t.timestamp,
                toolCalls: t.toolCalls || t.tool_calls,
            }))
            : [],
    };
}
