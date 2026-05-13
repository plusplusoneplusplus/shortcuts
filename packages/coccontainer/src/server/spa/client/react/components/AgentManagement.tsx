/**
 * Agent Management Panel
 *
 * Add/remove agents, see health status.
 */

import React, { useState } from 'react';
import type { Agent } from '../types';

interface AgentManagementProps {
    agents: Agent[];
    loading: boolean;
    onAdd: (address: string, name?: string) => Promise<Agent>;
    onRemove: (id: string) => Promise<void>;
    onRefresh: () => void;
}

export function AgentManagement({ agents, loading, onAdd, onRemove, onRefresh }: AgentManagementProps) {
    const [address, setAddress] = useState('');
    const [name, setName] = useState('');
    const [adding, setAdding] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!address.trim()) return;
        setAdding(true);
        setError(null);
        try {
            await onAdd(address.trim(), name.trim() || undefined);
            setAddress('');
            setName('');
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setAdding(false);
        }
    };

    const handleRemove = async (agent: Agent) => {
        if (!confirm(`Remove agent "${agent.name}"?`)) return;
        try {
            await onRemove(agent.id);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    return (
        <section className="agent-management">
            <div className="section-header">
                <h2>Agents</h2>
                <button className="btn-secondary" onClick={onRefresh} disabled={loading}>
                    {loading ? '⟳' : '↻'} Refresh
                </button>
            </div>

            <form className="add-agent-form" onSubmit={handleAdd}>
                <input
                    type="text"
                    placeholder="http://localhost:4000"
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    className="input"
                    required
                />
                <input
                    type="text"
                    placeholder="Name (optional)"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="input input-name"
                />
                <button type="submit" className="btn-primary" disabled={adding || !address.trim()}>
                    {adding ? 'Adding…' : '+ Add Agent'}
                </button>
            </form>

            {error && (
                <div className="error-banner">
                    {error}
                    <button className="btn-dismiss" onClick={() => setError(null)}>✕</button>
                </div>
            )}

            {agents.length === 0 && !loading && (
                <div className="empty-state">
                    No agents registered. Add a CoC agent above to get started.
                </div>
            )}

            <div className="agents-list">
                {agents.map(agent => (
                    <div key={agent.id} className="agent-badge">
                        <span className={`status-dot ${agent.status}`} />
                        <span className="agent-badge-name">{agent.name}</span>
                        <span className="agent-badge-address">{agent.address}</span>
                        <button
                            className="btn-danger-sm"
                            onClick={() => handleRemove(agent)}
                            title="Remove agent"
                        >
                            ✕
                        </button>
                    </div>
                ))}
            </div>
        </section>
    );
}
