import { useEffect, useState } from 'react';
import type { TeamsIc3ConnectivityStatus } from '../../../../messaging/teams-ic3-own-commands-runtime';
import { SettingsCard } from './SettingsCard';
import { useAdminServer } from './adminTarget';

const LABELS = {
    disabled: 'Disabled', connecting: 'Connecting', connected: 'Connected',
    degraded: 'Degraded', error: 'Connection failed', stopped: 'Stopped',
};

export function TeamsIc3StatusCard() {
    const server = useAdminServer();
    const [status, setStatus] = useState<TeamsIc3ConnectivityStatus | null>(null);
    const [error, setError] = useState(false);
    const [refresh, setRefresh] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        setStatus(null);
        setError(false);
        const poll = async () => {
            try {
                const response = await server.fetch(`${server.apiBase}/messaging/teams/ic3-own-commands/status`, {
                    cache: 'no-store', signal: controller.signal,
                });
                if (!response.ok) throw new Error('IC3 status unavailable');
                const next: TeamsIc3ConnectivityStatus = await response.json();
                if (!next || !Object.hasOwn(LABELS, next.state)
                    || (next.error !== undefined && typeof next.error !== 'string')
                    || (next.trouter !== undefined && (!next.trouter
                        || !['disabled', 'connecting', 'registered', 'retrying', 'stopped'].includes(next.trouter.state)
                        || (next.trouter.error !== null && (!next.trouter.error || typeof next.trouter.error.code !== 'string'))))
                    || [next.lastCheckedAt, next.lastConnectedAt].some(value =>
                        value !== undefined && (typeof value !== 'string' || !Number.isFinite(Date.parse(value))))) {
                    throw new Error('Invalid IC3 status');
                }
                if (!controller.signal.aborted) {
                    setStatus(next);
                    setError(false);
                }
            } catch {
                if (!controller.signal.aborted) {
                    setStatus(null);
                    setError(true);
                }
            } finally {
                if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 5000);
            }
        };
        void poll();
        return () => { controller.abort(); clearTimeout(timer); };
    }, [server, refresh]);

    const badge = status?.state === 'connected' ? 'ar-badge-success'
        : status?.state === 'degraded' || status?.state === 'error' ? 'ar-badge-warning' : '';
    return (
        <SettingsCard title="IC3 connectivity" description="Own-command connection on the configured machine. Independent of the Teams channel bridge."
            data-testid="teams-ic3-status">
            <div className="ar-hstack">
                <span className={`ar-badge ${badge}`} role="status">
                    {status ? LABELS[status.state] : error ? 'Status unavailable' : 'Loading status...'}
                </span>
                <button type="button" className="ar-btn ar-btn-ghost ar-btn-sm" onClick={() => setRefresh(value => value + 1)}>
                    Refresh IC3 status
                </button>
            </div>
            {status?.state === 'disabled' && <p className="ar-hint">Enable IC3 own commands and save a workspace and region below to connect.</p>}
            {status?.lastCheckedAt && <p className="ar-hint">Last check: {new Date(status.lastCheckedAt).toLocaleString()}</p>}
            {status?.lastConnectedAt && <p className="ar-hint">Last connected: {new Date(status.lastConnectedAt).toLocaleString()}</p>}
            {status?.error && <p className="ar-teams-error" role="alert">
                IC3 check failed ({status.error}). Check the saved workspace, region and Azure CLI sign-in on the configured machine.
            </p>}
            {error && <p className="ar-teams-error" role="alert">Unable to read IC3 status from the configured machine. Refresh to retry.</p>}
            <p className="ar-hint" data-testid="ic3-own-command-trouter-status">
                Own-command Trouter: {status?.trouter?.state ?? 'disabled'}.
                {' Notifications wake targeted IC3 reads; background scans remain a fallback.'}
            </p>
            {status?.trouter?.error && <p className="ar-teams-error" role="alert">
                Own-command Trouter failed ({status.trouter.error.code}). Background scans remain active.
            </p>}
            <p className="ar-hint">Status follows background reads. Refreshing status sends no Teams message and does not test write access.</p>
        </SettingsCard>
    );
}
