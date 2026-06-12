/**
 * @vitest-environment jsdom
 *
 * Tests for the read-only NativeCopilotSessionsPanel.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockList = vi.fn();
const mockGet = vi.fn();

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        nativeCopilotSessions: {
            list: mockList,
            get: mockGet,
        },
    }),
}));

vi.mock('../../../../src/server/spa/client/react/ui', () => ({
    Spinner: () => <span data-testid="spinner" />,
    Button: ({ children, loading: _loading, variant: _variant, size: _size, ...props }: any) => (
        <button {...props}>{children}</button>
    ),
    cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
}));

import { NativeCopilotSessionsPanel } from '../../../../src/server/spa/client/react/features/native-copilot-sessions/NativeCopilotSessionsPanel';

// ── Helpers ──────────────────────────────────────────────────────────────────

function setFlag(enabled: boolean): void {
    (window as any).__DASHBOARD_CONFIG__ = {
        apiBasePath: '/api',
        wsPath: '/ws',
        features: { nativeCopilotSessionsEnabled: enabled },
    };
}

function makeListItem(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        id: 'session-aaaa-bbbb',
        repository: 'owner/repo',
        cwd: '/workspace/path',
        hostType: 'github',
        branch: 'main',
        summaryPreview: 'Stored summary preview',
        createdAt: '2026-06-11T17:56:21.130Z',
        updatedAt: '2026-06-11T17:56:22.081Z',
        turnCount: 3,
        matchSnippets: [],
        ...overrides,
    };
}

function makeListResponse(items: unknown[], overrides: Partial<Record<string, unknown>> = {}) {
    return {
        enabled: true,
        available: true,
        items,
        total: items.length,
        searchIndexAvailable: true,
        limit: 50,
        offset: 0,
        ...overrides,
    };
}

function makeDetailResponse(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        enabled: true,
        available: true,
        session: {
            id: 'session-aaaa-bbbb',
            repository: 'owner/repo',
            cwd: '/workspace/path',
            hostType: 'github',
            branch: 'main',
            summary: 'Full stored summary',
            createdAt: '2026-06-11T17:56:21.130Z',
            updatedAt: '2026-06-11T17:56:22.081Z',
            turns: [
                {
                    id: 1,
                    turnIndex: 0,
                    timestamp: '2026-06-11T17:56:35.601Z',
                    userMessage: '<script>alert("xss")</script> stored user text',
                    assistantResponse: '',
                    userChars: 40,
                    assistantChars: 0,
                    searchIndexSourceId: 'session-aaaa-bbbb:turn:0',
                    searchIndexChars: 40,
                },
                {
                    id: 2,
                    turnIndex: 1,
                    timestamp: '2026-06-11T17:57:35.601Z',
                    userMessage: 'second question',
                    assistantResponse: 'second answer',
                    userChars: 15,
                    assistantChars: 13,
                    searchIndexSourceId: null,
                    searchIndexChars: null,
                },
            ],
            ...overrides,
        },
    };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('NativeCopilotSessionsPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setFlag(true);
        mockList.mockResolvedValue(makeListResponse([]));
        mockGet.mockResolvedValue(makeDetailResponse());
    });

    afterEach(() => {
        cleanup();
        delete (window as any).__DASHBOARD_CONFIG__;
    });

    it('shows the disabled state without calling the API when the flag is off', async () => {
        setFlag(false);
        render(<NativeCopilotSessionsPanel workspaceId="ws-1" />);
        expect(screen.getByTestId('native-sessions-disabled-by-flag')).toBeTruthy();
        expect(mockList).not.toHaveBeenCalled();
    });

    it('renders the empty state when no sessions match the workspace', async () => {
        render(<NativeCopilotSessionsPanel workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('native-sessions-empty')).toBeTruthy());
    });

    it('renders a typed unavailable state when the native store is missing', async () => {
        mockList.mockResolvedValue({
            enabled: true, available: false, reason: 'db-missing', items: [], total: 0, limit: 50, offset: 0,
        });
        render(<NativeCopilotSessionsPanel workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('native-sessions-unavailable')).toBeTruthy());
        expect(screen.getByTestId('native-sessions-unavailable').textContent).toContain('not found');
    });

    it('renders a request error with retry', async () => {
        mockList.mockRejectedValueOnce(new Error('network down'));
        render(<NativeCopilotSessionsPanel workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('native-sessions-error')).toBeTruthy());
        expect(screen.getByTestId('native-sessions-error').textContent).toContain('network down');
    });

    it('renders session rows with external read-only labels', async () => {
        mockList.mockResolvedValue(makeListResponse([
            makeListItem(),
            makeListItem({ id: 'second-session', branch: null, summaryPreview: '' }),
        ]));
        render(<NativeCopilotSessionsPanel workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('native-sessions-table')).toBeTruthy());

        const rows = screen.getAllByTestId('native-session-row');
        expect(rows).toHaveLength(2);
        expect(screen.getAllByTestId('native-session-external-label').length).toBeGreaterThan(0);
        expect(screen.getAllByTestId('native-session-readonly-badge').length).toBeGreaterThan(0);
        // Null branch renders as Unknown branch; null summary renders empty preview copy.
        expect(rows[1].textContent).toContain('Unknown branch');
        expect(rows[1].textContent).toContain('No summary stored');
    });

    it('opens read-only detail with ordered turns, explicit empty assistant copy, and no CoC chat actions', async () => {
        mockList.mockResolvedValue(makeListResponse([makeListItem()]));
        render(<NativeCopilotSessionsPanel workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('native-sessions-table')).toBeTruthy());

        fireEvent.click(screen.getAllByTestId('native-session-row')[0]);
        await waitFor(() => expect(screen.getByTestId('native-session-detail')).toBeTruthy());
        expect(mockGet).toHaveBeenCalledWith('ws-1', 'session-aaaa-bbbb');

        const detail = screen.getByTestId('native-session-detail');
        expect(detail.textContent).toContain('Full stored summary');

        const turns = screen.getAllByTestId('native-session-turn');
        expect(turns).toHaveLength(2);
        expect(turns[0].textContent).toContain('Turn 0');
        expect(turns[1].textContent).toContain('Turn 1');
        expect(screen.getByTestId('native-session-turn-no-assistant').textContent).toContain('No assistant response stored');

        // Stored script text renders as inert text, never as an executable element.
        expect(turns[0].textContent).toContain('<script>alert("xss")</script>');
        expect(detail.querySelector('script')).toBeNull();

        // Index diagnostics: indexed turn shows char count, unindexed shows Not indexed.
        const diagnostics = screen.getAllByTestId('native-session-turn-index-diagnostics');
        expect(diagnostics[0].textContent).toContain('Indexed');
        expect(diagnostics[1].textContent).toContain('Not indexed');

        // Read-only separation: no CoC chat action controls exist anywhere in the panel.
        for (const action of ['follow-up', 'follow up', 'archive', 'pin', 'delete', 'resume', 'retry conversation']) {
            const pattern = new RegExp(`^${action}$`, 'i');
            expect(screen.queryByRole('button', { name: pattern })).toBeNull();
        }
    });

    it('applies search filters through the typed client and surfaces match snippets', async () => {
        mockList.mockResolvedValue(makeListResponse([makeListItem({ matchSnippets: ['matched mermaid snippet'] })]));
        render(<NativeCopilotSessionsPanel workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('native-sessions-table')).toBeTruthy());

        fireEvent.change(screen.getByTestId('native-sessions-search-input'), { target: { value: 'mermaid' } });
        fireEvent.click(screen.getByTestId('native-sessions-apply-filters'));

        await waitFor(() => {
            expect(mockList).toHaveBeenLastCalledWith('ws-1', expect.objectContaining({ q: 'mermaid' }));
        });
        await waitFor(() => expect(screen.getByTestId('native-session-match-snippets')).toBeTruthy());
        expect(screen.getByTestId('native-session-match-snippets').textContent).toContain('matched mermaid snippet');
    });

    it('shows the unavailable-search hint when the native index is absent and a query is set', async () => {
        mockList.mockResolvedValue(makeListResponse([], { searchIndexAvailable: false }));
        render(<NativeCopilotSessionsPanel workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('native-sessions-empty')).toBeTruthy());

        fireEvent.change(screen.getByTestId('native-sessions-search-input'), { target: { value: 'anything' } });
        fireEvent.click(screen.getByTestId('native-sessions-apply-filters'));

        await waitFor(() => expect(screen.getByTestId('native-sessions-search-unavailable')).toBeTruthy());
    });
});
