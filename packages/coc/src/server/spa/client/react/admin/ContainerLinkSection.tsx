/**
 * ContainerLinkSection — Admin panel section for managing
 * the agent's outbound connection to a container (call-home mode).
 *
 * Shows connection status, container URL, and allows connect/disconnect.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Spinner } from '../ui';

interface ContainerLinkStatus {
    status: 'disconnected' | 'connecting' | 'connected' | 'registered';
    containerUrl: string | null;
    agentId: string | null;
    agentName: string | null;
}

const STATUS_LABELS: Record<ContainerLinkStatus['status'], string> = {
    disconnected: 'Disconnected',
    connecting: 'Connecting…',
    connected: 'Connected',
    registered: 'Registered',
};

const STATUS_COLORS: Record<ContainerLinkStatus['status'], string> = {
    disconnected: 'var(--color-muted, #888)',
    connecting: 'var(--color-warning, #f59e0b)',
    connected: 'var(--color-success, #22c55e)',
    registered: 'var(--color-success, #22c55e)',
};

export function ContainerLinkSection({ onError }: { onError?: (msg: string) => void }) {
    const [status, setStatus] = useState<ContainerLinkStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [urlInput, setUrlInput] = useState('');
    const [nameInput, setNameInput] = useState('');

    // Use a ref so fetchStatus doesn't need onError as a dep — prevents a
    // re-render cascade that causes an infinite GET /api/config/container loop
    // when the server is restarting and every failed fetch triggers a toast,
    // which re-renders AdminPanel, produces a new onError reference, which
    // invalidates fetchStatus, which re-fires the effect, and so on.
    const onErrorRef = useRef(onError);
    useEffect(() => { onErrorRef.current = onError; });

    const fetchStatus = useCallback(async (silent = false) => {
        try {
            const res = await fetch('/api/config/container');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: ContainerLinkStatus = await res.json();
            setStatus(data);
            if (data.containerUrl) setUrlInput(data.containerUrl);
            if (data.agentName) setNameInput(data.agentName);
        } catch (err) {
            // Only surface errors for explicit user-triggered fetches; suppress
            // during background polling so toasts don't spam during a restart.
            if (!silent) onErrorRef.current?.(`Failed to fetch container link status: ${(err as Error).message}`);
        } finally {
            setLoading(false);
        }
    }, []); // stable identity — onError captured via ref above

    useEffect(() => { fetchStatus(); }, [fetchStatus]);

    // Poll status while connecting; use silent=true so a temporary server
    // restart doesn't flood the UI with error toasts, and polling continues
    // so the UI auto-recovers once the server is back.
    useEffect(() => {
        if (!status || status.status === 'disconnected' || status.status === 'registered') return;
        const timer = setInterval(() => fetchStatus(true), 3000);
        return () => clearInterval(timer);
    }, [status?.status, fetchStatus]);

    const handleConnect = async () => {
        if (!urlInput.trim()) {
            onError?.('Container URL is required');
            return;
        }
        setSaving(true);
        try {
            const res = await fetch('/api/config/container', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    containerUrl: urlInput.trim(),
                    agentName: nameInput.trim() || undefined,
                }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: ContainerLinkStatus = await res.json();
            setStatus(data);
        } catch (err) {
            onError?.(`Failed to connect: ${(err as Error).message}`);
        } finally {
            setSaving(false);
        }
    };

    const handleDisconnect = async () => {
        setSaving(true);
        try {
            const res = await fetch('/api/config/container', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ containerUrl: null }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: ContainerLinkStatus = await res.json();
            setStatus(data);
            setUrlInput('');
            setNameInput('');
        } catch (err) {
            onError?.(`Failed to disconnect: ${(err as Error).message}`);
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div style={{ padding: 16 }}><Spinner size="sm" /> Loading…</div>;

    const isConnected = status?.status === 'connected' || status?.status === 'registered';
    const isConnecting = status?.status === 'connecting';

    return (
        <>
            <div className="ar-card-body">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <span style={{
                        display: 'inline-block',
                        width: 8, height: 8,
                        borderRadius: '50%',
                        backgroundColor: STATUS_COLORS[status?.status ?? 'disconnected'],
                    }} />
                    <span style={{ fontWeight: 500 }}>
                        {STATUS_LABELS[status?.status ?? 'disconnected']}
                    </span>
                    {status?.agentId && (
                        <span style={{ fontSize: 12, color: 'var(--color-muted, #888)' }}>
                            (Agent ID: {status.agentId})
                        </span>
                    )}
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                    <input
                        type="text"
                        placeholder="Agent name (shown on container)"
                        value={nameInput}
                        onChange={e => setNameInput(e.target.value)}
                        disabled={isConnected || saving}
                        className="ar-input"
                        style={{ width: 200 }}
                    />
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                    <input
                        type="text"
                        placeholder="ws://container.example.com:5000 or http://..."
                        value={urlInput}
                        onChange={e => setUrlInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !isConnected) handleConnect(); }}
                        disabled={isConnected || saving}
                        className="ar-input ar-long ar-mono"
                        style={{ flex: 1 }}
                    />
                    {!isConnected ? (
                        <button
                            type="button"
                            className="ar-btn ar-btn-primary ar-btn-sm"
                            onClick={handleConnect}
                            disabled={saving || !urlInput.trim()}
                        >
                            {(saving || isConnecting) && <Spinner size="sm" />}
                            {isConnecting ? 'Connecting…' : 'Connect'}
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="ar-btn ar-btn-secondary ar-btn-sm"
                            onClick={handleDisconnect}
                            disabled={saving}
                        >
                            Disconnect
                        </button>
                    )}
                </div>

                {status?.agentName && (
                    <div style={{ fontSize: 12, color: 'var(--color-muted, #888)' }}>
                        Registered as: <strong>{status.agentName}</strong>
                    </div>
                )}
            </div>
        </>
    );
}
