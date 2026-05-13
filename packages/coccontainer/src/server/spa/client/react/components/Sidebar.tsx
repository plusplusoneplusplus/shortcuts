/**
 * Sidebar — agent list with expandable repo dropdowns.
 *
 * Each agent is a collapsible group. Expanding it fetches the agent's
 * workspaces and shows them as clickable items.
 */

import React, { useState, useCallback } from 'react';
import { fetchApi } from '../hooks/useAgents';
import type { Agent, RemoteWorkspace } from '../types';

interface SidebarProps {
    agents: Agent[];
    loading: boolean;
    selectedAgentId: string | null;
    selectedWorkspaceId: string | null;
    onSelectAgent: (agentId: string) => void;
    onSelectWorkspace: (agentId: string, ws: RemoteWorkspace) => void;
    onOpenSettings: () => void;
}

interface AgentExpansion {
    workspaces: RemoteWorkspace[];
    loading: boolean;
    error?: string;
}

export function Sidebar({
    agents,
    loading,
    selectedAgentId,
    selectedWorkspaceId,
    onSelectAgent,
    onSelectWorkspace,
    onOpenSettings,
}: SidebarProps) {
    const [expanded, setExpanded] = useState<Record<string, AgentExpansion>>({});

    const toggleAgent = useCallback(async (agent: Agent) => {
        if (expanded[agent.id]) {
            // Collapse
            setExpanded(prev => {
                const next = { ...prev };
                delete next[agent.id];
                return next;
            });
            return;
        }

        // Expand — fetch workspaces from the agent
        setExpanded(prev => ({
            ...prev,
            [agent.id]: { workspaces: [], loading: true },
        }));

        try {
            const data = await fetchApi(`/api/agent/${agent.id}/workspaces`);
            const workspaces: RemoteWorkspace[] = Array.isArray(data) ? data : (data?.workspaces ?? []);
            setExpanded(prev => ({
                ...prev,
                [agent.id]: { workspaces, loading: false },
            }));
        } catch (err) {
            setExpanded(prev => ({
                ...prev,
                [agent.id]: {
                    workspaces: [],
                    loading: false,
                    error: err instanceof Error ? err.message : String(err),
                },
            }));
        }
    }, [expanded]);

    return (
        <aside className="sidebar">
            {/* ── Header ─────────────────────────── */}
            <div className="sidebar-header">
                <span className="sidebar-logo">🔗</span>
                <span className="sidebar-title">CoCContainer</span>
                <button
                    className="sidebar-settings-btn"
                    onClick={onOpenSettings}
                    title="Agent settings"
                >
                    ⚙
                </button>
            </div>

            {/* ── Agent list ─────────────────────── */}
            <div className="sidebar-agents">
                {loading && agents.length === 0 && (
                    <div className="sidebar-loading">Loading agents…</div>
                )}

                {!loading && agents.length === 0 && (
                    <div className="sidebar-empty">
                        <p>No agents</p>
                        <button className="btn-primary btn-sm" onClick={onOpenSettings}>
                            + Add Agent
                        </button>
                    </div>
                )}

                {agents.map(agent => {
                    const exp = expanded[agent.id];
                    const isExpanded = !!exp;

                    return (
                        <div key={agent.id} className="sidebar-agent">
                            {/* Agent row */}
                            <div
                                className={`sidebar-agent-row ${selectedAgentId === agent.id && !selectedWorkspaceId ? 'active' : ''}`}
                                onClick={() => toggleAgent(agent)}
                            >
                                <span className="sidebar-expand-icon">
                                    {isExpanded ? '▾' : '▸'}
                                </span>
                                <span className={`status-dot ${agent.status}`} />
                                <span className="sidebar-agent-name" title={agent.address}>
                                    {agent.name}
                                </span>
                                {isExpanded && exp.workspaces.length > 0 && (
                                    <span className="sidebar-count">{exp.workspaces.length}</span>
                                )}
                            </div>

                            {/* Expanded workspaces */}
                            {isExpanded && (
                                <div className="sidebar-workspaces">
                                    {exp.loading && (
                                        <div className="sidebar-ws-loading">Loading…</div>
                                    )}
                                    {exp.error && (
                                        <div className="sidebar-ws-error" title={exp.error}>⚠ Error</div>
                                    )}
                                    {!exp.loading && !exp.error && exp.workspaces.length === 0 && (
                                        <div className="sidebar-ws-empty">No repos</div>
                                    )}
                                    {exp.workspaces.map(ws => (
                                        <div
                                            key={ws.id}
                                            className={`sidebar-ws-item ${selectedAgentId === agent.id && selectedWorkspaceId === ws.id ? 'active' : ''}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onSelectWorkspace(agent.id, ws);
                                            }}
                                            title={ws.rootPath || ws.id}
                                        >
                                            <span
                                                className="sidebar-ws-dot"
                                                style={{ background: ws.color || '#848484' }}
                                            />
                                            <span className="sidebar-ws-name">
                                                {ws.name || lastPathSegment(ws.rootPath) || ws.id}
                                            </span>
                                            {ws.gitInfo?.branch && (
                                                <span className="sidebar-ws-branch">{ws.gitInfo.branch}</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </aside>
    );
}

function lastPathSegment(p?: string): string {
    if (!p) return '';
    const cleaned = p.replace(/[\\/]+$/, '');
    const idx = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'));
    return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}
