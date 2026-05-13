/**
 * Agent-grouped Repo View
 *
 * Shows agents as collapsible cards. Expanding an agent shows its repos.
 * Clicking a repo shows its processes.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { Agent, RemoteWorkspace, RemoteProcess } from '../types';
import { fetchApi } from '../hooks/useAgents';

interface AgentRepoViewProps {
    agents: Agent[];
    onProcessSelect: (agentId: string, processId: string) => void;
    events: any[];
}

interface AgentExpansion {
    workspaces: RemoteWorkspace[];
    loading: boolean;
    error?: string;
    selectedWorkspaceId?: string;
    processes: RemoteProcess[];
    processesLoading: boolean;
}

export function AgentRepoView({ agents, onProcessSelect, events }: AgentRepoViewProps) {
    const [expanded, setExpanded] = useState<Record<string, AgentExpansion>>({});

    const toggleAgent = useCallback(async (agent: Agent) => {
        if (expanded[agent.id]?.workspaces) {
            // Collapse
            setExpanded(prev => {
                const next = { ...prev };
                delete next[agent.id];
                return next;
            });
            return;
        }

        // Expand — fetch workspaces
        setExpanded(prev => ({
            ...prev,
            [agent.id]: { workspaces: [], loading: true, processes: [], processesLoading: false },
        }));

        try {
            const data = await fetchApi(`/api/agent/${agent.id}/workspaces`);
            const workspaces: RemoteWorkspace[] = Array.isArray(data) ? data : (data?.workspaces ?? []);
            setExpanded(prev => ({
                ...prev,
                [agent.id]: { ...prev[agent.id], workspaces, loading: false },
            }));
        } catch (err) {
            setExpanded(prev => ({
                ...prev,
                [agent.id]: {
                    ...prev[agent.id],
                    loading: false,
                    error: err instanceof Error ? err.message : String(err),
                },
            }));
        }
    }, [expanded]);

    const selectWorkspace = useCallback(async (agentId: string, ws: RemoteWorkspace) => {
        setExpanded(prev => ({
            ...prev,
            [agentId]: { ...prev[agentId], selectedWorkspaceId: ws.id, processes: [], processesLoading: true },
        }));

        try {
            const data = await fetchApi(`/api/agent/${agentId}/workspaces/${ws.id}/processes`);
            const processes: RemoteProcess[] = Array.isArray(data) ? data : (data?.processes ?? []);
            setExpanded(prev => ({
                ...prev,
                [agentId]: { ...prev[agentId], processes, processesLoading: false },
            }));
        } catch {
            setExpanded(prev => ({
                ...prev,
                [agentId]: { ...prev[agentId], processesLoading: false },
            }));
        }
    }, []);

    if (agents.length === 0) return null;

    return (
        <section className="agent-repo-view">
            {agents.map(agent => {
                const exp = expanded[agent.id];
                const isExpanded = !!exp;

                return (
                    <div key={agent.id} className="agent-card">
                        <div
                            className="agent-card-header"
                            onClick={() => toggleAgent(agent)}
                        >
                            <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
                            <span className={`status-dot ${agent.status}`} />
                            <span className="agent-card-name">{agent.name}</span>
                            <span className="agent-card-address">{agent.address}</span>
                            {isExpanded && exp.workspaces.length > 0 && (
                                <span className="agent-card-count">
                                    {exp.workspaces.length} repo{exp.workspaces.length !== 1 ? 's' : ''}
                                </span>
                            )}
                        </div>

                        {isExpanded && (
                            <div className="agent-card-body">
                                {exp.loading && (
                                    <div className="loading-text">Loading repos…</div>
                                )}
                                {exp.error && (
                                    <div className="error-text">{exp.error}</div>
                                )}
                                {!exp.loading && !exp.error && exp.workspaces.length === 0 && (
                                    <div className="empty-text">No repos on this agent.</div>
                                )}

                                <div className="workspace-list">
                                    {exp.workspaces.map(ws => (
                                        <div
                                            key={ws.id}
                                            className={`workspace-item ${exp.selectedWorkspaceId === ws.id ? 'selected' : ''}`}
                                            onClick={() => selectWorkspace(agent.id, ws)}
                                        >
                                            <span
                                                className="ws-color-dot"
                                                style={{ background: ws.color || '#848484' }}
                                            />
                                            <span className="ws-name">
                                                {ws.name || ws.rootPath || ws.id}
                                            </span>
                                            {ws.gitInfo?.branch && (
                                                <span className="ws-branch">{ws.gitInfo.branch}</span>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {/* Processes for selected workspace */}
                                {exp.selectedWorkspaceId && (
                                    <div className="process-list">
                                        {exp.processesLoading && (
                                            <div className="loading-text">Loading processes…</div>
                                        )}
                                        {!exp.processesLoading && exp.processes.length === 0 && (
                                            <div className="empty-text">No processes.</div>
                                        )}
                                        {exp.processes.map(proc => (
                                            <div
                                                key={proc.id}
                                                className="process-item"
                                                onClick={() => onProcessSelect(agent.id, proc.id)}
                                            >
                                                <span className={`process-status ${proc.status || 'unknown'}`}>
                                                    {statusIcon(proc.status)}
                                                </span>
                                                <span className="process-title">
                                                    {proc.title || proc.id}
                                                </span>
                                                {proc.createdAt && (
                                                    <span className="process-time">
                                                        {new Date(proc.createdAt).toLocaleString()}
                                                    </span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </section>
    );
}

function statusIcon(status?: string): string {
    switch (status) {
        case 'completed': return '✓';
        case 'failed': return '✗';
        case 'running': return '⏳';
        case 'queued': return '⏸';
        case 'cancelled': return '⊘';
        default: return '•';
    }
}
