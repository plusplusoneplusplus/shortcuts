/**
 * AddRepoDialog — modal dialog for adding a repository.
 *
 * Mirrors CoC's "Add Repository" dialog but with an additional
 * agent selector combobox at the top so the user picks which
 * agent this repo will be added to.
 */

import React, { useState } from 'react';
import type { Agent } from '../types';

const COLORS = [
    '#0078d4', '#107c10', '#d83b01', '#5c2d91',
    '#008575', '#e3008c', '#00b7c3', '#767676',
];

interface AddRepoDialogProps {
    agents: Agent[];
    onAdd: (agentId: string, path: string, name: string, color: string) => Promise<void>;
    onClose: () => void;
}

export function AddRepoDialog({ agents, onAdd, onClose }: AddRepoDialogProps) {
    const [agentId, setAgentId] = useState(agents.length > 0 ? agents[0].id : '');
    const [path, setPath] = useState('');
    const [name, setName] = useState('');
    const [color, setColor] = useState(COLORS[0]);
    const [adding, setAdding] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!agentId || !path.trim()) return;
        setAdding(true);
        setError(null);
        try {
            await onAdd(agentId, path.trim(), name.trim(), color);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setAdding(false);
        }
    };

    const onlineAgents = agents.filter(a => a.status !== 'offline');

    return (
        <div className="dialog-overlay" onClick={onClose}>
            <div className="dialog" onClick={e => e.stopPropagation()}>
                <div className="dialog-header">
                    <h2>Add Repository</h2>
                    <button className="dialog-close" onClick={onClose}>✕</button>
                </div>

                <form onSubmit={handleSubmit}>
                    {/* Agent selector */}
                    <label className="dialog-label">Agent</label>
                    <select
                        className="dialog-select"
                        value={agentId}
                        onChange={e => setAgentId(e.target.value)}
                        required
                    >
                        {onlineAgents.length === 0 && (
                            <option value="" disabled>No agents online</option>
                        )}
                        {onlineAgents.map(agent => (
                            <option key={agent.id} value={agent.id}>
                                {agent.name} ({agent.address})
                            </option>
                        ))}
                    </select>

                    {/* Path */}
                    <label className="dialog-label">Path</label>
                    <div className="dialog-path-row">
                        <input
                            type="text"
                            className="dialog-input"
                            placeholder="C:\path\to\repo"
                            value={path}
                            onChange={e => setPath(e.target.value)}
                            required
                        />
                        <button type="button" className="dialog-browse-btn" title="Browse (not available in container)">
                            Browse
                        </button>
                    </div>

                    {/* Name */}
                    <label className="dialog-label">Name</label>
                    <input
                        type="text"
                        className="dialog-input"
                        placeholder="Alias / display name"
                        value={name}
                        onChange={e => setName(e.target.value)}
                    />

                    {/* Color */}
                    <label className="dialog-label">Color</label>
                    <div className="color-picker">
                        {COLORS.map(c => (
                            <button
                                key={c}
                                type="button"
                                className={`color-swatch ${color === c ? 'selected' : ''}`}
                                style={{ background: c }}
                                onClick={() => setColor(c)}
                            />
                        ))}
                    </div>

                    {error && <div className="dialog-error">{error}</div>}

                    <div className="dialog-actions">
                        <button type="button" className="dialog-btn-cancel" onClick={onClose}>Cancel</button>
                        <button
                            type="submit"
                            className="dialog-btn-primary"
                            disabled={adding || !agentId || !path.trim()}
                        >
                            {adding ? 'Adding…' : 'Add Repo'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
