import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamsIc3StatusCard } from '../../../../src/server/spa/client/react/admin/TeamsIc3StatusCard';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), server: {} as { fetch: typeof fetch; apiBase: string } }));
vi.mock('../../../../src/server/spa/client/react/admin/adminTarget', () => ({
    useAdminServer: () => mocks.server,
}));

describe('Teams IC3 connectivity card', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mocks.fetch.mockReset();
        mocks.server = { fetch: mocks.fetch, apiBase: 'https://configured.example.test/api' };
    });
    afterEach(() => { vi.useRealTimers(); });
    const respond = (body: object) => new Response(JSON.stringify(body));
    const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

    it.each([
        ['disabled', 'Disabled'], ['connecting', 'Connecting'], ['connected', 'Connected'],
        ['degraded', 'Degraded'], ['error', 'Connection failed'], ['stopped', 'Stopped'],
    ])('renders %s distinctly from the channel bridge', async (state, label) => {
        mocks.fetch.mockResolvedValue(respond({ state }));
        render(<TeamsIc3StatusCard />);
        await flush();
        expect(screen.getByRole('status').textContent).toBe(label);
        expect(screen.getByText('IC3 connectivity')).toBeDefined();
        expect(screen.getByTestId('ic3-own-command-trouter-status').textContent).toContain('disabled');
        expect(screen.getByTestId('ic3-own-command-trouter-status').textContent).toContain('Notifications wake targeted IC3 reads');
        expect(mocks.fetch).toHaveBeenCalledWith(
            'https://configured.example.test/api/messaging/teams/ic3-own-commands/status',
            expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
        if (state === 'disabled') expect(screen.getByText(/Enable IC3 own commands/)).toBeDefined();
    });

    it('shows independent own-command notification health and fallback guidance', async () => {
        mocks.fetch.mockResolvedValue(respond({ state: 'connected',
            trouter: { state: 'retrying', error: { code: 'socket', message: 'Socket unavailable' } } }));
        render(<TeamsIc3StatusCard />);
        await flush();
        expect(screen.getByRole('status').textContent).toBe('Connected');
        expect(screen.getByTestId('ic3-own-command-trouter-status').textContent).toContain('retrying');
        expect(screen.getByRole('alert').textContent).toContain('socket');
        expect(screen.getByRole('alert').textContent).toContain('Background scans remain active');
    });
    it('shows last check, last connection and safe diagnostic guidance', async () => {
        mocks.fetch.mockResolvedValue(respond({ state: 'degraded', error: 'Permission',
            lastCheckedAt: '2026-01-01T00:00:00Z', lastConnectedAt: '2025-12-31T23:59:00Z' }));
        render(<TeamsIc3StatusCard />);
        await flush();
        expect(screen.getByText(/Last check:/)).toBeDefined();
        expect(screen.getByText(/Last connected:/)).toBeDefined();
        expect(screen.getByRole('alert').textContent).toContain('Permission');
        expect(screen.getByText(/does not test write access/)).toBeDefined();
    });

    it('drops stale connected status on failure and recovers through explicit refresh', async () => {
        mocks.fetch.mockResolvedValueOnce(respond({ state: 'connected' }))
            .mockRejectedValueOnce(new Error('private failure')).mockResolvedValue(respond({ state: 'connected' }));
        render(<TeamsIc3StatusCard />);
        await flush();
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(screen.getByRole('status').textContent).toBe('Status unavailable');
        expect(screen.getByRole('alert').textContent).not.toContain('private failure');
        fireEvent.click(screen.getByRole('button', { name: 'Refresh IC3 status' }));
        await flush();
        expect(screen.getByRole('status').textContent).toBe('Connected');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('rejects malformed status and HTTP failure instead of showing connected', async () => {
        mocks.fetch.mockResolvedValueOnce(respond({ state: 'unexpected' }))
            .mockResolvedValue(new Response('', { status: 503 }));
        render(<TeamsIc3StatusCard />);
        await flush();
        expect(screen.getByRole('status').textContent).toBe('Status unavailable');
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(screen.getByRole('status').textContent).toBe('Status unavailable');
    });

    it('rejects malformed notification status without rendering provider objects', async () => {
        mocks.fetch.mockResolvedValue(respond({ state: 'connected', trouter: { state: 'registered', error: { code: {} } } }));
        render(<TeamsIc3StatusCard />);
        await flush();
        expect(screen.getByRole('status').textContent).toBe('Status unavailable');
    });

    it('aborts old-machine reads and ignores late results after switching machines', async () => {
        let finish!: (response: Response) => void;
        mocks.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const { rerender, unmount } = render(<TeamsIc3StatusCard />);
        const oldSignal = mocks.fetch.mock.calls[0][1].signal;
        const remoteFetch = vi.fn().mockResolvedValue(respond({ state: 'disabled' }));
        mocks.server = { fetch: remoteFetch, apiBase: 'https://other.example.test/api' };
        rerender(<TeamsIc3StatusCard />);
        await flush();
        expect(oldSignal.aborted).toBe(true);
        await act(async () => { finish(respond({ state: 'connected' })); });
        expect(screen.getByRole('status').textContent).toBe('Disabled');
        unmount();
        expect(remoteFetch.mock.calls[0][1].signal.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });
});
