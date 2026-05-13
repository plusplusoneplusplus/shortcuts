/**
 * CoCContainer SPA Root Component
 *
 * Mirrors CoC's layout exactly:
 *   Top bar   — hamburger, brand, repo tabs (from all agents), "+" menu, action buttons
 *   Left      — process sidebar (activity list, filters)
 *   Main      — conversation / empty state
 *
 * Key difference from CoC: repos come from multiple agents.
 * "+" menu has "Add agent" option. "Add Repo" dialog includes agent selector.
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { TopBar } from './components/TopBar';
import { ProcessSidebar } from './components/ProcessSidebar';
import { ProcessDetail } from './components/ProcessDetail';
import { AddAgentDialog } from './components/AddAgentDialog';
import { AddRepoDialog } from './components/AddRepoDialog';
import { AgentSettings } from './components/AgentSettings';
import { useAgents, fetchApi } from './hooks/useAgents';
import type { RemoteWorkspace, RemoteProcess } from './types';

/** A workspace tagged with which agent it belongs to */
export interface TaggedWorkspace extends RemoteWorkspace {
    agentId: string;
    agentName: string;
}

type DialogState = 'none' | 'add-agent' | 'add-repo' | 'settings';

export function App() {
    const { agents, loading: agentsLoading, refresh: refreshAgents, addAgent, removeAgent } = useAgents();
    const [workspaces, setWorkspaces] = useState<TaggedWorkspace[]>([]);
    const [selectedWsId, setSelectedWsId] = useState<string | null>(null);
    const [processes, setProcesses] = useState<RemoteProcess[]>([]);
    const [processesLoading, setProcessesLoading] = useState(false);
    const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
    const [dialog, setDialog] = useState<DialogState>('none');
    const [streamEvents, setStreamEvents] = useState<any[]>([]);

    // SSE connection
    useEffect(() => {
        const es = new EventSource('/api/events');
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

    // Fetch workspaces from all agents
    const refreshWorkspaces = useCallback(async () => {
        const results: TaggedWorkspace[] = [];
        await Promise.all(agents.map(async (agent) => {
            if (agent.status === 'offline') return;
            try {
                const data = await fetchApi(`/api/agent/${agent.id}/workspaces`);
                const wsList: RemoteWorkspace[] = Array.isArray(data) ? data : (data?.workspaces ?? []);
                for (const ws of wsList) {
                    results.push({ ...ws, agentId: agent.id, agentName: agent.name });
                }
            } catch { /* skip unavailable agents */ }
        }));
        setWorkspaces(results);
    }, [agents]);

    useEffect(() => {
        if (agents.length > 0) refreshWorkspaces();
        else setWorkspaces([]);
    }, [agents, refreshWorkspaces]);

    // Currently selected workspace
    const selectedWs = useMemo(
        () => workspaces.find(ws => ws.id === selectedWsId) ?? null,
        [workspaces, selectedWsId]
    );

    // Fetch processes when workspace changes
    useEffect(() => {
        if (!selectedWs) {
            setProcesses([]);
            setSelectedProcessId(null);
            return;
        }
        let cancelled = false;
        setProcessesLoading(true);
        fetchApi(`/api/agent/${selectedWs.agentId}/workspaces/${selectedWs.id}/processes`)
            .then(data => {
                if (cancelled) return;
                const list: RemoteProcess[] = Array.isArray(data) ? data : (data?.processes ?? []);
                setProcesses(list);
                setProcessesLoading(false);
            })
            .catch(() => {
                if (!cancelled) { setProcesses([]); setProcessesLoading(false); }
            });
        return () => { cancelled = true; };
    }, [selectedWs?.id, selectedWs?.agentId]);

    // Refresh processes on stream events
    useEffect(() => {
        if (!selectedWs) return;
        const last = streamEvents[streamEvents.length - 1];
        if (!last || last.agentId !== selectedWs.agentId) return;
        if (last.type === 'process-updated' || last.type === 'process-completed' || last.type === 'process-created') {
            fetchApi(`/api/agent/${selectedWs.agentId}/workspaces/${selectedWs.id}/processes`)
                .then(data => setProcesses(Array.isArray(data) ? data : (data?.processes ?? [])))
                .catch(() => {});
        }
    }, [streamEvents, selectedWs]);

    const handleNewChat = useCallback(async (message: string) => {
        if (!selectedWs) return;
        try {
            const result = await fetchApi(`/api/agent/${selectedWs.agentId}/processes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: message, workspaceId: selectedWs.id }),
            });
            const data = await fetchApi(`/api/agent/${selectedWs.agentId}/workspaces/${selectedWs.id}/processes`);
            setProcesses(Array.isArray(data) ? data : (data?.processes ?? []));
            if (result?.id) setSelectedProcessId(result.id);
        } catch (err) { console.error('Failed to create process:', err); }
    }, [selectedWs]);

    const handleSendFollowUp = useCallback(async (processId: string, message: string) => {
        if (!selectedWs) return;
        try {
            await fetchApi(`/api/agent/${selectedWs.agentId}/processes/${processId}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message }),
            });
        } catch (err) { console.error('Failed to send follow-up:', err); }
    }, [selectedWs]);

    const handleAddAgent = useCallback(async (address: string, name?: string) => {
        await addAgent(address, name);
        setDialog('none');
    }, [addAgent]);

    const handleAddRepo = useCallback(async (agentId: string, path: string, name: string, color: string) => {
        try {
            await fetchApi(`/api/agent/${agentId}/workspaces`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rootPath: path, name, color }),
            });
            await refreshWorkspaces();
            setDialog('none');
        } catch (err) { console.error('Failed to add repo:', err); }
    }, [refreshWorkspaces]);

    return (
        <div className="app-shell">
            {/* ── Top bar ── */}
            <TopBar
                workspaces={workspaces}
                selectedWsId={selectedWsId}
                onSelectWorkspace={setSelectedWsId}
                onAddAgent={() => setDialog('add-agent')}
                onAddRepo={() => setDialog('add-repo')}
                onOpenSettings={() => setDialog('settings')}
                selectedWs={selectedWs}
            />

            {/* ── Sub-tab bar (only when a workspace is selected) ── */}
            {dialog !== 'settings' && selectedWs && (
                <div className="sub-tab-bar">
                    <span className="sub-tab-repo-name">
                        <span className="sub-tab-dot" style={{ background: selectedWs.color || '#848484' }} />
                        {selectedWs.name || selectedWs.rootPath || selectedWs.id}
                    </span>
                    <span className="sub-tab active">Activity</span>
                    <span className="sub-tab-agent-badge">{selectedWs.agentName}</span>
                </div>
            )}

            {/* ── Body ── */}
            <div className="app-body">
                {dialog === 'settings' ? (
                    <div className="settings-container">
                        <AgentSettings
                            agents={agents}
                            loading={agentsLoading}
                            onAdd={addAgent}
                            onRemove={removeAgent}
                            onRefresh={refreshAgents}
                            onClose={() => setDialog('none')}
                        />
                    </div>
                ) : !selectedWs ? (
                    <div className="empty-body">
                        <div className="empty-chat-icon">💬</div>
                        <h2>Start a new conversation</h2>
                        <p>Select a repo from the top bar to begin, or add a new agent.</p>
                    </div>
                ) : (
                    <>
                        {/* Left sidebar — process list */}
                        <ProcessSidebar
                            processes={processes}
                            loading={processesLoading}
                            selectedProcessId={selectedProcessId}
                            onSelect={setSelectedProcessId}
                            onNewChat={handleNewChat}
                        />

                        {/* Main area — process detail */}
                        <main className="main-content">
                            {selectedProcessId && selectedWs ? (
                                <ProcessDetail
                                    agentId={selectedWs.agentId}
                                    processId={selectedProcessId}
                                    streamEvents={streamEvents}
                                    onSendFollowUp={handleSendFollowUp}
                                />
                            ) : (
                                <div className="empty-detail">
                                    <div className="empty-chat-icon">💬</div>
                                    <p>Start a new conversation</p>
                                    <p className="empty-detail-sub">Type a message below to begin</p>
                                </div>
                            )}
                        </main>
                    </>
                )}
            </div>

            {/* ── Dialogs ── */}
            {dialog === 'add-agent' && (
                <AddAgentDialog
                    onAdd={handleAddAgent}
                    onClose={() => setDialog('none')}
                />
            )}
            {dialog === 'add-repo' && (
                <AddRepoDialog
                    agents={agents}
                    onAdd={handleAddRepo}
                    onClose={() => setDialog('none')}
                />
            )}
        </div>
    );
}
