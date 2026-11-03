import { useCallback, useEffect, useRef, useState } from 'react';
import { SettingsCard } from './SettingsCard';
import { useAdminServer } from './adminTarget';
import { AdminRow } from './adminControls';
import { validateBrowserApprovalUrl } from '../../../../shared/browser-approval-site';
import type { BrowserApprovedSiteAddRequest, BrowserApprovedSiteAddResponse } from '@plusplusoneplusplus/coc-client';

const SITES_PATH = '/api/admin/browser-approved-sites';

/**
 * Admin → Browser card managing persistent browser-control site approvals.
 * The list is global to the server
 * (shared by all workspaces); removing a site makes the agent ask again.
 */
export function BrowserApprovedSites() {
    const adminServer = useAdminServer();
    const [sites, setSites] = useState<string[] | null>(null);
    const [removing, setRemoving] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [url, setUrl] = useState('');
    const [adding, setAdding] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const mounted = useRef(false);
    const mutation = useRef(false);
    const listVersion = useRef(0);
    const validation = validateBrowserApprovalUrl(url);
    const duplicate = !!validation.site && !!sites?.includes(validation.site);

    const load = useCallback(async () => {
        const version = listVersion.current;
        try {
            const res = await adminServer.fetch(adminServer.resolveUrl(SITES_PATH));
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!mounted.current || version !== listVersion.current) return;
            setSites(Array.isArray(data?.sites) ? data.sites : []);
            setError(null);
        } catch (err) {
            if (mounted.current && version === listVersion.current) setError(`Could not load always-allowed sites: ${(err as Error).message}`);
        }
    }, [adminServer]);

    useEffect(() => {
        mounted.current = true;
        void load();
        return () => { mounted.current = false; };
    }, [load]);

    const remove = async (site: string) => {
        if (mutation.current) return;
        mutation.current = true;
        setNotice(null);
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
            mutation.current = false;
            if (mounted.current) setRemoving(null);
        }
    };

    const add = async () => {
        if (!validation.site || duplicate || mutation.current) return;
        mutation.current = true;
        setAdding(true);
        setError(null);
        setNotice(null);
        try {
            const body: BrowserApprovedSiteAddRequest = { url: url.trim() };
            const res = await adminServer.fetch(adminServer.resolveUrl(SITES_PATH), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: BrowserApprovedSiteAddResponse = await res.json();
            if (!Array.isArray(data.sites) || typeof data.site !== 'string' || typeof data.added !== 'boolean') {
                throw new Error('Invalid server response');
            }
            if (!mounted.current) return;
            listVersion.current++;
            setSites(data.sites);
            setUrl('');
            setNotice(data.added ? `Added ${data.site}.` : `${data.site} is already always allowed.`);
        } catch (err) {
            if (mounted.current) setError(`Could not add site: ${(err as Error).message}`);
        } finally {
            mutation.current = false;
            if (mounted.current) setAdding(false);
        }
    };

    return (
        <SettingsCard
            title="Always-allowed sites"
            description="Sites the AI browser may open without asking. Shared by all workspaces on this server; remove a site to be asked again."
            badge="Global"
            data-testid="browser-approved-sites"
        >
            <form noValidate onSubmit={event => { event.preventDefault(); void add(); }} className="ar-section">
                <label htmlFor="browser-approved-url">URL to always allow</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                    <input
                        id="browser-approved-url"
                        type="url"
                        className="ar-input"
                        style={{ flex: '1 1 240px', minWidth: 0, width: '100%' }}
                        value={url}
                        placeholder="https://example.com"
                        disabled={adding}
                        autoComplete="off"
                        spellCheck={false}
                        aria-describedby="browser-approved-hint browser-approved-validation"
                        aria-invalid={!!url && !!validation.error}
                        onChange={event => { setUrl(event.target.value); setNotice(null); setError(null); }}
                    />
                    <button type="submit" className="ar-btn ar-btn-primary ar-btn-sm" disabled={!validation.site || duplicate || adding || removing !== null}>
                        {adding ? 'Adding...' : 'Add'}
                    </button>
                </div>
                <p id="browser-approved-hint" className="ar-muted">Allows AI navigation without site approval. Root domains include subdomains; IP addresses match exactly. All HTTP(S) ports and paths are allowed.</p>
                <p id="browser-approved-validation" className="ar-muted" aria-live="polite">
                    {url && (validation.error || (duplicate ? `${validation.site} is already always allowed.` : `Site to trust: ${validation.site}`))}
                </p>
                {adding && <p role="status" className="ar-muted">Saving site...</p>}
                {notice && <p role="status" className="ar-muted">{notice}</p>}
            </form>
            {sites === null && !error && <p role="status" className="ar-muted">Loading always-allowed sites...</p>}
            {sites?.length === 0 && <p className="ar-muted" data-testid="browser-approved-sites-empty">No always-allowed sites yet.</p>}
            {sites?.map(site => (
                <AdminRow key={site} name={site} data-testid={`browser-approved-site-${site}`}>
                    <button
                        type="button"
                        className="ar-btn ar-btn-danger-outline ar-btn-sm"
                        disabled={removing !== null || adding}
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
