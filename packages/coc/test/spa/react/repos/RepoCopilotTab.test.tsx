/**
 * Tests for RepoCopilotTab — MCP server toggle panel.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// fetchApi mock — default resolves with two servers
const mockFetchApi = vi.fn();

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => 'http://localhost:4000/api',
}));

async function renderTab(workspaceId = 'ws-1') {
    const { RepoCopilotTab } = await import(
        '../../../../src/server/spa/client/react/repos/RepoCopilotTab'
    );
    return render(<RepoCopilotTab workspaceId={workspaceId} />);
}

const twoServers = {
    availableServers: [
        { name: 'github', type: 'stdio' },
        { name: 'search', type: 'sse' },
    ],
    enabledMcpServers: null,
};

beforeEach(() => {
    vi.resetAllMocks();
    mockFetchApi.mockResolvedValue(twoServers);
});

// ── 1. Loading state ─────────────────────────────────────────────────────────

describe('loading state', () => {
    it('shows loading text while GET is pending', async () => {
        let resolve: (v: any) => void;
        mockFetchApi.mockReturnValue(new Promise((r) => { resolve = r; }));
        await act(async () => { await renderTab(); });
        expect(screen.getByText('Loading…')).toBeTruthy();
        // resolve to avoid unhandled rejection
        await act(async () => { resolve!(twoServers); });
    });
});

// ── 2. Renders server list ───────────────────────────────────────────────────

describe('server list rendering', () => {
    it('renders server names and type labels', async () => {
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        expect(screen.getByText('github')).toBeTruthy();
        expect(screen.getByText('search')).toBeTruthy();
        expect(screen.getByText('stdio')).toBeTruthy();
        expect(screen.getByText('sse')).toBeTruthy();
    });
});

// ── 3. null enabledMcpServers → all checked ──────────────────────────────────

describe('null enabledMcpServers', () => {
    it('marks all toggles as checked when enabledMcpServers is null', async () => {
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        const github = screen.getByTestId('mcp-toggle-github') as HTMLInputElement;
        const search = screen.getByTestId('mcp-toggle-search') as HTMLInputElement;
        expect(github.checked).toBe(true);
        expect(search.checked).toBe(true);
    });
});

// ── 4. Partial enabledMcpServers ─────────────────────────────────────────────

describe('partial enabledMcpServers', () => {
    it('only checks the enabled server', async () => {
        mockFetchApi.mockResolvedValue({
            availableServers: twoServers.availableServers,
            enabledMcpServers: ['github'],
        });
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        const github = screen.getByTestId('mcp-toggle-github') as HTMLInputElement;
        const search = screen.getByTestId('mcp-toggle-search') as HTMLInputElement;
        expect(github.checked).toBe(true);
        expect(search.checked).toBe(false);
    });
});

// ── 5. Toggle off calls PUT with correct body ────────────────────────────────

describe('toggle off', () => {
    it('calls PUT with remaining server when one is toggled off', async () => {
        mockFetchApi
            .mockResolvedValueOnce(twoServers) // GET
            .mockResolvedValueOnce({}); // PUT
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());

        await act(async () => {
            fireEvent.click(screen.getByTestId('mcp-toggle-github'));
        });

        expect(mockFetchApi).toHaveBeenCalledWith(
            '/workspaces/ws-1/mcp-config',
            expect.objectContaining({
                method: 'PUT',
                body: JSON.stringify({ enabledMcpServers: ['search'] }),
            }),
        );
    });
});

// ── 6. Enabling last disabled server sends null ──────────────────────────────

describe('enable last disabled server', () => {
    it('sends null when all servers are enabled', async () => {
        mockFetchApi
            .mockResolvedValueOnce({
                availableServers: twoServers.availableServers,
                enabledMcpServers: ['github'],
            }) // GET
            .mockResolvedValueOnce({}); // PUT
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());

        await act(async () => {
            fireEvent.click(screen.getByTestId('mcp-toggle-search'));
        });

        expect(mockFetchApi).toHaveBeenCalledWith(
            '/workspaces/ws-1/mcp-config',
            expect.objectContaining({
                method: 'PUT',
                body: JSON.stringify({ enabledMcpServers: null }),
            }),
        );
    });
});

// ── 7. PUT failure reverts toggle and shows error ────────────────────────────

describe('PUT failure', () => {
    it('reverts toggle and shows error on PUT failure', async () => {
        mockFetchApi
            .mockResolvedValueOnce(twoServers) // GET
            .mockRejectedValueOnce(new Error('Network error')); // PUT fails
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());

        await act(async () => {
            fireEvent.click(screen.getByTestId('mcp-toggle-github'));
        });

        await waitFor(() => expect(screen.getByText('Network error')).toBeTruthy());
        const github = screen.getByTestId('mcp-toggle-github') as HTMLInputElement;
        expect(github.checked).toBe(true); // reverted
    });
});

// ── 8. Empty server list ─────────────────────────────────────────────────────

describe('empty server list', () => {
    it('shows empty state message when no servers are configured', async () => {
        mockFetchApi.mockResolvedValue({ availableServers: [], enabledMcpServers: null });
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        expect(screen.getByText('No MCP servers configured.')).toBeTruthy();
    });
});

// ── 9. GET failure shows error ───────────────────────────────────────────────

describe('GET failure', () => {
    it('shows error text when GET fails', async () => {
        mockFetchApi.mockRejectedValue(new Error('Failed to fetch'));
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByText('Failed to fetch')).toBeTruthy());
    });
});

// ── 10. Toggles disabled while saving ───────────────────────────────────────

describe('saving state', () => {
    it('disables all toggles during a pending PUT', async () => {
        let resolvePut: (v: any) => void;
        mockFetchApi
            .mockResolvedValueOnce(twoServers) // GET
            .mockReturnValueOnce(new Promise((r) => { resolvePut = r; })); // slow PUT

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());

        act(() => {
            fireEvent.click(screen.getByTestId('mcp-toggle-github'));
        });

        // While PUT is in-flight, all toggles should be disabled
        await waitFor(() => {
            const github = screen.getByTestId('mcp-toggle-github') as HTMLInputElement;
            expect(github.disabled).toBe(true);
        });

        await act(async () => { resolvePut!({}); });
    });
});
