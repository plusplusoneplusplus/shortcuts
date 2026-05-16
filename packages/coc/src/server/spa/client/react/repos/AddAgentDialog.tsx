/**
 * AddAgentDialog — modal for adding a new CoC agent in container mode.
 */

import { useState } from 'react';
import { Dialog, Button } from '../ui';

interface AddAgentDialogProps {
    open: boolean;
    onClose: () => void;
    onAdd: (address: string, name?: string, tunnelId?: string) => Promise<any>;
}

function isDevTunnelAddress(address: string): boolean {
    try {
        return new URL(address).hostname.endsWith('.devtunnels.ms');
    } catch {
        return false;
    }
}

export function AddAgentDialog({ open, onClose, onAdd }: AddAgentDialogProps) {
    const [address, setAddress] = useState('');
    const [name, setName] = useState('');
    const [tunnelId, setTunnelId] = useState('');
    const [adding, setAdding] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const showTunnelId = isDevTunnelAddress(address);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!address.trim()) return;
        setAdding(true);
        setError(null);
        try {
            await onAdd(address.trim(), name.trim() || undefined, tunnelId.trim() || undefined);
            setAddress('');
            setName('');
            setTunnelId('');
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        setAdding(false);
    };

    if (!open) return null;

    return (
        <Dialog open={open} onClose={onClose} title="Add Agent">
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <label className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                    Agent Address
                    <input
                        type="text"
                        className="mt-1 w-full h-8 px-2 text-xs rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4]"
                        placeholder="http://localhost:4000"
                        value={address}
                        onChange={e => setAddress(e.target.value)}
                        autoFocus
                        required
                    />
                </label>
                <label className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                    Display Name (optional)
                    <input
                        type="text"
                        className="mt-1 w-full h-8 px-2 text-xs rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4]"
                        placeholder="My Agent"
                        value={name}
                        onChange={e => setName(e.target.value)}
                    />
                </label>
                {showTunnelId && (
                    <label className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                        Tunnel ID
                        <input
                            type="text"
                            className="mt-1 w-full h-8 px-2 text-xs rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4] font-mono"
                            placeholder="e.g. amusing-book-s4hcgw2.usw2"
                            value={tunnelId}
                            onChange={e => setTunnelId(e.target.value)}
                        />
                        <span className="text-[10px] text-[#6e6e6e] dark:text-[#888888] block mt-0.5">
                            For server-side auth (no browser popup). Run <code>devtunnel list</code> to find it.
                        </span>
                    </label>
                )}
                {error && (
                    <div className="text-xs text-[#f14c4c] bg-[#f14c4c]/10 rounded px-2 py-1">{error}</div>
                )}
                <div className="flex justify-end gap-2 mt-1">
                    <Button variant="secondary" size="sm" onClick={onClose} type="button">Cancel</Button>
                    <Button variant="primary" size="sm" type="submit" disabled={adding || !address.trim()}>
                        {adding ? 'Adding…' : 'Add Agent'}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}
