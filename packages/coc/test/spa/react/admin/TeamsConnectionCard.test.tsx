import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TeamsConnectionCard } from '../../../../src/server/spa/client/react/admin/TeamsConnectionCard';

const status = {
    enabled: false,
    status: 'disconnected',
    error: null,
    authStatus: 'authenticated',
    oauthAvailable: true,
    serverUrl: 'https://example.test/teams',
    teamName: 'Engineering',
    channelName: 'General',
    botName: 'CoC',
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('TeamsConnectionCard', () => {
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

    it('does not offer OAuth when the server lacks support and displays connection errors', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            json: async () => ({ ...status, oauthAvailable: false, error: 'OAuth required', authStatus: 'required' }),
        })));
        render(<TeamsConnectionCard />);
        expect(await screen.findByText('OAuth required')).toBeDefined();
        expect((screen.getByText('Authenticate') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByText('Enable & connect') as HTMLButtonElement).disabled).toBe(true);
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
