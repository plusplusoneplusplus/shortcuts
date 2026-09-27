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
    teamsBridgeObservabilityEnabled?: boolean;
}

type AttemptResult = 'disconnected' | 'superseded' | 'failed' | 'interrupted';
type AttemptStage = 'started' | 'authenticating' | 'resolving' | 'starting-polling' | 'connected';

interface AttemptSummary {
    id: string;
    startedAt: string;
    endedAt?: string;
    result?: AttemptResult;
    stage: AttemptStage;
    failureCategory?: string;
    degraded?: boolean;
}

interface AttemptDetail extends AttemptSummary {
    phases: Array<{ stage: AttemptStage; at: string }>;
    events: Array<{ type: string; at: string; category?: string }>;
    totals: Record<string, number>;
    lastPollSuccessAt?: string;
    lastSendSuccessAt?: string;
    pollDegraded?: boolean;
    sendDegraded?: boolean;
}

interface AttemptPage {
    attempts: AttemptSummary[];
    total: number;
    nextOffset: number | null;
}

const stageLabels: Record<AttemptStage, string> = {
    started: 'Starting',
    authenticating: 'Authenticating',
    resolving: 'Resolving team/channel',
    'starting-polling': 'Starting polling',
    connected: 'Connected',
};

function attemptLabel(attempt: AttemptSummary): string {
    if (attempt.result === 'failed') return 'Failed';
    if (attempt.result === 'interrupted') return 'Interrupted by restart';
    if (attempt.result === 'superseded') return 'Superseded';
    if (attempt.result === 'disconnected') return 'Disconnected';
    if (attempt.degraded) return 'Connected · degraded';
    return stageLabels[attempt.stage];
}

function localTime(value: string): string {
    return new Date(value).toLocaleString();
}

function duration(start: string, end?: string): string {
    const ms = Math.max(0, new Date(end ?? Date.now()).getTime() - new Date(start).getTime());
    return ms < 60_000 ? `${Math.floor(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.floor(ms % 60_000 / 1000)}s`;
}

function timeline(detail: AttemptDetail): Array<{ at: string; label: string }> {
    return [
        ...detail.phases.map(phase => ({ at: phase.at, label: stageLabels[phase.stage] })),
        ...detail.events.map(event => ({
            at: event.at,
            label: `${event.type === 'send-accepted' ? 'MCP accepted reply' : event.type.replace(/-/g, ' ')}${event.category ? ` · ${event.category}` : ''}`,
        })),
        ...(detail.endedAt && detail.result
            ? [{ at: detail.endedAt, label: attemptLabel(detail) }]
            : []),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

const guidance: Record<string, string> = {
    configuration: 'Check the bridge configuration.',
    authentication: 'Check Microsoft sign-in.',
    resolution: 'Check team and channel access.',
    polling: 'Check polling availability.',
    dispatch: 'Check command processing.',
    send: 'Check reply delivery through MCP.',
    unknown: 'Check bridge health and try reconnecting.',
};

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
    const [history, setHistory] = useState<AttemptPage | null>(null);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const [historyOffset, setHistoryOffset] = useState(0);
    const [displayOffset, setDisplayOffset] = useState(0);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<AttemptDetail | null>(null);
    const [detailError, setDetailError] = useState<string | null>(null);
    const historyRequest = useRef(0);
    const detailRequest = useRef(0);
    const oauth = useRef(new McpOAuthFlowController());
    const mounted = useRef(false);
    const dirty = status !== null && (
        serverUrl !== (status.serverUrl ?? '')
        || teamName !== status.teamName
        || channelName !== status.channelName
        || botName !== status.botName
    );
    const load = useCallback(async (syncForm = false, offset = historyOffset) => {
        try {
            const next = await request<TeamsStatus>('/messaging/teams/status');
            if (!mounted.current) return;
            setStatus(next);
            if (next.teamsBridgeObservabilityEnabled) {
                const generation = ++historyRequest.current;
                setHistoryLoading(true);
                try {
                    const page = await request<AttemptPage>(`/messaging/teams/attempts?offset=${offset}&limit=20`);
                    if (mounted.current && generation === historyRequest.current) {
                        setHistory(page);
                        setDisplayOffset(offset);
                        setHistoryError(null);
                    }
                } catch (err) {
                    if (mounted.current && generation === historyRequest.current)
                        setHistoryError(err instanceof Error ? err.message : String(err));
                } finally {
                    if (mounted.current && generation === historyRequest.current) setHistoryLoading(false);
                }
            } else {
                historyRequest.current++;
                setHistory(null);
                setHistoryError(null);
                setHistoryLoading(false);
            }
            if (syncForm) {
                setServerUrl(next.serverUrl ?? '');
                setTeamName(next.teamName);
                setChannelName(next.channelName);
                setBotName(next.botName);
            }
        } catch (err) {
            if (mounted.current) setError(err instanceof Error ? err.message : String(err));
        }
    }, [historyOffset]);

    useEffect(() => {
        if (!expandedId || !status?.teamsBridgeObservabilityEnabled) return;
        const generation = ++detailRequest.current;
        setDetail(null);
        setDetailError(null);
        void request<{ attempt: AttemptDetail }>(`/messaging/teams/attempts/${encodeURIComponent(expandedId)}`)
            .then(response => {
                if (mounted.current && generation === detailRequest.current) setDetail(response.attempt);
            })
            .catch(err => {
                if (mounted.current && generation === detailRequest.current)
                    setDetailError(err instanceof Error ? err.message : String(err));
            });
        return () => { detailRequest.current++; };
    }, [expandedId, history, status?.teamsBridgeObservabilityEnabled]);

    useEffect(() => {
        mounted.current = true;
        void load(true);
        const timer = setInterval(() => void load(), 5000);
        return () => {
            mounted.current = false;
            historyRequest.current++;
            detailRequest.current++;
            clearInterval(timer);
            oauth.current.stopAll();
        };
    }, [load]);

    const run = async (action: () => Promise<void>) => {
        setBusy(true);
        setError(null);
        try {
            await action();
            setHistoryOffset(0);
            await load(false, 0);
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
                {status?.teamsBridgeObservabilityEnabled && (
                    <section className="ar-teams-history" aria-label="Connection attempts">
                        <h4>Connection attempts</h4>
                        {historyLoading && !history && <p role="status">Loading connection history…</p>}
                        {historyError && <p role="alert" className="ar-teams-error">
                            Could not load connection history: {historyError}{history && ' · Previous results are stale.'}
                        </p>}
                        {history && history.attempts.length === 0 && <p>No connection attempts yet{status.enabled ? '.' : ' (bridge disabled).'}</p>}
                        {history?.attempts.map(attempt => (
                            <details key={attempt.id} open={expandedId === attempt.id}
                                onToggle={event => {
                                    if (event.currentTarget.open && expandedId !== attempt.id) setExpandedId(attempt.id);
                                    else if (!event.currentTarget.open && expandedId === attempt.id) setExpandedId(null);
                                }}>
                                <summary className="ar-teams-attempt-summary">
                                    <time dateTime={attempt.startedAt}>{localTime(attempt.startedAt)}</time>
                                    <strong>{attempt.result === 'failed' ? '✕ ' : attempt.degraded ? '! ' : '○ '}{attemptLabel(attempt)}</strong>
                                    <span>{duration(attempt.startedAt, attempt.endedAt)}</span>
                                    {attempt.failureCategory && <span>{attempt.failureCategory} failure</span>}
                                </summary>
                                {expandedId === attempt.id && (
                                    detail?.id === attempt.id ? (
                                        <div className="ar-teams-attempt-detail">
                                            <ol className="ar-teams-timeline">
                                                {timeline(detail).map((event, index) => <li key={index}>
                                                    <time dateTime={event.at}>{localTime(event.at)}</time> {event.label}
                                                </li>)}
                                            </ol>
                                            {detail.failureCategory && <p>{guidance[detail.failureCategory] ?? guidance.unknown}</p>}
                                            <p>Poll: {detail.pollDegraded ? 'Degraded' : 'Healthy'} · last success: {detail.lastPollSuccessAt ? localTime(detail.lastPollSuccessAt) : 'none'}</p>
                                            <p>Reply send: {detail.sendDegraded ? 'Degraded' : 'Healthy'} · last MCP acceptance: {detail.lastSendSuccessAt ? localTime(detail.lastSendSuccessAt) : 'none'}</p>
                                            <p>MCP acceptance does not confirm Teams displayed a reply.</p>
                                            <dl className="ar-teams-counts">
                                                {Object.entries(detail.totals).map(([key, count]) => (
                                                    <div key={key}><dt>{key.replace(/([A-Z])/g, ' $1')}</dt><dd>{count}</dd></div>
                                                ))}
                                            </dl>
                                        </div>
                                    ) : <p role={detailError ? 'alert' : 'status'}>
                                        {detailError ? `Could not load attempt: ${detailError}` : 'Loading attempt…'}
                                    </p>
                                )}
                            </details>
                        ))}
                        {history && history.total > 20 && (
                            <nav className="ar-teams-pages" aria-label="Connection history pages">
                                <Button size="sm" disabled={historyLoading || displayOffset === 0}
                                    onClick={() => setHistoryOffset(Math.max(0, displayOffset - 20))}>Previous</Button>
                                <span>{displayOffset + 1}–{displayOffset + history.attempts.length} of {history.total}</span>
                                <Button size="sm" disabled={historyLoading || history.nextOffset === null}
                                    onClick={() => setHistoryOffset(history.nextOffset ?? 0)}>Next</Button>
                            </nav>
                        )}
                    </section>
                )}
            </div>
        </SettingsCard>
    );
}
