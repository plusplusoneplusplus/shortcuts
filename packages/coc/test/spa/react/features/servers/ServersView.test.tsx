import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { ServersView } from '../../../../../src/server/spa/client/react/features/servers/ServersView';
import type { RemoteServer } from '../../../../../src/server/spa/client/react/utils/serverRegistry';
import { useRemoteServerHealth } from '../../../../../src/server/spa/client/react/hooks/useRemoteServerHealth';

const registryMocks = vi.hoisted(() => ({
    listRemoteServers: vi.fn(),
    addRemoteServer: vi.fn(),
    updateRemoteServer: vi.fn(),
    removeRemoteServer: vi.fn(),
    testRemoteServer: vi.fn(),
    reconnectServer: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/utils/serverRegistry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../../src/server/spa/client/react/utils/serverRegistry')>();
    return {
        ...actual,
        listRemoteServers: registryMocks.listRemoteServers,
        addRemoteServer: registryMocks.addRemoteServer,
        updateRemoteServer: registryMocks.updateRemoteServer,
        removeRemoteServer: registryMocks.removeRemoteServer,
        testRemoteServer: registryMocks.testRemoteServer,
        reconnectServer: registryMocks.reconnectServer,
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

const SSH_REMOTE: RemoteServer = {
    id: 'c',
    kind: 'ssh',
    label: 'ubuntu-arm',
    host: 'ubuntu-arm',
    localPort: 4000,
    addedAt: 3,
    updatedAt: 3,
};

beforeEach(() => {
    registryMocks.listRemoteServers.mockResolvedValue([]);
    registryMocks.addRemoteServer.mockResolvedValue(URL_REMOTE);
    registryMocks.updateRemoteServer.mockResolvedValue(URL_REMOTE);
    registryMocks.removeRemoteServer.mockResolvedValue(undefined);
    registryMocks.testRemoteServer.mockResolvedValue({ serverId: 'test', kind: 'url', status: 'online', lastChecked: 1 });
    registryMocks.reconnectServer.mockResolvedValue({ serverId: 'c', kind: 'ssh', status: 'online' });
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

const defaultHealthImpl = (servers: RemoteServer[]) =>
    servers.map(s => ({
        server: s,
        kind: s.kind,
        status: 'online' as const,
        version: '1.0.0',
        effectiveUrl: s.kind === 'devtunnel' ? s.effectiveUrl : s.url,
        localPort: s.kind === 'devtunnel' ? s.localPort : undefined,
        tunnelId: s.kind === 'devtunnel' ? s.tunnelId : undefined,
    }));

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.values(registryMocks).forEach(mock => mock.mockReset());
    vi.mocked(useRemoteServerHealth).mockReset().mockImplementation(defaultHealthImpl);
});

function switchToGrid() {
    fireEvent.click(screen.getByTitle('grid'));
}

describe('ServersView', () => {
    it('defaults to split view', () => {
        render(<ServersView />);
        expect(screen.getByRole('heading', { name: 'This Server' })).toBeTruthy();
    });

    it('always renders the local "This Server" card first', async () => {
        render(<ServersView />);
        switchToGrid();
        const cards = screen.getAllByTestId('server-card');
        expect(cards[0].textContent).toContain('This Server');
        await waitFor(() => expect(registryMocks.listRemoteServers).toHaveBeenCalled());
    });

    it('renders one ServerCard per remote returned by backend plus the local card', async () => {
        registryMocks.listRemoteServers.mockResolvedValue([URL_REMOTE, TUNNEL_REMOTE]);

        render(<ServersView />);
        switchToGrid();
        await waitFor(() => expect(screen.getAllByTestId('server-card')).toHaveLength(3));
        const cards = screen.getAllByTestId('server-card');
        expect(cards[0].textContent).toContain('This Server');
        expect(cards[1].textContent).toContain('Box A');
        expect(cards[2].textContent).toContain('Box B');
        expect(cards[2].textContent).toContain('Tunnel: box-b');
    });

    it('clicking "+ Add Server" opens the AddServerDialog', () => {
        render(<ServersView />);
        switchToGrid();
        expect(screen.queryByTestId('add-server-url-input')).toBeNull();
        fireEvent.click(screen.getByTestId('servers-view-add-btn'));
        expect(screen.getByTestId('add-server-url-input')).toBeTruthy();
    });

    it('submitting Add Server calls backend add and refreshes the list', async () => {
        registryMocks.listRemoteServers
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ ...URL_REMOTE, id: 'new', label: 'New Box', url: 'https://new.example.com' }]);

        render(<ServersView />);
        switchToGrid();
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
        switchToGrid();
        await waitFor(() => expect(screen.getAllByTestId('server-card')).toHaveLength(2));

        fireEvent.click(screen.getByTestId('server-card-menu-btn'));
        await act(async () => {
            fireEvent.click(screen.getByTestId('server-card-menu-remove'));
        });

        expect(registryMocks.removeRemoteServer).toHaveBeenCalledWith('a');
        await waitFor(() => expect(screen.getAllByTestId('server-card')).toHaveLength(1));
    });

    it('clicking Reconnect on an SSH server calls backend reconnect and refreshes', async () => {
        registryMocks.listRemoteServers.mockResolvedValue([SSH_REMOTE]);

        render(<ServersView />);
        switchToGrid();
        await waitFor(() => expect(screen.getAllByTestId('server-card')).toHaveLength(2));

        fireEvent.click(screen.getByTestId('server-card-menu-btn'));
        await act(async () => {
            fireEvent.click(screen.getByTestId('server-card-menu-reconnect'));
        });

        expect(registryMocks.reconnectServer).toHaveBeenCalledWith('c');
        await waitFor(() => expect(registryMocks.listRemoteServers).toHaveBeenCalledTimes(2));
    });

    it('clicking Edit server opens a prefilled edit dialog for a Direct URL server', async () => {
        registryMocks.listRemoteServers.mockResolvedValue([URL_REMOTE]);

        render(<ServersView />);
        switchToGrid();
        await waitFor(() => expect(screen.getAllByTestId('server-card')).toHaveLength(2));

        fireEvent.click(screen.getByTestId('server-card-menu-btn'));
        fireEvent.click(screen.getByTestId('server-card-menu-edit'));

        expect(screen.getByText('Edit Server')).toBeTruthy();
        expect((screen.getByTestId('edit-server-kind-url') as HTMLInputElement).checked).toBe(true);
        expect((screen.getByTestId('edit-server-url-input') as HTMLInputElement).value).toBe('https://a.example.com');
        expect((screen.getByTestId('edit-server-label-input') as HTMLInputElement).value).toBe('Box A');
        expect((screen.getByTestId('edit-server-submit-btn') as HTMLButtonElement).textContent).toContain('Save Changes');
    });

    it('editing a Direct URL server calls update and refreshes the list', async () => {
        registryMocks.listRemoteServers
            .mockResolvedValueOnce([URL_REMOTE])
            .mockResolvedValueOnce([{ ...URL_REMOTE, label: 'Box A Edited', url: 'https://edited.example.com' }]);

        render(<ServersView />);
        switchToGrid();
        await waitFor(() => expect(screen.getAllByTestId('server-card')).toHaveLength(2));

        fireEvent.click(screen.getByTestId('server-card-menu-btn'));
        fireEvent.click(screen.getByTestId('server-card-menu-edit'));
        fireEvent.change(screen.getByTestId('edit-server-url-input'), {
            target: { value: 'https://edited.example.com/' },
        });
        fireEvent.change(screen.getByTestId('edit-server-label-input'), {
            target: { value: 'Box A Edited' },
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('edit-server-submit-btn'));
        });

        await waitFor(() => expect(registryMocks.updateRemoteServer).toHaveBeenCalledWith('a', {
            kind: 'url',
            label: 'Box A Edited',
            url: 'https://edited.example.com',
        }));
        await waitFor(() => expect(screen.queryByTestId('edit-server-url-input')).toBeNull());
        expect(screen.getAllByTestId('server-card')[1].textContent).toContain('Box A Edited');
    });

    it('editing a DevTunnel server preloads and saves the tunnel ID', async () => {
        registryMocks.listRemoteServers
            .mockResolvedValueOnce([TUNNEL_REMOTE])
            .mockResolvedValueOnce([{ ...TUNNEL_REMOTE, label: 'Box C', tunnelId: 'box-c' }]);

        render(<ServersView />);
        switchToGrid();
        await waitFor(() => expect(screen.getAllByTestId('server-card')).toHaveLength(2));

        fireEvent.click(screen.getByTestId('server-card-menu-btn'));
        fireEvent.click(screen.getByTestId('server-card-menu-edit'));

        expect((screen.getByTestId('edit-server-kind-devtunnel') as HTMLInputElement).checked).toBe(true);
        expect((screen.getByTestId('edit-server-tunnel-id-input') as HTMLInputElement).value).toBe('box-b');

        fireEvent.change(screen.getByTestId('edit-server-tunnel-id-input'), {
            target: { value: 'box-c' },
        });
        fireEvent.change(screen.getByTestId('edit-server-label-input'), {
            target: { value: 'Box C' },
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('edit-server-submit-btn'));
        });

        await waitFor(() => expect(registryMocks.updateRemoteServer).toHaveBeenCalledWith('b', {
            kind: 'devtunnel',
            label: 'Box C',
            tunnelId: 'box-c',
        }));
        await waitFor(() => expect(screen.queryByTestId('edit-server-tunnel-id-input')).toBeNull());
        expect(screen.getAllByTestId('server-card')[1].textContent).toContain('Tunnel: box-c');
    });

    it('local card displays "Current — You\'re here" and no menu button', () => {
        render(<ServersView />);
        switchToGrid();
        const cards = screen.getAllByTestId('server-card');
        expect(cards[0].textContent).toContain('Current');
        expect(cards[0].querySelector('[data-testid="server-card-menu-btn"]')).toBeNull();
    });

    it('local card transitions to online after polling', async () => {
        render(<ServersView />);
        switchToGrid();
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
        switchToGrid();
        const localCard = screen.getAllByTestId('server-card')[0];
        await waitFor(() => {
            const dot = localCard.querySelector('[data-testid="server-status-dot"]');
            expect(dot?.getAttribute('data-status')).toBe('offline');
        });
    });

    it('clears the local poll interval on unmount', async () => {
        const clearSpy = vi.spyOn(global, 'clearInterval');
        const { unmount } = render(<ServersView />);
        switchToGrid();
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
        switchToGrid();
        try {
            await act(async () => { await vi.advanceTimersByTimeAsync(0); });
            const callsAfterFirstPoll = fetchMock.mock.calls.length;
            await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
            expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirstPoll);
        } finally {
            unmount();
        }
    });

    // ── New UI features ──

    it('summary strip renders the five KPI labels', () => {
        render(<ServersView />);
        const strip = screen.getByTestId('summary-strip');
        expect(strip.textContent).toContain('Online');
        expect(strip.textContent).toContain('Offline');
        expect(strip.textContent).toContain('Active tasks');
        expect(strip.textContent).toContain('DevTunnels');
        expect(strip.textContent).toContain('SSH tunnels');
    });

    it('filter "URL" shows only URL-kind servers', async () => {
        registryMocks.listRemoteServers.mockResolvedValue([URL_REMOTE, TUNNEL_REMOTE]);
        render(<ServersView />);
        switchToGrid();
        await waitFor(() => expect(screen.getAllByTestId('server-card')).toHaveLength(3));

        fireEvent.click(screen.getByRole('button', { name: 'URL' }));
        expect(screen.getAllByTestId('server-card')).toHaveLength(1);
        expect(screen.getAllByTestId('server-card')[0].textContent).toContain('Box A');
    });

    it('filter "Tunnel" shows only DevTunnel servers', async () => {
        registryMocks.listRemoteServers.mockResolvedValue([URL_REMOTE, TUNNEL_REMOTE]);
        render(<ServersView />);
        switchToGrid();
        await waitFor(() => expect(screen.getAllByTestId('server-card')).toHaveLength(3));

        fireEvent.click(screen.getByRole('button', { name: 'Tunnel' }));
        expect(screen.getAllByTestId('server-card')).toHaveLength(1);
        expect(screen.getAllByTestId('server-card')[0].textContent).toContain('Box B');
    });

    it('filter "Local" shows only the local server', async () => {
        registryMocks.listRemoteServers.mockResolvedValue([URL_REMOTE, TUNNEL_REMOTE]);
        render(<ServersView />);
        switchToGrid();
        await waitFor(() => expect(screen.getAllByTestId('server-card')).toHaveLength(3));

        fireEvent.click(screen.getByRole('button', { name: 'Local' }));
        expect(screen.getAllByTestId('server-card')).toHaveLength(1);
        expect(screen.getAllByTestId('server-card')[0].textContent).toContain('This Server');
    });

    it('filter "All" restores the full list after narrowing', async () => {
        registryMocks.listRemoteServers.mockResolvedValue([URL_REMOTE, TUNNEL_REMOTE]);
        render(<ServersView />);
        switchToGrid();
        await waitFor(() => expect(screen.getAllByTestId('server-card')).toHaveLength(3));

        fireEvent.click(screen.getByRole('button', { name: 'URL' }));
        expect(screen.getAllByTestId('server-card')).toHaveLength(1);

        fireEvent.click(screen.getByRole('button', { name: /^All/ }));
        expect(screen.getAllByTestId('server-card')).toHaveLength(3);
    });

    it('filter "Offline" shows only offline-status servers', async () => {
        vi.mocked(useRemoteServerHealth).mockImplementation(servers =>
            servers.map(s => ({
                server: s,
                kind: s.kind,
                status: 'offline' as const,
                effectiveUrl: s.kind === 'devtunnel'
                    ? (s as typeof TUNNEL_REMOTE).effectiveUrl
                    : (s as typeof URL_REMOTE).url,
                localPort: s.kind === 'devtunnel' ? (s as typeof TUNNEL_REMOTE).localPort : undefined,
                tunnelId: s.kind === 'devtunnel' ? (s as typeof TUNNEL_REMOTE).tunnelId : undefined,
            }))
        );
        registryMocks.listRemoteServers.mockResolvedValue([URL_REMOTE]);
        render(<ServersView />);
        switchToGrid();
        await waitFor(() => expect(screen.getAllByTestId('server-card')).toHaveLength(2));

        fireEvent.click(screen.getByRole('button', { name: /^Offline/ }));
        expect(screen.getAllByTestId('server-card')).toHaveLength(1);
        expect(screen.getAllByTestId('server-card')[0].textContent).toContain('Box A');
    });

    it('search by label narrows the displayed server cards', async () => {
        registryMocks.listRemoteServers.mockResolvedValue([URL_REMOTE, TUNNEL_REMOTE]);
        render(<ServersView />);
        switchToGrid();
        await waitFor(() => expect(screen.getAllByTestId('server-card')).toHaveLength(3));

        fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'Box A' } });
        expect(screen.getAllByTestId('server-card')).toHaveLength(1);
        expect(screen.getAllByTestId('server-card')[0].textContent).toContain('Box A');
    });

    it('clearing search text restores the full server list', async () => {
        registryMocks.listRemoteServers.mockResolvedValue([URL_REMOTE, TUNNEL_REMOTE]);
        render(<ServersView />);
        switchToGrid();
        await waitFor(() => expect(screen.getAllByTestId('server-card')).toHaveLength(3));

        const input = screen.getByPlaceholderText('Search…');
        fireEvent.change(input, { target: { value: 'Box' } });
        expect(screen.getAllByTestId('server-card')).toHaveLength(2);

        fireEvent.change(input, { target: { value: '' } });
        expect(screen.getAllByTestId('server-card')).toHaveLength(3);
    });

    it('switching to list view renders server labels without server-card wrappers', async () => {
        registryMocks.listRemoteServers.mockResolvedValue([URL_REMOTE]);
        render(<ServersView />);
        switchToGrid();
        await waitFor(() => expect(screen.getAllByTestId('server-card')).toHaveLength(2));

        fireEvent.click(screen.getByTitle('list'));
        expect(screen.queryAllByTestId('server-card')).toHaveLength(0);
        expect(screen.getByText('This Server')).toBeTruthy();
        expect(screen.getByText('Box A')).toBeTruthy();
    });

    it('switching to grid from default split shows server cards', () => {
        render(<ServersView />);
        expect(screen.getByRole('heading', { name: 'This Server' })).toBeTruthy();
        switchToGrid();
        expect(screen.queryAllByTestId('server-card').length).toBeGreaterThan(0);
    });

    it('summary strip shows SSH tunnel count when SSH servers are registered', async () => {
        registryMocks.listRemoteServers.mockResolvedValue([SSH_REMOTE]);
        render(<ServersView />);
        await waitFor(() => expect(registryMocks.listRemoteServers).toHaveBeenCalled());
        const strip = screen.getByTestId('summary-strip');
        expect(strip.textContent).toContain('SSH tunnels');
    });

    it('shows a load-error banner when listRemoteServers rejects', async () => {
        registryMocks.listRemoteServers.mockRejectedValue(new Error('network error'));
        render(<ServersView />);
        await waitFor(() => expect(screen.getByTestId('servers-view-load-error')).toBeTruthy());
        expect(screen.getByTestId('servers-view-load-error').textContent).toContain('network error');
    });
});
