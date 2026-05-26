/**
 * ConnectedAgentsPanel — Read-only view of agents connected to this container.
 *
 * Agents self-register via the call-home WebSocket protocol.
 * This panel simply lists them with their status, name, and connection info.
 */

import { useContainerAgents, type ContainerAgent } from '../contexts/ContainerAgentContext';
import { Spinner } from '../ui';

const STATUS_COLORS: Record<string, string> = {
    online: 'var(--color-success, #22c55e)',
    offline: 'var(--color-muted, #888)',
    connecting: 'var(--color-warning, #f59e0b)',
};

function AgentStatusDot({ status }: { status: string }) {
    return (
        <span style={{
            display: 'inline-block',
            width: 8, height: 8,
            borderRadius: '50%',
            backgroundColor: STATUS_COLORS[status] ?? STATUS_COLORS.offline,
            marginRight: 8,
        }} />
    );
}

export function ConnectedAgentsPanel() {
    const { agents, loading, refresh, removeAgent } = useContainerAgents();

    if (loading) {
        return (
            <section className="ar-card">
                <div className="ar-card-body" style={{ padding: 24, textAlign: 'center' }}>
                    <Spinner size="sm" /> Loading agents…
                </div>
            </section>
        );
    }

    return (
        <section className="ar-card">
            <header className="ar-card-head">
                <div style={{ minWidth: 0, flex: 1 }}>
                    <h3>Connected Agents</h3>
                    <p className="ar-card-desc">
                        Agents connect to this container using the call-home pattern. Configure the container URL in each agent's Admin → Server → Container Link section.
                    </p>
                </div>
                <button
                    type="button"
                    className="ar-btn ar-btn-secondary ar-btn-sm"
                    onClick={refresh}
                    title="Refresh agent list"
                >
                    ↻ Refresh
                </button>
            </header>
            <div className="ar-card-body">
                {agents.length === 0 ? (
                    <div style={{ padding: '16px 0', color: 'var(--color-muted, #888)', fontSize: 13 }}>
                        No agents connected. Agents will appear here once they connect to this container.
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {agents.map((agent: ContainerAgent) => (
                            <div
                                key={agent.id}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 12,
                                    padding: '10px 12px',
                                    borderRadius: 6,
                                    border: '1px solid var(--ar-border, #e5e5e5)',
                                    background: 'var(--ar-card-bg, #fff)',
                                }}
                            >
                                <AgentStatusDot status={agent.status} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 500, fontSize: 13 }}>
                                        {agent.name || agent.id}
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--color-muted, #888)', marginTop: 2 }}>
                                        {agent.address.startsWith('inbound://') ? 'Call-home (WebSocket)' : agent.address}
                                    </div>
                                    {agent.workspaces && agent.workspaces.length > 0 && (
                                        <div style={{ fontSize: 11, color: 'var(--color-muted, #888)', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                            {agent.workspaces.map(ws => (
                                                <span key={ws.id} style={{
                                                    padding: '1px 6px',
                                                    borderRadius: 3,
                                                    background: 'var(--ar-badge-bg, #f0f0f0)',
                                                    border: '1px solid var(--ar-border, #e0e0e0)',
                                                    fontSize: 10,
                                                }}>
                                                    {ws.name}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ fontSize: 11, color: 'var(--color-muted, #888)' }}>
                                        {agent.status}
                                    </span>
                                    <button
                                        type="button"
                                        className="ar-btn ar-btn-secondary ar-btn-sm"
                                        style={{ fontSize: 11, padding: '2px 8px' }}
                                        onClick={() => removeAgent(agent.id)}
                                        title="Unregister this agent"
                                    >
                                        Unregister
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}
