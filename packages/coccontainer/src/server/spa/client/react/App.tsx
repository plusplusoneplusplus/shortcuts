/**
 * CoCContainer SPA Root Component
 */

import React, { useState, useEffect, useCallback } from 'react';
import { AgentManagement } from './components/AgentManagement';
import { AgentRepoView } from './components/AgentRepoView';
import { ProcessView } from './components/ProcessView';
import { useAgents } from './hooks/useAgents';
import { useContainerWebSocket } from './hooks/useContainerWebSocket';
import type { Agent, RemoteWorkspace, RemoteProcess } from './types';

type View = 'agents' | 'process';

export function App() {
    const { agents, loading, refresh, addAgent, removeAgent } = useAgents();
    const [view, setView] = useState<View>('agents');
    const [selectedProcess, setSelectedProcess] = useState<{ agentId: string; processId: string } | null>(null);
    const [events, setEvents] = useState<any[]>([]);

    const handleWsMessage = useCallback((msg: any) => {
        setEvents(prev => [...prev.slice(-200), msg]);
    }, []);

    const { status: wsStatus } = useContainerWebSocket({ onMessage: handleWsMessage });

    const handleProcessSelect = useCallback((agentId: string, processId: string) => {
        setSelectedProcess({ agentId, processId });
        setView('process');
    }, []);

    return (
        <div className="app">
            <header className="header">
                <h1>🔗 CoCContainer</h1>
                <span className="subtitle">Multi-Agent Dashboard</span>
                <span className={`ws-status ${wsStatus}`} title={`WebSocket: ${wsStatus}`}>
                    {wsStatus === 'open' ? '●' : '○'}
                </span>
                {view === 'process' && (
                    <button className="btn-back" onClick={() => setView('agents')}>
                        ← Back to Agents
                    </button>
                )}
            </header>

            <main className="main-content">
                {view === 'agents' && (
                    <>
                        <AgentManagement
                            agents={agents}
                            loading={loading}
                            onAdd={addAgent}
                            onRemove={removeAgent}
                            onRefresh={refresh}
                        />
                        <AgentRepoView
                            agents={agents}
                            onProcessSelect={handleProcessSelect}
                            events={events}
                        />
                    </>
                )}

                {view === 'process' && selectedProcess && (
                    <ProcessView
                        agentId={selectedProcess.agentId}
                        processId={selectedProcess.processId}
                        events={events}
                    />
                )}
            </main>
        </div>
    );
}
