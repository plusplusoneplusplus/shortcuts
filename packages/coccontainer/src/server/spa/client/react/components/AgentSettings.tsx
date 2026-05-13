/**
 * Agent Settings panel — add/remove agents.
 * Displayed in the main area when the user clicks the gear icon.
 */

import React, { useState } from 'react';
import type { Agent } from '../types';

interface AgentSettingsProps {
    agents: Agent[];
    loading: boolean;
    onAdd: (address: string, name?: string) => Promise<Agent>;
    onRemove: (id: string) => Promise<void>;
    onRefresh: () => void;
    onClose: () => void;
}

export function AgentSettings({ agents, loading, onAdd, onRemove, onRefresh, onClose }: AgentSettingsProps) {
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
        <div className="settings-panel">
            <div className="settings-header">
                <h2>Agent Settings</h2>
                <button className="btn-back" onClick={onClose}>← Back</button>
            </div>

            {/* Add form */}
            <form className="add-agent-form" onSubmit={handleAdd}>
                <input
                    type="text"
                    placeholder="http://localhost:4000"
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    className="input"
                    style={{ flex: 1 }}
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

            {/* Agent table */}
            <table className="agent-table">
                <thead>
                    <tr>
                        <th>Status</th>
                        <th>Name</th>
                        <th>Address</th>
                        <th>Last Seen</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {agents.length === 0 && (
                        <tr>
                            <td colSpan={5} className="agent-table-empty">
                                No agents registered. Add one above.
                            </td>
                        </tr>
                    )}
                    {agents.map(agent => (
                        <tr key={agent.id}>
                            <td><span className={`status-dot ${agent.status}`} /></td>
                            <td className="agent-table-name">{agent.name}</td>
                            <td className="agent-table-addr">{agent.address}</td>
                            <td className="agent-table-time">
                                {agent.lastSeenAt ? new Date(agent.lastSeenAt).toLocaleString() : '—'}
                            </td>
                            <td>
                                <button
                                    className="btn-danger-sm"
                                    onClick={() => handleRemove(agent)}
                                    title="Remove agent"
                                >
                                    ✕ Remove
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <div className="settings-footer">
                <button className="btn-secondary" onClick={onRefresh} disabled={loading}>
                    ↻ Refresh
                </button>
            </div>
        </div>
    );
}
