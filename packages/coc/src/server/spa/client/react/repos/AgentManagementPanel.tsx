/**
 * AgentManagementPanel — full agent management page for container mode.
 * Add, edit (name/address/tunnelId), remove agents. Shows status, address, tunnel info, repo count.
 */

import { useState, useCallback } from 'react';
import { useContainerAgents, type ContainerAgent } from '../contexts/ContainerAgentContext';
import { useRepos } from '../contexts/ReposContext';
import { Button, Card, Spinner } from '../ui';
import { AddAgentDialog } from './AddAgentDialog';

function isDevTunnelAddress(address: string): boolean {
    try {
        return new URL(address).hostname.endsWith('.devtunnels.ms');
    } catch {
        return false;
    }
}

export function AgentManagementPanel() {
    const { agents, loading, refresh, addAgent, removeAgent, updateAgent } = useContainerAgents();
    const { repos } = useRepos();
    const [addOpen, setAddOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editFields, setEditFields] = useState<{ name: string; address: string; tunnelId: string }>({ name: '', address: '', tunnelId: '' });
    const [editError, setEditError] = useState<string | null>(null);
    const [editSaving, setEditSaving] = useState(false);
    const [removing, setRemoving] = useState<string | null>(null);

    const repoCountByAgent = useCallback((agentId: string) => {
        return repos.filter(r => r.workspace.agentId === agentId).length;
    }, [repos]);

    const startEdit = (agent: ContainerAgent) => {
        setEditingId(agent.id);
        setEditFields({ name: agent.name, address: agent.address, tunnelId: agent.tunnelId || '' });
        setEditError(null);
    };

    const handleSaveEdit = async (id: string) => {
        setEditSaving(true);
        setEditError(null);
        try {
            await updateAgent(id, {
                name: editFields.name.trim() || undefined,
                address: editFields.address.trim() || undefined,
                tunnelId: editFields.tunnelId.trim() || null,
            });
            setEditingId(null);
        } catch (e: any) {
            setEditError(e.message || 'Failed to save');
        }
        setEditSaving(false);
    };

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
                    <p className="text-sm text-[#848484] mt-1">Manage connected CoC agents</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => refresh()}>↻ Refresh</Button>
                    <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>+ Add Agent</Button>
                </div>
            </div>

            {agents.length === 0 ? (
                <Card className="p-8 text-center">
                    <div className="text-4xl mb-3">🔗</div>
                    <p className="text-sm text-[#848484] mb-4">No agents connected yet. Add a CoC agent to get started.</p>
                    <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>+ Add Agent</Button>
                </Card>
            ) : (
                <div className="flex flex-col gap-3">
                    {agents.map(agent => {
                        const count = repoCountByAgent(agent.id);
                        const isEditing = editingId === agent.id;
                        const isRemoving = removing === agent.id;
                        const showTunnelHint = isDevTunnelAddress(agent.address);
                        return (
                            <Card key={agent.id} className="p-4">
                                <div className="flex items-start gap-4">
                                    {/* Status dot */}
                                    <div className="pt-1">
                                        <span
                                            className={`inline-block w-3 h-3 rounded-full ${statusColor(agent.status)}`}
                                            title={statusLabel(agent.status)}
                                        />
                                    </div>

                                    {/* Agent info */}
                                    <div className="flex-1 min-w-0">
                                        {isEditing ? (
                                            <div className="flex flex-col gap-2">
                                                <label className="text-xs text-[#848484]">
                                                    Name
                                                    <input
                                                        type="text"
                                                        value={editFields.name}
                                                        onChange={e => setEditFields(f => ({ ...f, name: e.target.value }))}
                                                        className="mt-0.5 w-full px-2 py-1 text-xs rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4]"
                                                        autoFocus
                                                    />
                                                </label>
                                                <label className="text-xs text-[#848484]">
                                                    Address
                                                    <input
                                                        type="text"
                                                        value={editFields.address}
                                                        onChange={e => setEditFields(f => ({ ...f, address: e.target.value }))}
                                                        className="mt-0.5 w-full px-2 py-1 text-xs rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4] font-mono"
                                                    />
                                                </label>
                                                {isDevTunnelAddress(editFields.address) && (
                                                    <label className="text-xs text-[#848484]">
                                                        Tunnel ID
                                                        <input
                                                            type="text"
                                                            value={editFields.tunnelId}
                                                            onChange={e => setEditFields(f => ({ ...f, tunnelId: e.target.value }))}
                                                            placeholder="e.g. amusing-book-s4hcgw2.usw2"
                                                            className="mt-0.5 w-full px-2 py-1 text-xs rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4] font-mono"
                                                        />
                                                        <span className="text-[10px] text-[#6e6e6e] dark:text-[#888888] block mt-0.5">
                                                            For server-side auth (no browser popup). Run <code>devtunnel list</code> to find it.
                                                        </span>
                                                    </label>
                                                )}
                                                {editError && (
                                                    <div className="text-xs text-[#f14c4c] bg-[#f14c4c]/10 rounded px-2 py-1">{editError}</div>
                                                )}
                                                <div className="flex gap-2">
                                                    <Button variant="primary" size="sm" onClick={() => handleSaveEdit(agent.id)} disabled={editSaving}>
                                                        {editSaving ? 'Saving…' : 'Save'}
                                                    </Button>
                                                    <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">{agent.name}</span>
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                                        agent.status === 'online'
                                                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                                            : agent.status === 'offline'
                                                                ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                                                                : 'bg-gray-100 dark:bg-gray-800 text-gray-500'
                                                    }`}>{statusLabel(agent.status)}</span>
                                                </div>
                                                <div className="text-xs text-[#848484] space-y-0.5">
                                                    <div>Address: <span className="font-mono text-[#1e1e1e] dark:text-[#cccccc]">{agent.address}</span></div>
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
                                                    {showTunnelHint && !agent.tunnelId && (
                                                        <div className="text-[#e5a100] dark:text-[#f5c842]">
                                                            ⚠ No tunnel ID — browser popup auth required
                                                        </div>
                                                    )}
                                                    <div>Repos: <span className="font-medium">{count}</span></div>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    {/* Actions */}
                                    {!isEditing && (
                                        <div className="flex items-center gap-1 flex-shrink-0">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => startEdit(agent)}
                                                title="Edit agent"
                                            >
                                                ✏️
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleRemove(agent)}
                                                disabled={isRemoving}
                                                title="Remove agent"
                                            >
                                                {isRemoving ? <Spinner size="sm" /> : '🗑️'}
                                            </Button>
                                        </div>
                                    )}
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
                    setAddOpen(false);
                }}
            />
        </div>
    );
}
