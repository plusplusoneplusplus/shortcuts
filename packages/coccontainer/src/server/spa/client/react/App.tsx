/**
 * CoCContainer SPA Root Component
 *
 * Mirrors CoC's layout:
 *   Top bar   — hamburger, brand, repo tabs grouped by agent, "+" menu, settings
 *   Sub-tab   — Activity | Git | Schedules | Explorer | Pull Requests | Plans | Settings
 *   Left      — process sidebar (queue tasks)
 *   Main      — conversation / empty state
 *
 * Key differences from CoC:
 *   - Repos come from multiple agents
 *   - Chat creation goes through the queue system: POST /api/agent/:agentId/queue/tasks
 *   - Process listing comes from queue: GET /api/agent/:agentId/queue/tasks
 *   - Follow-ups via: POST /api/agent/:agentId/processes/:processId/message
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { TopBar } from './components/TopBar';
import { ProcessSidebar } from './components/ProcessSidebar';
import { ProcessDetail } from './components/ProcessDetail';
import { AddAgentDialog } from './components/AddAgentDialog';
import { AddRepoDialog } from './components/AddRepoDialog';
import { AgentSettings } from './components/AgentSettings';
import { useAgents, fetchApi } from './hooks/useAgents';
import type { RemoteWorkspace, QueueTask } from './types';

/** A workspace tagged with which agent it belongs to */
export interface TaggedWorkspace extends RemoteWorkspace {
    agentId: string;
    agentName: string;
}

type DialogState = 'none' | 'add-agent' | 'add-repo' | 'settings';

const SUB_TABS = ['Activity', 'Git', 'Schedules', 'Explorer', 'Pull Requests', 'Plans', 'Settings'] as const;
type SubTab = typeof SUB_TABS[number];

export function App() {
    const { agents, loading: agentsLoading, refresh: refreshAgents, addAgent, removeAgent } = useAgents();
    const [workspaces, setWorkspaces] = useState<TaggedWorkspace[]>([]);
    const [selectedWsId, setSelectedWsId] = useState<string | null>(null);
    const [tasks, setTasks] = useState<QueueTask[]>([]);
    const [tasksLoading, setTasksLoading] = useState(false);
    const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<SubTab>('Activity');
    const [dialog, setDialog] = useState<DialogState>('none');
    const [streamEvents, setStreamEvents] = useState<any[]>([]);

    // SSE connection for container-level events
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

    // Fetch queue tasks when workspace changes
    useEffect(() => {
        if (!selectedWs) {
            setTasks([]);
            setSelectedProcessId(null);
            return;
        }
        let cancelled = false;
        setTasksLoading(true);
        fetchApi(`/api/agent/${selectedWs.agentId}/queue/tasks`)
            .then(data => {
                if (cancelled) return;
                const allTasks: QueueTask[] = Array.isArray(data) ? data : (data?.tasks ?? []);
                // Filter tasks by workspaceId on client side
                const filtered = allTasks.filter(t =>
                    t.payload?.workspaceId === selectedWs.id
                );
                setTasks(filtered);
                setTasksLoading(false);
            })
            .catch(() => {
                if (!cancelled) { setTasks([]); setTasksLoading(false); }
            });
        return () => { cancelled = true; };
    }, [selectedWs?.id, selectedWs?.agentId]);

    // Refresh tasks on relevant stream events
    useEffect(() => {
        if (!selectedWs) return;
        const last = streamEvents[streamEvents.length - 1];
        if (!last || last.agentId !== selectedWs.agentId) return;
        if (last.type === 'process-updated' || last.type === 'process-completed' ||
            last.type === 'process-created' || last.type === 'task-updated' ||
            last.type === 'task-completed' || last.type === 'task-created') {
            fetchApi(`/api/agent/${selectedWs.agentId}/queue/tasks`)
                .then(data => {
                    const allTasks: QueueTask[] = Array.isArray(data) ? data : (data?.tasks ?? []);
                    setTasks(allTasks.filter(t => t.payload?.workspaceId === selectedWs.id));
                })
                .catch(() => {});
        }
    }, [streamEvents, selectedWs]);

    // Reset tab when workspace changes
    useEffect(() => {
        setActiveTab('Activity');
    }, [selectedWsId]);

    // Create chat via queue system
    const handleNewChat = useCallback(async (message: string) => {
        if (!selectedWs) return;
        try {
            const result = await fetchApi(`/api/agent/${selectedWs.agentId}/queue/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'chat',
                    priority: 'normal',
                    payload: {
                        kind: 'chat',
                        mode: 'ask',
                        prompt: message,
                        workspaceId: selectedWs.id,
                    },
                }),
            });
            // Refresh task list
            const data = await fetchApi(`/api/agent/${selectedWs.agentId}/queue/tasks`);
            const allTasks: QueueTask[] = Array.isArray(data) ? data : (data?.tasks ?? []);
            setTasks(allTasks.filter(t => t.payload?.workspaceId === selectedWs.id));
            // Select the new process
            const task = result?.task || result;
            if (task?.processId) setSelectedProcessId(task.processId);
            else if (task?.id) setSelectedProcessId(task.id);
        } catch (err) { console.error('Failed to create chat:', err); }
    }, [selectedWs]);

    // Follow-up messages
    const handleSendFollowUp = useCallback(async (processId: string, message: string) => {
        if (!selectedWs) return;
        try {
            await fetchApi(`/api/agent/${selectedWs.agentId}/processes/${processId}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: message }),
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
                    {SUB_TABS.map(tab => (
                        <button
                            key={tab}
                            className={`sub-tab ${activeTab === tab ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab)}
                        >
                            {tab}
                        </button>
                    ))}
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
                ) : activeTab === 'Activity' ? (
                    <>
                        {/* Left sidebar — task list */}
                        <ProcessSidebar
                            tasks={tasks}
                            loading={tasksLoading}
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
                ) : (
                    /* Placeholder for non-Activity tabs */
                    <div className="empty-body">
                        <div className="empty-chat-icon">🚧</div>
                        <h2>{activeTab}</h2>
                        <p>Coming soon — view on agent directly</p>
                        {selectedWs.agentAddress && (
                            <p className="placeholder-agent-link">
                                Agent: <a href={selectedWs.agentAddress} target="_blank" rel="noopener noreferrer">
                                    {selectedWs.agentAddress}
                                </a>
                            </p>
                        )}
                    </div>
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
