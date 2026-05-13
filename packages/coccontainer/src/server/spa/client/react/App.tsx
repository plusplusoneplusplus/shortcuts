/**
 * CoCContainer SPA Root Component
 *
 * Layout mirrors CoC:
 *   Top bar       — agent selector with repo dropdown (instead of flat repo tabs)
 *   Left sidebar  — process list for the selected agent+repo
 *   Main area     — process detail / conversation view
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { AgentRepoBar } from './components/AgentRepoBar';
import { AgentSettings } from './components/AgentSettings';
import { ProcessSidebar } from './components/ProcessSidebar';
import { ProcessDetail } from './components/ProcessDetail';
import { useAgents, fetchApi } from './hooks/useAgents';
import type { Selection, RemoteProcess } from './types';

type View = 'main' | 'settings';

export function App() {
    const { agents, loading, refresh, addAgent, removeAgent } = useAgents();
    const [view, setView] = useState<View>('main');
    const [selection, setSelection] = useState<Selection | null>(null);
    const [processes, setProcesses] = useState<RemoteProcess[]>([]);
    const [processesLoading, setProcessesLoading] = useState(false);
    const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
    const [streamEvents, setStreamEvents] = useState<any[]>([]);
    const eventSourceRef = useRef<EventSource | null>(null);

    // SSE connection to get streaming events
    useEffect(() => {
        const es = new EventSource('/api/events');
        eventSourceRef.current = es;
        es.onmessage = (e) => {
            try {
                const envelope = JSON.parse(e.data);
                const payload = typeof envelope.payload === 'string'
                    ? JSON.parse(envelope.payload) : envelope.payload;
                setStreamEvents(prev => [...prev.slice(-500), {
                    agentId: envelope.agentId,
                    agentName: envelope.agentName,
                    ...payload,
                }]);
            } catch { /* ignore */ }
        };
        return () => es.close();
    }, []);

    // Fetch processes when selection changes
    useEffect(() => {
        if (!selection) {
            setProcesses([]);
            setSelectedProcessId(null);
            return;
        }
        let cancelled = false;
        setProcessesLoading(true);
        fetchApi(`/api/agent/${selection.agentId}/workspaces/${selection.workspaceId}/processes`)
            .then(data => {
                if (cancelled) return;
                const list: RemoteProcess[] = Array.isArray(data)
                    ? data
                    : (data?.processes ?? []);
                setProcesses(list);
                setProcessesLoading(false);
            })
            .catch(() => {
                if (!cancelled) {
                    setProcesses([]);
                    setProcessesLoading(false);
                }
            });
        return () => { cancelled = true; };
    }, [selection]);

    // Auto-refresh processes when stream events indicate changes
    useEffect(() => {
        if (!selection) return;
        const last = streamEvents[streamEvents.length - 1];
        if (!last) return;
        if (last.agentId === selection.agentId &&
            (last.type === 'process-updated' || last.type === 'process-completed' || last.type === 'process-created')) {
            fetchApi(`/api/agent/${selection.agentId}/workspaces/${selection.workspaceId}/processes`)
                .then(data => {
                    const list: RemoteProcess[] = Array.isArray(data)
                        ? data : (data?.processes ?? []);
                    setProcesses(list);
                })
                .catch(() => {});
        }
    }, [streamEvents, selection]);

    const handleSelectProcess = useCallback((processId: string) => {
        setSelectedProcessId(processId);
    }, []);

    const handleNewChat = useCallback(async (message: string) => {
        if (!selection) return;
        try {
            const result = await fetchApi(`/api/agent/${selection.agentId}/processes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: message,
                    workspaceId: selection.workspaceId,
                }),
            });
            // Refresh process list
            const data = await fetchApi(
                `/api/agent/${selection.agentId}/workspaces/${selection.workspaceId}/processes`
            );
            const list: RemoteProcess[] = Array.isArray(data) ? data : (data?.processes ?? []);
            setProcesses(list);
            // Select the new process
            if (result?.id) {
                setSelectedProcessId(result.id);
            }
        } catch (err) {
            console.error('Failed to create process:', err);
        }
    }, [selection]);

    const handleSendFollowUp = useCallback(async (processId: string, message: string) => {
        if (!selection) return;
        try {
            await fetchApi(`/api/agent/${selection.agentId}/processes/${processId}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message }),
            });
        } catch (err) {
            console.error('Failed to send follow-up:', err);
        }
    }, [selection]);

    return (
        <div className="app-shell">
            {/* ── Top bar ──────────────────────────── */}
            <AgentRepoBar
                agents={agents}
                selection={selection}
                onSelect={setSelection}
                onOpenSettings={() => setView('settings')}
            />

            {/* ── Body ─────────────────────────────── */}
            <div className="app-body">
                {view === 'settings' ? (
                    <div className="settings-container">
                        <AgentSettings
                            agents={agents}
                            loading={loading}
                            onAdd={addAgent}
                            onRemove={removeAgent}
                            onRefresh={refresh}
                            onClose={() => setView('main')}
                        />
                    </div>
                ) : !selection ? (
                    <div className="empty-body">
                        {agents.length === 0 ? (
                            <>
                                <div className="empty-icon">🔗</div>
                                <h2>Welcome to CoCContainer</h2>
                                <p>Add a CoC agent to get started.</p>
                                <button className="btn-primary" onClick={() => setView('settings')}>
                                    + Add Agent
                                </button>
                            </>
                        ) : (
                            <>
                                <div className="empty-icon">📂</div>
                                <h2>Select a repo</h2>
                                <p>Click an agent in the top bar, then pick a repo from the dropdown.</p>
                            </>
                        )}
                    </div>
                ) : (
                    <>
                        {/* Left sidebar — process list */}
                        <ProcessSidebar
                            processes={processes}
                            loading={processesLoading}
                            selectedProcessId={selectedProcessId}
                            onSelect={handleSelectProcess}
                            onNewChat={handleNewChat}
                        />

                        {/* Main area — process detail */}
                        <main className="main-content">
                            {selectedProcessId && selection ? (
                                <ProcessDetail
                                    agentId={selection.agentId}
                                    processId={selectedProcessId}
                                    streamEvents={streamEvents}
                                    onSendFollowUp={handleSendFollowUp}
                                />
                            ) : (
                                <div className="empty-detail">
                                    <p>Select a process from the sidebar, or start a new chat.</p>
                                </div>
                            )}
                        </main>
                    </>
                )}
            </div>
        </div>
    );
}
