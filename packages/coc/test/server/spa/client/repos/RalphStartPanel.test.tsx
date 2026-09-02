/**
 * @vitest-environment jsdom
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
    isGitWorktreeExecutionEnabled: () => mockWorktreeEnabled(),
}));

const { mockModalSelection, mockWorktreeEnabled } = vi.hoisted(() => ({
    mockModalSelection: vi.fn(() => ({ resolved: { provider: 'copilot' } })),
    mockWorktreeEnabled: vi.fn(() => false),
}));

const { mockUseRepos } = vi.hoisted(() => ({
    mockUseRepos: vi.fn(),
}));

const { mockPatchMetadata, mockUseRalphSessionView } = vi.hoisted(() => ({
    mockPatchMetadata: vi.fn(async () => ({ process: {} })),
    // Default: no launched session in view → existing tests get the plain banner.
    mockUseRalphSessionView: vi.fn(() => ({ view: undefined, refresh: vi.fn() })),
}));

vi.mock('../../../../../src/server/spa/client/react/repos/cloneRouting', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../../src/server/spa/client/react/repos/cloneRouting')>();
    return {
        ...actual,
        useCocClient: () => ({ processes: { patchMetadata: mockPatchMetadata } }),
    };
});

vi.mock('../../../../../src/server/spa/client/react/features/chat/useRalphSessionView', () => ({
    useRalphSessionView: (...args: unknown[]) => mockUseRalphSessionView(...args),
}));

vi.mock('../../../../../src/server/spa/client/react/shared/ModalJobAiControls', () => ({
    useModalJobAiSelection: (options: unknown) => mockModalSelection(options),
    ModalJobAiControls: ({ testIdPrefix = 'modal-job' }: { testIdPrefix?: string }) => (
        <div data-testid={`${testIdPrefix}-ai-controls`} />
    ),
}));

vi.mock('../../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: mockUseRepos,
}));

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import { RalphStartPanel } from '../../../../../src/server/spa/client/react/features/chat/RalphStartPanel';
import type { ClientConversationTurn } from '../../../../../src/server/spa/client/react/types/dashboard';
import { resetCloneRegistryForTests } from '../../../../../src/server/spa/client/react/repos/cloneRegistry';
import {
    getRalphExecutionRepoTargetKey,
    isSameRalphExecutionTarget,
    resolveRalphExecutionRepoSource,
    type RalphExecutionRepoTarget,
} from '../../../../../src/server/spa/client/react/shared/RalphExecutionRepoSelector';

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

function makeTarget(
    serverId: string,
    workspaceId: string,
    baseUrl?: string,
): RalphExecutionRepoTarget {
    const local = serverId === 'local';
    return {
        key: getRalphExecutionRepoTargetKey(serverId, workspaceId),
        workspaceId,
        workspaceName: `${serverId}/${workspaceId}`,
        serverId,
        serverLabel: local ? 'Current CoC' : serverId,
        local,
        baseUrl,
    };
}

describe('Ralph execution source resolution', () => {
    it('resolves the exact remote server when two servers expose the same workspace id', () => {
        const serverA = makeTarget('srv-a', 'legacy-ws', 'http://127.0.0.1:7001');
        const serverB = makeTarget('srv-b', 'legacy-ws', 'http://127.0.0.1:7002');

        const resolution = resolveRalphExecutionRepoSource(
            { workspaceId: 'legacy-ws', selectionId: 'remote:srv-b:legacy-ws' },
            [serverA, serverB],
        );

        expect(resolution).toEqual({ status: 'resolved', target: serverB });
        expect(isSameRalphExecutionTarget(resolution.target, serverA)).toBe(false);
        expect(isSameRalphExecutionTarget(resolution.target, serverB)).toBe(true);
    });

    it('uses an explicit clone selection when local and remote targets share a legacy workspace id', () => {
        const local = makeTarget('local', 'shared-ws');
        const remote = makeTarget('srv-remote', 'shared-ws', 'http://127.0.0.1:7999');

        expect(resolveRalphExecutionRepoSource(
            { workspaceId: 'shared-ws', selectionId: 'remote:srv-remote:shared-ws' },
            [local, remote],
        )).toEqual({ status: 'resolved', target: remote });
        expect(resolveRalphExecutionRepoSource(
            { workspaceId: 'shared-ws', selectionId: 'shared-ws' },
            [local, remote],
        )).toEqual({ status: 'resolved', target: local });
    });

    it('uses a unique normalized base URL only as the legacy ambiguity fallback', () => {
        const local = makeTarget('local', 'shared-ws');
        const remote = makeTarget('srv-remote', 'shared-ws', 'http://127.0.0.1:7999');

        expect(resolveRalphExecutionRepoSource(
            { workspaceId: 'shared-ws', baseUrl: 'http://127.0.0.1:7999/' },
            [local, remote],
        )).toEqual({ status: 'resolved', target: remote });
    });

    it('does not classify an unresolved remote selection as local', () => {
        const local = makeTarget('local', 'shared-ws');

        expect(resolveRalphExecutionRepoSource(
            { workspaceId: 'shared-ws', selectionId: 'remote:srv-missing:shared-ws' },
            [local],
        )).toEqual({ status: 'unresolved', target: null });
    });

    it('keeps source-less launch behavior on the first available target', () => {
        const local = makeTarget('local', 'first');
        expect(resolveRalphExecutionRepoSource(undefined, [local]))
            .toEqual({ status: 'none', target: null });
    });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RalphStartPanel', () => {
    const mockOnStarted = vi.fn();

    beforeEach(() => {
        mockOnStarted.mockClear();
        mockModalSelection.mockReset();
        mockModalSelection.mockReturnValue({ resolved: { provider: 'copilot' } });
        mockWorktreeEnabled.mockReset();
        mockWorktreeEnabled.mockReturnValue(false);
        mockPatchMetadata.mockClear();
        mockPatchMetadata.mockResolvedValue({ process: {} });
        mockUseRalphSessionView.mockReset();
        mockUseRalphSessionView.mockReturnValue({ view: undefined, refresh: vi.fn() });
        mockUseRepos.mockReset();
        mockUseRepos.mockReturnValue({
            repos: [
                { workspace: { id: 'ws-1', name: 'Source Repo', rootPath: '/repos/source' } },
                { workspace: { id: 'ws-2', name: 'Other Repo', rootPath: '/repos/other' } },
            ],
            loading: false,
        });
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        resetCloneRegistryForTests();
    });

    it('routes the goal-file blob fetch to the remote clone server, not the local origin', async () => {
        // Regression: a remote clone's /fs/blob must target the clone's own server.
        // Reading the path on the LOCAL server 403s ("Path is outside trusted
        // directories") because that path only exists on the remote machine.
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ content: '## Goal\nremote goal body' }),
        });
        vi.stubGlobal('fetch', fetchMock);

        render(
            <RalphStartPanel
                processId="queue_remote"
                workspaceId="remote-ws"
                sourceBaseUrl="http://127.0.0.1:9999"
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

    it('renders the closed state as a compact banner row', () => {
        render(
            <RalphStartPanel
                processId="queue_test-banner"
                workspaceId="ws-1"
                turns={GRILLING_TURNS}
                goalFilePath="/repos/myrepo/remove-vscode-extension.goal.md"
                onStarted={mockOnStarted}
            />,
        );

        const banner = screen.getByTestId('ralph-start-banner');
        const button = screen.getByTestId('ralph-start-btn');
        const description = screen.getByTestId('ralph-start-description');

        expect(banner).toBeTruthy();
        expect(button.className).toContain('w-full');
        expect(button.textContent).toContain('Ralph ready');
        expect(button.textContent).toContain('Start Ralph');
        expect(description.className).toContain('truncate');
        expect(description.textContent).toBe('Goal spec: remove-vscode-extension.goal.md');
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

    it('shows online remote workspace options', async () => {
        mockUseRepos.mockReturnValue({
            repos: [
                { workspace: { id: 'ws-1', name: 'Source Repo', rootPath: '/repos/source' } },
                {
                    workspace: {
                        id: 'remote-ws',
                        name: 'Lab Repo',
                        rootPath: '/srv/source',
                        baseUrl: 'http://127.0.0.1:7777',
                        remote: {
                            serverId: 'srv-1',
                            serverLabel: 'Lab Server',
                            baseUrl: 'http://127.0.0.1:7777',
                            offline: false,
                        },
                    },
                },
            ],
            loading: false,
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
        expect(screen.queryByTestId('ralph-start-execution-repo-warning')).toBeNull();
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
        mockUseRepos.mockReturnValue({
            repos: [
                { workspace: { id: 'ws-1', name: 'Source Repo', rootPath: '/repos/source' } },
                {
                    workspace: {
                        id: 'remote-ws',
                        name: 'Remote Repo',
                        rootPath: '/remote/repo',
                        baseUrl: 'http://127.0.0.1:7777',
                        remote: {
                            serverId: 'srv-remote',
                            serverLabel: 'Remote CoC',
                            baseUrl: 'http://127.0.0.1:7777',
                            offline: false,
                        },
                    },
                },
            ],
            loading: false,
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

    it('persists ralphLaunchedSession when a grilling launch targets a different remote repo', async () => {
        // Regression: a grilling-phase launch (useLaunchEndpoint unset) into a
        // DIFFERENT remote target hits the remote /ralph-launch and mints a
        // session. The pointer must still be persisted onto the SOURCE chat so
        // the banner can track the executing/complete status — otherwise it
        // stays stuck on the plain "Ralph ready" banner.
        mockUseRepos.mockReturnValue({
            repos: [
                { workspace: { id: 'ws-1', name: 'Source Repo', rootPath: '/repos/source' } },
                {
                    workspace: {
                        id: 'remote-ws',
                        name: 'Remote Repo',
                        rootPath: '/remote/repo',
                        baseUrl: 'http://127.0.0.1:7777',
                        remote: {
                            serverId: 'srv-remote',
                            serverLabel: 'Remote CoC',
                            baseUrl: 'http://127.0.0.1:7777',
                            offline: false,
                        },
                    },
                },
            ],
            loading: false,
        });
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ processId: 'queue_remote_started', sessionId: 'ralph-remote-xyz' }),
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

        // Endpoint is the remote /ralph-launch (not the local ralph-start).
        const startCall = mockFetch.mock.calls[0];
        expect(startCall[0]).toBe('http://127.0.0.1:7777/api/ralph-launch');

        // The pointer is persisted onto the SOURCE chat, targeting the remote ws.
        await waitFor(() => expect(mockPatchMetadata).toHaveBeenCalled());
        const [patchedProcessId, patchBody] = mockPatchMetadata.mock.calls[0];
        expect(patchedProcessId).toBe('queue_grill-remote');
        expect(patchBody).toEqual({
            set: {
                ralphLaunchedSession: {
                    sessionId: 'ralph-remote-xyz',
                    workspaceId: 'remote-ws',
                    executionProcessId: 'queue_remote_started',
                    launchedAt: expect.any(String),
                },
            },
        });
    });

    // -----------------------------------------------------------------------
    // Fix 1: same-origin default
    // -----------------------------------------------------------------------

    it('defaults to the remote-origin target when source is a remote workspace', async () => {
        mockUseRepos.mockReturnValue({
            repos: [
                // Same workspace id exists locally (should NOT be chosen as default).
                { workspace: { id: 'remote-ws', name: 'Local Copy' } },
                { workspace: { id: 'another-local', name: 'Another Local' } },
                // The remote entry on the same origin as the source workspace.
                {
                    workspace: {
                        id: 'remote-ws',
                        name: 'Remote Source Repo',
                        rootPath: '/remote/repo',
                        baseUrl: 'http://127.0.0.1:7777',
                        remote: {
                            serverId: 'srv-a',
                            serverLabel: 'Server A',
                            baseUrl: 'http://127.0.0.1:7777',
                            offline: false,
                        },
                    },
                },
            ],
            loading: false,
        });

        render(
            <RalphStartPanel
                processId="queue_same-origin"
                workspaceId="remote-ws"
                sourceSelectionId="remote:srv-a:remote-ws"
                turns={GRILLING_TURNS}
                onStarted={mockOnStarted}
            />,
        );

        fireEvent.click(screen.getByTestId('ralph-start-btn'));
        await waitFor(() => {
            const select = screen.getByTestId('ralph-start-execution-repo-select') as HTMLSelectElement;
            expect(select.value).toBe('srv-a:remote-ws');
        });
    });

    // -----------------------------------------------------------------------
    // Fix 2: cached list, no on-demand fetch; offline remotes dropped
    // -----------------------------------------------------------------------

    it('excludes offline remote workspaces from the selector options', async () => {
        mockUseRepos.mockReturnValue({
            repos: [
                { workspace: { id: 'ws-1', name: 'Local Repo' } },
                {
                    workspace: {
                        id: 'offline-ws',
                        name: 'Offline Repo',
                        baseUrl: 'http://127.0.0.1:9999',
                        remote: {
                            serverId: 'srv-offline',
                            serverLabel: 'Offline Server',
                            baseUrl: 'http://127.0.0.1:9999',
                            offline: true,
                        },
                    },
                },
            ],
            loading: false,
        });

        render(
            <RalphStartPanel
                processId="queue_offline-test"
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
        const optionValues = [...select.options].map(o => o.value);
        expect(optionValues).not.toContain('srv-offline:offline-ws');
        expect(optionValues).toContain('local:ws-1');
    });

    it('leaves an offline remote source unselected, warns, and disables confirmation', async () => {
        mockUseRepos.mockReturnValue({
            repos: [
                { workspace: { id: 'local-ws', name: 'Local Repo' } },
                {
                    workspace: {
                        id: 'remote-ws',
                        name: 'Remote Source',
                        baseUrl: 'http://127.0.0.1:7777',
                        remote: {
                            serverId: 'srv-offline',
                            serverLabel: 'ubuntu-arm',
                            baseUrl: 'http://127.0.0.1:7777',
                            offline: true,
                            connection: 'offline',
                        },
                    },
                },
            ],
            loading: false,
            remoteWarnings: [],
        });

        render(
            <RalphStartPanel
                processId="queue_offline-source"
                workspaceId="remote-ws"
                sourceSelectionId="remote:srv-offline:remote-ws"
                turns={GRILLING_TURNS}
                onStarted={mockOnStarted}
            />,
        );

        fireEvent.click(screen.getByTestId('ralph-start-btn'));
        await waitForRepoSelector();

        expect((screen.getByTestId('ralph-start-execution-repo-select') as HTMLSelectElement).value).toBe('');
        expect(screen.getByTestId('ralph-start-execution-repo-source-warning').textContent)
            .toBe('The source workspace on ubuntu-arm is offline. Reconnect it or choose another repository.');
        expect((screen.getByTestId('ralph-confirm-start-btn') as HTMLButtonElement).disabled).toBe(true);
    });

    it('automatically selects an offline source after it reconnects when the user has not interacted', async () => {
        const props = {
            processId: 'queue_reconnecting-source',
            workspaceId: 'remote-ws',
            sourceSelectionId: 'remote:srv-a:remote-ws',
            turns: GRILLING_TURNS,
            onStarted: mockOnStarted,
        };
        mockUseRepos.mockReturnValue({
            repos: [
                { workspace: { id: 'local-ws', name: 'Local Repo' } },
                {
                    workspace: {
                        id: 'remote-ws',
                        name: 'Remote Source',
                        baseUrl: 'http://127.0.0.1:7777',
                        remote: {
                            serverId: 'srv-a',
                            serverLabel: 'ubuntu-arm',
                            baseUrl: 'http://127.0.0.1:7777',
                            offline: true,
                            connection: 'connecting',
                        },
                    },
                },
            ],
            loading: false,
        });
        const view = render(<RalphStartPanel {...props} />);
        fireEvent.click(screen.getByTestId('ralph-start-btn'));
        await waitForRepoSelector();
        expect((screen.getByTestId('ralph-start-execution-repo-select') as HTMLSelectElement).value).toBe('');

        mockUseRepos.mockReturnValue({
            repos: [
                { workspace: { id: 'local-ws', name: 'Local Repo' } },
                {
                    workspace: {
                        id: 'remote-ws',
                        name: 'Remote Source',
                        baseUrl: 'http://127.0.0.1:7778',
                        remote: {
                            serverId: 'srv-a',
                            serverLabel: 'ubuntu-arm',
                            baseUrl: 'http://127.0.0.1:7778',
                            offline: false,
                            connection: 'online',
                        },
                    },
                },
            ],
            loading: false,
        });
        view.rerender(<RalphStartPanel {...props} />);

        await waitFor(() => {
            expect((screen.getByTestId('ralph-start-execution-repo-select') as HTMLSelectElement).value)
                .toBe('srv-a:remote-ws');
        });
    });

    it('preserves a manual local target when the remote source reconnects', async () => {
        const props = {
            processId: 'queue_manual-source',
            workspaceId: 'remote-ws',
            sourceSelectionId: 'remote:srv-a:remote-ws',
            turns: GRILLING_TURNS,
            onStarted: mockOnStarted,
        };
        mockUseRepos.mockReturnValue({
            repos: [
                { workspace: { id: 'local-ws', name: 'Local Repo' } },
                {
                    workspace: {
                        id: 'remote-ws',
                        name: 'Remote Source',
                        baseUrl: 'http://127.0.0.1:7777',
                        remote: {
                            serverId: 'srv-a',
                            serverLabel: 'ubuntu-arm',
                            baseUrl: 'http://127.0.0.1:7777',
                            offline: true,
                            connection: 'offline',
                        },
                    },
                },
            ],
            loading: false,
        });
        const view = render(<RalphStartPanel {...props} />);
        fireEvent.click(screen.getByTestId('ralph-start-btn'));
        await waitForRepoSelector();
        fireEvent.change(screen.getByTestId('ralph-start-execution-repo-select'), {
            target: { value: 'local:local-ws' },
        });

        mockUseRepos.mockReturnValue({
            repos: [
                { workspace: { id: 'local-ws', name: 'Local Repo' } },
                {
                    workspace: {
                        id: 'remote-ws',
                        name: 'Remote Source',
                        baseUrl: 'http://127.0.0.1:7778',
                        remote: {
                            serverId: 'srv-a',
                            serverLabel: 'ubuntu-arm',
                            baseUrl: 'http://127.0.0.1:7778',
                            offline: false,
                            connection: 'online',
                        },
                    },
                },
            ],
            loading: false,
        });
        view.rerender(<RalphStartPanel {...props} />);

        await waitFor(() => {
            expect((screen.getByTestId('ralph-start-execution-repo-select') as HTMLSelectElement).value)
                .toBe('local:local-ws');
        });
    });

    it('posts a same-remote grilling start to the remote process endpoint', async () => {
        mockUseRepos.mockReturnValue({
            repos: [
                { workspace: { id: 'local-ws', name: 'Local Repo' } },
                {
                    workspace: {
                        id: 'remote-ws',
                        name: 'Remote Source',
                        baseUrl: 'http://127.0.0.1:7333',
                        remote: {
                            serverId: 'srv-a',
                            serverLabel: 'ubuntu-arm',
                            baseUrl: 'http://127.0.0.1:7333',
                            offline: false,
                        },
                    },
                },
            ],
            loading: false,
        });
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ processId: 'queue_remote-execution' }),
        });
        vi.stubGlobal('fetch', mockFetch);

        render(
            <RalphStartPanel
                processId="queue_remote-grill"
                workspaceId="remote-ws"
                sourceSelectionId="remote:srv-a:remote-ws"
                turns={GRILLING_TURNS}
                onStarted={mockOnStarted}
            />,
        );
        fireEvent.click(screen.getByTestId('ralph-start-btn'));
        await waitForRepoSelector();
        fireEvent.click(screen.getByTestId('ralph-confirm-start-btn'));

        await waitFor(() => expect(mockOnStarted).toHaveBeenCalled());
        expect(String(mockFetch.mock.calls[0][0]))
            .toBe('http://127.0.0.1:7333/api/processes/queue_remote-grill/ralph-start');
    });

    it('posts to local ralph-launch when the user chooses a local target from a remote source', async () => {
        mockUseRepos.mockReturnValue({
            repos: [
                { workspace: { id: 'local-ws', name: 'Local Repo' } },
                {
                    workspace: {
                        id: 'remote-ws',
                        name: 'Remote Source',
                        baseUrl: 'http://127.0.0.1:7333',
                        remote: {
                            serverId: 'srv-a',
                            serverLabel: 'ubuntu-arm',
                            baseUrl: 'http://127.0.0.1:7333',
                            offline: false,
                        },
                    },
                },
            ],
            loading: false,
        });
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ processId: 'queue_local-execution' }),
        });
        vi.stubGlobal('fetch', mockFetch);

        render(
            <RalphStartPanel
                processId="queue_remote-grill"
                workspaceId="remote-ws"
                sourceSelectionId="remote:srv-a:remote-ws"
                turns={GRILLING_TURNS}
                onStarted={mockOnStarted}
            />,
        );
        fireEvent.click(screen.getByTestId('ralph-start-btn'));
        await waitForRepoSelector();
        fireEvent.change(screen.getByTestId('ralph-start-execution-repo-select'), {
            target: { value: 'local:local-ws' },
        });
        fireEvent.click(screen.getByTestId('ralph-confirm-start-btn'));

        await waitFor(() => expect(mockOnStarted).toHaveBeenCalledWith('queue_local-execution', 'local-ws'));
        expect(String(mockFetch.mock.calls[0][0])).toBe('http://localhost:4000/api/ralph-launch');
    });

    // -----------------------------------------------------------------------
    // AC-01: persist a launched-session pointer on the source chat
    // -----------------------------------------------------------------------

    it('AC-01 — persists ralphLaunchedSession on the source chat via patchMetadata after a launch', async () => {
        const mockFetch = vi.fn()
            // First call: fs/blob (goal file content)
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ content: '## Goal\nDo something', encoding: 'utf-8' }),
            })
            // Second call: ralph-launch → { processId, sessionId }
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ processId: 'queue_launched', sessionId: 'ralph-abc' }),
            });
        vi.stubGlobal('fetch', mockFetch);

        render(
            <RalphStartPanel
                processId="queue_source-chat"
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
        await waitFor(() => {
            const textarea = screen.getByTestId('ralph-goal-spec-input') as HTMLTextAreaElement;
            expect(textarea.value).toContain('Do something');
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('ralph-confirm-start-btn'));
        });

        await waitFor(() => expect(mockPatchMetadata).toHaveBeenCalled());
        // Patch targets the SOURCE chat's process id, on the source workspace's client.
        const [patchedProcessId, patchBody] = mockPatchMetadata.mock.calls[0];
        expect(patchedProcessId).toBe('queue_source-chat');
        expect(patchBody).toEqual({
            set: {
                ralphLaunchedSession: {
                    sessionId: 'ralph-abc',
                    workspaceId: 'ws-1',
                    executionProcessId: 'queue_launched',
                    launchedAt: expect.any(String),
                },
            },
        });
    });

    it('AC-01 — does NOT persist a pointer for the grilling-phase (ralph-start) path', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ processId: 'queue_started' }),
        });
        vi.stubGlobal('fetch', mockFetch);

        render(
            <RalphStartPanel
                processId="queue_grill"
                workspaceId="ws-1"
                turns={GRILLING_TURNS}
                onStarted={mockOnStarted}
            />,
        );

        fireEvent.click(screen.getByTestId('ralph-start-btn'));
        await waitForRepoSelector();
        await act(async () => {
            fireEvent.click(screen.getByTestId('ralph-confirm-start-btn'));
        });

        await waitFor(() => expect(mockOnStarted).toHaveBeenCalledWith('queue_started', 'ws-1'));
        expect(mockPatchMetadata).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // AC-02: render the launched session's live state in the banner
    // -----------------------------------------------------------------------

    const LAUNCHED = {
        sessionId: 'ralph-123',
        workspaceId: 'ws-2',
        executionProcessId: 'queue_exec',
        launchedAt: '2026-06-30T00:00:00.000Z',
    };

    function viewWith(record: Record<string, unknown>) {
        return {
            view: {
                record: {
                    sessionId: 'ralph-123',
                    workspaceId: 'ws-2',
                    originalGoal: '',
                    maxIterations: 10,
                    currentIteration: 1,
                    phase: 'executing',
                    startedAt: '',
                    iterations: [],
                    ...record,
                },
                sections: [],
            },
            refresh: vi.fn(),
        };
    }

    it('AC-02 — shows executing status with iteration N/max and routes the read to the stored workspace', () => {
        mockUseRalphSessionView.mockReturnValue(viewWith({ phase: 'executing', currentIteration: 3, maxIterations: 10 }));

        render(
            <RalphStartPanel
                processId="queue_source"
                workspaceId="ws-1"
                turns={[]}
                goalFilePath="/repos/myrepo/goal.md"
                useLaunchEndpoint
                launchedSession={LAUNCHED}
                onStarted={mockOnStarted}
            />,
        );

        // Read routes via the stored (target) workspace + session id.
        expect(mockUseRalphSessionView).toHaveBeenCalledWith('ws-2', 'ralph-123');
        const status = screen.getByTestId('ralph-launched-status');
        expect(status.textContent).toContain('Ralph executing');
        expect(status.textContent).toContain('iteration 3/10');
    });

    it('AC-02 — clicking the status link opens the running execution process on the stored workspace', () => {
        mockUseRalphSessionView.mockReturnValue(viewWith({ phase: 'executing' }));

        render(
            <RalphStartPanel
                processId="queue_source"
                workspaceId="ws-1"
                turns={[]}
                goalFilePath="/repos/myrepo/goal.md"
                useLaunchEndpoint
                launchedSession={LAUNCHED}
                onStarted={mockOnStarted}
            />,
        );

        fireEvent.click(screen.getByTestId('ralph-launched-link'));
        expect(mockOnStarted).toHaveBeenCalledWith('queue_exec', 'ws-2');
    });

    it('AC-02 — shows terminal "Ralph complete" for a completed session', () => {
        mockUseRalphSessionView.mockReturnValue(viewWith({ phase: 'complete', terminalReason: 'RALPH_COMPLETE' }));
        render(
            <RalphStartPanel processId="queue_source" workspaceId="ws-1" turns={[]} goalFilePath="/g.md" useLaunchEndpoint launchedSession={LAUNCHED} onStarted={mockOnStarted} />,
        );
        const status = screen.getByTestId('ralph-launched-status');
        expect(status.textContent).toContain('Ralph complete');
        expect(status.textContent).not.toContain('iteration');
        expect(screen.getByTestId('ralph-launched-link')).toBeTruthy();
    });

    it('AC-02 — shows terminal "Ralph cancelled" and "Ralph failed" for terminal reasons', () => {
        mockUseRalphSessionView.mockReturnValue(viewWith({ phase: 'complete', terminalReason: 'CANCELLED' }));
        const { rerender } = render(
            <RalphStartPanel processId="queue_source" workspaceId="ws-1" turns={[]} goalFilePath="/g.md" useLaunchEndpoint launchedSession={LAUNCHED} onStarted={mockOnStarted} />,
        );
        expect(screen.getByTestId('ralph-launched-status').textContent).toContain('Ralph cancelled');

        mockUseRalphSessionView.mockReturnValue(viewWith({ phase: 'complete', terminalReason: 'CAP_REACHED' }));
        rerender(
            <RalphStartPanel processId="queue_source" workspaceId="ws-1" turns={[]} goalFilePath="/g.md" useLaunchEndpoint launchedSession={LAUNCHED} onStarted={mockOnStarted} />,
        );
        expect(screen.getByTestId('ralph-launched-status').textContent).toContain('Ralph failed');
    });

    it('AC-02 — falls back to the plain banner when the session record is unreadable', () => {
        // view === null → deleted / target unreachable / clone not registered.
        mockUseRalphSessionView.mockReturnValue({ view: null, refresh: vi.fn() });
        render(
            <RalphStartPanel processId="queue_source" workspaceId="ws-1" turns={[]} goalFilePath="/repos/myrepo/fallback.goal.md" useLaunchEndpoint launchedSession={LAUNCHED} onStarted={mockOnStarted} />,
        );
        expect(screen.queryByTestId('ralph-launched-status')).toBeNull();
        // Plain banner is still shown (with Start Ralph), no error spew.
        expect(screen.getByTestId('ralph-start-description')).toBeTruthy();
        expect(screen.getByTestId('ralph-start-btn')).toBeTruthy();
    });

    // -----------------------------------------------------------------------
    // AC-03: Start Ralph stays available; relaunch tracks latest
    // -----------------------------------------------------------------------

    it('AC-03 — Start Ralph stays rendered and enabled while a session is executing', () => {
        mockUseRalphSessionView.mockReturnValue(viewWith({ phase: 'executing' }));
        render(
            <RalphStartPanel processId="queue_source" workspaceId="ws-1" turns={[]} goalFilePath="/g.md" useLaunchEndpoint launchedSession={LAUNCHED} onStarted={mockOnStarted} />,
        );
        const startBtn = screen.getByTestId('ralph-start-btn') as HTMLButtonElement;
        expect(startBtn).toBeTruthy();
        expect(startBtn.disabled).toBe(false);
        // Coexists with the live status row.
        expect(screen.getByTestId('ralph-launched-status')).toBeTruthy();
    });

    it('AC-03 — relaunch overwrites the pointer with the newest session', async () => {
        mockUseRalphSessionView.mockReturnValue(viewWith({ phase: 'executing' }));
        const mockFetch = vi.fn()
            // fs/blob
            .mockResolvedValueOnce({ ok: true, json: async () => ({ content: '## Goal\nx', encoding: 'utf-8' }) })
            // ralph-launch → a NEW session id
            .mockResolvedValueOnce({ ok: true, json: async () => ({ processId: 'queue_launched2', sessionId: 'ralph-NEW' }) });
        vi.stubGlobal('fetch', mockFetch);

        render(
            <RalphStartPanel processId="queue_source" workspaceId="ws-1" turns={[]} goalFilePath="/repos/myrepo/goal.md" useLaunchEndpoint launchedSession={LAUNCHED} onStarted={mockOnStarted} />,
        );

        fireEvent.click(screen.getByTestId('ralph-start-btn'));
        await waitFor(() => expect(screen.getByTestId('ralph-start-panel')).toBeTruthy());
        await waitForRepoSelector();
        await act(async () => {
            fireEvent.click(screen.getByTestId('ralph-confirm-start-btn'));
        });

        await waitFor(() => expect(mockPatchMetadata).toHaveBeenCalled());
        const [, patchBody] = mockPatchMetadata.mock.calls[0];
        expect((patchBody as any).set.ralphLaunchedSession.sessionId).toBe('ralph-NEW');
    });

    it('AC-03 — a chat with no prior launch shows the plain banner (no status row)', () => {
        render(
            <RalphStartPanel processId="queue_source" workspaceId="ws-1" turns={[]} goalFilePath="/repos/myrepo/x.goal.md" useLaunchEndpoint onStarted={mockOnStarted} />,
        );
        expect(screen.queryByTestId('ralph-launched-status')).toBeNull();
        expect(screen.getByTestId('ralph-start-description')).toBeTruthy();
        expect(screen.getByTestId('ralph-start-btn')).toBeTruthy();
    });

    describe('worktree controls (AC-05)', () => {
        function stubRuntimeAndStartFetch(processId: string) {
            const mockFetch = vi.fn((url: string) => {
                if (String(url).includes('/config/runtime')) {
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({ features: { gitWorktreeExecutionEnabled: true } }),
                    });
                }
                return Promise.resolve({ ok: true, json: async () => ({ processId, sessionId: 'sess-wt' }) });
            });
            vi.stubGlobal('fetch', mockFetch);
            return mockFetch;
        }

        it('hides the worktree control when the feature flag is off', async () => {
            mockWorktreeEnabled.mockReturnValue(false);
            vi.stubGlobal('fetch', vi.fn());
            render(
                <RalphStartPanel processId="queue_wt-off" workspaceId="ws-1" turns={GRILLING_TURNS} onStarted={mockOnStarted} />,
            );
            fireEvent.click(screen.getByTestId('ralph-start-btn'));
            await waitFor(() => expect(screen.getByTestId('ralph-start-panel')).toBeTruthy());
            await waitForRepoSelector();
            expect(screen.queryByTestId('ralph-start-worktree-controls')).toBeNull();
        });

        it('shows the worktree checkbox when the feature flag is on', async () => {
            mockWorktreeEnabled.mockReturnValue(true);
            stubRuntimeAndStartFetch('queue_wt-on');
            render(
                <RalphStartPanel processId="queue_wt-on" workspaceId="ws-1" turns={GRILLING_TURNS} onStarted={mockOnStarted} />,
            );
            fireEvent.click(screen.getByTestId('ralph-start-btn'));
            await waitFor(() => expect(screen.getByTestId('ralph-start-panel')).toBeTruthy());
            await waitForRepoSelector();
            expect(screen.getByTestId('ralph-start-worktree-checkbox')).toBeDefined();
        });

        it('sends the worktree request with a trimmed base ref on confirm', async () => {
            mockWorktreeEnabled.mockReturnValue(true);
            const mockFetch = stubRuntimeAndStartFetch('queue_wt-task');
            render(
                <RalphStartPanel processId="queue_wt-src" workspaceId="ws-1" turns={GRILLING_TURNS} onStarted={mockOnStarted} />,
            );
            fireEvent.click(screen.getByTestId('ralph-start-btn'));
            await waitFor(() => expect(screen.getByTestId('ralph-start-panel')).toBeTruthy());
            await waitForRepoSelector();

            fireEvent.click(screen.getByTestId('ralph-start-worktree-checkbox'));
            fireEvent.change(screen.getByTestId('ralph-start-worktree-base-ref'), {
                target: { value: ' feature/x ' },
            });
            await act(async () => {
                fireEvent.click(screen.getByTestId('ralph-confirm-start-btn'));
            });

            await waitFor(() => expect(mockOnStarted).toHaveBeenCalledWith('queue_wt-task', 'ws-1'));
            const startCall = mockFetch.mock.calls.find(c => String(c[0]).includes('/ralph-start'))!;
            const body = JSON.parse(startCall[1].body);
            expect(body.worktree).toEqual({ enabled: true, baseRef: 'feature/x' });
        });
    });
});
