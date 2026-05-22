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
    status: 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'error';
    mode: 'graph' | 'mcp';
    error: string | null;
    teamName?: string;
    channelName?: string;
    teamId?: string;
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

async function postTeamsConfig(patch: { botName?: string; channelId?: string; enabled?: boolean; teamName?: string; channelName?: string; mode?: 'graph' | 'mcp' }): Promise<void> {
    const res = await fetch(getRawApiBase() + '/container/messaging/teams/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function postTeamsReconnect(): Promise<void> {
    // 1. Start auth session — server creates temp callback server and returns OAuth config
    const configRes = await fetch(getRawApiBase() + '/container/messaging/teams/auth/start', { method: 'POST' });
    if (!configRes.ok) throw new Error(`HTTP ${configRes.status}`);
    const oauthConfig = await configRes.json() as { clientId: string; tenantId: string; scope: string; authorizeUrl: string; redirectUri: string };

    // 2. Generate PKCE code_verifier + code_challenge
    const codeVerifierBytes = new Uint8Array(32);
    crypto.getRandomValues(codeVerifierBytes);
    const codeVerifier = btoa(String.fromCharCode(...codeVerifierBytes))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const challengeBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
    const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(challengeBuffer)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    // 3. Use the localhost redirect URI from server config
    const redirectUri = oauthConfig.redirectUri;

    // 4. Build authorize URL and open popup
    const params = new URLSearchParams({
        client_id: oauthConfig.clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: oauthConfig.scope,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        response_mode: 'query',
    });
    const authUrl = `${oauthConfig.authorizeUrl}?${params.toString()}`;
    const popup = window.open(authUrl, 'teams-auth', 'width=600,height=700');

    // 5. Listen for postMessage from popup with the auth code
    const code = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
            window.removeEventListener('message', handler);
            reject(new Error('OAuth login timed out (120s)'));
        }, 120000);
        function handler(event: MessageEvent) {
            if (event.data?.type !== 'teams-auth-callback') return;
            clearTimeout(timeout);
            window.removeEventListener('message', handler);
            if (event.data.error) {
                reject(new Error(`OAuth error: ${event.data.error} - ${event.data.errorDescription ?? ''}`));
            } else if (event.data.code) {
                resolve(event.data.code);
            } else {
                reject(new Error('No auth code received'));
            }
        }
        window.addEventListener('message', handler);
        // Also check if popup was closed without completing
        const pollClosed = setInterval(() => {
            if (popup && popup.closed) {
                clearInterval(pollClosed);
                clearTimeout(timeout);
                window.removeEventListener('message', handler);
                reject(new Error('Login window was closed'));
            }
        }, 1000);
    });

    // 6. Exchange code for tokens on server
    const exchangeRes = await fetch(getRawApiBase() + '/container/messaging/teams/auth/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, codeVerifier, redirectUri }),
    });
    if (!exchangeRes.ok) {
        const err = await exchangeRes.json().catch(() => ({ error: 'Exchange failed' }));
        throw new Error((err as { error?: string }).error ?? `HTTP ${exchangeRes.status}`);
    }
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
        authenticating: 'bg-amber-500 animate-pulse',
        error: 'bg-red-500',
        disconnected: 'bg-gray-400',
    };
    return <span className={`inline-block w-2 h-2 rounded-full ${colors[status] ?? colors.disconnected}`} />;
}

function TeamsStatusLabel({ status }: { status: TeamsStatus['status'] }) {
    const labels: Record<string, string> = {
        connected: 'Connected',
        connecting: 'Connecting…',
        authenticating: 'Waiting for login…',
        error: 'Error',
        disconnected: 'Not connected',
    };
    return <span className="text-sm">{labels[status] ?? status}</span>;
}

/** Inline editable fields for Team name + Channel name. */
function TeamsTargetConfig({ status, onSaved, setError }: { status: TeamsStatus; onSaved: () => void; setError: (e: string) => void }) {
    const [teamName, setTeamName] = useState(status.teamName ?? '');
    const [channelName, setChannelName] = useState(status.channelName ?? '');
    const [saving, setSaving] = useState(false);

    const dirty = teamName !== (status.teamName ?? '') || channelName !== (status.channelName ?? '');

    return (
        <div className="space-y-2 pt-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
            <p className="text-[10px] text-[#616161] dark:text-[#999]">
                Set the team & channel where CoC messages are sent. If they don't exist they'll be created automatically.
            </p>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center">
                <label className="text-xs text-[#616161] dark:text-[#999]">Team</label>
                <input
                    type="text"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    className="text-sm px-2 py-1 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#2d2d2d] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-blue-500"
                    placeholder="Coc"
                />
                <label className="text-xs text-[#616161] dark:text-[#999]">Channel</label>
                <input
                    type="text"
                    value={channelName}
                    onChange={(e) => setChannelName(e.target.value)}
                    className="text-sm px-2 py-1 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#2d2d2d] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-blue-500"
                    placeholder="Coc-General"
                />
            </div>
            {dirty && (
                <Button
                    size="sm"
                    variant="primary"
                    loading={saving}
                    onClick={async () => {
                        setSaving(true);
                        try {
                            await postTeamsConfig({ teamName: teamName.trim(), channelName: channelName.trim() });
                            onSaved();
                        } catch (e: any) {
                            setError(e.message);
                        } finally {
                            setSaving(false);
                        }
                    }}
                >
                    Save & Resolve
                </Button>
            )}
        </div>
    );
}

function TeamsSettingsCard() {
    const [status, setStatus] = useState<TeamsStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [nameEditing, setNameEditing] = useState(false);
    const [nameSaving, setNameSaving] = useState(false);
    const [toggling, setToggling] = useState(false);

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

    // Poll while authenticating so UI updates when login completes
    const teamsPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    useEffect(() => {
        if (status?.status === 'authenticating' || status?.status === 'connecting') {
            teamsPollRef.current = setInterval(() => void loadStatus(), 3000);
            return () => { if (teamsPollRef.current) clearInterval(teamsPollRef.current); };
        } else {
            if (teamsPollRef.current) { clearInterval(teamsPollRef.current); teamsPollRef.current = null; }
        }
    }, [status?.status, loadStatus]);

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
            description="Connect MS Teams to bridge CoC conversations to a Teams channel."
            badge="Container"
            data-testid="im-settings-teams"
        >
            {error && (
                <div className="text-xs text-red-600 dark:text-red-400 mb-2">
                    ⚠ {error}
                </div>
            )}

            {/* Enable/Disable toggle */}
            <div className="flex items-center justify-between mb-3 pb-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <span className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">
                    {status?.enabled ? 'Enabled' : 'Disabled'}
                </span>
                <button
                    disabled={toggling}
                    onClick={async () => {
                        setToggling(true);
                        try {
                            await postTeamsConfig({ enabled: !status?.enabled });
                            setTimeout(() => void loadStatus(), 1000);
                        } catch (e: any) {
                            setError(e.message);
                        } finally {
                            setToggling(false);
                        }
                    }}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${status?.enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-[#555]'} ${toggling ? 'opacity-50' : ''}`}
                >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${status?.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                </button>
            </div>

            {!status?.enabled ? (
                <p className="text-xs text-[#616161] dark:text-[#999]">
                    Teams integration is disabled. Toggle the switch above to enable it. A container restart is required for changes to take effect.
                </p>
            ) : (
                <div className="space-y-3">
                    {/* Mode selector */}
                    <div className="flex items-center justify-between pb-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                        <label className="text-xs text-[#616161] dark:text-[#999]">Transport mode</label>
                        <select
                            value={status.mode ?? 'graph'}
                            onChange={async (e) => {
                                const mode = e.target.value as 'graph' | 'mcp';
                                try {
                                    await postTeamsConfig({ mode });
                                    setTimeout(() => void loadStatus(), 1000);
                                } catch (err: any) {
                                    setError(err.message);
                                }
                            }}
                            className="text-xs px-2 py-1 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#2d2d2d] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-blue-500"
                        >
                            <option value="graph">Graph API</option>
                            <option value="mcp">MCP Server</option>
                        </select>
                    </div>

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

                    {/* Team & Channel name inputs */}
                    <TeamsTargetConfig status={status} onSaved={() => void loadStatus()} setError={setError} />

                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <span className="text-[#616161] dark:text-[#999]">Resolved Team</span>
                        <span className="text-[#1e1e1e] dark:text-[#cccccc] font-mono text-[10px]">
                            {status.teamId
                                ? status.teamId
                                : <span className="italic text-[#999]">not resolved</span>}
                        </span>
                        <span className="text-[#616161] dark:text-[#999]">Resolved Channel</span>
                        <span className="text-[#1e1e1e] dark:text-[#cccccc] font-mono text-[10px]">
                            {status.channelId
                                ? status.channelId
                                : <span className="italic text-[#999]">not resolved</span>}
                        </span>
                    </div>
                </div>
            )}
        </SettingsCard>
    );
}
