import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../ui';
import { getRawApiBase } from '../utils/config';
import { McpOAuthFlowController } from '../features/skills/mcpOAuthFlowController';
import { SettingsCard } from './SettingsCard';

interface TeamsStatus {
    enabled: boolean;
    status: 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'error';
    error: string | null;
    authStatus: string | null;
    oauthAvailable: boolean;
    teamsOAuthAvailable?: boolean;
    serverUrl: string | null;
    teamName: string;
    channelName: string;
    botName: string;
}

const base = () => getRawApiBase();

async function request<T>(path: string, body?: object): Promise<T> {
    const response = await fetch(`${base()}${path}`, body
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : undefined);
    if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error ?? `HTTP ${response.status}`);
    }
    return response.json() as Promise<T>;
}

export function TeamsConnectionCard() {
    const [status, setStatus] = useState<TeamsStatus | null>(null);
    const [serverUrl, setServerUrl] = useState('');
    const [teamName, setTeamName] = useState('');
    const [channelName, setChannelName] = useState('');
    const [botName, setBotName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [authorizing, setAuthorizing] = useState(false);
    const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
    const oauth = useRef(new McpOAuthFlowController());
    const mounted = useRef(false);
    const dirty = status !== null && (
        serverUrl !== (status.serverUrl ?? '')
        || teamName !== status.teamName
        || channelName !== status.channelName
        || botName !== status.botName
    );
    const load = useCallback(async (syncForm = false) => {
        try {
            const next = await request<TeamsStatus>('/messaging/teams/status');
            if (!mounted.current) return;
            setStatus(next);
            if (syncForm) {
                setServerUrl(next.serverUrl ?? '');
                setTeamName(next.teamName);
                setChannelName(next.channelName);
                setBotName(next.botName);
            }
        } catch (err) {
            if (mounted.current) setError(err instanceof Error ? err.message : String(err));
        }
    }, []);

    useEffect(() => {
        mounted.current = true;
        void load(true);
        const timer = setInterval(() => void load(), 5000);
        return () => {
            mounted.current = false;
            clearInterval(timer);
            oauth.current.stopAll();
        };
    }, [load]);

    const run = async (action: () => Promise<void>) => {
        setBusy(true);
        setError(null);
        try {
            await action();
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            await load();
        } finally {
            setBusy(false);
        }
    };

    const authenticate = async () => {
        setAuthorizing(true);
        setError(null);
        setAuthorizationUrl(null);
        try {
            const response = await request<{
                requestId: string; authorizationUrl: string;
            }>('/messaging/teams/auth/start', {});
            if (!response.requestId) throw new Error('OAuth did not return a request ID');
            if (!response.authorizationUrl) throw new Error('OAuth did not return a sign-in link');
            setAuthorizationUrl(response.authorizationUrl);
            oauth.current.startPolling({
                key: 'Microsoft Teams', requestId: response.requestId, apiBase: base(),
                isStale: () => !mounted.current,
            }, {
                onCompleted: () => { setAuthorizationUrl(null); setAuthorizing(false); void load(); },
                onFailed: message => { setAuthorizationUrl(null); setAuthorizing(false); setError(message); },
            });
        } catch (err) {
            setAuthorizing(false);
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    return (
        <SettingsCard title="Microsoft Teams" description="Receive commands and chat messages from one Teams channel, routed to a selected CoC workspace." data-testid="teams-connection-card">
            <div className="ar-teams">
                <p className="ar-teams-hint">
                    Configure a global Teams MCP endpoint, complete Microsoft sign-in, then connect.
                    This bridge polls a team channel for inbound messages; it does not relay agent output to a self-chat.
                    A missing team or channel is created when you connect.
                    Users can run <code>list repos</code> and <code>select repo &lt;name&gt;</code> to choose their workspace.
                </p>
                <p role="status" className="ar-teams-status">
                    Connection: {status?.status ?? 'Loading…'} · OAuth: {status?.authStatus ?? 'not configured'}
                </p>
                {status?.error && <p role="alert" className="ar-teams-error">{status.error}</p>}
                {error && <p role="alert" className="ar-teams-error">{error}</p>}
                <label className="ar-teams-field">Teams MCP server URL
                    <input className="ar-input ar-full" type="url" value={serverUrl} onChange={e => setServerUrl(e.target.value)}
                        placeholder="https://…/servers/mcp_TeamsServer" />
                </label>
                <Button size="sm" disabled={busy || !serverUrl.trim()} onClick={() => void run(async () => {
                    await request('/messaging/teams/server', { url: serverUrl.trim() });
                })}>Save MCP endpoint</Button>
                <div className="ar-teams-fields">
                    {([
                        ['Team', teamName, setTeamName],
                        ['Channel', channelName, setChannelName],
                        ['Bot name', botName, setBotName],
                    ] as const).map(([label, value, setter]) => (
                        <label key={label} className="ar-teams-field">{label}
                            <input className="ar-input ar-full" value={value} onChange={e => setter(e.target.value)} />
                        </label>
                    ))}
                </div>
                <div className="ar-teams-actions">
                    <Button size="sm" disabled={busy || !teamName.trim() || !channelName.trim() || !botName.trim()}
                        onClick={() => void run(async () => {
                            await request('/messaging/teams/config', {
                                teamName: teamName.trim(), channelName: channelName.trim(), botName: botName.trim(),
                            });
                        })}>Save channel</Button>
                    <Button size="sm" disabled={busy || authorizing || dirty || !status?.serverUrl || !status?.teamsOAuthAvailable}
                        onClick={() => void authenticate()}>{authorizing ? 'Authorizing…' : 'Authenticate'}</Button>
                    {authorizationUrl && <a className="ar-teams-auth-link" href={authorizationUrl} target="_blank" rel="noopener noreferrer">Continue Microsoft sign-in</a>}
                    <Button size="sm" disabled={busy || dirty || !status?.serverUrl || !['authenticated', 'expired'].includes(status.authStatus ?? '')}
                        onClick={() => void run(async () => {
                            if (!status?.enabled) await request('/messaging/teams/config', { enabled: true });
                            await request('/messaging/teams/reconnect', {});
                        })}>{status?.enabled ? 'Reconnect' : 'Enable & connect'}</Button>
                    {status?.enabled && <Button size="sm" disabled={busy} onClick={() => void run(async () => {
                        await request('/messaging/teams/config', { enabled: false });
                    })}>Disable</Button>}
                    <Button size="sm" disabled={busy} onClick={() => void load()}>Refresh status</Button>
                </div>
                {status && !status.teamsOAuthAvailable && <p className="ar-teams-warning">
                    MCP OAuth is unavailable. Enable mcpOauth and restart CoC.
                </p>}
                {authorizationUrl && <p className="ar-teams-warning">Open the sign-in link on the same computer as CoC; the callback uses localhost.</p>}
                {dirty && <p className="ar-teams-warning">Save endpoint and channel changes before connecting.</p>}
            </div>
        </SettingsCard>
    );
}
