import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TeamsSettingsCard } from '../../../../src/server/spa/client/react/admin/IMSettingsSection';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function fixture() {
    const state = {
        connection: 'disconnected',
        auth: { authenticated: false, status: 'pending', error: undefined as string | undefined },
        authorizationUrl: 'https://login.microsoftonline.com/fixture/authorize',
        cancelOk: true,
    };
    const fetchMock = vi.fn(async (url: string) => ({
        ok: true,
        json: async () => {
            if (url.endsWith('/auth/start')) return { ok: true, authorizationUrl: state.authorizationUrl, status: 'pending' };
            if (url.endsWith('/auth/status')) return state.auth;
            if (url.endsWith('/auth/cancel')) return { ok: state.cancelOk, error: state.cancelOk ? undefined : 'Cancellation failed' };
            return { enabled: true, status: state.connection, mode: 'mcp', error: null, botName: 'Fixture' };
        },
    }));
    vi.stubGlobal('fetch', fetchMock);
    return { state, fetchMock };
}

async function start(fakeTime = false) {
    render(<TeamsSettingsCard />);
    const connect = await screen.findByRole('button', { name: 'Connect' });
    if (fakeTime) vi.useFakeTimers();
    await act(async () => { fireEvent.click(connect); });
    return screen.getByRole('link', { name: 'Open Microsoft sign-in' });
}

describe('container Teams native sign-in UI', () => {
    it('shows native instructions and cancels without PKCE, popups or code exchange', async () => {
        const f = fixture();
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        const link = await start();
        expect(link.getAttribute('href')).toBe(f.state.authorizationUrl);
        expect((screen.getByRole('button', { name: 'Authorizing...' }) as HTMLButtonElement).disabled).toBe(true);
        expect(open).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('link')).toBeNull());
        expect(f.fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/auth\/cancel$/), { method: 'POST' });
        expect(f.fetchMock.mock.calls.every(([url]) => !url.includes('/exchange'))).toBe(true);
        open.mockRestore();
    });

    it('waits through pending reauthentication and updates only after native completion', async () => {
        const f = fixture();
        await start(true);
        f.state.auth.authenticated = true;
        await act(() => vi.advanceTimersByTimeAsync(2000));
        expect(screen.getByRole('link', { name: 'Open Microsoft sign-in' })).toBeDefined();
        f.state.auth.status = 'authenticated';
        f.state.connection = 'connected';
        await act(() => vi.advanceTimersByTimeAsync(2000));
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.getByText('Connected')).toBeDefined();
        expect(f.fetchMock.mock.calls.every(([url]) => !url.includes('/exchange'))).toBe(true);
    });

    it('keeps native failures visible and stops the sign-in poller', async () => {
        const f = fixture();
        await start(true);
        f.state.auth = { status: 'error', authenticated: false, error: 'StorageDenied' };
        await act(() => vi.advanceTimersByTimeAsync(2000));
        expect(screen.getByRole('alert').textContent).toBe('StorageDenied');
        expect(screen.queryByRole('link')).toBeNull();
        const count = f.fetchMock.mock.calls.filter(([url]) => url.endsWith('/auth/status')).length;
        await act(() => vi.advanceTimersByTimeAsync(4000));
        expect(f.fetchMock.mock.calls.filter(([url]) => url.endsWith('/auth/status')).length).toBe(count);
    });

    it('cancels server-owned work on unmount', async () => {
        const f = fixture();
        await start();
        cleanup();
        expect(f.fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/auth\/cancel$/), { method: 'POST' });
    });

    it('does not render an invalid native authorization URL', async () => {
        const f = fixture();
        f.state.authorizationUrl = 'javascript:fixture()';
        render(<TeamsSettingsCard />);
        fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
        await screen.findByRole('alert');
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('retains instructions when server cancellation fails', async () => {
        const f = fixture();
        await start();
        f.state.cancelOk = false;
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect((await screen.findByRole('alert')).textContent).toBe('Cancellation failed');
        expect(screen.getByRole('link', { name: 'Open Microsoft sign-in' })).toBeDefined();
        f.state.cancelOk = true;
    });
});
