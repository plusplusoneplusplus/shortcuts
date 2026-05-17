/**
 * @vitest-environment jsdom
 *
 * Tests for RalphStartPanel component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => 'http://localhost:4000/api',
    isRalphEnabled: () => true,
}));

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import { RalphStartPanel } from '../../../../../src/server/spa/client/react/features/chat/RalphStartPanel';
import type { ClientConversationTurn } from '../../../../../src/server/spa/client/react/types/dashboard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTurn(role: 'user' | 'assistant', content: string): ClientConversationTurn {
    return { role, content, turnIndex: 0, timeline: [] };
}

const GRILLING_TURNS: ClientConversationTurn[] = [
    makeTurn('user', 'I want to build something'),
    makeTurn('assistant', '## Goal\nBuild an awesome feature\n\n## Acceptance Criteria\n- AC1'),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RalphStartPanel', () => {
    const mockOnStarted = vi.fn();

    beforeEach(() => {
        mockOnStarted.mockClear();
        vi.stubGlobal('fetch', vi.fn());
    });

    it('shows "Start Ralph" button initially', () => {
        render(
            <RalphStartPanel
                processId="queue_test-123"
                workspaceId="ws-1"
                turns={GRILLING_TURNS}
                onStarted={mockOnStarted}
            />,
        );
        expect(screen.getByTestId('ralph-start-btn')).toBeTruthy();
        expect(screen.queryByTestId('ralph-start-panel')).toBeNull();
    });

    it('opens the panel with extracted goal spec when Start Ralph is clicked', async () => {
        render(
            <RalphStartPanel
                processId="queue_test-123"
                workspaceId="ws-1"
                turns={GRILLING_TURNS}
                onStarted={mockOnStarted}
            />,
        );

        fireEvent.click(screen.getByTestId('ralph-start-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('ralph-start-panel')).toBeTruthy();
        });

        const textarea = screen.getByTestId('ralph-goal-spec-input') as HTMLTextAreaElement;
        expect(textarea.value).toContain('## Goal');
        expect(textarea.value).toContain('Build an awesome feature');
    });

    it('shows error when goal spec is empty on confirm', async () => {
        render(
            <RalphStartPanel
                processId="queue_test-123"
                workspaceId="ws-1"
                turns={[]}
                onStarted={mockOnStarted}
            />,
        );

        fireEvent.click(screen.getByTestId('ralph-start-btn'));
        await waitFor(() => expect(screen.getByTestId('ralph-start-panel')).toBeTruthy());

        // Clear the textarea and confirm
        const textarea = screen.getByTestId('ralph-goal-spec-input') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: '' } });

        fireEvent.click(screen.getByTestId('ralph-confirm-start-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('ralph-start-error')).toBeTruthy();
        });
        expect(screen.getByTestId('ralph-start-error').textContent).toMatch(/empty/i);
    });

    it('calls onStarted with the returned processId on success', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ processId: 'queue_new-task' }),
        });
        vi.stubGlobal('fetch', mockFetch);

        render(
            <RalphStartPanel
                processId="queue_test-456"
                workspaceId="ws-1"
                turns={GRILLING_TURNS}
                onStarted={mockOnStarted}
            />,
        );

        fireEvent.click(screen.getByTestId('ralph-start-btn'));
        await waitFor(() => expect(screen.getByTestId('ralph-start-panel')).toBeTruthy());

        await act(async () => {
            fireEvent.click(screen.getByTestId('ralph-confirm-start-btn'));
        });

        await waitFor(() => {
            expect(mockOnStarted).toHaveBeenCalledWith('queue_new-task');
        });
    });

    it('shows error message when fetch fails', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: false,
            text: async () => '{"error":"Process not found"}',
        });
        vi.stubGlobal('fetch', mockFetch);

        render(
            <RalphStartPanel
                processId="queue_bad-id"
                workspaceId="ws-1"
                turns={GRILLING_TURNS}
                onStarted={mockOnStarted}
            />,
        );

        fireEvent.click(screen.getByTestId('ralph-start-btn'));
        await waitFor(() => expect(screen.getByTestId('ralph-start-panel')).toBeTruthy());

        await act(async () => {
            fireEvent.click(screen.getByTestId('ralph-confirm-start-btn'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('ralph-start-error')).toBeTruthy();
        });
    });

    it('extracts goal spec from last assistant turn starting from ## Goal', () => {
        const turns: ClientConversationTurn[] = [
            makeTurn('user', 'ok'),
            makeTurn('assistant', 'Some preamble text\n\n## Goal\nThe real goal\n\n## Acceptance Criteria\n- AC1'),
        ];

        render(
            <RalphStartPanel
                processId="queue_test-789"
                workspaceId="ws-1"
                turns={turns}
                onStarted={mockOnStarted}
            />,
        );

        fireEvent.click(screen.getByTestId('ralph-start-btn'));

        const textarea = screen.getByTestId('ralph-goal-spec-input') as HTMLTextAreaElement;
        // Should start from ## Goal, not include "Some preamble text"
        expect(textarea.value).toContain('## Goal');
        expect(textarea.value).not.toContain('Some preamble text');
    });

    // -----------------------------------------------------------------------
    // Goal-file-based flow (goalFilePath prop)
    // -----------------------------------------------------------------------

    it('shows contextual description when goalFilePath is provided', () => {
        render(
            <RalphStartPanel
                processId="queue_test-goal"
                workspaceId="ws-1"
                turns={[]}
                goalFilePath="/repos/myrepo/auth-refactor.goal.md"
                onStarted={mockOnStarted}
            />,
        );

        expect(screen.getByTestId('ralph-start-btn')).toBeTruthy();
        expect(screen.getByText(/auth-refactor\.goal\.md/)).toBeTruthy();
    });

    it('fetches goal content from /api/fs/blob when goalFilePath is provided', async () => {
        const mockFetch = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ content: '## Goal\nRefactor auth module', encoding: 'utf-8' }),
            });
        vi.stubGlobal('fetch', mockFetch);

        render(
            <RalphStartPanel
                processId="queue_test-goal-fetch"
                workspaceId="ws-1"
                turns={[]}
                goalFilePath="/repos/myrepo/goal.md"
                onStarted={mockOnStarted}
            />,
        );

        fireEvent.click(screen.getByTestId('ralph-start-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('ralph-start-panel')).toBeTruthy();
        });

        // Should have fetched from fs/blob
        expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('/api/fs/blob?path='),
        );

        await waitFor(() => {
            const textarea = screen.getByTestId('ralph-goal-spec-input') as HTMLTextAreaElement;
            expect(textarea.value).toContain('Refactor auth module');
        });
    });

    it('shows error when goal file fetch fails', async () => {
        const mockFetch = vi.fn()
            .mockResolvedValueOnce({
                ok: false,
                status: 404,
            });
        vi.stubGlobal('fetch', mockFetch);

        render(
            <RalphStartPanel
                processId="queue_test-goal-fail"
                workspaceId="ws-1"
                turns={[]}
                goalFilePath="/repos/myrepo/missing.goal.md"
                onStarted={mockOnStarted}
            />,
        );

        fireEvent.click(screen.getByTestId('ralph-start-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('ralph-start-error')).toBeTruthy();
        });
    });

    it('calls /api/ralph-launch instead of ralph-start when goalFilePath is set', async () => {
        const mockFetch = vi.fn()
            // First call: fs/blob (goal file content)
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ content: '## Goal\nDo something', encoding: 'utf-8' }),
            })
            // Second call: ralph-launch
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ processId: 'queue_launched', sessionId: 'ralph-123' }),
            });
        vi.stubGlobal('fetch', mockFetch);

        render(
            <RalphStartPanel
                processId="queue_test-launch"
                workspaceId="ws-1"
                turns={[]}
                goalFilePath="/repos/myrepo/goal.md"
                onStarted={mockOnStarted}
            />,
        );

        fireEvent.click(screen.getByTestId('ralph-start-btn'));
        await waitFor(() => expect(screen.getByTestId('ralph-start-panel')).toBeTruthy());

        // Wait for goal content to load
        await waitFor(() => {
            const textarea = screen.getByTestId('ralph-goal-spec-input') as HTMLTextAreaElement;
            expect(textarea.value).toContain('Do something');
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('ralph-confirm-start-btn'));
        });

        await waitFor(() => {
            expect(mockOnStarted).toHaveBeenCalledWith('queue_launched');
        });

        // Verify the second fetch call went to ralph-launch, not ralph-start
        const launchCall = mockFetch.mock.calls[1];
        expect(launchCall[0]).toContain('/api/ralph-launch');
    });
});
