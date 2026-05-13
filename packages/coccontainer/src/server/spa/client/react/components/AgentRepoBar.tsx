/**
 * AgentRepoBar — top bar with agent tabs and repo dropdown.
 *
 * Mirrors CoC's RepoTabStrip but adds an agent layer:
 *   [Agent1 ▾]  [Agent2 ▾]  [+ Agent]  [⚙]
 *
 * Clicking an agent opens a dropdown of its repos.
 * Selecting a repo updates the selection.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { fetchApi } from '../hooks/useAgents';
import type { Agent, RemoteWorkspace, Selection } from '../types';

interface AgentRepoBarProps {
    agents: Agent[];
    selection: Selection | null;
    onSelect: (selection: Selection) => void;
    onOpenSettings: () => void;
}

interface DropdownState {
    agentId: string;
    workspaces: RemoteWorkspace[];
    loading: boolean;
    error?: string;
}

export function AgentRepoBar({ agents, selection, onSelect, onOpenSettings }: AgentRepoBarProps) {
    const [dropdown, setDropdown] = useState<DropdownState | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdown(null);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const toggleDropdown = useCallback(async (agent: Agent) => {
        if (dropdown?.agentId === agent.id) {
            setDropdown(null);
            return;
        }

        setDropdown({ agentId: agent.id, workspaces: [], loading: true });

        try {
            const data = await fetchApi(`/api/agent/${agent.id}/workspaces`);
            const workspaces: RemoteWorkspace[] = Array.isArray(data)
                ? data : (data?.workspaces ?? []);
            setDropdown({ agentId: agent.id, workspaces, loading: false });
        } catch (err) {
            setDropdown({
                agentId: agent.id,
                workspaces: [],
                loading: false,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }, [dropdown]);

    const handleSelectWorkspace = useCallback((agentId: string, ws: RemoteWorkspace) => {
        onSelect({ agentId, workspaceId: ws.id });
        setDropdown(null);
    }, [onSelect]);

    // Find selected agent/workspace names for the active indicator
    const selectedAgent = agents.find(a => a.id === selection?.agentId);

    return (
        <header className="top-bar">
            <div className="top-bar-brand">
                <span className="top-bar-logo">🔗</span>
                <span className="top-bar-title">CoCContainer</span>
            </div>

            <div className="top-bar-agents" ref={dropdownRef}>
                {agents.map(agent => {
                    const isActive = selection?.agentId === agent.id;
                    const isOpen = dropdown?.agentId === agent.id;

                    return (
                        <div key={agent.id} className="agent-tab-wrapper">
                            <button
                                className={`agent-tab ${isActive ? 'active' : ''} ${isOpen ? 'open' : ''}`}
                                onClick={() => toggleDropdown(agent)}
                            >
                                <span className={`status-dot-sm ${agent.status}`} />
                                <span className="agent-tab-name">{agent.name}</span>
                                <span className="agent-tab-arrow">{isOpen ? '▴' : '▾'}</span>
                            </button>

                            {/* Repo dropdown */}
                            {isOpen && dropdown && (
                                <div className="repo-dropdown">
                                    {dropdown.loading && (
                                        <div className="repo-dropdown-loading">Loading repos…</div>
                                    )}
                                    {dropdown.error && (
                                        <div className="repo-dropdown-error">⚠ {dropdown.error}</div>
                                    )}
                                    {!dropdown.loading && !dropdown.error && dropdown.workspaces.length === 0 && (
                                        <div className="repo-dropdown-empty">No repos on this agent</div>
                                    )}
                                    {dropdown.workspaces.map(ws => (
                                        <button
                                            key={ws.id}
                                            className={`repo-dropdown-item ${
                                                selection?.agentId === agent.id && selection?.workspaceId === ws.id ? 'selected' : ''
                                            }`}
                                            onClick={() => handleSelectWorkspace(agent.id, ws)}
                                        >
                                            <span
                                                className="repo-dot"
                                                style={{ background: ws.color || '#848484' }}
                                            />
                                            <span className="repo-name">
                                                {ws.name || lastSegment(ws.rootPath) || ws.id}
                                            </span>
                                            {ws.gitInfo?.branch && (
                                                <span className="repo-branch">{ws.gitInfo.branch}</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Selection indicator */}
            {selectedAgent && selection && (
                <div className="top-bar-selection">
                    <span className="selection-agent">{selectedAgent.name}</span>
                    <span className="selection-sep">/</span>
                    <span className="selection-repo">{selection.workspaceId.slice(0, 12)}</span>
                </div>
            )}

            <div className="top-bar-actions">
                <button className="top-bar-btn" onClick={onOpenSettings} title="Agent settings">
                    ⚙
                </button>
            </div>
        </header>
    );
}

function lastSegment(p?: string): string {
    if (!p) return '';
    const cleaned = p.replace(/[\\/]+$/, '');
    const idx = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'));
    return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}
