/**
 * IMSettingsSection — container-mode admin panel for Instant Messaging integrations.
 * Supports WhatsApp via Baileys and MS Teams via MCP server.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Button, Spinner } from '../ui';
import { Dialog } from '../ui/Dialog';
import { SettingsCard } from './SettingsCard';
import { AdminToggle } from './adminControls';
import { getRawApiBase } from '../utils/config';
import { WhatsAppPairingContent, WhatsAppStatusIndicator, type WhatsAppConnectionState } from './WhatsAppConnectionUI';

interface WhatsAppStatus {
    enabled: boolean;
    status: WhatsAppConnectionState;
    qr: string | null;
    error: string | null;
    groupJid?: string;
    userName: string;
}

interface TeamsStatus {
    ic3Region?: 'amer' | 'emea' | 'apac' | null;
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

async function postTeamsConfig(patch: { botName?: string; channelId?: string; enabled?: boolean; teamName?: string; channelName?: string; mode?: 'graph' | 'mcp'; ic3Region?: TeamsStatus['ic3Region'] }): Promise<void> {
    const res = await fetch(getRawApiBase() + '/container/messaging/teams/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function postTeamsReconnect(): Promise<string> {
    const configRes = await fetch(getRawApiBase() + '/container/messaging/teams/auth/start', { method: 'POST' });
    if (!configRes.ok) throw new Error(`HTTP ${configRes.status}`);
    const instructions: { ok?: boolean; authorizationUrl?: string; error?: string } = await configRes.json();
    if (!instructions.ok || !instructions.authorizationUrl) {
        throw new Error(instructions.error ?? 'Teams sign-in did not return instructions');
    }
    if (new URL(instructions.authorizationUrl).protocol !== 'https:') {
        throw new Error('Teams sign-in returned an invalid authorization URL');
    }
    return instructions.authorizationUrl;
}

async function cancelTeamsAuth(): Promise<void> {
    const response = await fetch(getRawApiBase() + '/container/messaging/teams/auth/cancel', { method: 'POST' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result: { ok?: boolean; error?: string } = await response.json();
    if (!result.ok) throw new Error(result.error ?? 'Teams sign-in cancellation failed');
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
                                <WhatsAppStatusIndicator status={status.status} />
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
                <WhatsAppPairingContent status={status?.status} qr={status?.qr} error={status?.error}
                    groupJid={status?.groupJid} waitingHint="Make sure WhatsApp is enabled in config and the container was restarted." />
            </Dialog>

            <TeamsSettingsCard />
        </div>
    );
}

const TEAMS_STATUS_LABELS: Record<string, string> = {
    connected: 'Connected',
    connecting: 'Connecting…',
    authenticating: 'Waiting for login…',
    error: 'Error',
    disconnected: 'Not connected',
};

interface TeamsChannelDraft { teamName: string; channelName: string; botName: string; ic3Region: string }

function savedChannelSettings(status: TeamsStatus): TeamsChannelDraft {
    return {
        teamName: status.teamName ?? '',
        channelName: status.channelName ?? '',
        botName: status.botName,
        ic3Region: status.ic3Region ?? '',
    };
}

export function TeamsSettingsCard() {
    const [status, setStatus] = useState<TeamsStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // Unsaved channel edits; null shows the saved values so polling never clobbers a draft.
    const [draft, setDraft] = useState<TeamsChannelDraft | null>(null);
    const [saving, setSaving] = useState(false);
    const [toggling, setToggling] = useState(false);
    const [authBusy, setAuthBusy] = useState(false);
    const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
    const [authError, setAuthError] = useState<string | null>(null);
    const authGeneration = useRef(0);
    const authActive = useRef(false);

    const loadStatus = useCallback(async () => {
        try {
            const data = await fetchTeamsStatus();
            setStatus(data);
            setError(null);
        } catch (e: any) {
            setError(e.message ?? 'Failed to fetch status');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadStatus();
    }, [loadStatus]);

    useEffect(() => () => {
        authGeneration.current++;
        if (authActive.current) {
            void cancelTeamsAuth().catch(() => console.error('Teams sign-in cancellation failed'));
        }
    }, []);

    useEffect(() => {
        if (!authorizationUrl) return;
        const generation = authGeneration.current;
        const controller = new AbortController();
        const startedAt = Date.now();
        let polling = false;
        const poll = async () => {
            if (polling) return;
            polling = true;
            try {
                const response = await fetch(getRawApiBase() + '/container/messaging/teams/auth/status', {
                    signal: controller.signal,
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const result: { authenticated: boolean; status: string; error?: string } = await response.json();
                if (generation !== authGeneration.current || controller.signal.aborted) return;
                if (result.status === 'pending' && Date.now() - startedAt < 10 * 60 * 1000) return;
                if (result.status !== 'authenticated' || !result.authenticated) {
                    throw new Error(result.error ?? (result.status === 'pending'
                        ? 'Teams sign-in timed out' : 'Teams sign-in failed'));
                }
                authActive.current = false;
                setAuthorizationUrl(null);
                await loadStatus();
            } catch (error) {
                if (generation !== authGeneration.current || controller.signal.aborted) return;
                setAuthError(error instanceof Error ? error.message : 'Teams sign-in failed');
                setAuthorizationUrl(null);
                authActive.current = false;
                void cancelTeamsAuth().catch(() => console.error('Teams sign-in cancellation failed'));
            } finally {
                polling = false;
            }
        };
        const timer = setInterval(() => void poll(), 2000);
        return () => { clearInterval(timer); controller.abort(); };
    }, [authorizationUrl, loadStatus]);

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

    const saved = status ? savedChannelSettings(status) : null;
    const form = draft ?? saved;
    const botNameDirty = !!form && !!saved && form.botName !== saved.botName;
    const targetDirty = !!form && !!saved && (form.teamName !== saved.teamName
        || form.channelName !== saved.channelName || form.ic3Region !== saved.ic3Region);
    const edit = (patch: Partial<TeamsChannelDraft>) => { if (form) setDraft({ ...form, ...patch }); };
    const signingIn = authBusy || !!authorizationUrl;

    const saveChannel = async () => {
        if (!form) return;
        setSaving(true);
        try {
            // Send only what changed; team, channel and region resolve together.
            await postTeamsConfig({
                ...(targetDirty ? {
                    teamName: form.teamName.trim(), channelName: form.channelName.trim(),
                    ic3Region: (form.ic3Region || null) as TeamsStatus['ic3Region'],
                } : {}),
                ...(botNameDirty ? { botName: form.botName.trim() || 'CoC' } : {}),
            });
            setDraft(null);
            await loadStatus();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const connect = async () => {
        const generation = ++authGeneration.current;
        authActive.current = true;
        setAuthBusy(true);
        setAuthError(null);
        try {
            const url = await postTeamsReconnect();
            if (generation === authGeneration.current) setAuthorizationUrl(url);
        } catch (error) {
            if (generation !== authGeneration.current) return;
            authActive.current = false;
            setAuthError(error instanceof Error ? error.message : 'Teams sign-in failed');
            void cancelTeamsAuth().catch(() => console.error('Teams sign-in cancellation failed'));
        } finally {
            if (generation === authGeneration.current) setAuthBusy(false);
        }
    };

    const cancelSignIn = async () => {
        try {
            await cancelTeamsAuth();
            authGeneration.current++;
            authActive.current = false;
            setAuthorizationUrl(null);
            setAuthError(null);
        } catch (error) {
            setAuthError(error instanceof Error ? error.message : 'Teams sign-in cancellation failed');
        }
    };

    return (
        <SettingsCard
            title="Microsoft Teams"
            description="Bridge CoC conversations to a Teams channel. Sign-in runs on the container node, where the CoC server runs."
            badge="Container"
            data-testid="im-settings-teams"
        >
            <div className="ar-teams">
                <div className="ar-teams-overview">
                    <div className="ar-teams-actions">
                        <AdminToggle
                            checked={status?.enabled === true}
                            disabled={toggling || signingIn}
                            aria-label="Enable Teams bridge"
                            data-testid="container-teams-enabled"
                            onChange={async enabled => {
                                setToggling(true);
                                try {
                                    await postTeamsConfig({ enabled });
                                    setTimeout(() => void loadStatus(), 1000);
                                } catch (e: any) {
                                    setError(e.message);
                                } finally {
                                    setToggling(false);
                                }
                            }}
                        />
                        <span>{status?.enabled ? 'Enabled' : 'Disabled'}</span>
                    </div>
                    {status?.enabled && (
                        <div role="status" className="ar-teams-status">
                            <span className={`ar-badge ${status.status === 'connected' ? 'ar-badge-success' : status.status === 'error' ? 'ar-badge-danger' : ''}`}>
                                {TEAMS_STATUS_LABELS[status.status] ?? status.status}
                            </span>
                        </div>
                    )}
                </div>
                {error && <p className="ar-teams-error">{error}</p>}
                {authError && <p role="alert" className="ar-teams-error">{authError}</p>}
                {status?.enabled && status.error && <p className="ar-teams-error">Error: {status.error}</p>}

                {!status?.enabled || !form ? (
                    <p className="ar-teams-hint">
                        Teams integration is disabled. Turn it on above, then restart the container for the change to take effect.
                    </p>
                ) : (
                    <>
                        <section className="ar-teams-section" aria-label="Sign-in">
                            <h4><span className="ar-teams-step" aria-hidden="true">1</span> Sign in</h4>
                            {status.status !== 'connected' && (
                                <p className="ar-teams-hint">
                                    Connect returns a Microsoft sign-in link. Complete it on the container node.
                                </p>
                            )}
                            <div className="ar-teams-actions">
                                <Button size="sm" variant={status.status === 'connected' ? 'secondary' : 'primary'}
                                    disabled={signingIn} onClick={() => void connect()}>
                                    {signingIn ? 'Authorizing...' : status.status === 'connected' ? 'Reconnect' : 'Connect'}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => void loadStatus()}>Refresh status</Button>
                            </div>
                            {authorizationUrl && (
                                <div className="ar-teams-actions">
                                    <a className="ar-teams-auth-link" href={authorizationUrl} target="_blank" rel="noopener noreferrer">
                                        Open Microsoft sign-in
                                    </a>
                                    <Button size="sm" variant="secondary" onClick={() => void cancelSignIn()}>Cancel</Button>
                                </div>
                            )}
                        </section>

                        <section className="ar-teams-section" aria-label="Channel settings">
                            <h4><span className="ar-teams-step" aria-hidden="true">2</span> Choose a channel</h4>
                            <p className="ar-teams-hint">A missing team or channel is created automatically.</p>
                            <div className="ar-teams-fields">
                                <label className="ar-teams-field">Team
                                    <input className="ar-input ar-full" value={form.teamName} placeholder="Coc"
                                        onChange={e => edit({ teamName: e.target.value })} />
                                </label>
                                <label className="ar-teams-field">Channel
                                    <input className="ar-input ar-full" value={form.channelName} placeholder="Coc-General"
                                        onChange={e => edit({ channelName: e.target.value })} />
                                </label>
                                <label className="ar-teams-field">Bot name
                                    <input className="ar-input ar-full" value={form.botName} placeholder="CoC"
                                        onChange={e => edit({ botName: e.target.value })} />
                                </label>
                            </div>
                            <details className="ar-teams-advanced">
                                <summary>Advanced options <span className="ar-teams-hint">Optional</span></summary>
                                <div className="ar-teams-advanced-body">
                                    <label className="ar-teams-field">IC3 region
                                        <select className="ar-input ar-full" value={form.ic3Region}
                                            onChange={e => edit({ ic3Region: e.target.value })}
                                            aria-describedby="container-teams-region-hint">
                                            <option value="">Unconfigured</option>
                                            <option value="amer">Americas</option>
                                            <option value="emea">Europe-Middle East-Africa</option>
                                            <option value="apac">Asia-Pacific</option>
                                        </select>
                                    </label>
                                    <p id="container-teams-region-hint" className="ar-teams-hint">
                                        IC3 writes and @coc own commands share this account region. MCP polling and sends work unconfigured.
                                        Automatic discovery is not available. Save to restart own commands; reconnect the bridge.
                                    </p>
                                    <dl className="ar-teams-status-facts">
                                        <div><dt>Transport</dt><dd>MCP server</dd></div>
                                        <div><dt>Resolved team</dt><dd className="ar-mono">{status.teamId || 'not resolved'}</dd></div>
                                        <div><dt>Resolved channel</dt><dd className="ar-mono">{status.channelId || 'not resolved'}</dd></div>
                                    </dl>
                                </div>
                            </details>
                            <div className="ar-teams-actions">
                                <Button size="sm" variant="secondary" loading={saving}
                                    disabled={saving || (!targetDirty && !botNameDirty)} onClick={() => void saveChannel()}>
                                    Save channel
                                </Button>
                                {draft && (targetDirty || botNameDirty) && (
                                    <Button size="sm" variant="ghost" disabled={saving} onClick={() => setDraft(null)}>Discard</Button>
                                )}
                            </div>
                        </section>
                    </>
                )}
            </div>
        </SettingsCard>
    );
}
