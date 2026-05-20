/**
 * IMSettingsSection — container-mode admin panel for Instant Messaging integrations.
 * Supports WhatsApp via Baileys and MS Teams via MCP server.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Button, Spinner } from '../ui';
import { Dialog } from '../ui/Dialog';
import { SettingsCard } from './SettingsCard';
import { getRawApiBase } from '../utils/config';
import QRCode from 'qrcode';

interface WhatsAppStatus {
    enabled: boolean;
    status: 'disconnected' | 'connecting' | 'qr-pending' | 'connected' | 'creating-group';
    qr: string | null;
    error: string | null;
    groupJid?: string;
    userName: string;
}

interface TeamsStatus {
    enabled: boolean;
    status: 'disconnected' | 'connecting' | 'connected' | 'error';
    error: string | null;
    channelId?: string;
    botName: string;
}

async function fetchMessagingStatus(): Promise<WhatsAppStatus> {
    const res = await fetch(getRawApiBase() + '/container/messaging/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function postMessagingConfig(patch: { userName?: string; groupJid?: string }): Promise<void> {
    const res = await fetch(getRawApiBase() + '/container/messaging/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function postMessagingReconnect(): Promise<void> {
    const res = await fetch(getRawApiBase() + '/container/messaging/reconnect', {
        method: 'POST',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function fetchTeamsStatus(): Promise<TeamsStatus> {
    const res = await fetch(getRawApiBase() + '/container/messaging/teams/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function postTeamsConfig(patch: { botName?: string; channelId?: string }): Promise<void> {
    const res = await fetch(getRawApiBase() + '/container/messaging/teams/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function postTeamsReconnect(): Promise<void> {
    const res = await fetch(getRawApiBase() + '/container/messaging/teams/reconnect', {
        method: 'POST',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ── QR Code Display ─────────────────────────────────────────

function QRCodeDisplay({ value }: { value: string }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (!canvasRef.current) return;
        QRCode.toCanvas(canvasRef.current, value, {
            width: 280,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
        }).catch(() => {});
    }, [value]);

    return (
        <div className="flex flex-col items-center gap-3">
            <canvas
                ref={canvasRef}
                className="rounded-lg border-4 border-white dark:border-[#3c3c3c] shadow-lg"
                style={{ imageRendering: 'pixelated' }}
            />
            <p className="text-xs text-[#616161] dark:text-[#999] text-center max-w-[280px]">
                Open WhatsApp on your phone → Settings → Linked Devices → Link a Device → Scan this QR code
            </p>
        </div>
    );
}

// ── Status indicator components ─────────────────────────────

function StatusDot({ status }: { status: WhatsAppStatus['status'] }) {
    const colors: Record<string, string> = {
        connected: 'bg-green-500',
        'qr-pending': 'bg-amber-500 animate-pulse',
        'creating-group': 'bg-blue-500 animate-pulse',
        connecting: 'bg-blue-500 animate-pulse',
        disconnected: 'bg-gray-400',
    };
    return <span className={`inline-block w-2 h-2 rounded-full ${colors[status] ?? colors.disconnected}`} />;
}

function StatusLabel({ status }: { status: WhatsAppStatus['status'] }) {
    const labels: Record<string, string> = {
        connected: 'Connected',
        'qr-pending': 'Waiting for QR scan',
        'creating-group': 'Creating group…',
        connecting: 'Connecting…',
        disconnected: 'Not connected',
    };
    return <span className="text-sm">{labels[status] ?? status}</span>;
}

// ── Main Section ────────────────────────────────────────────

export function IMSettingsSection() {
    const [status, setStatus] = useState<WhatsAppStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [qrDialogOpen, setQrDialogOpen] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [editName, setEditName] = useState('');
    const [nameEditing, setNameEditing] = useState(false);
    const [nameSaving, setNameSaving] = useState(false);

    const loadStatus = useCallback(async () => {
        try {
            const data = await fetchMessagingStatus();
            setStatus(data);
            if (!nameEditing) setEditName(data.userName);
            setError(null);
        } catch (e: any) {
            setError(e.message ?? 'Failed to fetch status');
        } finally {
            setLoading(false);
        }
    }, [nameEditing]);

    useEffect(() => {
        void loadStatus();
    }, [loadStatus]);

    // Poll every 2s while QR dialog is open
    useEffect(() => {
        if (qrDialogOpen) {
            pollRef.current = setInterval(() => void loadStatus(), 2000);
            return () => { if (pollRef.current) clearInterval(pollRef.current); };
        } else {
            if (pollRef.current) clearInterval(pollRef.current);
        }
    }, [qrDialogOpen, loadStatus]);

    // Auto-close QR dialog when connected
    useEffect(() => {
        if (status?.status === 'connected' && qrDialogOpen) {
            setQrDialogOpen(false);
        }
    }, [status?.status, qrDialogOpen]);

    if (loading) {
        return (
            <Card className="p-4">
                <div className="flex items-center gap-2 text-sm text-[#848484]">
                    <Spinner size="sm" /> Loading messaging status…
                </div>
            </Card>
        );
    }

    return (
        <div className="space-y-3">
            <SettingsCard
                title="WhatsApp"
                description="Connect WhatsApp to bridge CoC conversations to a WhatsApp group."
                badge="Container"
                data-testid="im-settings-whatsapp"
            >
                {error && (
                    <div className="text-xs text-red-600 dark:text-red-400 mb-2">
                        ⚠ {error}
                    </div>
                )}

                {!status?.enabled ? (
                    <div className="space-y-2">
                        <p className="text-xs text-[#616161] dark:text-[#999]">
                            WhatsApp integration is disabled. Set <code className="text-[10px] bg-[#f0f0f0] dark:bg-[#3c3c3c] px-1 py-0.5 rounded">messaging.whatsapp.enabled: true</code> in your <code className="text-[10px] bg-[#f0f0f0] dark:bg-[#3c3c3c] px-1 py-0.5 rounded">~/.coccontainer/config.yaml</code> if it was explicitly disabled.
                        </p>
                        <pre className="text-[10px] bg-[#1e1e1e] text-[#d4d4d4] p-2 rounded overflow-x-auto">
{`messaging:
  whatsapp:
    enabled: true
    groupJid: "your-group@g.us"  # optional
    userName: "CoC"`}
                        </pre>
                        <p className="text-[10px] text-[#616161] dark:text-[#999]">
                            Restart the container after changing config.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <StatusDot status={status.status} />
                                <StatusLabel status={status.status} />
                            </div>
                            <div className="flex items-center gap-2">
                                {status.status === 'connected' && (
                                    <Button
                                        size="sm"
                                        variant="danger"
                                        onClick={async () => {
                                            try {
                                                await postMessagingReconnect();
                                                setQrDialogOpen(true);
                                                setTimeout(() => void loadStatus(), 1000);
                                            } catch (e: any) {
                                                setError(e.message);
                                            }
                                        }}
                                    >
                                        Re-pair
                                    </Button>
                                )}
                                <Button
                                    size="sm"
                                    variant={status.status === 'connected' ? 'secondary' : 'primary'}
                                    onClick={() => { setQrDialogOpen(true); void loadStatus(); }}
                                    disabled={status.status === 'connected'}
                                >
                                    {status.status === 'connected' ? '✓ Paired' : 'Setup / Pair'}
                                </Button>
                                <button
                                    onClick={() => void loadStatus()}
                                    title="Refresh status"
                                    className="text-[#616161] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-base leading-none px-1"
                                >↻</button>
                            </div>
                        </div>

                        {/* Editable device name */}
                        <div className="space-y-2">
                            <label className="block text-xs text-[#616161] dark:text-[#999]">
                                Device name <span className="text-[10px] italic">(shown in WhatsApp Linked Devices)</span>
                            </label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={editName}
                                    onChange={(e) => { setEditName(e.target.value); setNameEditing(true); }}
                                    className="flex-1 text-sm px-2 py-1 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#2d2d2d] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-blue-500"
                                    placeholder="CoC"
                                />
                                {nameEditing && editName !== status.userName && (
                                    <Button
                                        size="sm"
                                        variant="primary"
                                        loading={nameSaving}
                                        onClick={async () => {
                                            setNameSaving(true);
                                            try {
                                                await postMessagingConfig({ userName: editName.trim() || 'CoC' });
                                                // Reconnect to apply new name
                                                await postMessagingReconnect();
                                                setNameEditing(false);
                                                setQrDialogOpen(true);
                                                setTimeout(() => void loadStatus(), 1000);
                                            } catch (e: any) {
                                                setError(e.message);
                                            } finally {
                                                setNameSaving(false);
                                            }
                                        }}
                                    >
                                        Save & Re-pair
                                    </Button>
                                )}
                            </div>
                            {nameEditing && editName !== status.userName && (
                                <p className="text-[10px] text-amber-600 dark:text-amber-400">
                                    Changing the name requires re-pairing (existing session will be cleared).
                                </p>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                            <span className="text-[#616161] dark:text-[#999]">Group</span>
                            <span className="text-[#1e1e1e] dark:text-[#cccccc] font-mono text-[10px]">
                                {status.groupJid
                                    ? status.groupJid
                                    : <span className="italic text-[#999]">auto-created on pairing</span>}
                            </span>
                        </div>
                    </div>
                )}
            </SettingsCard>

            <Dialog
                open={qrDialogOpen}
                onClose={() => setQrDialogOpen(false)}
                title="Pair WhatsApp"
            >
                <div className="flex flex-col items-center gap-4 py-4">
                    {status?.qr ? (
                        <QRCodeDisplay value={status.qr} />
                    ) : status?.error ? (
                        <div className="flex flex-col items-center gap-2 py-8">
                            <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                                <span className="text-3xl">✕</span>
                            </div>
                            <p className="text-sm font-medium text-red-700 dark:text-red-400">Connection failed</p>
                            <p className="text-xs text-[#999] text-center max-w-[300px]">{status.error}</p>
                            <p className="text-xs text-[#999]">Check network connectivity and try restarting the container.</p>
                        </div>
                    ) : status?.status === 'creating-group' ? (
                        <div className="flex flex-col items-center gap-2 py-8">
                            <Spinner size="md" />
                            <p className="text-sm text-[#616161] dark:text-[#999]">Creating WhatsApp group…</p>
                            <p className="text-xs text-[#999]">Phone paired! Setting up the bridge group now.</p>
                        </div>
                    ) : status?.status === 'connecting' ? (
                        <div className="flex flex-col items-center gap-2 py-8">
                            <Spinner size="md" />
                            <p className="text-sm text-[#616161] dark:text-[#999]">Connecting to WhatsApp…</p>
                        </div>
                    ) : status?.status === 'connected' ? (
                        <div className="flex flex-col items-center gap-2 py-8">
                            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                                <span className="text-3xl">✓</span>
                            </div>
                            <p className="text-sm font-medium text-green-700 dark:text-green-400">WhatsApp is connected!</p>
                            {status.groupJid && (
                                <p className="text-xs text-[#999]">Group ready — messages will be bridged.</p>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2 py-8">
                            <Spinner size="md" />
                            <p className="text-sm text-[#616161] dark:text-[#999]">Waiting for QR code…</p>
                            <p className="text-xs text-[#999]">Make sure WhatsApp is enabled in config and the container was restarted.</p>
                        </div>
                    )}
                </div>
            </Dialog>

            <TeamsSettingsCard />
        </div>
    );
}

function TeamsStatusDot({ status }: { status: TeamsStatus['status'] }) {
    const colors: Record<string, string> = {
        connected: 'bg-green-500',
        connecting: 'bg-blue-500 animate-pulse',
        error: 'bg-red-500',
        disconnected: 'bg-gray-400',
    };
    return <span className={`inline-block w-2 h-2 rounded-full ${colors[status] ?? colors.disconnected}`} />;
}

function TeamsStatusLabel({ status }: { status: TeamsStatus['status'] }) {
    const labels: Record<string, string> = {
        connected: 'Connected',
        connecting: 'Connecting…',
        error: 'Error',
        disconnected: 'Not connected',
    };
    return <span className="text-sm">{labels[status] ?? status}</span>;
}

function TeamsSettingsCard() {
    const [status, setStatus] = useState<TeamsStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [nameEditing, setNameEditing] = useState(false);
    const [nameSaving, setNameSaving] = useState(false);

    const loadStatus = useCallback(async () => {
        try {
            const data = await fetchTeamsStatus();
            setStatus(data);
            if (!nameEditing) setEditName(data.botName);
            setError(null);
        } catch (e: any) {
            setError(e.message ?? 'Failed to fetch status');
        } finally {
            setLoading(false);
        }
    }, [nameEditing]);

    useEffect(() => {
        void loadStatus();
    }, [loadStatus]);

    if (loading) {
        return (
            <Card className="p-4">
                <div className="flex items-center gap-2 text-sm text-[#848484]">
                    <Spinner size="sm" /> Loading Teams status…
                </div>
            </Card>
        );
    }

    return (
        <SettingsCard
            title="Microsoft Teams"
            description="Connect MS Teams to bridge CoC conversations to a Teams channel via MCP server."
            badge="Container"
            data-testid="im-settings-teams"
        >
            {error && (
                <div className="text-xs text-red-600 dark:text-red-400 mb-2">
                    ⚠ {error}
                </div>
            )}

            {!status?.enabled ? (
                <div className="space-y-2">
                    <p className="text-xs text-[#616161] dark:text-[#999]">
                        Teams integration is disabled. Set <code className="text-[10px] bg-[#f0f0f0] dark:bg-[#3c3c3c] px-1 py-0.5 rounded">messaging.teams.enabled: true</code> and provide <code className="text-[10px] bg-[#f0f0f0] dark:bg-[#3c3c3c] px-1 py-0.5 rounded">mcpServerUrl</code> in your <code className="text-[10px] bg-[#f0f0f0] dark:bg-[#3c3c3c] px-1 py-0.5 rounded">~/.coccontainer/config.yaml</code>.
                    </p>
                    <pre className="text-[10px] bg-[#1e1e1e] text-[#d4d4d4] p-2 rounded overflow-x-auto">
{`messaging:
  teams:
    enabled: true
    mcpServerUrl: "https://agent365.svc.cloud.microsoft/..."
    channelId: "your-channel-id"  # optional
    botName: "CoC"`}
                    </pre>
                    <p className="text-[10px] text-[#616161] dark:text-[#999]">
                        Restart the container after changing config.
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <TeamsStatusDot status={status.status} />
                            <TeamsStatusLabel status={status.status} />
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                size="sm"
                                variant={status.status === 'connected' ? 'secondary' : 'primary'}
                                onClick={async () => {
                                    try {
                                        await postTeamsReconnect();
                                        setTimeout(() => void loadStatus(), 2000);
                                    } catch (e: any) {
                                        setError(e.message);
                                    }
                                }}
                            >
                                {status.status === 'connected' ? 'Reconnect' : 'Connect'}
                            </Button>
                            <button
                                onClick={() => void loadStatus()}
                                title="Refresh status"
                                className="text-[#616161] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-base leading-none px-1"
                            >↻</button>
                        </div>
                    </div>

                    {status.error && (
                        <div className="text-xs text-red-600 dark:text-red-400">
                            Error: {status.error}
                        </div>
                    )}

                    {/* Editable bot name */}
                    <div className="space-y-2">
                        <label className="block text-xs text-[#616161] dark:text-[#999]">
                            Bot name <span className="text-[10px] italic">(shown in Teams messages)</span>
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={editName}
                                onChange={(e) => { setEditName(e.target.value); setNameEditing(true); }}
                                className="flex-1 text-sm px-2 py-1 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#2d2d2d] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-blue-500"
                                placeholder="CoC"
                            />
                            {nameEditing && editName !== status.botName && (
                                <Button
                                    size="sm"
                                    variant="primary"
                                    loading={nameSaving}
                                    onClick={async () => {
                                        setNameSaving(true);
                                        try {
                                            await postTeamsConfig({ botName: editName.trim() || 'CoC' });
                                            setNameEditing(false);
                                            setTimeout(() => void loadStatus(), 1000);
                                        } catch (e: any) {
                                            setError(e.message);
                                        } finally {
                                            setNameSaving(false);
                                        }
                                    }}
                                >
                                    Save
                                </Button>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <span className="text-[#616161] dark:text-[#999]">Channel</span>
                        <span className="text-[#1e1e1e] dark:text-[#cccccc] font-mono text-[10px]">
                            {status.channelId
                                ? status.channelId
                                : <span className="italic text-[#999]">not configured</span>}
                        </span>
                    </div>
                </div>
            )}
        </SettingsCard>
    );
}
