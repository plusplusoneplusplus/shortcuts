import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TeamsConnectionCard } from '../../../../src/server/spa/client/react/admin/TeamsConnectionCard';
import { IMSettingsSection } from '../../../../src/server/spa/client/react/admin/IMSettingsSection';

const status = {
    enabled: false,
    status: 'disconnected',
    error: null,
    authStatus: 'authenticated',
    oauthAvailable: true,
    teamsOAuthAvailable: true,
    serverUrl: 'https://example.test/teams',
    teamName: 'Engineering',
    channelName: 'General',
    botName: 'CoC',
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('TeamsConnectionCard', () => {
    it.each(['amer', 'emea', 'apac', ''] as const)('saves container region %s with the existing form and reconnect guidance', async region => {
        let current = { ...status, enabled: true, mode: 'mcp', ic3Region: region === '' ? 'emea' : null as string | null };
        const fetch = vi.fn(async (url: string, options?: RequestInit) => {
            if (url.endsWith('/teams/config')) current = { ...current, ...JSON.parse(String(options?.body)) };
            return { ok: true, json: async () => url.includes('/teams/') ? current : {
                enabled: false, status: 'disconnected', qr: null, error: null, userName: 'CoC',
            } };
        });
        vi.stubGlobal('fetch', fetch);
        render(<IMSettingsSection />);
        const select = await screen.findByLabelText('IC3 region') as HTMLSelectElement;
        expect(select.value).toBe(region === '' ? 'emea' : '');
        expect(Array.from(select.options).map(option => option.value)).toEqual(['', 'amer', 'emea', 'apac']);
        fireEvent.change(select, { target: { value: region } });
        fireEvent.click(screen.getByText('Save & Resolve'));
        await waitFor(() => expect(fetch).toHaveBeenCalledWith(
            expect.stringMatching(/\/container\/messaging\/teams\/config$/),
            expect.objectContaining({ body: JSON.stringify({
                teamName: 'Engineering', channelName: 'General', ic3Region: region || null,
            }) }),
        ));
        expect(screen.getByText(/Save, then reconnect/)).toBeDefined();
    });

    const active = {
        id: 'attempt-1', startedAt: '2026-01-01T00:00:00Z', stage: 'connected',
        degraded: true,
    };
    const failed = {
        id: 'attempt-2', startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:00:05Z',
        stage: 'authenticating', result: 'failed', failureCategory: 'authentication',
    };
    const details = {
        ...active, phases: [{ stage: 'started', at: active.startedAt }, { stage: 'connected', at: active.startedAt }],
        events: [{ type: 'reply-rejected', at: active.startedAt, category: 'send' }],
        totals: { pollsSucceeded: 12, sendAttempted: 1, failed: 1 },
        pollDegraded: false, sendDegraded: true,
        lastPollSuccessAt: active.startedAt,
    };

    it('hides history when the owning server omits or disables the flag', async () => {
        const fetch = vi.fn(async () => ({ ok: true, json: async () => status }));
        vi.stubGlobal('fetch', fetch);
        render(<TeamsConnectionCard />);
        await screen.findByText(/Connection: disconnected/);
        expect(screen.queryByText('Connection attempts')).toBeNull();
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('shows loading and empty history independently of connection status', async () => {
        let resolveHistory!: (value: { ok: boolean; json: () => Promise<object> }) => void;
        vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/attempts?')
            ? new Promise(resolve => { resolveHistory = resolve; })
            : Promise.resolve({ ok: true, json: async () => ({ ...status, teamsBridgeObservabilityEnabled: true }) })));
        render(<TeamsConnectionCard />);
        expect(await screen.findByText('Loading connection history…')).toBeDefined();
        resolveHistory({ ok: true, json: async () => ({ attempts: [], total: 0, nextOffset: null }) });
        expect(await screen.findByText(/No connection attempts yet/)).toBeDefined();
    });

    it('expands active degraded and failed attempts using native keyboard-accessible summaries', async () => {
        const fetch = vi.fn(async (url: string) => ({
            ok: true, json: async () => url.endsWith('/status')
                ? { ...status, enabled: true, status: 'connected', teamsBridgeObservabilityEnabled: true }
                : url.endsWith('/attempt-1') ? { attempt: details }
                    : url.includes('/attempts?') ? { attempts: [active, failed], total: 2, nextOffset: null }
                        : { attempt: { ...failed, phases: [{ stage: 'started', at: failed.startedAt }], events: [], totals: {} } },
        }));
        vi.stubGlobal('fetch', fetch);
        render(<TeamsConnectionCard />);
        const degraded = await screen.findByText(/Connected · degraded/);
        const summary = degraded.closest('summary')!;
        expect(summary.tagName).toBe('SUMMARY');
        summary.focus();
        expect(document.activeElement).toBe(summary);
        fireEvent.click(summary);
        expect(await screen.findByText(/MCP acceptance does not confirm/)).toBeDefined();
        expect(screen.getByText(/Reply send: Degraded/)).toBeDefined();
        expect(screen.getByText('Check reply delivery through MCP.')).toBeDefined();
        expect(screen.getByText('polls Succeeded')).toBeDefined();
        expect(screen.getByText(/authentication failure/)).toBeDefined();
        expect(screen.getByText(/✕ Failed/)).toBeDefined();
    });

    it('pages newest-first history and refreshes immediately after reconnect', async () => {
        let refreshed = false;
        const fetch = vi.fn(async (url: string, options?: RequestInit) => {
            if (url.endsWith('/reconnect') && options?.method === 'POST') refreshed = true;
            return {
                ok: true,
                json: async () => url.endsWith('/status')
                    ? { ...status, enabled: true, teamsBridgeObservabilityEnabled: true }
                    : url.includes('offset=20') ? { attempts: [failed], total: 21, nextOffset: null }
                        : url.includes('/attempts?') ? {
                            attempts: [refreshed ? { ...active, id: 'attempt-new' } : active],
                            total: 21, nextOffset: 20,
                        } : { ok: true },
            };
        });
        vi.stubGlobal('fetch', fetch);
        render(<TeamsConnectionCard />);
        await screen.findByText(/Connected · degraded/);
        fireEvent.click(screen.getByText('Next'));
        expect(await screen.findByText(/✕ Failed/)).toBeDefined();
        fireEvent.click(screen.getByText('Reconnect'));
        await waitFor(() => expect(fetch).toHaveBeenCalledWith(
            expect.stringMatching(/\/messaging\/teams\/attempts\?offset=0&limit=20$/), undefined,
        ));
        await waitFor(() => expect(screen.queryByText(/✕ Failed/)).toBeNull());
    });

    it('marks retained history stale when a later refresh fails', async () => {
        let fail = false;
        vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/attempts?')
            ? fail ? { ok: false, status: 503, json: async () => ({ error: 'Unavailable' }) }
                : { ok: true, json: async () => ({ attempts: [active], total: 1, nextOffset: null }) }
            : { ok: true, json: async () => ({ ...status, teamsBridgeObservabilityEnabled: true }) }));
        render(<TeamsConnectionCard />);
        await screen.findByText(/Connected · degraded/);
        fail = true;
        fireEvent.click(screen.getByText('Refresh status'));
        expect(await screen.findByText(/Previous results are stale/)).toBeDefined();
        expect(screen.getByText(/Connected · degraded/)).toBeDefined();
    });

    it('shows an initial history-load error without misrepresenting it as empty', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/attempts?')
            ? { ok: false, status: 503, json: async () => ({ error: 'Unavailable' }) }
            : { ok: true, json: async () => ({ ...status, teamsBridgeObservabilityEnabled: true }) }));
        render(<TeamsConnectionCard />);
        expect(await screen.findByText(/Could not load connection history: Unavailable/)).toBeDefined();
        expect(screen.queryByText(/No connection attempts yet/)).toBeNull();
        expect(screen.queryByText(/Previous results are stale/)).toBeNull();
    });

    it('shows the inbound bridge and enables + connects using the normal CoC routes', async () => {
        const fetch = vi.fn(async (url: string, options?: RequestInit) => ({
            ok: true,
            json: async () => url.endsWith('/status') ? status : { ok: true },
        }));
        vi.stubGlobal('fetch', fetch);
        render(<TeamsConnectionCard />);
        expect(await screen.findByText(/Connection: disconnected/)).toBeDefined();
        expect(screen.getByText(/does not relay agent output/)).toBeDefined();
        fireEvent.click(screen.getByText('Enable & connect'));
        await waitFor(() => expect(fetch).toHaveBeenCalledWith(
            expect.stringMatching(/\/messaging\/teams\/reconnect$/),
            expect.objectContaining({ method: 'POST' }),
        ));
        expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/messaging\/teams\/config$/),
            expect.objectContaining({ body: '{"enabled":true}' }));
    });

    it('shows the server-provided machine channel and saves an edited channel', async () => {
        const initial = { ...status, channelName: 'CoC-Desktop-01' };
        const fetch = vi.fn(async (url: string) => ({
            ok: true, json: async () => url.endsWith('/status') ? initial : { ok: true },
        }));
        vi.stubGlobal('fetch', fetch);
        render(<TeamsConnectionCard />);
        const channel = await screen.findByDisplayValue('CoC-Desktop-01');
        expect(screen.getByText(/including machines with the same name/)).toBeDefined();
        fireEvent.change(channel, { target: { value: 'Private-Channel' } });
        expect((screen.getByText('Enable & connect') as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByText('Save channel'));
        await waitFor(() => expect(fetch).toHaveBeenCalledWith(
            expect.stringMatching(/\/messaging\/teams\/config$/),
            expect.objectContaining({ body: '{"teamName":"Engineering","channelName":"Private-Channel","botName":"CoC","ic3Region":null}' }),
        ));
    });

    it.each(['amer', 'emea', 'apac', ''] as const)('saves region %s explicitly and gates reconnect on unsaved changes', async region => {
        let current = { ...status, enabled: true, ic3Region: 'emea' as string | null };
        const fetch = vi.fn(async (url: string, options?: RequestInit) => {
            if (url.endsWith('/config')) current = { ...current, ...JSON.parse(String(options?.body)) };
            return { ok: true, json: async () => url.endsWith('/status') ? current : { ok: true } };
        });
        vi.stubGlobal('fetch', fetch);
        render(<TeamsConnectionCard />);
        await screen.findByText(/Connection: disconnected/);
        const select = screen.getByLabelText('IC3 region') as HTMLSelectElement;
        expect(select.value).toBe('emea');
        expect(Array.from(select.options).map(option => option.text))
            .toEqual(['Unconfigured', 'Americas', 'Europe-Middle East-Africa', 'Asia-Pacific']);
        fireEvent.change(select, { target: { value: region } });
        expect((screen.getByText('Reconnect') as HTMLButtonElement).disabled).toBe(region !== 'emea');
        fireEvent.click(screen.getByText('Save channel'));
        await waitFor(() => expect(fetch).toHaveBeenCalledWith(
            expect.stringMatching(/\/messaging\/teams\/config$/),
            expect.objectContaining({ body: JSON.stringify({
                teamName: 'Engineering', channelName: 'General', botName: 'CoC', ic3Region: region || null,
            }) }),
        ));
        await waitFor(() => expect((screen.getByText('Reconnect') as HTMLButtonElement).disabled).toBe(false));
        expect(screen.getByText(/Save changes, then reconnect/)).toBeDefined();
    });

    it('does not offer OAuth when the server lacks support and displays connection errors', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            json: async () => ({ ...status, teamsOAuthAvailable: false, error: 'OAuth required', authStatus: 'required' }),
        })));
        render(<TeamsConnectionCard />);
        expect(await screen.findByText('OAuth required')).toBeDefined();
        expect((screen.getByText('Authenticate') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByText('Enable & connect') as HTMLButtonElement).disabled).toBe(true);
    });

    it('offers a user-clickable sign-in link without opening a popup automatically', async () => {
        const popup = vi.fn();
        vi.stubGlobal('open', popup);
        const fetch = vi.fn(async (url: string) => ({
            ok: true,
            json: async () => url.endsWith('/status') ? { ...status, authStatus: 'required' } : {
                requestId: 'pending-1', authorizationUrl: 'https://login.example.test/authorize?state=opaque',
            },
        }));
        vi.stubGlobal('fetch', fetch);
        render(<TeamsConnectionCard />);
        await screen.findByText(/OAuth: required/);
        fireEvent.click(screen.getByText('Authenticate'));
        const link = await screen.findByText('Continue Microsoft sign-in') as HTMLAnchorElement;
        expect(link.href).toContain('https://login.example.test/authorize');
        expect(link.rel).toContain('noopener');
        expect(popup).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/messaging\/teams\/auth\/start$/), expect.objectContaining({ method: 'POST' }));
    });

    it('offers reconnect for an expired token that the connector can refresh', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            json: async () => ({ ...status, authStatus: 'expired', oauthAvailable: false }),
        })));
        render(<TeamsConnectionCard />);
        expect(await screen.findByText(/OAuth: expired/)).toBeDefined();
        expect((screen.getByText('Enable & connect') as HTMLButtonElement).disabled).toBe(false);
    });

    it('saves an edited MCP URL without connecting with unsaved changes', async () => {
        const fetch = vi.fn(async (url: string) => ({
            ok: true,
            json: async () => url.endsWith('/status') ? status : { ok: true },
        }));
        vi.stubGlobal('fetch', fetch);
        render(<TeamsConnectionCard />);
        const input = await screen.findByDisplayValue('https://example.test/teams');
        fireEvent.change(input, { target: { value: 'https://example.test/new-teams' } });
        expect((screen.getByText('Enable & connect') as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByText('Save MCP endpoint'));
        await waitFor(() => expect(fetch).toHaveBeenCalledWith(
            expect.stringMatching(/\/messaging\/teams\/server$/),
            expect.objectContaining({ body: '{"url":"https://example.test/new-teams"}' }),
        ));
    });
});
