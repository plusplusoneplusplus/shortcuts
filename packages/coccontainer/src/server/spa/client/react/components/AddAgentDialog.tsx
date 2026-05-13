/**
 * AddAgentDialog — modal dialog for adding a new CoC agent.
 */

import React, { useState } from 'react';

interface AddAgentDialogProps {
    onAdd: (address: string, name?: string) => Promise<void>;
    onClose: () => void;
}

export function AddAgentDialog({ onAdd, onClose }: AddAgentDialogProps) {
    const [address, setAddress] = useState('');
    const [name, setName] = useState('');
    const [adding, setAdding] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!address.trim()) return;
        setAdding(true);
        setError(null);
        try {
            await onAdd(address.trim(), name.trim() || undefined);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setAdding(false);
        }
    };

    return (
        <div className="dialog-overlay" onClick={onClose}>
            <div className="dialog" onClick={e => e.stopPropagation()}>
                <div className="dialog-header">
                    <h2>Add Agent</h2>
                    <button className="dialog-close" onClick={onClose}>✕</button>
                </div>

                <form onSubmit={handleSubmit}>
                    <label className="dialog-label">Address</label>
                    <input
                        type="text"
                        className="dialog-input"
                        placeholder="http://localhost:4000"
                        value={address}
                        onChange={e => setAddress(e.target.value)}
                        autoFocus
                        required
                    />

                    <label className="dialog-label">Name</label>
                    <input
                        type="text"
                        className="dialog-input"
                        placeholder="Alias / display name"
                        value={name}
                        onChange={e => setName(e.target.value)}
                    />

                    {error && <div className="dialog-error">{error}</div>}

                    <div className="dialog-actions">
                        <button type="button" className="dialog-btn-cancel" onClick={onClose}>Cancel</button>
                        <button type="submit" className="dialog-btn-primary" disabled={adding || !address.trim()}>
                            {adding ? 'Adding…' : 'Add Agent'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
