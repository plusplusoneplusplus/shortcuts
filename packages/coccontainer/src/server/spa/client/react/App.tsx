/**
 * CoCContainer SPA Root Component
 *
 * Two-panel layout:
 *   Left sidebar  — agent list with expandable repo dropdowns
 *   Main area     — iframe showing the selected CoC agent dashboard (full CoC UI)
 *
 * The iframe loads the real CoC SPA directly from the agent address,
 * giving 100 % feature parity without duplicating any CoC code.
 */

import React, { useState, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { AgentSettings } from './components/AgentSettings';
import { useAgents } from './hooks/useAgents';
import type { RemoteWorkspace } from './types';

type View = 'dashboard' | 'settings';

export interface IframeTarget {
    agentId: string;
    agentName: string;
    agentAddress: string;
    /** If set, deep-link into this workspace via hash */
    workspace?: RemoteWorkspace;
}

export function App() {
    const { agents, loading, refresh, addAgent, removeAgent } = useAgents();
    const [view, setView] = useState<View>('dashboard');
    const [iframeTarget, setIframeTarget] = useState<IframeTarget | null>(null);

    const handleSelectAgent = useCallback((agentId: string) => {
        const agent = agents.find(a => a.id === agentId);
        if (!agent) return;
        setIframeTarget({ agentId: agent.id, agentName: agent.name, agentAddress: agent.address });
        setView('dashboard');
    }, [agents]);

    const handleSelectWorkspace = useCallback((agentId: string, ws: RemoteWorkspace) => {
        const agent = agents.find(a => a.id === agentId);
        if (!agent) return;
        setIframeTarget({
            agentId: agent.id,
            agentName: agent.name,
            agentAddress: agent.address,
            workspace: ws,
        });
        setView('dashboard');
    }, [agents]);

    // Build the iframe URL — CoC uses hash routing, so we can deep-link
    const iframeSrc = iframeTarget
        ? iframeTarget.workspace
            ? `${iframeTarget.agentAddress}#repos/${iframeTarget.workspace.id}`
            : iframeTarget.agentAddress
        : '';

    return (
        <div className="container-layout">
            {/* ── Left sidebar ─────────────────────────── */}
            <Sidebar
                agents={agents}
                loading={loading}
                selectedAgentId={iframeTarget?.agentId ?? null}
                selectedWorkspaceId={iframeTarget?.workspace?.id ?? null}
                onSelectAgent={handleSelectAgent}
                onSelectWorkspace={handleSelectWorkspace}
                onOpenSettings={() => setView('settings')}
            />

            {/* ── Main area ────────────────────────────── */}
            <main className="main-panel">
                {view === 'settings' && (
                    <AgentSettings
                        agents={agents}
                        loading={loading}
                        onAdd={addAgent}
                        onRemove={removeAgent}
                        onRefresh={refresh}
                        onClose={() => setView('dashboard')}
                    />
                )}

                {view === 'dashboard' && !iframeTarget && (
                    <div className="empty-main">
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
                                <div className="empty-icon">👈</div>
                                <h2>Select a repo</h2>
                                <p>Expand an agent in the sidebar and pick a repo to view its dashboard.</p>
                            </>
                        )}
                    </div>
                )}

                {view === 'dashboard' && iframeTarget && (
                    <div className="iframe-wrapper">
                        <div className="iframe-bar">
                            <span className="iframe-agent-name">{iframeTarget.agentName}</span>
                            {iframeTarget.workspace && (
                                <span className="iframe-workspace-name">
                                    / {iframeTarget.workspace.name || iframeTarget.workspace.rootPath}
                                </span>
                            )}
                            <a
                                className="iframe-open-link"
                                href={iframeSrc}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Open in new tab"
                            >
                                ↗
                            </a>
                        </div>
                        <iframe
                            key={iframeSrc}
                            className="agent-iframe"
                            src={iframeSrc}
                            title={`${iframeTarget.agentName} dashboard`}
                        />
                    </div>
                )}
            </main>
        </div>
    );
}
