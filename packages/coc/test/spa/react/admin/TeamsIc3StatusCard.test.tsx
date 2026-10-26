import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamsIc3StatusCard } from '../../../../src/server/spa/client/react/admin/TeamsIc3StatusCard';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), reactionFetch: vi.fn(), server: {} as { fetch: typeof fetch; apiBase: string } }));
vi.mock('../../../../src/server/spa/client/react/admin/adminTarget', () => ({
    useAdminServer: () => mocks.server,
}));

describe('Teams IC3 connectivity card', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mocks.fetch.mockReset();
        mocks.reactionFetch.mockReset().mockImplementation(async () => respond({ state: 'disabled' }));
        mocks.server = {
            fetch: (url, options) => String(url).endsWith('/reactions/status')
                ? mocks.reactionFetch(url, options) : mocks.fetch(url, options),
            apiBase: 'https://configured.example.test/api',
        };
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
        expect(screen.getByTestId('ic3-own-command-trouter-status').textContent)
            .toContain(state === 'disabled' ? 'disabled' : 'Status unavailable');
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
        expect(screen.getByTestId('ic3-own-command-trouter-status').textContent).toContain('Status unavailable');
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(screen.getByRole('status').textContent).toBe('Status unavailable');
    });

    it('does not claim notifications are disabled while the status request is pending', async () => {
        mocks.fetch.mockImplementation(() => new Promise(() => {}));
        render(<TeamsIc3StatusCard />);
        expect(screen.getByRole('status').textContent).toBe('Loading status...');
        expect(screen.getByTestId('ic3-own-command-trouter-status').textContent).toContain('Status unavailable');
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

    it.each(['blocked', 'failed'] as const)('shows %s mention and reaction checks without marking reads unhealthy', async state => {
        const outboundCompliance = {
            state, reason: state === 'blocked' ? 'Blocked by policy. The rejection reaction failed.' : 'The compliance decision timed out.',
            checkedAt: '2026-01-01T00:00:00Z',
        };
        mocks.fetch.mockResolvedValue(respond({ state: 'connected', outboundCompliance }));
        mocks.reactionFetch.mockResolvedValue(respond({ state: 'connected', outboundCompliance }));
        render(<TeamsIc3StatusCard />);
        await flush();
        expect(screen.getByRole('status').textContent).toBe('Connected');
        const alerts = screen.getAllByRole('alert').map(element => element.textContent);
        expect(alerts).toHaveLength(2);
        expect(alerts[0]).toContain(`Last mention outbound compliance failure: ${state}`);
        expect(alerts[1]).toContain(`Last reaction outbound compliance failure: ${state}`);
        expect(alerts.every(text => text?.includes(outboundCompliance.reason))).toBe(true);
        expect(mocks.reactionFetch).toHaveBeenCalledWith(
            'https://configured.example.test/api/messaging/teams/reactions/status',
            expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
    });

    it.each([
        { state: 'allowed', reason: 'Invalid state', checkedAt: '2026-01-01T00:00:00Z' },
        { state: 'blocked', reason: {}, checkedAt: '2026-01-01T00:00:00Z' },
        { state: 'failed', reason: 'Failure', checkedAt: 'invalid' },
    ])('reports malformed compliance status instead of hiding failures: %j', async outboundCompliance => {
        mocks.fetch.mockResolvedValue(respond({ state: 'connected', outboundCompliance }));
        mocks.reactionFetch.mockResolvedValue(respond({ state: 'connected', outboundCompliance }));
        render(<TeamsIc3StatusCard />);
        await flush();
        expect(screen.getByRole('status').textContent).toBe('Status unavailable');
        expect(screen.getAllByRole('alert')).toHaveLength(2);
    });

    it('reports reaction status failures independently and recovers without a Teams write', async () => {
        mocks.fetch.mockImplementation(async () => respond({ state: 'connected' }));
        mocks.reactionFetch.mockRejectedValueOnce(new Error('private endpoint text'))
            .mockImplementation(async () => respond({ state: 'connected' }));
        render(<TeamsIc3StatusCard />);
        await flush();
        expect(screen.getByRole('status').textContent).toBe('Connected');
        expect(screen.getByRole('alert').textContent).toContain('Unable to read reaction compliance status');
        expect(screen.getByRole('alert').textContent).not.toContain('private endpoint text');
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(screen.queryByRole('alert')).toBeNull();
        expect(mocks.fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true);
    });

    it('revokes pending reaction failures when switching the owning server', async () => {
        mocks.fetch.mockImplementation(async () => respond({ state: 'connected' }));
        let finish!: (response: Response) => void;
        mocks.reactionFetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const { rerender, unmount } = render(<TeamsIc3StatusCard />);
        const oldSignal = mocks.reactionFetch.mock.calls[0][1].signal;
        const remoteFetch = vi.fn().mockImplementation(async () => respond({ state: 'disabled' }));
        mocks.server = { fetch: remoteFetch, apiBase: 'https://other.example.test/api' };
        rerender(<TeamsIc3StatusCard />);
        await flush();
        expect(oldSignal.aborted).toBe(true);
        await act(async () => { finish(respond({ state: 'connected', outboundCompliance: {
            state: 'blocked', reason: 'Stale owner failure', checkedAt: '2026-01-01T00:00:00Z',
        } })); });
        expect(screen.queryByText(/Stale owner failure/)).toBeNull();
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });
});
