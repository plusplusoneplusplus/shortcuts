/**
 * Tests for ServersView page component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { ServersView } from '../../../../../src/server/spa/client/react/features/servers/ServersView';

vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

// Mock the remote health hook so we don't have to drive its 30s timer in
// these tests — we already cover its behavior in useRemoteServerHealth.test.
vi.mock('../../../../../src/server/spa/client/react/hooks/useRemoteServerHealth', () => ({
    useRemoteServerHealth: vi.fn((servers: Array<{ id: string; label: string; url: string; addedAt: number }>) =>
        servers.map(s => ({ server: s, status: 'online' as const, version: '1.0.0' }))
    ),
}));

const REGISTRY_KEY = 'coc-remote-servers';

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
    } as unknown as Response;
}

beforeEach(() => {
    localStorage.clear();
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
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('ServersView', () => {
    it('always renders the local "This Server" card first', () => {
        render(<ServersView />);
        const cards = screen.getAllByTestId('server-card');
        expect(cards.length).toBeGreaterThanOrEqual(1);
        expect(cards[0].textContent).toContain('This Server');
    });

    it('renders one ServerCard per remote in registry plus the local card', () => {
        const remotes = [
            { id: 'a', label: 'Box A', url: 'https://a.example.com', addedAt: 1 },
            { id: 'b', label: 'Box B', url: 'https://b.example.com', addedAt: 2 },
        ];
        localStorage.setItem(REGISTRY_KEY, JSON.stringify(remotes));

        render(<ServersView />);
        const cards = screen.getAllByTestId('server-card');
        expect(cards.length).toBe(3);
        expect(cards[0].textContent).toContain('This Server');
        expect(cards[1].textContent).toContain('Box A');
        expect(cards[2].textContent).toContain('Box B');
    });

    it('clicking "+ Add Server" opens the AddServerDialog', () => {
        render(<ServersView />);
        expect(screen.queryByTestId('add-server-url-input')).toBeNull();
        fireEvent.click(screen.getByTestId('servers-view-add-btn'));
        expect(screen.getByTestId('add-server-url-input')).toBeTruthy();
    });

    it('submitting Add Server adds a remote to the registry and renders a new card', () => {
        render(<ServersView />);
        fireEvent.click(screen.getByTestId('servers-view-add-btn'));
        fireEvent.change(screen.getByTestId('add-server-url-input'), {
            target: { value: 'https://new.example.com' },
        });
        fireEvent.change(screen.getByTestId('add-server-label-input'), {
            target: { value: 'New Box' },
        });
        fireEvent.click(screen.getByTestId('add-server-submit-btn'));

        const persisted = JSON.parse(localStorage.getItem(REGISTRY_KEY) || '[]');
        expect(persisted).toHaveLength(1);
        expect(persisted[0].label).toBe('New Box');
        expect(persisted[0].url).toBe('https://new.example.com');

        const cards = screen.getAllByTestId('server-card');
        expect(cards.length).toBe(2);
        expect(cards[1].textContent).toContain('New Box');
    });

    it('clicking Remove on a remote card removes it from the registry and DOM', () => {
        const remotes = [
            { id: 'a', label: 'Box A', url: 'https://a.example.com', addedAt: 1 },
        ];
        localStorage.setItem(REGISTRY_KEY, JSON.stringify(remotes));

        render(<ServersView />);
        expect(screen.getAllByTestId('server-card').length).toBe(2);

        fireEvent.click(screen.getByTestId('server-card-menu-btn'));
        fireEvent.click(screen.getByTestId('server-card-menu-remove'));

        const persisted = JSON.parse(localStorage.getItem(REGISTRY_KEY) || '[]');
        expect(persisted).toHaveLength(0);
        expect(screen.getAllByTestId('server-card').length).toBe(1);
    });

    it('local card displays "Current — You\'re here" and no menu button', () => {
        render(<ServersView />);
        const cards = screen.getAllByTestId('server-card');
        expect(cards[0].textContent).toContain("Current");
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
        // Wait for the initial poll to settle to avoid late state updates.
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
