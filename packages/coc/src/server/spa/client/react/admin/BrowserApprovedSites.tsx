import { useCallback, useEffect, useRef, useState } from 'react';
import { SettingsCard } from './SettingsCard';
import { useAdminServer } from './adminTarget';
import { AdminRow } from './adminControls';

const SITES_PATH = '/api/admin/browser-approved-sites';

/**
 * Admin → Browser card listing the root domains saved with "Always allow" on
 * a browser-control site approval card. The list is global to the server
 * (shared by all workspaces); removing a site makes the agent ask again.
 */
export function BrowserApprovedSites() {
    const adminServer = useAdminServer();
    const [sites, setSites] = useState<string[] | null>(null);
    const [removing, setRemoving] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const mounted = useRef(false);

    const load = useCallback(async () => {
        try {
            const res = await adminServer.fetch(adminServer.resolveUrl(SITES_PATH));
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!mounted.current) return;
            setSites(Array.isArray(data?.sites) ? data.sites : []);
            setError(null);
        } catch (err) {
            if (mounted.current) setError(`Could not load always-allowed sites: ${(err as Error).message}`);
        }
    }, [adminServer]);

    useEffect(() => {
        mounted.current = true;
        void load();
        return () => { mounted.current = false; };
    }, [load]);

    const remove = async (site: string) => {
        setRemoving(site);
        setError(null);
        try {
            const res = await adminServer.fetch(adminServer.resolveUrl(`${SITES_PATH}/${encodeURIComponent(site)}`), { method: 'DELETE' });
            if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
            if (!mounted.current) return;
            const data = res.ok ? await res.json() : null;
            if (Array.isArray(data?.sites)) setSites(data.sites);
            else await load();
        } catch (err) {
            if (mounted.current) setError(`Could not remove ${site}: ${(err as Error).message}`);
        } finally {
            if (mounted.current) setRemoving(null);
        }
    };

    return (
        <SettingsCard
            title="Always-allowed sites"
            description="Sites the AI browser may open without asking, saved with “Always allow” on a site approval card. Shared by all workspaces; remove a site to be asked again."
            badge="Global"
            data-testid="browser-approved-sites"
        >
            {sites === null && !error && <p role="status" className="ar-muted">Loading always-allowed sites...</p>}
            {sites?.length === 0 && <p className="ar-muted" data-testid="browser-approved-sites-empty">No always-allowed sites yet.</p>}
            {sites?.map(site => (
                <AdminRow key={site} name={site} data-testid={`browser-approved-site-${site}`}>
                    <button
                        type="button"
                        className="ar-btn ar-btn-danger-outline ar-btn-sm"
                        disabled={removing !== null}
                        aria-label={`Remove ${site}`}
                        onClick={() => { void remove(site); }}
                    >
                        {removing === site ? 'Removing...' : 'Remove'}
                    </button>
                </AdminRow>
            ))}
            {error && <p role="alert" style={{ color: 'var(--ar-danger)' }}>{error}</p>}
        </SettingsCard>
    );
}
