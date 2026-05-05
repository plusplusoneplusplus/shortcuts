import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { ServersView } from '../../../../../src/server/spa/client/react/features/servers/ServersView';
import type { RemoteServer } from '../../../../../src/server/spa/client/react/utils/serverRegistry';

const registryMocks = vi.hoisted(() => ({
    listRemoteServers: vi.fn(),
    addRemoteServer: vi.fn(),
    removeRemoteServer: vi.fn(),
    testRemoteServer: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/utils/serverRegistry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../../src/server/spa/client/react/utils/serverRegistry')>();
    return {
        ...actual,
        listRemoteServers: registryMocks.listRemoteServers,
        addRemoteServer: registryMocks.addRemoteServer,
        removeRemoteServer: registryMocks.removeRemoteServer,
        testRemoteServer: registryMocks.testRemoteServer,
    };
});

vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useRemoteServerHealth', () => ({
    useRemoteServerHealth: vi.fn((servers: RemoteServer[]) =>
        servers.map(s => ({
            server: s,
            kind: s.kind,
            status: 'online' as const,
            version: '1.0.0',
            effectiveUrl: s.kind === 'devtunnel' ? s.effectiveUrl : s.url,
            localPort: s.kind === 'devtunnel' ? s.localPort : undefined,
            tunnelId: s.kind === 'devtunnel' ? s.tunnelId : undefined,
        }))
    ),
}));

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
    } as unknown as Response;
}

const URL_REMOTE: RemoteServer = {
    id: 'a',
    kind: 'url',
    label: 'Box A',
    url: 'https://a.example.com',
    addedAt: 1,
    updatedAt: 1,
};

const TUNNEL_REMOTE: RemoteServer = {
    id: 'b',
    kind: 'devtunnel',
    label: 'Box B',
    tunnelId: 'box-b',
    effectiveUrl: 'http://127.0.0.1:4000',
    localPort: 4000,
    addedAt: 2,
    updatedAt: 2,
};

beforeEach(() => {
    registryMocks.listRemoteServers.mockResolvedValue([]);
    registryMocks.addRemoteServer.mockResolvedValue(URL_REMOTE);
    registryMocks.removeRemoteServer.mockResolvedValue(undefined);
    registryMocks.testRemoteServer.mockResolvedValue({ serverId: 'test', kind: 'url', status: 'online', lastChecked: 1 });
    const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/health') || url.endsWith('/api/health')) {
            return Promise.resolve(jsonResponse({ uptime: 100, processCount: 2 }));
        }
        if (url.endsWith('/admin/version') || url.endsWith('/api/admin/version')) {
            return Promise.resolve(jsonResponse({ version: '9.9.9' }));
        }
        if (url.endsWith('/admin/config') || url.endsWith('/api/admin/config')) {
            return Promise.resolve(jsonResponse({ hostname: 'local-host' }));
        }
        return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.values(registryMocks).forEach(mock => mock.mockReset());
});

describe('ServersView', () => {
    it('always renders the local "This Server" card first', async () => {
        render(<ServersView />);
        const cards = screen.getAllByTestId('server-card');
        expect(cards[0].textContent).toContain('This Server');
        await waitFor(() => expect(registryMocks.listRemoteServers).toHaveBeenCalled());
    });

    it('renders one ServerCard per remote returned by backend plus the local card', async () => {
        registryMocks.listRemoteServers.mockResolvedValue([URL_REMOTE, TUNNEL_REMOTE]);

        render(<ServersView />);
        await waitFor(() => expect(screen.getAllByTestId('server-card')).toHaveLength(3));
        const cards = screen.getAllByTestId('server-card');
        expect(cards[0].textContent).toContain('This Server');
        expect(cards[1].textContent).toContain('Box A');
        expect(cards[2].textContent).toContain('Box B');
        expect(cards[2].textContent).toContain('Tunnel: box-b');
    });

    it('clicking "+ Add Server" opens the AddServerDialog', () => {
        render(<ServersView />);
        expect(screen.queryByTestId('add-server-url-input')).toBeNull();
        fireEvent.click(screen.getByTestId('servers-view-add-btn'));
        expect(screen.getByTestId('add-server-url-input')).toBeTruthy();
    });

    it('submitting Add Server calls backend add and refreshes the list', async () => {
        registryMocks.listRemoteServers
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ ...URL_REMOTE, id: 'new', label: 'New Box', url: 'https://new.example.com' }]);

        render(<ServersView />);
        fireEvent.click(screen.getByTestId('servers-view-add-btn'));
        fireEvent.change(screen.getByTestId('add-server-url-input'), {
            target: { value: 'https://new.example.com' },
        });
        fireEvent.change(screen.getByTestId('add-server-label-input'), {
            target: { value: 'New Box' },
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('add-server-submit-btn'));
        });

        await waitFor(() => expect(registryMocks.addRemoteServer).toHaveBeenCalledWith({
            kind: 'url',
            label: 'New Box',
            url: 'https://new.example.com',
        }));
        await waitFor(() => expect(screen.getAllByTestId('server-card')).toHaveLength(2));
        expect(screen.getAllByTestId('server-card')[1].textContent).toContain('New Box');
    });

    it('clicking Remove calls backend remove and refreshes the list', async () => {
        registryMocks.listRemoteServers
            .mockResolvedValueOnce([URL_REMOTE])
            .mockResolvedValueOnce([]);

        render(<ServersView />);
        await waitFor(() => expect(screen.getAllByTestId('server-card')).toHaveLength(2));

        fireEvent.click(screen.getByTestId('server-card-menu-btn'));
        await act(async () => {
            fireEvent.click(screen.getByTestId('server-card-menu-remove'));
        });

        expect(registryMocks.removeRemoteServer).toHaveBeenCalledWith('a');
        await waitFor(() => expect(screen.getAllByTestId('server-card')).toHaveLength(1));
    });

    it('local card displays "Current — You\'re here" and no menu button', () => {
        render(<ServersView />);
        const cards = screen.getAllByTestId('server-card');
        expect(cards[0].textContent).toContain('Current');
        expect(cards[0].querySelector('[data-testid="server-card-menu-btn"]')).toBeNull();
    });

    it('local card transitions to online after polling', async () => {
        render(<ServersView />);
        const localCard = screen.getAllByTestId('server-card')[0];
        await waitFor(() => {
            const dot = localCard.querySelector('[data-testid="server-status-dot"]');
            expect(dot?.getAttribute('data-status')).toBe('online');
        });
    });

    it('local card shows offline when the local poll fails', async () => {
        vi.unstubAllGlobals();
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
        render(<ServersView />);
        const localCard = screen.getAllByTestId('server-card')[0];
        await waitFor(() => {
            const dot = localCard.querySelector('[data-testid="server-status-dot"]');
            expect(dot?.getAttribute('data-status')).toBe('offline');
        });
    });

    it('clears the local poll interval on unmount', async () => {
        const clearSpy = vi.spyOn(global, 'clearInterval');
        const { unmount } = render(<ServersView />);
        await waitFor(() => {
            const localCard = screen.getAllByTestId('server-card')[0];
            const dot = localCard.querySelector('[data-testid="server-status-dot"]');
            expect(dot?.getAttribute('data-status')).toBe('online');
        });
        unmount();
        expect(clearSpy).toHaveBeenCalled();
    });

    it('re-polls the local server after the 30s interval', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockImplementation((url: string) => {
            if (url.endsWith('/health')) {
                return Promise.resolve(jsonResponse({ uptime: 1, processCount: 0 }));
            }
            if (url.endsWith('/admin/version')) {
                return Promise.resolve(jsonResponse({ version: 'x' }));
            }
            return Promise.resolve(jsonResponse({}));
        });
        vi.unstubAllGlobals();
        vi.stubGlobal('fetch', fetchMock);

        const { unmount } = render(<ServersView />);
        try {
            await act(async () => { await vi.advanceTimersByTimeAsync(0); });
            const callsAfterFirstPoll = fetchMock.mock.calls.length;
            await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
            expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirstPoll);
        } finally {
            unmount();
        }
    });
});
