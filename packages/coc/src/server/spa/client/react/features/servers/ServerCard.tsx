import { useEffect, useRef, useState } from 'react';
import { Card } from '../../ui';
import { getServerEndpoint, type RemoteServer } from '../../utils/serverRegistry';

type CardServer = RemoteServer | { id: 'local'; label: string; url: string };

export interface ServerCardHealth {
    server: CardServer;
    status: 'checking' | 'online' | 'offline';
    version?: string;
    serverName?: string;
    uptime?: number;
    processCount?: number;
    lastChecked?: number;
    error?: string;
    effectiveUrl?: string;
    tunnelId?: string;
    localPort?: number;
    publicUrl?: string;
}

export interface ServerCardProps {
    health: ServerCardHealth;
    isLocal: boolean;
    onRemove?: (id: string) => void | Promise<void>;
    onEdit?: (id: string) => void;
    onReconnect?: (id: string) => void | Promise<void>;
    reconnecting?: boolean;
}

function isRemoteServer(server: CardServer): server is RemoteServer {
    return 'kind' in server;
}

function StatusDot({ status }: { status: ServerCardHealth['status'] }) {
    const cls =
        status === 'online' ? 'bg-[#16c060]' :
        status === 'offline' ? 'bg-[#f14c4c]' :
        'bg-[#e5a92b] animate-pulse';
    return (
        <span
            data-testid="server-status-dot"
            data-status={status}
            className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${cls}`}
        />
    );
}

export function formatUptime(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) { return '0m'; }
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts: string[] = [];
    if (d > 0) { parts.push(`${d}d`); }
    if (h > 0) { parts.push(`${h}h`); }
    parts.push(`${m}m`);
    return parts.join(' ');
}

export function timeAgo(ts: number, now: number = Date.now()): string {
    const diff = Math.max(0, Math.floor((now - ts) / 1000));
    if (diff < 60) { return `${diff}s ago`; }
    if (diff < 3600) { return `${Math.floor(diff / 60)}m ago`; }
    return `${Math.floor(diff / 3600)}h ago`;
}

export function ServerCard({ health, isLocal, onRemove, onEdit, onReconnect, reconnecting }: ServerCardProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuWrapRef = useRef<HTMLDivElement | null>(null);
    const endpoint = isRemoteServer(health.server)
        ? health.effectiveUrl ?? getServerEndpoint(health.server)
        : health.server.url;

    useEffect(() => {
        if (!menuOpen) { return; }
        const handler = (e: MouseEvent) => {
            if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [menuOpen]);

    const handleCopyUrl = () => {
        setMenuOpen(false);
        if (!endpoint) {
            return;
        }
        try {
            void navigator.clipboard?.writeText(endpoint);
        } catch {
            // best-effort
        }
    };

    const handleCopyPublicUrl = () => {
        setMenuOpen(false);
        if (!health.publicUrl) {
            return;
        }
        try {
            void navigator.clipboard?.writeText(health.publicUrl);
        } catch {
            // best-effort
        }
    };

    return (
        <Card className="p-0 flex flex-col" data-testid="server-card">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <StatusDot status={health.status} />
                <span className="flex-1 min-w-0 text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc] truncate" title={health.server.label}>
                    {health.server.label}
                </span>
                {!isLocal && (
                    <div className="relative" ref={menuWrapRef}>
                        <button
                            type="button"
                            data-testid="server-card-menu-btn"
                            className="p-1 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.06] text-[#848484] dark:text-[#999]"
                            onClick={() => setMenuOpen(o => !o)}
                            aria-label="Server options"
                        >
                            ⋮
                        </button>
                        {menuOpen && (
                            <div
                                data-testid="server-card-menu"
                                className="absolute right-0 top-full mt-1 z-20 min-w-[140px] rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] shadow-md text-sm"
                            >
                                <button
                                    type="button"
                                    data-testid="server-card-menu-edit"
                                    className="w-full text-left px-3 py-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] text-[#1e1e1e] dark:text-[#cccccc]"
                                    onClick={() => { setMenuOpen(false); onEdit?.(health.server.id); }}
                                >
                                    Edit server
                                </button>
                                <button
                                    type="button"
                                    data-testid="server-card-menu-copy"
                                    className="w-full text-left px-3 py-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] text-[#1e1e1e] dark:text-[#cccccc]"
                                    onClick={handleCopyUrl}
                                >
                                    Copy URL
                                </button>
                                {health.publicUrl && (
                                    <button
                                        type="button"
                                        data-testid="server-card-menu-copy-public"
                                        className="w-full text-left px-3 py-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] text-[#1e1e1e] dark:text-[#cccccc]"
                                        onClick={handleCopyPublicUrl}
                                    >
                                        Copy public URL
                                    </button>
                                )}
                                {isRemoteServer(health.server) && (health.server.kind === 'devtunnel' || health.server.kind === 'ssh') && onReconnect && (
                                    <button
                                        type="button"
                                        data-testid="server-card-menu-reconnect"
                                        className="w-full text-left px-3 py-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] text-[#1e1e1e] dark:text-[#cccccc]"
                                        disabled={reconnecting}
                                        onClick={() => { setMenuOpen(false); void onReconnect(health.server.id); }}
                                    >
                                        {reconnecting ? 'Reconnecting…' : 'Reconnect'}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    data-testid="server-card-menu-remove"
                                    className="w-full text-left px-3 py-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] text-[#f14c4c] dark:text-[#f48771]"
                                    onClick={() => { setMenuOpen(false); void onRemove?.(health.server.id); }}
                                >
                                    Remove
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="px-4 py-3 flex flex-col gap-1.5 text-xs text-[#848484] dark:text-[#999] flex-1">
                {health.serverName && (
                    <div className="text-[#1e1e1e] dark:text-[#cccccc] font-medium text-xs truncate" data-testid="server-card-hostname">
                        CoC @ {health.serverName}
                    </div>
                )}
                {isRemoteServer(health.server) && health.server.kind === 'url' && (
                    <div className="truncate" data-testid="server-card-url">
                        URL: {health.server.url}
                    </div>
                )}
                {isRemoteServer(health.server) && health.server.kind === 'devtunnel' && (
                    <>
                        <div className="truncate" data-testid="server-card-tunnel-id">
                            Tunnel: {health.server.tunnelId}
                        </div>
                        {health.publicUrl && (
                            <div className="truncate" data-testid="server-card-public-url">
                                Public:{' '}
                                <a
                                    href={health.publicUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[#0078d4] dark:text-[#3794ff] hover:underline"
                                >
                                    {health.publicUrl}
                                </a>
                            </div>
                        )}
                        {health.localPort !== undefined && (
                            <div data-testid="server-card-local-port">
                                Local: localhost:{health.localPort}
                            </div>
                        )}
                        {endpoint && (
                            <div className="truncate" data-testid="server-card-effective-url">
                                Endpoint: {endpoint}
                            </div>
                        )}
                    </>
                )}
                {health.processCount !== undefined && (
                    <div data-testid="server-card-process-count">
                        📦 {health.processCount} process{health.processCount === 1 ? '' : 'es'}
                    </div>
                )}
                {health.uptime !== undefined && (
                    <div data-testid="server-card-uptime">
                        ⏱ up {formatUptime(health.uptime)}
                    </div>
                )}
                {health.version && (
                    <div data-testid="server-card-version">
                        🔖 v{health.version}
                    </div>
                )}
                {health.status === 'offline' && health.lastChecked !== undefined && (
                    <div className="text-[#e5a92b]" data-testid="server-card-last-seen">
                        Last seen {timeAgo(health.lastChecked)}
                    </div>
                )}
                {health.error && (
                    <div className="text-[#f14c4c] truncate" data-testid="server-card-error">
                        {health.error}
                    </div>
                )}
            </div>

            <div className="px-4 pb-3">
                {isLocal ? (
                    <span
                        data-testid="server-card-current-label"
                        className="inline-block text-xs text-[#0078d4] dark:text-[#3794ff] font-medium"
                    >
                        Current — You're here
                    </span>
                ) : endpoint ? (
                    <a
                        href={endpoint}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="server-card-open-link"
                        className="text-xs text-[#0078d4] dark:text-[#3794ff] hover:underline font-medium"
                    >
                        Open Dashboard →
                    </a>
                ) : (
                    <span
                        data-testid="server-card-open-unavailable"
                        className="text-xs text-[#848484] dark:text-[#999] font-medium"
                    >
                        Endpoint unavailable
                    </span>
                )}
            </div>
        </Card>
    );
}
