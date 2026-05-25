/**
 * @vitest-environment jsdom
 *
 * Tests for MemoryStatusCard — the compact V2 memory status card shown in
 * repo settings (AC-04).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks — must come before component imports
// ---------------------------------------------------------------------------

vi.mock('@plusplusoneplusplus/forge', () => ({}));

const mockListScopes = vi.fn();
vi.mock('../../../../../../src/server/spa/client/react/features/memory/memoryV2Api', () => ({
    memoryV2Api: {
        listScopes: (...a: any[]) => mockListScopes(...a),
    },
}));

const mockDispatch = vi.fn();
vi.mock('../../../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: {},
        dispatch: mockDispatch,
    }),
}));

vi.mock('../../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
    isServersEnabled: () => false,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { MemoryStatusCard } from '../../../../../../src/server/spa/client/react/features/memory/MemoryStatusCard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WS_ID = 'ws-test-abc';

function workspaceScope(overrides: Record<string, any> = {}) {
    return {
        id: `workspace:${WS_ID}`,
        type: 'workspace',
        workspaceId: WS_ID,
        label: 'test-repo',
        enabled: true,
        counts: { activeFacts: 3, reviewFacts: 0, episodes: 1 },
        ...overrides,
    };
}

function globalScope() {
    return {
        id: 'global',
        type: 'global',
        label: 'Global',
        enabled: true,
        counts: { activeFacts: 5, reviewFacts: 0, episodes: 2 },
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MemoryStatusCard', () => {
    beforeEach(() => {
        mockListScopes.mockReset();
        mockDispatch.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('shows loading state while fetching scopes', async () => {
        // Never resolves immediately
        mockListScopes.mockReturnValue(new Promise(() => {}));

        render(<MemoryStatusCard workspaceId={WS_ID} />);
        expect(screen.getByText(/loading memory status/i)).toBeTruthy();
    });

    it('shows enabled badge when workspace memory is enabled', async () => {
        mockListScopes.mockResolvedValue([globalScope(), workspaceScope({ enabled: true })]);

        await act(async () => {
            render(<MemoryStatusCard workspaceId={WS_ID} />);
        });

        await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
        expect(screen.getByTestId('memory-enabled-badge').textContent).toContain('Enabled');
    });

    it('shows disabled badge when workspace memory is disabled', async () => {
        mockListScopes.mockResolvedValue([globalScope(), workspaceScope({ enabled: false })]);

        await act(async () => {
            render(<MemoryStatusCard workspaceId={WS_ID} />);
        });

        await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
        expect(screen.getByTestId('memory-enabled-badge').textContent).toContain('Disabled');
    });

    it('shows "Not registered" when workspace scope is missing from list', async () => {
        mockListScopes.mockResolvedValue([globalScope()]);

        await act(async () => {
            render(<MemoryStatusCard workspaceId={WS_ID} />);
        });

        await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
        expect(screen.getByTestId('memory-enabled-badge').textContent).toContain('Not registered');
    });

    it('shows review badge when reviewFacts > 0', async () => {
        mockListScopes.mockResolvedValue([
            globalScope(),
            workspaceScope({ counts: { activeFacts: 2, reviewFacts: 3, episodes: 0 } }),
        ]);

        await act(async () => {
            render(<MemoryStatusCard workspaceId={WS_ID} />);
        });

        await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
        expect(screen.getByTestId('memory-review-badge').textContent).toContain('3');
    });

    it('does not show review badge when reviewFacts is 0', async () => {
        mockListScopes.mockResolvedValue([
            globalScope(),
            workspaceScope({ counts: { activeFacts: 2, reviewFacts: 0, episodes: 0 } }),
        ]);

        await act(async () => {
            render(<MemoryStatusCard workspaceId={WS_ID} />);
        });

        await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
        expect(screen.queryByTestId('memory-review-badge')).toBeNull();
    });

    it('shows error message when listScopes fails', async () => {
        mockListScopes.mockRejectedValue(new Error('Network error'));

        await act(async () => {
            render(<MemoryStatusCard workspaceId={WS_ID} />);
        });

        await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
        expect(screen.getByTestId('memory-status-error').textContent).toContain('Network error');
    });

    it('dispatches SET_MEMORY_SCOPE and navigates to #memory when "Open in Memory" is clicked', async () => {
        const scope = workspaceScope({ enabled: true });
        mockListScopes.mockResolvedValue([globalScope(), scope]);

        await act(async () => {
            render(<MemoryStatusCard workspaceId={WS_ID} />);
        });

        await waitFor(() => screen.getByTestId('open-in-memory-btn'));

        const user = userEvent.setup();
        await user.click(screen.getByTestId('open-in-memory-btn'));

        expect(mockDispatch).toHaveBeenCalledWith({
            type: 'SET_MEMORY_SCOPE',
            scopeId: `workspace:${WS_ID}`,
        });
    });

    it('falls back to workspace:<wsId> scope ID if scope is not found', async () => {
        // No workspace scope in the list
        mockListScopes.mockResolvedValue([globalScope()]);

        await act(async () => {
            render(<MemoryStatusCard workspaceId={WS_ID} />);
        });

        await waitFor(() => screen.getByTestId('open-in-memory-btn'));

        const user = userEvent.setup();
        await user.click(screen.getByTestId('open-in-memory-btn'));

        expect(mockDispatch).toHaveBeenCalledWith({
            type: 'SET_MEMORY_SCOPE',
            scopeId: `workspace:${WS_ID}`,
        });
    });
});
