/**
 * AgentManagementPanel — full agent management page for container mode.
 * Add, rename, remove agents. Shows status, address, repo count.
 */

import { useState, useCallback } from 'react';
import { useContainerAgents, type ContainerAgent } from '../contexts/ContainerAgentContext';
import { useRepos } from '../contexts/ReposContext';
import { Button, Card, Spinner } from '../ui';
import { AddAgentDialog } from './AddAgentDialog';

export function AgentManagementPanel() {
    const { agents, loading, refresh, addAgent, removeAgent, renameAgent } = useContainerAgents();
    const { repos } = useRepos();
    const [addOpen, setAddOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [removing, setRemoving] = useState<string | null>(null);

    const repoCountByAgent = useCallback((agentId: string) => {
        return repos.filter(r => r.workspace.agentId === agentId).length;
    }, [repos]);

    const handleRename = async (id: string) => {
        if (!editName.trim()) return;
        try {
            await renameAgent(id, editName.trim());
        } catch (e: any) {
            alert('Failed to rename: ' + e.message);
        }
        setEditingId(null);
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
                                            <div className="flex items-center gap-2 mb-1">
                                                <input
                                                    type="text"
                                                    value={editName}
                                                    onChange={e => setEditName(e.target.value)}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') handleRename(agent.id);
                                                        if (e.key === 'Escape') setEditingId(null);
                                                    }}
                                                    className="px-2 py-1 text-sm rounded border border-[#0078d4] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none flex-1"
                                                    autoFocus
                                                />
                                                <Button variant="primary" size="sm" onClick={() => handleRename(agent.id)}>Save</Button>
                                                <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
                                            </div>
                                        ) : (
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
                                        )}
                                        <div className="text-xs text-[#848484] space-y-0.5">
                                            <div>Address: <span className="font-mono text-[#1e1e1e] dark:text-[#cccccc]">{agent.address}</span></div>
                                            <div>Repos: <span className="font-medium">{count}</span></div>
                                            {agent.addedAt && <div>Added: {new Date(agent.addedAt).toLocaleDateString()}</div>}
                                            {agent.lastHealthCheck && <div>Last seen: {new Date(agent.lastHealthCheck).toLocaleString()}</div>}
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    {!isEditing && (
                                        <div className="flex items-center gap-1 flex-shrink-0">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => { setEditingId(agent.id); setEditName(agent.name); }}
                                                title="Rename agent"
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
                onAdd={async (address, name) => {
                    await addAgent(address, name);
                    setAddOpen(false);
                }}
            />
        </div>
    );
}
