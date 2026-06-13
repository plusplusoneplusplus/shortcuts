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

// Stub the reused chat bubble so the panel test stays focused on the panel's
// mapping/integration (the bubble is exercised by its own suite). The stub
// surfaces the mapped turn's shape via data-attributes + renders content as a
// React text node (so any stored HTML stays inert, mirroring the real bubble).
vi.mock('../../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble', () => ({
    ConversationTurnBubble: ({ turn, wsId, provider }: any) => (
        <div
            data-testid="conversation-turn-bubble"
            data-role={turn.role}
            data-ws-id={wsId}
            data-provider={provider}
            data-tool-calls={(turn.toolCalls ?? []).map((t: any) => t.toolName).join(',')}
            data-images={String((turn.images ?? []).length)}
            data-timeline-types={(turn.timeline ?? []).map((i: any) => i.type).join(',')}
            data-model={turn.model ?? ''}
        >
            {turn.content}
        </div>
    ),
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
            conversation: [
                {
                    role: 'user',
                    content: '<script>alert("xss")</script> stored user text',
                    timestamp: '2026-06-11T17:56:35.601Z',
                    turnIndex: 0,
                    timeline: [],
                    images: ['data:image/png;base64,AAAA'],
                },
                {
                    role: 'assistant',
                    content: 'Here is the **answer**.',
                    timestamp: '2026-06-11T17:57:35.601Z',
                    turnIndex: 1,
                    model: 'gpt-5.5',
                    thinking: 'Let me reason about this.',
                    toolCalls: [
                        { id: 't1', toolName: 'shell', args: { command: 'ls' }, result: 'file.txt', status: 'completed' },
                    ],
                    timeline: [
                        { type: 'content', timestamp: '2026-06-11T17:57:35.601Z', content: 'Here is the **answer**.' },
                        { type: 'tool-start', timestamp: '2026-06-11T17:57:36.000Z', toolCall: { id: 't1', toolName: 'shell', args: { command: 'ls' }, status: 'running' } },
                        { type: 'tool-complete', timestamp: '2026-06-11T17:57:37.000Z', toolCall: { id: 't1', toolName: 'shell', args: { command: 'ls' }, result: 'file.txt', status: 'completed' } },
                    ],
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
        window.location.hash = '';
        mockList.mockResolvedValue(makeListResponse([]));
        mockGet.mockResolvedValue(makeDetailResponse());
    });

    afterEach(() => {
        cleanup();
        window.location.hash = '';
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

    it('opens read-only detail rendering the reconstructed transcript via the reused chat bubble, with no CoC chat actions', async () => {
        mockList.mockResolvedValue(makeListResponse([makeListItem()]));
        render(<NativeCopilotSessionsPanel workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('native-sessions-table')).toBeTruthy());

        fireEvent.click(screen.getAllByTestId('native-session-row')[0]);
        await waitFor(() => expect(screen.getByTestId('native-session-detail')).toBeTruthy());
        expect(mockGet).toHaveBeenCalledWith('ws-1', 'session-aaaa-bbbb');

        const detail = screen.getByTestId('native-session-detail');
        // Metadata header preserved.
        expect(detail.textContent).toContain('Full stored summary');
        expect(screen.getByTestId('native-session-conversation').textContent).toContain('Conversation (2)');

        // Transcript renders one reused chat bubble per conversation turn, in order.
        const bubbles = screen.getAllByTestId('conversation-turn-bubble');
        expect(bubbles).toHaveLength(2);
        expect(bubbles[0].getAttribute('data-role')).toBe('user');
        expect(bubbles[1].getAttribute('data-role')).toBe('assistant');

        // Stored script text passes through as inert React text, never an executable element.
        expect(bubbles[0].textContent).toContain('<script>alert("xss")</script>');
        expect(detail.querySelector('script')).toBeNull();

        // User images and the workspace id thread through to the bubble.
        expect(bubbles[0].getAttribute('data-images')).toBe('1');
        expect(bubbles[0].getAttribute('data-ws-id')).toBe('ws-1');

        // Assistant turn carries the Copilot provider, model, tool-call card, and
        // reasoning folded into the content/timeline (no component fork).
        expect(bubbles[1].getAttribute('data-provider')).toBe('copilot');
        expect(bubbles[1].getAttribute('data-model')).toBe('gpt-5.5');
        expect(bubbles[1].getAttribute('data-tool-calls')).toContain('shell');
        expect(bubbles[1].getAttribute('data-timeline-types')).toContain('tool-complete');
        expect(bubbles[1].textContent).toContain('Reasoning');

        // Read-only separation: no CoC chat action controls exist anywhere in the panel.
        for (const action of ['follow-up', 'follow up', 'archive', 'pin', 'delete', 'resume', 'retry conversation']) {
            const pattern = new RegExp(`^${action}$`, 'i');
            expect(screen.queryByRole('button', { name: pattern })).toBeNull();
        }
    });

    it('renders the empty-conversation state when the reconstruction has no turns', async () => {
        mockList.mockResolvedValue(makeListResponse([makeListItem()]));
        mockGet.mockResolvedValue(makeDetailResponse({ conversation: [] }));
        render(<NativeCopilotSessionsPanel workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('native-sessions-table')).toBeTruthy());

        fireEvent.click(screen.getAllByTestId('native-session-row')[0]);
        await waitFor(() => expect(screen.getByTestId('native-session-detail')).toBeTruthy());

        expect(screen.getByTestId('native-session-conversation').textContent).toContain('Conversation (0)');
        expect(screen.getByTestId('native-session-no-turns')).toBeTruthy();
        expect(screen.queryByTestId('conversation-turn-bubble')).toBeNull();
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

    it('shows the dedup hint when sessions are already tracked in CoC Activity', async () => {
        mockList.mockResolvedValue(makeListResponse([makeListItem()], { deduplicatedCount: 3 }));
        render(<NativeCopilotSessionsPanel workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('native-sessions-deduplicated')).toBeTruthy());
        expect(screen.getByTestId('native-sessions-deduplicated').textContent).toContain('3 sessions hidden');
    });

    it('omits the dedup hint when no sessions are deduplicated', async () => {
        mockList.mockResolvedValue(makeListResponse([makeListItem()]));
        render(<NativeCopilotSessionsPanel workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('native-sessions-table')).toBeTruthy());
        expect(screen.queryByTestId('native-sessions-deduplicated')).toBeNull();
    });

    it('shows the background-hidden hint when background jobs are filtered', async () => {
        mockList.mockResolvedValue(makeListResponse([makeListItem()], { backgroundJobCount: 5 }));
        render(<NativeCopilotSessionsPanel workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('native-sessions-background-hidden')).toBeTruthy());
        expect(screen.getByTestId('native-sessions-background-hidden').textContent).toContain('5 background jobs hidden');
    });

    it('writes the deep-link hash when a session is selected', async () => {
        mockList.mockResolvedValue(makeListResponse([makeListItem()]));
        render(<NativeCopilotSessionsPanel workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('native-sessions-table')).toBeTruthy());

        fireEvent.click(screen.getAllByTestId('native-session-row')[0]);
        await waitFor(() => expect(window.location.hash).toBe('#repos/ws-1/copilot-sessions/session-aaaa-bbbb'));
        await waitFor(() => expect(screen.getByTestId('native-session-detail')).toBeTruthy());
    });

    it('restores the selected session from a deep-link hash on mount', async () => {
        mockList.mockResolvedValue(makeListResponse([makeListItem()]));
        window.location.hash = '#repos/ws-1/copilot-sessions/session-aaaa-bbbb';
        render(<NativeCopilotSessionsPanel workspaceId="ws-1" />);
        await waitFor(() => expect(mockGet).toHaveBeenCalledWith('ws-1', 'session-aaaa-bbbb'));
        await waitFor(() => expect(screen.getByTestId('native-session-detail')).toBeTruthy());
    });

    it('ignores a deep-link hash that targets a different workspace', async () => {
        mockList.mockResolvedValue(makeListResponse([makeListItem()]));
        window.location.hash = '#repos/other-ws/copilot-sessions/session-aaaa-bbbb';
        render(<NativeCopilotSessionsPanel workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('native-sessions-table')).toBeTruthy());
        expect(mockGet).not.toHaveBeenCalled();
        expect(screen.getByTestId('native-session-detail-empty')).toBeTruthy();
    });
});
