/**
 * @vitest-environment jsdom
 *
 * Tests for RalphStartPanel component.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => 'http://localhost:4000/api',
    isRalphEnabled: () => true,
}));

const { mockModalSelection } = vi.hoisted(() => ({
    mockModalSelection: vi.fn(() => ({ resolved: { provider: 'copilot' } })),
}));

const {
    mockListWorkspaces,
    mockListRemoteWorkspaceTargetSources,
} = vi.hoisted(() => ({
    mockListWorkspaces: vi.fn(),
    mockListRemoteWorkspaceTargetSources: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/shared/ModalJobAiControls', () => ({
    useModalJobAiSelection: (options: unknown) => mockModalSelection(options),
    ModalJobAiControls: ({ testIdPrefix = 'modal-job' }: { testIdPrefix?: string }) => (
        <div data-testid={`${testIdPrefix}-ai-controls`} />
    ),
}));

vi.mock('../../../../../src/server/spa/client/react/repos/repositoryService', () => ({
    listWorkspaces: mockListWorkspaces,
    listRemoteWorkspaceTargetSources: mockListRemoteWorkspaceTargetSources,
}));

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import { RalphStartPanel } from '../../../../../src/server/spa/client/react/features/chat/RalphStartPanel';
import type { ClientConversationTurn } from '../../../../../src/server/spa/client/react/types/dashboard';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../../../src/server/spa/client/react/repos/cloneRegistry';

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

async function waitForRepoSelector() {
    await waitFor(() => expect(screen.getByTestId('ralph-start-execution-repo-select')).toBeTruthy());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RalphStartPanel', () => {
    const mockOnStarted = vi.fn();

    beforeEach(() => {
        mockOnStarted.mockClear();
        mockModalSelection.mockReset();
        mockModalSelection.mockReturnValue({ resolved: { provider: 'copilot' } });
        mockListWorkspaces.mockReset();
        mockListWorkspaces.mockResolvedValue([
            { id: 'ws-1', name: 'Source Repo', rootPath: '/repos/source' },
            { id: 'ws-2', name: 'Other Repo', rootPath: '/repos/other' },
        ]);
        mockListRemoteWorkspaceTargetSources.mockReset();
        mockListRemoteWorkspaceTargetSources.mockResolvedValue({ sources: [], warnings: [] });
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        resetCloneRegistryForTests();
    });

    it('routes the goal-file blob fetch to the remote clone server, not the local origin', async () => {
        // Regression: a remote clone's /fs/blob must target the clone's own server.
        // Reading the path on the LOCAL server 403s ("Path is outside trusted
        // directories") because that path only exists on the remote machine.
        registerCloneBaseUrls([{ workspaceId: 'remote-ws', baseUrl: 'http://127.0.0.1:9999' }]);
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ content: '## Goal\nremote goal body' }),
        });
        vi.stubGlobal('fetch', fetchMock);

        render(
            <RalphStartPanel
                processId="queue_remote"
                workspaceId="remote-ws"
                turns={[]}
                goalFilePath="/home/u/.coc/repos/remote-ws/notes/Plans/x.goal.md"
                onStarted={mockOnStarted}
            />,
        );

        fireEvent.click(screen.getByTestId('ralph-start-btn'));
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());

        const url = String(fetchMock.mock.calls[0][0]);
        expect(url).toContain('http://127.0.0.1:9999/api/fs/blob');
        expect(url).not.toContain('localhost:4000');

        // The remote file's content flows into the goal-spec editor.
        await waitFor(() => {
            const textarea = screen.getByTestId('ralph-goal-spec-input') as HTMLTextAreaElement;
            expect(textarea.value).toContain('remote goal body');
        });
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

    it('renders shared AI controls when the panel is open', async () => {
        render(
            <RalphStartPanel
                processId="queue_test-ai-controls"
                workspaceId="ws-1"
                turns={GRILLING_TURNS}
                onStarted={mockOnStarted}
            />,
        );

        fireEvent.click(screen.getByTestId('ralph-start-btn'));
        await waitFor(() => expect(screen.getByTestId('ralph-start-panel')).toBeTruthy());

        expect(screen.getByTestId('ralph-start-ai-controls')).toBeTruthy();
    });

    it('renders the execution repo selector and defaults to the source workspace', async () => {
        render(
            <RalphStartPanel
                processId="queue_test-repo-selector"
                workspaceId="ws-1"
                turns={GRILLING_TURNS}
                onStarted={mockOnStarted}
            />,
        );

        fireEvent.click(screen.getByTestId('ralph-start-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('ralph-start-execution-repo-select')).toBeTruthy();
        });

        const select = screen.getByTestId('ralph-start-execution-repo-select') as HTMLSelectElement;
        expect(select.value).toBe('local:ws-1');
        expect(screen.getByTestId('ralph-start-execution-repo-summary').textContent)
            .toContain('Ralph will run in Source Repo on Current CoC');
    });

    it('shows remote options and remote load warnings', async () => {
        mockListRemoteWorkspaceTargetSources.mockResolvedValue({
            sources: [{
                server: { id: 'srv-1', label: 'Lab Server', effectiveUrl: 'http://127.0.0.1:7777' },
                workspaces: [{ id: 'remote-ws', name: 'Source Repo', rootPath: '/srv/source' }],
                gitInfoResults: {},
            }],
            warnings: ['Offline Server: remote CoC is offline'],
        });

        render(
            <RalphStartPanel
                processId="queue_test-remote-options"
                workspaceId="ws-1"
                turns={GRILLING_TURNS}
                onStarted={mockOnStarted}
            />,
        );

        fireEvent.click(screen.getByTestId('ralph-start-btn'));

        await waitFor(() => {
            const select = screen.getByTestId('ralph-start-execution-repo-select') as HTMLSelectElement;
            expect([...select.options].map(option => option.value)).toContain('srv-1:remote-ws');
        });
        expect(screen.getByTestId('ralph-start-execution-repo-warning').textContent)
            .toContain('Offline Server: remote CoC is offline');
    });

    it('resolves modal AI defaults against the selected execution workspace', async () => {
        render(
            <RalphStartPanel
                processId="queue_test-ai-workspace"
                workspaceId="ws-1"
                turns={GRILLING_TURNS}
                onStarted={mockOnStarted}
            />,
        );

        fireEvent.click(screen.getByTestId('ralph-start-btn'));
        await waitForRepoSelector();
        fireEvent.change(screen.getByTestId('ralph-start-execution-repo-select'), { target: { value: 'local:ws-2' } });

        await waitFor(() => {
            expect(mockModalSelection).toHaveBeenLastCalledWith({ workspaceId: 'ws-2', mode: 'ralph' });
        });
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
        await waitForRepoSelector();

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
        await waitForRepoSelector();

        await act(async () => {
            fireEvent.click(screen.getByTestId('ralph-confirm-start-btn'));
        });

        await waitFor(() => {
            expect(mockOnStarted).toHaveBeenCalledWith('queue_new-task', 'ws-1');
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.provider).toBe('copilot');
        expect(body.config).toBeUndefined();
    });

    it('includes resolved model and reasoning effort in the ralph-start request config', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ processId: 'queue_ai-task' }),
        });
        vi.stubGlobal('fetch', mockFetch);
        mockModalSelection.mockReturnValue({
            resolved: { provider: 'codex', model: 'gpt-5.3-codex', reasoningEffort: 'high' },
        });

        render(
            <RalphStartPanel
                processId="queue_test-ai-selection"
                workspaceId="ws-1"
                turns={GRILLING_TURNS}
                onStarted={mockOnStarted}
            />,
        );

        fireEvent.click(screen.getByTestId('ralph-start-btn'));
        await waitFor(() => expect(screen.getByTestId('ralph-start-panel')).toBeTruthy());
        await waitForRepoSelector();

        await act(async () => {
            fireEvent.click(screen.getByTestId('ralph-confirm-start-btn'));
        });

        await waitFor(() => {
            expect(mockOnStarted).toHaveBeenCalledWith('queue_ai-task', 'ws-1');
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.provider).toBe('codex');
        expect(body.config).toEqual({ model: 'gpt-5.3-codex', reasoningEffort: 'high' });
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
        await waitForRepoSelector();

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

    it('calls /api/ralph-launch when useLaunchEndpoint is set', async () => {
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
                useLaunchEndpoint
                onStarted={mockOnStarted}
            />,
        );

        fireEvent.click(screen.getByTestId('ralph-start-btn'));
        await waitFor(() => expect(screen.getByTestId('ralph-start-panel')).toBeTruthy());
        await waitForRepoSelector();

        // Wait for goal content to load
        await waitFor(() => {
            const textarea = screen.getByTestId('ralph-goal-spec-input') as HTMLTextAreaElement;
            expect(textarea.value).toContain('Do something');
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('ralph-confirm-start-btn'));
        });

        await waitFor(() => {
            expect(mockOnStarted).toHaveBeenCalledWith('queue_launched', 'ws-1');
        });

        // Verify the second fetch call went to ralph-launch, not ralph-start
        const launchCall = mockFetch.mock.calls[1];
        expect(launchCall[0]).toContain('/api/ralph-launch');
    });

    // -----------------------------------------------------------------------
    // Grilling-phase with a goal file: source = file, endpoint = ralph-start
    // -----------------------------------------------------------------------

    it('loads goal text from the file but still posts to ralph-start when useLaunchEndpoint is unset', async () => {
        const longSpec = '## Goal\nLong, detailed goal spec\n\n## Acceptance Criteria\n- AC1\n- AC2\n- AC3';
        const mockFetch = vi.fn()
            // First call: fs/blob (goal file content)
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ content: longSpec, encoding: 'utf-8' }),
            })
            // Second call: ralph-start
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ processId: 'queue_started' }),
            });
        vi.stubGlobal('fetch', mockFetch);

        // Turns contain only a short synthesis — file should take precedence.
        const shortSynthesisTurns: ClientConversationTurn[] = [
            makeTurn('user', 'looks good'),
            makeTurn('assistant', '## Goal\nShort summary only'),
        ];

        render(
            <RalphStartPanel
                processId="queue_grill-123"
                workspaceId="ws-1"
                turns={shortSynthesisTurns}
                goalFilePath="/repos/myrepo/goal.md"
                onStarted={mockOnStarted}
            />,
        );

        fireEvent.click(screen.getByTestId('ralph-start-btn'));
        await waitFor(() => expect(screen.getByTestId('ralph-start-panel')).toBeTruthy());
        await waitForRepoSelector();

        // Textarea should contain the long spec from the file, not the short
        // synthesis from the last assistant turn.
        await waitFor(() => {
            const textarea = screen.getByTestId('ralph-goal-spec-input') as HTMLTextAreaElement;
            expect(textarea.value).toContain('Long, detailed goal spec');
            expect(textarea.value).not.toContain('Short summary only');
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('ralph-confirm-start-btn'));
        });

        await waitFor(() => {
            expect(mockOnStarted).toHaveBeenCalledWith('queue_started', 'ws-1');
        });

        // Endpoint must be ralph-start (the existing grilling process), not ralph-launch.
        const startCall = mockFetch.mock.calls[1];
        expect(startCall[0]).toContain('/processes/queue_grill-123/ralph-start');
        expect(startCall[0]).not.toContain('/ralph-launch');
        // And the body should carry the file's long spec, not the short synthesis.
        const body = JSON.parse(startCall[1].body);
        expect(body.goalSpec).toContain('Long, detailed goal spec');
    });

    it('uses ralph-launch with the selected workspace id when a grilling launch targets another local workspace', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ processId: 'queue_cross_local' }),
        });
        vi.stubGlobal('fetch', mockFetch);

        render(
            <RalphStartPanel
                processId="queue_grill-cross"
                workspaceId="ws-1"
                turns={GRILLING_TURNS}
                onStarted={mockOnStarted}
            />,
        );

        fireEvent.click(screen.getByTestId('ralph-start-btn'));
        await waitFor(() => expect(screen.getByTestId('ralph-start-execution-repo-select')).toBeTruthy());
        fireEvent.change(screen.getByTestId('ralph-start-execution-repo-select'), { target: { value: 'local:ws-2' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('ralph-confirm-start-btn'));
        });

        await waitFor(() => {
            expect(mockOnStarted).toHaveBeenCalledWith('queue_cross_local', 'ws-2');
        });

        const startCall = mockFetch.mock.calls[0];
        expect(startCall[0]).toBe('http://localhost:4000/api/ralph-launch');
        expect(startCall[0]).not.toContain('/processes/queue_grill-cross/ralph-start');
        const body = JSON.parse(startCall[1].body);
        expect(body.workspaceId).toBe('ws-2');
    });

    it('routes a remote execution target to the remote ralph-launch endpoint without local fallthrough', async () => {
        mockListRemoteWorkspaceTargetSources.mockResolvedValue({
            sources: [{
                server: { id: 'srv-remote', label: 'Remote CoC', effectiveUrl: 'http://127.0.0.1:7777' },
                workspaces: [{ id: 'remote-ws', name: 'Remote Repo', rootPath: '/remote/repo' }],
                gitInfoResults: {},
            }],
            warnings: [],
        });
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ processId: 'queue_remote_started' }),
        });
        vi.stubGlobal('fetch', mockFetch);

        render(
            <RalphStartPanel
                processId="queue_grill-remote"
                workspaceId="ws-1"
                turns={GRILLING_TURNS}
                onStarted={mockOnStarted}
            />,
        );

        fireEvent.click(screen.getByTestId('ralph-start-btn'));
        await waitFor(() => expect(screen.getByTestId('ralph-start-execution-repo-select')).toBeTruthy());
        fireEvent.change(screen.getByTestId('ralph-start-execution-repo-select'), { target: { value: 'srv-remote:remote-ws' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('ralph-confirm-start-btn'));
        });

        await waitFor(() => {
            expect(mockOnStarted).toHaveBeenCalledWith('queue_remote_started', 'remote-ws');
        });

        const startCall = mockFetch.mock.calls[0];
        expect(startCall[0]).toBe('http://127.0.0.1:7777/api/ralph-launch');
        expect(startCall[0]).not.toContain('localhost:4000');
        const body = JSON.parse(startCall[1].body);
        expect(body.workspaceId).toBe('remote-ws');
    });
});
