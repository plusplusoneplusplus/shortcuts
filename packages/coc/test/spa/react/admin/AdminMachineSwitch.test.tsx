/**
 * Desktop Admin machine switch (`features.adminMachineSwitch`).
 *
 * Drives the real AdminTargetProvider / AdminTargetGate / selector against
 * distinct mock servers routed by URL, so every assertion is about which
 * machine a request actually reached.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    AdminMachineSelector,
    AdminTargetGate,
    AdminTargetProvider,
    buildAdminMachines,
    useAdminDirtyGuard,
    useAdminServer,
} from '../../../../src/server/spa/client/react/admin/adminTarget';
import { getSpaCocClient, getSpaCocClientErrorMessage, resetSpaCocClientForTests } from '../../../../src/server/spa/client/react/api/cocClient';
import { useMemoryV2Api } from '../../../../src/server/spa/client/react/features/memory/memoryV2Api';
import { registerCloneBaseUrls } from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { LogsView } from '../../../../src/server/spa/client/react/features/logs/LogsView';
import { AdminDialog } from '../../../../src/server/spa/client/react/admin/AdminDialog';
import { useAdminFeatureSettings } from '../../../../src/server/spa/client/react/admin/useAdminFeatureSettings';
import { DASHBOARD_CONFIG_UPDATED_EVENT } from '../../../../src/server/spa/client/react/utils/config';
import { renderWithProviders } from '../test-utils';

const A = 'http://127.0.0.1:5001';
const B = 'http://127.0.0.1:5002';

type Handler = (url: string, init: RequestInit | undefined) => unknown | Promise<unknown>;

let routes: Record<string, Handler>;
let calls: { url: string; method: string; body?: string }[];
let registry: any[];

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function server(id: string, label: string, url: string, extra: Record<string, unknown> = {}) {
    return { id, label, kind: 'url', url, effectiveUrl: url, status: 'online', addedAt: 0, updatedAt: 0, serverIdentity: `identity-${id}`, ...extra };
}

beforeEach(() => {
    calls = [];
    registry = [server('a', 'build-box', A), server('b', 'build-box', B), server('c', 'laptop', 'http://127.0.0.1:5003', { kind: 'ssh', host: 'laptop', status: 'offline', effectiveUrl: undefined, localPort: 5003 })];
    routes = {
        'GET /api/servers': () => registry,
        [`GET ${A}/api/health`]: () => ({ status: 'ok', serverIdentity: 'identity-a', uptime: 1, processCount: 0 }),
        [`GET ${B}/api/health`]: () => ({ status: 'ok', serverIdentity: 'identity-b', uptime: 1, processCount: 0 }),
        [`GET ${A}/api/config/runtime`]: () => ({ revision: 1, features: { serversEnabled: true } }),
        [`GET ${B}/api/config/runtime`]: () => ({ revision: 1, features: { serversEnabled: false } }),
        'GET /api/admin/config': () => ({ resolved: { serve: { serverName: 'local' } } }),
        [`GET ${A}/api/admin/config`]: () => ({ resolved: { serve: { serverName: 'remote-a' } } }),
        [`GET ${B}/api/admin/config`]: () => ({ resolved: { serve: { serverName: 'remote-b' } } }),
        [`PUT ${A}/api/admin/config`]: () => ({ resolved: {} }),
        'PUT /api/admin/config': () => ({ resolved: {} }),
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
        const key = `${method} ${url.split('?')[0]}`;
        const handler = routes[key];
        if (!handler) return json({ error: `no route ${key}` }, 404);
        const result = await handler(url, init);
        return result instanceof Response ? result : json(result);
    }));
    (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', hostname: 'desk', adminMachineSwitchEnabled: true };
    (window as any).cocDesktop = { isDesktop: true };
    resetSpaCocClientForTests();
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete (window as any).__DASHBOARD_CONFIG__;
    delete (window as any).cocDesktop;
    registerCloneBaseUrls([]);
    resetSpaCocClientForTests();
});

/** Reads the server name through the Admin transport, like AdminPanel's config load. */
function ConfigProbe({ onWrite }: { onWrite?: (save: () => Promise<void>) => void }) {
    const admin = useAdminServer();
    const [name, setName] = useState('loading');
    useEffect(() => {
        admin.client.admin.getConfig()
            .then((data: any) => setName(data?.resolved?.serve?.serverName ?? 'none'))
            .catch(() => setName('error'));
    }, [admin]);
    onWrite?.(async () => { await admin.client.admin.updateConfig({ 'serve.serverName': 'renamed' }); });
    return <div data-testid="probe">{name}|{admin.isRemote ? 'remote' : 'local'}</div>;
}

/** A server-owned draft card registered with the switch guard. */
function DraftCard({ id, label, fail = false }: { id: string; label: string; fail?: boolean }) {
    const admin = useAdminServer();
    const [value, setValue] = useState('');
    const [saved, setSaved] = useState('');
    const [saving, setSaving] = useState(false);
    const save = async () => {
        setSaving(true);
        try {
            await admin.client.admin.updateConfig({ [id]: value });
            if (!fail) setSaved(value);
        } catch {
            // card shows its own error; stays dirty
        } finally {
            setSaving(false);
        }
    };
    useAdminDirtyGuard(id, { label, dirty: value !== saved, saving, save });
    return <input aria-label={label} value={value} onChange={e => setValue(e.target.value)} />;
}

function Shell({ children }: { children: React.ReactNode }) {
    return (
        <AdminTargetProvider>
            <AdminTargetGate>
                <AdminMachineSelector />
                {children}
            </AdminTargetGate>
        </AdminTargetProvider>
    );
}

/** Writes refused before dispatch surface the target's reason to the card. */
async function expectBlocked(promise: Promise<unknown>, reason: RegExp) {
    const error = await promise.then(() => null, (e: unknown) => e);
    expect(error).not.toBeNull();
    expect(getSpaCocClientErrorMessage(error, '')).toMatch(reason);
}

async function selectMachine(key: string) {
    const select = await screen.findByTestId('admin-machine-select');
    await waitFor(() => expect(select.querySelector(`option[value="${key}"]`)).not.toBeNull());
    fireEvent.change(select, { target: { value: key } });
}

describe('buildAdminMachines', () => {
    it('lists the connected server first, then registered machines with credential-free hints and status text', () => {
        const machines = buildAdminMachines([
            server('a', 'build-box', 'https://user:secret@a.example.com:8443/path?token=x') as any,
            server('t', 'tunnel', '', { kind: 'devtunnel', tunnelId: 'my-coc', status: 'connecting' }) as any,
        ]);
        expect(machines.map(m => m.key)).toEqual(['connected', 'server:a', 'server:t']);
        expect(machines[0]).toMatchObject({ connected: true, label: 'desk' });
        expect(machines[1].hint).toBe('a.example.com:8443');
        expect(machines[1].hint).not.toMatch(/secret|token/);
        expect(machines[2]).toMatchObject({ hint: 'tunnel my-coc', statusText: 'Connecting' });
    });
});

describe('AC-01 selection and lifecycle', () => {
    it('starts on the connected server and lists duplicate and offline machines distinguishably', async () => {
        render(<Shell><ConfigProbe /></Shell>);
        expect(await screen.findByText('local|local')).toBeTruthy();
        const select = screen.getByTestId('admin-machine-select') as HTMLSelectElement;
        expect(select.value).toBe('connected');
        await waitFor(() => expect(select.options.length).toBe(4));
        const texts = [...select.options].map(o => o.textContent);
        expect(texts[0]).toBe('desk — connected server');
        expect(texts[1]).toBe('build-box (127.0.0.1:5001) — Online');
        expect(texts[2]).toBe('build-box (127.0.0.1:5002) — Online');
        expect(texts[3]).toBe('laptop — Offline');
        expect(screen.getByTestId('admin-machine-status').textContent).toContain('Connected server');
    });

    it('keeps the target while Admin content changes and resets on a genuine reopen', async () => {
        const { rerender, unmount } = render(<Shell><ConfigProbe /></Shell>);
        await selectMachine('server:a');
        expect(await screen.findByText('remote-a|remote')).toBeTruthy();
        // Navigating between embedded pages swaps children, not the provider.
        rerender(<Shell><div data-testid="logs-page">logs</div><ConfigProbe /></Shell>);
        expect(await screen.findByText('remote-a|remote')).toBeTruthy();
        expect((screen.getByTestId('admin-machine-select') as HTMLSelectElement).value).toBe('server:a');
        unmount();
        render(<Shell><ConfigProbe /></Shell>);
        expect(await screen.findByText('local|local')).toBeTruthy();
        expect((screen.getByTestId('admin-machine-select') as HTMLSelectElement).value).toBe('connected');
    });

    it('adds no persistent state and leaves the shared client and workspace routing untouched', async () => {
        const shared = getSpaCocClient();
        const storage = { local: window.localStorage.length, session: window.sessionStorage.length };
        const hash = window.location.hash;
        render(<Shell><ConfigProbe /></Shell>);
        await selectMachine('server:a');
        await screen.findByText('remote-a|remote');
        expect(getSpaCocClient()).toBe(shared);
        expect(window.localStorage.length).toBe(storage.local);
        expect(window.sessionStorage.length).toBe(storage.session);
        expect(window.location.hash).toBe(hash);
    });

    it('is inert with the flag off: no selector and page-origin transport', async () => {
        (window as any).__DASHBOARD_CONFIG__.adminMachineSwitchEnabled = false;
        render(<Shell><ConfigProbe /></Shell>);
        expect(await screen.findByText('local|local')).toBeTruthy();
        expect(screen.queryByTestId('admin-machine-selector')).toBeNull();
        expect(calls.some(c => c.url === '/api/servers')).toBe(false);
    });

    it('stays off outside the desktop shell', async () => {
        delete (window as any).cocDesktop;
        render(<Shell><ConfigProbe /></Shell>);
        expect(await screen.findByText('local|local')).toBeTruthy();
        expect(screen.queryByTestId('admin-machine-selector')).toBeNull();
    });
});

describe('AC-02 routing and ownership', () => {
    it('routes reads and writes to the exact selected machine even with duplicate labels', async () => {
        let save: (() => Promise<void>) | undefined;
        render(<Shell><ConfigProbe onWrite={fn => { save = fn; }} /></Shell>);
        await selectMachine('server:b');
        expect(await screen.findByText('remote-b|remote')).toBeTruthy();
        routes[`PUT ${B}/api/admin/config`] = () => ({ resolved: {} });
        await act(async () => { await save!(); });
        const writes = calls.filter(c => c.method === 'PUT');
        expect(writes.map(c => c.url)).toEqual([`${B}/api/admin/config`]);
        expect(calls.some(c => c.url.startsWith(A))).toBe(false);
    });

    it('sends workspace-scoped memory writes to the target even when a local clone shares the workspace id', async () => {
        registerCloneBaseUrls([{ workspaceId: 'ws-shared', baseUrl: 'http://127.0.0.1:5999' }] as any);
        let api: ReturnType<typeof useMemoryV2Api> | undefined;
        function MemoryProbe() { api = useMemoryV2Api(); return null; }
        routes[`PATCH ${A}/api/workspaces/ws-shared/preferences`] = () => ({});
        render(<Shell><ConfigProbe /><MemoryProbe /></Shell>);
        await selectMachine('server:a');
        await screen.findByText('remote-a|remote');
        await act(async () => { await api!.enableWorkspaceScope('ws-shared').catch(() => undefined); });
        const prefs = calls.filter(c => c.url.includes('/workspaces/ws-shared/'));
        expect(prefs.length).toBeGreaterThan(0);
        expect(prefs.every(c => c.url.startsWith(`${A}/api/`))).toBe(true);
    });

    it('takes capability metadata from the selected server', async () => {
        let serversEnabled: boolean | undefined;
        function CapabilityProbe() { serversEnabled = useAdminServer().serversEnabled; return null; }
        render(<Shell><ConfigProbe /><CapabilityProbe /></Shell>);
        await selectMachine('server:b');
        await screen.findByText('remote-b|remote');
        expect(serversEnabled).toBe(false);
    });

    it('never lets a delayed previous-target answer populate the new target view', async () => {
        let release!: () => void;
        routes[`GET ${A}/api/admin/config`] = () => new Promise(resolve => {
            release = () => resolve(json({ resolved: { serve: { serverName: 'late-a' } } }));
        });
        render(<Shell><ConfigProbe /></Shell>);
        await selectMachine('server:a');
        await waitFor(() => expect(release).toBeTypeOf('function'));
        await selectMachine('server:b');
        expect(await screen.findByText('remote-b|remote')).toBeTruthy();
        await act(async () => { release(); await Promise.resolve(); });
        expect(screen.queryByText(/late-a/)).toBeNull();
        expect(screen.getByTestId('probe').textContent).toBe('remote-b|remote');
    });

    it('closes the previous target log stream and opens the new one on switch', async () => {
        const opened: { url: string; closed: boolean }[] = [];
        class FakeEventSource extends EventTarget {
            onerror: (() => void) | null = null;
            onopen: (() => void) | null = null;
            entry: { url: string; closed: boolean };
            constructor(url: string) { super(); this.entry = { url, closed: false }; opened.push(this.entry); }
            close() { this.entry.closed = true; }
        }
        vi.stubGlobal('EventSource', FakeEventSource);
        vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0));
        render(<Shell><LogsView /></Shell>);
        await waitFor(() => expect(opened.map(e => e.url)).toContain('/api/logs/stream'));
        await selectMachine('server:a');
        await waitFor(() => expect(opened.map(e => e.url)).toContain(`${A}/api/logs/stream`));
        expect(opened.find(e => e.url === '/api/logs/stream')!.closed).toBe(true);
    });

    it('shows an identity mismatch as unavailable without mounting content', async () => {
        routes[`GET ${A}/api/health`] = () => ({ status: 'ok', serverIdentity: 'someone-else', uptime: 1, processCount: 0 });
        render(<Shell><ConfigProbe /></Shell>);
        await selectMachine('server:a');
        expect(await screen.findByTestId('admin-target-unavailable')).toBeTruthy();
        expect(screen.getByTestId('admin-target-unavailable').textContent).toMatch(/different server/);
        expect(screen.queryByTestId('probe')).toBeNull();
        expect(calls.some(c => c.url === `${A}/api/admin/config`)).toBe(false);
    });
});

describe('AC-03 dirty edits and unavailable targets', () => {
    async function makeDirty(label: string, value = 'x') {
        fireEvent.change(await screen.findByLabelText(label), { target: { value } });
    }

    it('Cancel keeps the target and the draft', async () => {
        render(<Shell><DraftCard id="k1" label="Card one" /></Shell>);
        await makeDirty('Card one', 'draft');
        await selectMachine('server:a');
        expect(await screen.findByTestId('admin-machine-guard')).toBeTruthy();
        fireEvent.click(screen.getByTestId('admin-machine-guard-cancel'));
        expect(screen.queryByTestId('admin-machine-guard')).toBeNull();
        expect((screen.getByTestId('admin-machine-select') as HTMLSelectElement).value).toBe('connected');
        expect((screen.getByLabelText('Card one') as HTMLInputElement).value).toBe('draft');
    });

    it('Discard switches and drops only the server draft, writing nothing', async () => {
        render(<Shell><DraftCard id="k1" label="Card one" /></Shell>);
        await makeDirty('Card one', 'draft');
        await selectMachine('server:a');
        fireEvent.click(await screen.findByTestId('admin-machine-guard-discard'));
        await waitFor(() => expect((screen.getByTestId('admin-machine-select') as HTMLSelectElement).value).toBe('server:a'));
        expect((await screen.findByLabelText('Card one') as HTMLInputElement).value).toBe('');
        expect(calls.some(c => c.method === 'PUT')).toBe(false);
    });

    it('Save completes on the original machine before switching', async () => {
        render(<Shell><DraftCard id="k1" label="Card one" /></Shell>);
        await makeDirty('Card one', 'draft');
        await selectMachine('server:a');
        fireEvent.click(await screen.findByTestId('admin-machine-guard-save'));
        await waitFor(() => expect((screen.getByTestId('admin-machine-select') as HTMLSelectElement).value).toBe('server:a'));
        expect(calls.filter(c => c.method === 'PUT').map(c => c.url)).toEqual(['/api/admin/config']);
    });

    it('a failed save keeps the original target and edits', async () => {
        routes['PUT /api/admin/config'] = () => json({ error: 'nope' }, 500);
        render(<Shell><DraftCard id="k1" label="Card one" /></Shell>);
        await makeDirty('Card one', 'draft');
        await selectMachine('server:a');
        fireEvent.click(await screen.findByTestId('admin-machine-guard-save'));
        await waitFor(() => expect(screen.getByTestId('admin-machine-guard').textContent).toMatch(/Could not save Card one/));
        expect((screen.getByTestId('admin-machine-select') as HTMLSelectElement).value).toBe('connected');
        expect((screen.getByLabelText('Card one') as HTMLInputElement).value).toBe('draft');
        expect(calls.some(c => c.url.startsWith(A) && c.method === 'PUT')).toBe(false);
    });

    it('a partial multi-card save stays put and names the outstanding card', async () => {
        render(<Shell><DraftCard id="good" label="Good card" /><DraftCard id="bad" label="Bad card" fail /></Shell>);
        await makeDirty('Good card');
        await makeDirty('Bad card');
        await selectMachine('server:a');
        fireEvent.click(await screen.findByTestId('admin-machine-guard-save'));
        await waitFor(() => expect(screen.getByTestId('admin-machine-guard').textContent).toMatch(/Could not save Bad card on desk/));
        expect(screen.getByTestId('admin-machine-guard').textContent).not.toMatch(/Good card/);
        expect((screen.getByTestId('admin-machine-select') as HTMLSelectElement).value).toBe('connected');
    });

    it('disables switching while a save is pending', async () => {
        let release!: () => void;
        routes['PUT /api/admin/config'] = () => new Promise(resolve => { release = () => resolve(json({ resolved: {} })); });
        render(<Shell><DraftCard id="k1" label="Card one" /></Shell>);
        await makeDirty('Card one');
        await selectMachine('server:a');
        fireEvent.click(await screen.findByTestId('admin-machine-guard-save'));
        await waitFor(() => expect((screen.getByTestId('admin-machine-select') as HTMLSelectElement).disabled).toBe(true));
        await act(async () => { release(); });
        await waitFor(() => expect((screen.getByTestId('admin-machine-select') as HTMLSelectElement).value).toBe('server:a'));
    });

    it('offline machines stay visible and unavailable, with no local fallback, until Retry succeeds', async () => {
        render(<Shell><ConfigProbe /></Shell>);
        await selectMachine('server:c');
        const panel = await screen.findByTestId('admin-target-unavailable');
        expect(panel.textContent).toMatch(/laptop is offline/);
        expect(panel.textContent).toMatch(/No settings from this desktop's server/);
        expect(screen.queryByTestId('probe')).toBeNull();
        const before = calls.filter(c => c.url === '/api/admin/config').length;
        registry[2] = { ...registry[2], status: 'online', effectiveUrl: 'http://127.0.0.1:5003', serverIdentity: undefined };
        routes['GET http://127.0.0.1:5003/api/health'] = () => ({ status: 'ok', uptime: 1, processCount: 0 });
        routes['GET http://127.0.0.1:5003/api/admin/config'] = () => ({ resolved: { serve: { serverName: 'laptop-cfg' } } });
        fireEvent.click(screen.getByTestId('admin-target-retry'));
        expect(await screen.findByText('laptop-cfg|remote')).toBeTruthy();
        expect(calls.filter(c => c.url === '/api/admin/config').length).toBe(before);
    });

    it('a dropped connection keeps edits, blocks writes, and Retry re-checks the same target', async () => {
        let save: (() => Promise<void>) | undefined;
        render(<Shell><ConfigProbe onWrite={fn => { save = fn; }} /><DraftCard id="k1" label="Card one" /></Shell>);
        await selectMachine('server:a');
        await screen.findByText('remote-a|remote');
        await makeDirty('Card one', 'keep');
        routes[`PUT ${A}/api/admin/config`] = () => { throw new TypeError('Failed to fetch'); };
        await act(async () => { await save!().catch(() => undefined); });
        expect(await screen.findByTestId('admin-machine-degraded')).toBeTruthy();
        const putsBefore = calls.filter(c => c.method === 'PUT').length;
        await act(async () => { await expectBlocked(save!(), /Connection lost/); });
        expect(calls.filter(c => c.method === 'PUT').length).toBe(putsBefore);
        expect((screen.getByLabelText('Card one') as HTMLInputElement).value).toBe('keep');
        fireEvent.click(screen.getByTestId('admin-machine-retry'));
        await waitFor(() => expect(screen.queryByTestId('admin-machine-degraded')).toBeNull());
        expect((screen.getByTestId('admin-machine-select') as HTMLSelectElement).value).toBe('server:a');
        expect(calls.some(c => c.url === '/api/admin/config' && c.method === 'PUT')).toBe(false);
    });

    it('a selected machine removed from the registry stays unavailable for writes', async () => {
        let save: (() => Promise<void>) | undefined;
        render(<Shell><ConfigProbe onWrite={fn => { save = fn; }} /></Shell>);
        await selectMachine('server:a');
        await screen.findByText('remote-a|remote');
        registry = registry.filter(s => s.id !== 'a');
        fireEvent.focus(screen.getByTestId('admin-machine-select'));
        expect(await screen.findByTestId('admin-machine-degraded')).toBeTruthy();
        await act(async () => { await expectBlocked(save!(), /no longer registered/); });
        fireEvent.click(screen.getByTestId('admin-machine-retry'));
        await waitFor(() => expect(calls.filter(c => c.url === '/api/servers').length).toBeGreaterThan(2));
        expect(screen.getByTestId('admin-machine-degraded')).toBeTruthy();
        expect(calls.some(c => c.method === 'PUT')).toBe(false);
    });
});

describe('Admin shell integration', () => {
    it('loads the real Admin panel from the selected machine and labels it', async () => {
        renderWithProviders(<AdminDialog open onClose={vi.fn()} />);
        await waitFor(() => expect(calls.some(c => c.url === '/api/admin/config')).toBe(true));
        routes[`GET ${A}/api/admin/version`] = () => ({ version: '9.9.9', commit: 'abc' });
        const localReads = calls.filter(c => c.url.startsWith('/api/admin/')).length;
        await selectMachine('server:a');
        await waitFor(() => expect(calls.some(c => c.url === `${A}/api/admin/config`)).toBe(true));
        await waitFor(() => expect(document.querySelector('.ar-brand-sub')?.textContent).toBe('build-box · v9.9.9'));
        expect(calls.some(c => c.url === `${A}/api/admin/data/stats` || c.url.startsWith(`${A}/api/admin/`))).toBe(true);
        expect(calls.filter(c => c.url.startsWith('/api/admin/')).length).toBe(localReads);
    });

    it('saving remote feature toggles never patches this desktop\'s runtime config', async () => {
        const patches = vi.fn();
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, patches);
        let features: ReturnType<typeof useAdminFeatureSettings> | undefined;
        function FeatureProbe() {
            features = useAdminFeatureSettings({ addToast: () => undefined, searchActive: false });
            return <div data-testid="features-ready">{useAdminServer().isRemote ? 'remote' : 'local'}</div>;
        }
        render(<Shell><FeatureProbe /></Shell>);
        await selectMachine('server:a');
        await screen.findByText('remote');
        await act(async () => { await features!.handleSaveTab('features'); });
        expect(calls.filter(c => c.method === 'PUT').map(c => c.url)).toEqual([`${A}/api/admin/config`]);
        expect(patches).not.toHaveBeenCalled();
        window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, patches);
    });
});
