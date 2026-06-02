/**
 * AgentManagementPanel — full agent management page for container mode.
 * Add, edit (name/address/tunnelId), remove agents. Shows status, address, tunnel info, repo count.
 * Supports Direct URL, DevTunnel, and SSH connection types.
 */

import { useState, useCallback } from 'react';
import { useContainerAgents, type ContainerAgent } from '../contexts/ContainerAgentContext';
import { useRepos } from '../contexts/ReposContext';
import { Button, Card, Spinner } from '../ui';
import { AddAgentDialog, EditAgentDialog } from './AddAgentDialog';

function getConnectionKindLabel(address: string, tunnelId?: string): { label: string; cls: string } {
    if (address.startsWith('inbound://')) {
        return { label: 'Call-home', cls: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' };
    }
    if (address.startsWith('ssh://')) {
        return { label: 'SSH', cls: 'bg-[#16a3b8]/10 text-[#0e7c8c] dark:text-[#3bc9db]' };
    }
    try {
        if (new URL(address).hostname.endsWith('.devtunnels.ms')) {
            return { label: 'DevTunnel', cls: 'bg-[#c586c0]/10 text-[#9a4e9a] dark:text-[#c586c0]' };
        }
    } catch { /* not a URL */ }
    return { label: 'URL', cls: 'bg-[#16c060]/10 text-[#16a060] dark:text-[#16c060]' };
}

export function AgentManagementPanel() {
    const { agents, loading, refresh, addAgent, removeAgent, updateAgent } = useContainerAgents();
    const { repos } = useRepos();
    const [addOpen, setAddOpen] = useState(false);
    const [editAgent, setEditAgent] = useState<ContainerAgent | null>(null);
    const [removing, setRemoving] = useState<string | null>(null);

    const repoCountByAgent = useCallback((agentId: string) => {
        return repos.filter(r => r.workspace.agentId === agentId).length;
    }, [repos]);

    const handleRemove = async (agent: ContainerAgent) => {
        const count = repoCountByAgent(agent.id);
        const msg = count > 0
            ? `Remove agent "${agent.name}"? It has ${count} repo(s) — they will be disconnected.`
            : `Remove agent "${agent.name}"?`;
        if (!confirm(msg)) return;
        setRemoving(agent.id);
        try {
            await removeAgent(agent.id);
        } catch (e: any) {
            alert('Failed to remove: ' + e.message);
        }
        setRemoving(null);
    };

    const statusColor = (status: string) => {
        switch (status) {
            case 'online': return 'bg-green-500';
            case 'offline': return 'bg-red-400';
            default: return 'bg-gray-400';
        }
    };

    const statusLabel = (status: string) => {
        switch (status) {
            case 'online': return 'Online';
            case 'offline': return 'Offline';
            default: return 'Unknown';
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Spinner size="md" />
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-xl font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Agent Management</h1>
                    <p className="text-sm text-[#848484] mt-1">Manage connected CoC agents via Direct URL, DevTunnel, or SSH</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => refresh()}>↻ Refresh</Button>
                    <Button variant="primary" size="sm" onClick={() => setAddOpen(true)} data-testid="agent-add-btn">+ Add Agent</Button>
                </div>
            </div>

            {agents.length === 0 ? (
                <Card className="p-8 text-center">
                    <p className="text-sm text-[#848484] mb-2">No agents connected yet.</p>
                    <p className="text-xs text-[#999] mb-4">
                        Add a CoC agent via Direct URL, DevTunnel, or SSH tunnel.
                        Agents running <code className="font-mono">coc serve</code> can also call home via WebSocket.
                    </p>
                    <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>+ Add Agent</Button>
                </Card>
            ) : (
                <div className="flex flex-col gap-3">
                    {agents.map(agent => {
                        const count = repoCountByAgent(agent.id);
                        const isRemoving = removing === agent.id;
                        const kindInfo = getConnectionKindLabel(agent.address, agent.tunnelId);
                        const isInbound = agent.address.startsWith('inbound://');
                        return (
                            <Card key={agent.id} className="p-4" data-testid="agent-card">
                                <div className="flex items-start gap-4">
                                    <div className="pt-1">
                                        <span
                                            className={`inline-block w-3 h-3 rounded-full ${statusColor(agent.status)}`}
                                            title={statusLabel(agent.status)}
                                            data-testid="agent-status-dot"
                                        />
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">{agent.name}</span>
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide ${kindInfo.cls}`}>
                                                {kindInfo.label}
                                            </span>
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                                agent.status === 'online'
                                                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                                    : agent.status === 'offline'
                                                        ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                                                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500'
                                            }`}>{statusLabel(agent.status)}</span>
                                        </div>
                                        <div className="text-xs text-[#848484] space-y-0.5">
                                            <div>
                                                {isInbound ? 'Connection: ' : 'Address: '}
                                                <span className="font-mono text-[#1e1e1e] dark:text-[#cccccc]">
                                                    {isInbound ? 'Call-home (WebSocket)' : agent.address}
                                                </span>
                                            </div>
                                            {agent.tunnelId && (
                                                <div>
                                                    Tunnel: <span className="font-mono text-[#1e1e1e] dark:text-[#cccccc]">{agent.tunnelId}</span>
                                                    <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                                                        local bridge
                                                    </span>
                                                </div>
                                            )}
                                            {agent.bridgeUrl && (
                                                <div>
                                                    Bridge: <span className="font-mono text-[#1e1e1e] dark:text-[#cccccc]">{agent.bridgeUrl}</span>
                                                </div>
                                            )}
                                            {agent.workspaces && agent.workspaces.length > 0 && (
                                                <div className="flex flex-wrap gap-1 mt-1">
                                                    {agent.workspaces.map(ws => (
                                                        <span key={ws.id} className="text-[10px] px-1.5 py-0.5 rounded bg-[#f0f0f0] dark:bg-[#2d2d30] border border-[#e0e0e0] dark:border-[#3c3c3c]">
                                                            {ws.name}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                            <div>Repos: <span className="font-medium">{count}</span></div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-1 flex-shrink-0">
                                        {!isInbound && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => setEditAgent(agent)}
                                                title="Edit agent"
                                                data-testid="agent-edit-btn"
                                            >
                                                Edit
                                            </Button>
                                        )}
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleRemove(agent)}
                                            disabled={isRemoving}
                                            title="Remove agent"
                                            data-testid="agent-remove-btn"
                                        >
                                            {isRemoving ? <Spinner size="sm" /> : 'Remove'}
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            <AddAgentDialog
                open={addOpen}
                onClose={() => setAddOpen(false)}
                onAdd={async (address, name, tunnelId) => {
                    await addAgent(address, name, tunnelId);
                }}
            />
            <EditAgentDialog
                open={!!editAgent}
                onClose={() => setEditAgent(null)}
                initial={editAgent ? { name: editAgent.name, address: editAgent.address, tunnelId: editAgent.tunnelId } : undefined}
                onSave={async (fields) => {
                    if (!editAgent) return;
                    await updateAgent(editAgent.id, fields);
                }}
            />
        </div>
    );
}
