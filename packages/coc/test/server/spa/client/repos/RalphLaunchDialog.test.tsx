/**
 * @vitest-environment jsdom
 *
 * Tests for RalphLaunchDialog component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => 'http://localhost:4000/api',
    isRalphEnabled: () => true,
    getDefaultProvider: () => 'copilot',
    getConfiguredDefaultProvider: () => 'copilot',
    isAutoAgentProviderRoutingEnabled: () => false,
    isGitWorktreeExecutionEnabled: () => mockWorktreeEnabled(),
}));

const {
    mockGetRepoPreferences,
    mockPatchRepoPreferences,
    mockAgentProviders,
    mockModalSelection,
    mockUseRepos,
    mockWorktreeEnabled,
} = vi.hoisted(() => ({
    mockGetRepoPreferences: vi.fn().mockResolvedValue({}),
    mockPatchRepoPreferences: vi.fn().mockResolvedValue({}),
    mockAgentProviders: [
        { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
        { id: 'codex', label: 'Codex', enabled: true, available: true },
        { id: 'claude', label: 'Claude', enabled: false, available: false },
    ],
    mockModalSelection: vi.fn(() => ({ resolved: { provider: 'copilot' } })),
    mockUseRepos: vi.fn(),
    mockWorktreeEnabled: vi.fn(() => false),
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        preferences: {
            getRepo: mockGetRepoPreferences,
            patchRepo: mockPatchRepoPreferences,
        },
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useAgentProviders', () => ({
    useAgentProviders: () => ({ providers: mockAgentProviders, loading: false, error: null, reload: vi.fn() }),
}));

const mockModels = [
    { id: 'model-a', name: 'Model A', enabled: true, tokenLimit: 100000 },
    { id: 'model-b', name: 'Model B', enabled: true, tokenLimit: 200000 },
    { id: 'model-c', name: 'Disabled Model', enabled: false, tokenLimit: 100000 },
];

vi.mock('../../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: () => ({ models: mockModels, loading: false, error: null, reload: vi.fn() }),
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

import { RalphLaunchDialog } from '../../../../../src/server/spa/client/react/shared/RalphLaunchDialog';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../../../src/server/spa/client/react/repos/cloneRegistry';

async function waitForRepoSelector() {
    await waitFor(() => expect(screen.getByTestId('ralph-launch-execution-repo-select')).toBeDefined());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RalphLaunchDialog', () => {
    const defaultProps = {
        open: true,
        workspaceId: 'ws-123',
        sourceLabel: 'auth-refactor.goal.md',
        goalSpec: '## Goal\nRefactor auth module',
        onClose: vi.fn(),
        onLaunched: vi.fn(),
    };

    beforeEach(() => {
        defaultProps.onClose.mockClear();
        defaultProps.onLaunched.mockClear();
        mockGetRepoPreferences.mockReset();
        mockGetRepoPreferences.mockResolvedValue({});
        mockPatchRepoPreferences.mockReset();
        mockPatchRepoPreferences.mockResolvedValue({});
        mockModalSelection.mockReset();
        mockModalSelection.mockReturnValue({ resolved: { provider: 'copilot' } });
        mockWorktreeEnabled.mockReset();
        mockWorktreeEnabled.mockReturnValue(false);
        mockUseRepos.mockReset();
        mockUseRepos.mockReturnValue({
            repos: [
                { workspace: { id: 'ws-123', name: 'Source Repo', rootPath: '/repos/source' } },
                { workspace: { id: 'ws-456', name: 'Other Repo', rootPath: '/repos/other' } },
            ],
            loading: false,
        });
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        resetCloneRegistryForTests();
    });

    it('renders nothing when open is false', () => {
        const { container } = render(<RalphLaunchDialog {...defaultProps} open={false} />);
        expect(container.innerHTML).toBe('');
    });

    it('renders dialog with source label and goal preview', () => {
        render(<RalphLaunchDialog {...defaultProps} />);
        expect(screen.getByTestId('ralph-launch-dialog')).toBeDefined();
        expect(screen.getByText('auth-refactor.goal.md')).toBeDefined();
        expect(screen.getByTestId('ralph-goal-preview')).toHaveValue('## Goal\nRefactor auth module');
    });

    it('goal preview is read-only', () => {
        render(<RalphLaunchDialog {...defaultProps} />);
        const textarea = screen.getByTestId('ralph-goal-preview') as HTMLTextAreaElement;
        expect(textarea.readOnly).toBe(true);
    });

    it('renders shared AI controls', () => {
        render(<RalphLaunchDialog {...defaultProps} />);
        expect(screen.getByTestId('ralph-launch-ai-controls')).toBeDefined();
    });

    it('renders the execution repo selector and defaults to the source workspace', async () => {
        render(<RalphLaunchDialog {...defaultProps} />);

        await waitForRepoSelector();

        const select = screen.getByTestId('ralph-launch-execution-repo-select') as HTMLSelectElement;
        expect(select.value).toBe('local:ws-123');
        expect(screen.getByTestId('ralph-launch-execution-repo-summary').textContent)
            .toContain('Ralph will run in Source Repo on Current CoC');
    });

    it('shows online remote workspace options', async () => {
        mockUseRepos.mockReturnValue({
            repos: [
                { workspace: { id: 'ws-123', name: 'Source Repo', rootPath: '/repos/source' } },
                {
                    workspace: {
                        id: 'remote-ws',
                        name: 'Lab Repo',
                        rootPath: '/remote/source',
                        baseUrl: 'http://127.0.0.1:7777',
                        remote: {
                            serverId: 'srv-1',
                            serverLabel: 'Remote Lab',
                            baseUrl: 'http://127.0.0.1:7777',
                            offline: false,
                        },
                    },
                },
            ],
            loading: false,
        });

        render(<RalphLaunchDialog {...defaultProps} />);

        await waitForRepoSelector();
        const select = screen.getByTestId('ralph-launch-execution-repo-select') as HTMLSelectElement;
        expect([...select.options].map(option => option.value)).toContain('srv-1:remote-ws');
        expect(screen.queryByTestId('ralph-launch-execution-repo-warning')).toBeNull();
    });

    it('disables confirmation and explains when no selectable workspace exists', async () => {
        mockUseRepos.mockReturnValue({ repos: [], loading: false });

        render(<RalphLaunchDialog {...defaultProps} />);

        await waitFor(() => {
            expect(screen.getByTestId('ralph-launch-execution-repo-empty').textContent)
                .toContain('Register a workspace');
        });
        expect(screen.getByTestId('ralph-launch-confirm-btn')).toBeDisabled();
    });

    it('calls onClose when Cancel is clicked', () => {
        render(<RalphLaunchDialog {...defaultProps} />);
        fireEvent.click(screen.getByText('Cancel'));
        expect(defaultProps.onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose when ✕ is clicked', () => {
        render(<RalphLaunchDialog {...defaultProps} />);
        fireEvent.click(screen.getByLabelText('Close'));
        expect(defaultProps.onClose).toHaveBeenCalledOnce();
    });

    it('posts to ralph-launch and calls onLaunched on success', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ processId: 'new-pid-123' }),
        });
        vi.stubGlobal('fetch', mockFetch);

        render(<RalphLaunchDialog {...defaultProps} />);
        await waitForRepoSelector();
        fireEvent.click(screen.getByTestId('ralph-launch-confirm-btn'));

        await waitFor(() => {
            expect(defaultProps.onLaunched).toHaveBeenCalledWith('new-pid-123', 'ws-123');
        });

        expect(mockFetch).toHaveBeenCalledWith(
            'http://localhost:4000/api/ralph-launch',
            expect.objectContaining({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            }),
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.goalSpec).toBe('## Goal\nRefactor auth module');
        expect(body.workspaceId).toBe('ws-123');
        expect(body.provider).toBe('copilot');
    });

    it('includes resolved model and reasoning effort in config', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ processId: 'pid-456' }),
        });
        vi.stubGlobal('fetch', mockFetch);
        mockModalSelection.mockReturnValue({
            resolved: { provider: 'codex', model: 'gpt-5.3-codex', reasoningEffort: 'high' },
        });

        render(<RalphLaunchDialog {...defaultProps} />);
        await waitForRepoSelector();
        fireEvent.click(screen.getByTestId('ralph-launch-confirm-btn'));

        await waitFor(() => {
            expect(defaultProps.onLaunched).toHaveBeenCalledWith('pid-456', 'ws-123');
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.provider).toBe('codex');
        expect(body.config).toEqual({ model: 'gpt-5.3-codex', reasoningEffort: 'high' });
    });

    it('omits config when no model or reasoning effort override is resolved', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ processId: 'pid-no-config' }),
        });
        vi.stubGlobal('fetch', mockFetch);

        render(<RalphLaunchDialog {...defaultProps} />);
        await waitForRepoSelector();
        fireEvent.click(screen.getByTestId('ralph-launch-confirm-btn'));

        await waitFor(() => {
            expect(defaultProps.onLaunched).toHaveBeenCalledWith('pid-no-config', 'ws-123');
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.provider).toBe('copilot');
        expect(body.config).toBeUndefined();
    });

    it('includes folderPath when provided', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ processId: 'pid-789' }),
        });
        vi.stubGlobal('fetch', mockFetch);

        render(<RalphLaunchDialog {...defaultProps} folderPath="/repo/notes" />);
        await waitForRepoSelector();
        fireEvent.click(screen.getByTestId('ralph-launch-confirm-btn'));

        await waitFor(() => {
            expect(defaultProps.onLaunched).toHaveBeenCalled();
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.folderPath).toBe('/repo/notes');
    });

    it('omits source folder paths when launching into another workspace', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ processId: 'pid-cross' }),
        });
        vi.stubGlobal('fetch', mockFetch);

        render(<RalphLaunchDialog {...defaultProps} folderPath="/repo/notes" workingDirectory="/repo" />);
        await waitForRepoSelector();
        fireEvent.change(screen.getByTestId('ralph-launch-execution-repo-select'), { target: { value: 'local:ws-456' } });
        fireEvent.click(screen.getByTestId('ralph-launch-confirm-btn'));

        await waitFor(() => {
            expect(defaultProps.onLaunched).toHaveBeenCalledWith('pid-cross', 'ws-456');
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.workspaceId).toBe('ws-456');
        expect(body.folderPath).toBeUndefined();
        expect(body.workingDirectory).toBeUndefined();
    });

    it('posts remote launches to the selected remote CoC server, not the local API base', async () => {
        mockUseRepos.mockReturnValue({
            repos: [
                { workspace: { id: 'ws-123', name: 'Source Repo', rootPath: '/repos/source' } },
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
            json: () => Promise.resolve({ processId: 'pid-remote' }),
        });
        vi.stubGlobal('fetch', mockFetch);

        render(<RalphLaunchDialog {...defaultProps} folderPath="/repo/notes" />);
        await waitForRepoSelector();
        fireEvent.change(screen.getByTestId('ralph-launch-execution-repo-select'), { target: { value: 'srv-remote:remote-ws' } });
        fireEvent.click(screen.getByTestId('ralph-launch-confirm-btn'));

        await waitFor(() => {
            expect(defaultProps.onLaunched).toHaveBeenCalledWith('pid-remote', 'remote-ws');
        });

        expect(mockFetch.mock.calls[0][0]).toBe('http://127.0.0.1:7777/api/ralph-launch');
        expect(mockFetch.mock.calls[0][0]).not.toContain('localhost:4000');
        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.workspaceId).toBe('remote-ws');
        expect(body.folderPath).toBeUndefined();
    });

    it('shows error on fetch failure', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            text: () => Promise.resolve(JSON.stringify({ error: 'Server exploded' })),
        });
        vi.stubGlobal('fetch', mockFetch);

        render(<RalphLaunchDialog {...defaultProps} />);
        await waitForRepoSelector();
        fireEvent.click(screen.getByTestId('ralph-launch-confirm-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('ralph-launch-error')).toBeDefined();
            expect(screen.getByTestId('ralph-launch-error').textContent).toBe('Server exploded');
        });
        expect(defaultProps.onLaunched).not.toHaveBeenCalled();
    });

    it('shows error when goalSpec is empty', async () => {
        render(<RalphLaunchDialog {...defaultProps} goalSpec="   " />);
        await waitForRepoSelector();
        fireEvent.click(screen.getByTestId('ralph-launch-confirm-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('ralph-launch-error')).toBeDefined();
            expect(screen.getByTestId('ralph-launch-error').textContent).toContain('empty');
        });
    });

    it('closes on backdrop click', () => {
        render(<RalphLaunchDialog {...defaultProps} />);
        const backdrop = screen.getByTestId('ralph-launch-dialog');
        fireEvent.mouseDown(backdrop);
        expect(defaultProps.onClose).toHaveBeenCalledOnce();
    });

    // -----------------------------------------------------------------------
    // Fix 1: same-origin default
    // -----------------------------------------------------------------------

    it('defaults to the remote-origin target when source is a remote workspace', async () => {
        registerCloneBaseUrls([{ workspaceId: 'ws-123', baseUrl: 'http://127.0.0.1:8888' }]);
        mockUseRepos.mockReturnValue({
            repos: [
                // Same workspace id exists locally (should NOT be chosen as default).
                { workspace: { id: 'ws-123', name: 'Local Copy' } },
                // The remote entry on the same origin as the source workspace.
                {
                    workspace: {
                        id: 'ws-123',
                        name: 'Remote Source Repo',
                        rootPath: '/remote/repo',
                        baseUrl: 'http://127.0.0.1:8888',
                        remote: {
                            serverId: 'srv-b',
                            serverLabel: 'Server B',
                            baseUrl: 'http://127.0.0.1:8888',
                            offline: false,
                        },
                    },
                },
            ],
            loading: false,
        });

        render(<RalphLaunchDialog {...defaultProps} workspaceId="ws-123" />);

        await waitFor(() => {
            const select = screen.getByTestId('ralph-launch-execution-repo-select') as HTMLSelectElement;
            expect(select.value).toBe('srv-b:ws-123');
        });
    });

    // -----------------------------------------------------------------------
    // Fix 2: cached list, offline remotes dropped
    // -----------------------------------------------------------------------

    it('excludes offline remote workspaces from the selector options', async () => {
        mockUseRepos.mockReturnValue({
            repos: [
                { workspace: { id: 'ws-123', name: 'Source Repo' } },
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

        render(<RalphLaunchDialog {...defaultProps} />);

        await waitForRepoSelector();
        const select = screen.getByTestId('ralph-launch-execution-repo-select') as HTMLSelectElement;
        const optionValues = [...select.options].map(o => o.value);
        expect(optionValues).not.toContain('srv-offline:offline-ws');
        expect(optionValues).toContain('local:ws-123');
    });

    describe('worktree controls (AC-05)', () => {
        function stubRuntimeAndLaunchFetch(processId: string) {
            const mockFetch = vi.fn((url: string) => {
                if (String(url).includes('/config/runtime')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ features: { gitWorktreeExecutionEnabled: true } }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ processId }) });
            });
            vi.stubGlobal('fetch', mockFetch);
            return mockFetch;
        }

        it('hides the worktree control when the feature flag is off', async () => {
            mockWorktreeEnabled.mockReturnValue(false);
            render(<RalphLaunchDialog {...defaultProps} />);
            await waitForRepoSelector();
            expect(screen.queryByTestId('ralph-launch-worktree-controls')).toBeNull();
        });

        it('shows the worktree checkbox when the feature flag is on', async () => {
            mockWorktreeEnabled.mockReturnValue(true);
            stubRuntimeAndLaunchFetch('pid-wt');
            render(<RalphLaunchDialog {...defaultProps} />);
            await waitForRepoSelector();
            expect(screen.getByTestId('ralph-launch-worktree-checkbox')).toBeDefined();
        });

        it('sends the worktree request with a trimmed base ref on launch', async () => {
            mockWorktreeEnabled.mockReturnValue(true);
            const mockFetch = stubRuntimeAndLaunchFetch('pid-wt');
            render(<RalphLaunchDialog {...defaultProps} />);
            await waitForRepoSelector();

            fireEvent.click(screen.getByTestId('ralph-launch-worktree-checkbox'));
            fireEvent.change(screen.getByTestId('ralph-launch-worktree-base-ref'), {
                target: { value: '  release/1.2  ' },
            });
            fireEvent.click(screen.getByTestId('ralph-launch-confirm-btn'));

            await waitFor(() => {
                expect(defaultProps.onLaunched).toHaveBeenCalledWith('pid-wt', 'ws-123');
            });
            const launchCall = mockFetch.mock.calls.find(c => String(c[0]).endsWith('/ralph-launch'))!;
            const body = JSON.parse(launchCall[1].body);
            expect(body.worktree).toEqual({ enabled: true, baseRef: 'release/1.2' });
        });

        it('omits the worktree request when the option is left unchecked', async () => {
            mockWorktreeEnabled.mockReturnValue(true);
            const mockFetch = stubRuntimeAndLaunchFetch('pid-plain');
            render(<RalphLaunchDialog {...defaultProps} />);
            await waitForRepoSelector();
            fireEvent.click(screen.getByTestId('ralph-launch-confirm-btn'));

            await waitFor(() => {
                expect(defaultProps.onLaunched).toHaveBeenCalledWith('pid-plain', 'ws-123');
            });
            const launchCall = mockFetch.mock.calls.find(c => String(c[0]).endsWith('/ralph-launch'))!;
            const body = JSON.parse(launchCall[1].body);
            expect(body.worktree).toBeUndefined();
        });
    });
});
