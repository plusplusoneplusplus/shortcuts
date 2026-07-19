/**
 * @vitest-environment jsdom
 *
 * Tests for ImplementPlanLaunchDialog — the inline launch panel that hosts the
 * confirm/enqueue action for implementing a reviewed plan. Verifies the enqueue
 * payload (including the resolved AI selection), local vs. remote routing,
 * canvas-backed plans, record persistence, and the close-without-enqueue paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks – declared before importing the component under test
// ---------------------------------------------------------------------------

const mockEnqueue = vi.fn();
const mockProcessUpdate = vi.fn();
const mockReadTrustedBlob = vi.fn();
const mockCanvasGet = vi.fn();
const mockRemoteEnqueue = vi.fn();
const mockRemoteUpdate = vi.fn();
const mockRemoteReadTrustedBlob = vi.fn();
const mockRemoteCanvasGet = vi.fn();
// AC-04: provider/tier fetches from the remote target
const mockRemoteAgentProvidersList = vi.fn();
const mockRemoteAgentProvidersGetEffortTiers = vi.fn();

// Stable remote client so observing fns survive useCocClient's memo per baseUrl.
const remoteClient = {
    queue: { enqueue: mockRemoteEnqueue },
    processes: { patchMetadata: mockRemoteUpdate },
    explorer: { readTrustedBlob: mockRemoteReadTrustedBlob },
    canvases: { get: mockRemoteCanvasGet },
    agentProviders: {
        list: mockRemoteAgentProvidersList,
        getEffortTiers: mockRemoteAgentProvidersGetEffortTiers,
    },
};

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        queue: { enqueue: mockEnqueue },
        processes: { patchMetadata: mockProcessUpdate },
        explorer: { readTrustedBlob: mockReadTrustedBlob },
        canvases: { get: mockCanvasGet },
    }),
    getCocClientFor: (_baseUrl: string) => remoteClient,
    getSpaCocClientErrorMessage: (err: any, fallback: string) =>
        (err instanceof Error ? err.message : undefined) || fallback,
}));

// Shared AI selection is stubbed — the real hook does network fetches. Tests
// drive `resolved` directly to assert how it maps into the enqueue payload.
const mockModalSelection = vi.fn(() => ({ resolved: {} as Record<string, unknown> }));
vi.mock('../../../../../src/server/spa/client/react/shared/ModalJobAiControls', () => ({
    useModalJobAiSelection: (options: unknown) => mockModalSelection(options),
    ModalJobAiControls: ({ testIdPrefix = 'modal-job' }: { testIdPrefix?: string }) => (
        <div data-testid={`${testIdPrefix}-ai-controls`} />
    ),
}));

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import { ImplementPlanLaunchDialog } from '../../../../../src/server/spa/client/react/features/chat/ImplementPlanLaunchDialog';
import type { ImplementTarget } from '../../../../../src/server/spa/client/react/features/chat/ImplementPlanCard';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImplementPlanLaunchDialog', () => {
    const onClose = vi.fn();
    const onImplemented = vi.fn();
    const onRecordPersisted = vi.fn();
    const onSelectPlanFile = vi.fn();

    beforeEach(() => {
        mockEnqueue.mockReset();
        mockProcessUpdate.mockReset();
        mockReadTrustedBlob.mockReset();
        mockCanvasGet.mockReset();
        mockRemoteEnqueue.mockReset();
        mockRemoteUpdate.mockReset();
        mockRemoteReadTrustedBlob.mockReset();
        mockRemoteCanvasGet.mockReset();
        mockRemoteAgentProvidersList.mockReset();
        mockRemoteAgentProvidersGetEffortTiers.mockReset();
        // Default: return empty providers (success, no AI data) so existing tests unaffected.
        mockRemoteAgentProvidersList.mockResolvedValue({ providers: [] });
        mockRemoteAgentProvidersGetEffortTiers.mockResolvedValue({ effortTiers: {}, defaults: {} });
        // AC-01: the panel loads the plan preview on open. Give every reader a
        // default resolution so the preview resolves and Implement enables; tests
        // that assert on content override these per-case.
        mockReadTrustedBlob.mockResolvedValue({ content: '# Plan\nPreview body.', encoding: 'utf-8' });
        mockRemoteReadTrustedBlob.mockResolvedValue({ content: '# Plan\nRemote body.', encoding: 'utf-8' });
        mockCanvasGet.mockResolvedValue({ id: 'plan-1', title: 'My plan', content: '# Plan\nCanvas body.' });
        onClose.mockReset();
        onImplemented.mockReset();
        onRecordPersisted.mockReset();
        onSelectPlanFile.mockReset();
        mockModalSelection.mockReset();
        mockModalSelection.mockReturnValue({ resolved: {} });
    });

    const localTarget: ImplementTarget = {
        workspaceId: 'ws-local',
        label: 'my-app',
        isRemote: false,
        workingDirectory: '/repo',
    };
    const remoteTarget: ImplementTarget = {
        workspaceId: 'ws-remote',
        label: 'my-app',
        serverLabel: 'dev-vm',
        isRemote: true,
        baseUrl: 'http://127.0.0.1:4000',
        workingDirectory: '/remote/repo',
    };

    function renderDialog(props: Record<string, any> = {}) {
        return render(
            <ImplementPlanLaunchDialog
                open
                onClose={onClose}
                planFilePath="/repo/plan.md"
                selectedPlanFile="/repo/plan.md"
                onSelectPlanFile={onSelectPlanFile}
                workspaceId="ws-local"
                workingDirectory="/repo"
                onImplemented={onImplemented}
                {...props}
            />,
        );
    }

    /** Wait until the plan preview has loaded and Implement is enabled (AC-02). */
    async function waitReady() {
        await waitFor(() =>
            expect(screen.getByTestId('implement-launch-confirm-btn')).not.toBeDisabled(),
        );
    }

    // ── Rendering ───────────────────────────────────────────────────────

    it('renders nothing when open is false', () => {
        const { container } = renderDialog({ open: false });
        expect(container.innerHTML).toBe('');
    });

    it('renders the AI controls, a plan summary, and a confirm button', () => {
        renderDialog();
        expect(screen.getByTestId('implement-launch-dialog')).toBeTruthy();
        expect(screen.getByTestId('implement-launch-ai-controls')).toBeTruthy();
        expect(screen.getByTestId('implement-launch-summary').textContent).toBe('/repo/plan.md');
        expect(screen.getByTestId('implement-launch-confirm-btn')).toBeTruthy();
    });

    it('hides the target selector with fewer than two targets', () => {
        renderDialog({ availableTargets: [localTarget] });
        expect(screen.queryByTestId('implement-launch-target-select')).toBeNull();
    });

    it('shows the target selector with two or more targets, defaulting to the current repo', () => {
        renderDialog({ availableTargets: [localTarget, remoteTarget] });
        const select = screen.getByTestId('implement-launch-target-select') as HTMLSelectElement;
        expect(select.value).toBe('ws-local');
        expect(select.options.length).toBe(2);
    });

    it('shows the plan-file selector only with two or more plan files', () => {
        const { rerender } = renderDialog({ planFiles: ['/repo/plan.md'] });
        expect(screen.queryByTestId('implement-launch-file-select')).toBeNull();

        rerender(
            <ImplementPlanLaunchDialog
                open
                onClose={onClose}
                planFilePath="/repo/a.plan.md"
                planFiles={['/repo/a.plan.md', '/repo/b.plan.md']}
                selectedPlanFile="/repo/a.plan.md"
                onSelectPlanFile={onSelectPlanFile}
                workspaceId="ws-local"
                onImplemented={onImplemented}
            />,
        );
        const select = screen.getByTestId('implement-launch-file-select') as HTMLSelectElement;
        expect(select.value).toBe('/repo/a.plan.md');
        expect(Array.from(select.options).map(o => o.textContent)).toEqual(['a.plan.md', 'b.plan.md']);
    });

    it('reports plan-file selection changes to the banner', () => {
        renderDialog({
            planFilePath: '/repo/a.plan.md',
            planFiles: ['/repo/a.plan.md', '/repo/b.plan.md'],
            selectedPlanFile: '/repo/a.plan.md',
        });
        fireEvent.change(screen.getByTestId('implement-launch-file-select'), {
            target: { value: '/repo/b.plan.md' },
        });
        expect(onSelectPlanFile).toHaveBeenCalledWith('/repo/b.plan.md');
    });

    // ── Local enqueue + AI payload (AC-05) ───────────────────────────────

    it('enqueues a path-based local autopilot task on confirm', async () => {
        mockEnqueue.mockResolvedValue({ task: { id: 'task-abc' } });
        renderDialog();
        await waitReady();

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-launch-confirm-btn'));
        });

        await waitFor(() => expect(mockEnqueue).toHaveBeenCalledTimes(1));
        const payload = mockEnqueue.mock.calls[0][0];
        expect(payload.type).toBe('chat');
        expect(payload.payload.mode).toBe('autopilot');
        expect(payload.payload.workspaceId).toBe('ws-local');
        expect(payload.payload.workingDirectory).toBe('/repo');
        expect(payload.payload.context.files).toEqual(['/repo/plan.md']);
        expect(payload.payload.prompt).toBe('Read and implement the plan file at /repo/plan.md');
        await waitFor(() => expect(onImplemented).toHaveBeenCalledWith('queue_task-abc'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('carries an explicit provider + effort tier into the enqueue payload', async () => {
        mockModalSelection.mockReturnValue({ resolved: { provider: 'codex', effortTier: 'high' } });
        mockEnqueue.mockResolvedValue({ task: { id: 'task-ai' } });
        renderDialog();
        await waitReady();

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-launch-confirm-btn'));
        });

        await waitFor(() => expect(mockEnqueue).toHaveBeenCalledTimes(1));
        const arg = mockEnqueue.mock.calls[0][0];
        expect(arg.payload.provider).toBe('codex');
        expect(arg.config).toEqual({ effortTier: 'high' });
    });

    it('carries a legacy model + reasoning effort into the enqueue payload', async () => {
        mockModalSelection.mockReturnValue({
            resolved: { provider: 'copilot', model: 'gpt-5.3', reasoningEffort: 'high' },
        });
        mockEnqueue.mockResolvedValue({ task: { id: 'task-legacy' } });
        renderDialog();
        await waitReady();

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-launch-confirm-btn'));
        });

        await waitFor(() => expect(mockEnqueue).toHaveBeenCalledTimes(1));
        const arg = mockEnqueue.mock.calls[0][0];
        expect(arg.payload.provider).toBe('copilot');
        expect(arg.payload.model).toBe('gpt-5.3');
        expect(arg.payload.reasoningEffort).toBe('high');
        expect(arg.config).toBeUndefined();
    });

    it('marks auto provider routing in the enqueue context', async () => {
        mockModalSelection.mockReturnValue({ resolved: { effortTier: 'medium', autoProviderRouting: true } });
        mockEnqueue.mockResolvedValue({ task: { id: 'task-auto' } });
        renderDialog();
        await waitReady();

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-launch-confirm-btn'));
        });

        await waitFor(() => expect(mockEnqueue).toHaveBeenCalledTimes(1));
        const arg = mockEnqueue.mock.calls[0][0];
        expect(arg.payload.provider).toBeUndefined();
        expect(arg.payload.context.autoProviderRouting).toEqual({ requested: true });
        // Local runs still carry the plan-file context alongside the routing flag.
        expect(arg.payload.context.files).toEqual(['/repo/plan.md']);
        expect(arg.config).toEqual({ effortTier: 'medium' });
    });

    it('keys the shared AI selection off the selected target workspace', () => {
        renderDialog({ availableTargets: [localTarget, remoteTarget] });
        expect(mockModalSelection).toHaveBeenCalledWith(
            expect.objectContaining({ workspaceId: 'ws-local', mode: 'autopilot' }),
        );
    });

    // ── Remote routing ───────────────────────────────────────────────────

    it('routes a remote run to the target client with the plan content embedded', async () => {
        mockReadTrustedBlob.mockResolvedValue({ content: '# Plan\nDo the thing.', encoding: 'utf-8' });
        mockRemoteEnqueue.mockResolvedValue({ task: { id: 'task-remote' } });
        renderDialog({ availableTargets: [localTarget, remoteTarget] });
        await waitReady();

        await act(async () => {
            fireEvent.change(screen.getByTestId('implement-launch-target-select'), {
                target: { value: 'ws-remote' },
            });
        });
        await waitReady();
        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-launch-confirm-btn'));
        });

        await waitFor(() => expect(mockReadTrustedBlob).toHaveBeenCalledWith('/repo/plan.md'));
        await waitFor(() => expect(mockRemoteEnqueue).toHaveBeenCalledTimes(1));
        expect(mockEnqueue).not.toHaveBeenCalled();

        const payload = mockRemoteEnqueue.mock.calls[0][0];
        expect(payload.payload.workspaceId).toBe('ws-remote');
        expect(payload.payload.workingDirectory).toBe('/remote/repo');
        expect(payload.payload.context).toBeUndefined();
        expect(payload.payload.prompt).toContain('Do the thing.');
        expect(payload.payload.prompt).toContain('BEGIN PLAN');
        await waitFor(() => expect(onImplemented).toHaveBeenCalledWith('queue_task-remote'));
    });

    it('inlines a remote-sourced plan and routes to the source server', async () => {
        mockRemoteReadTrustedBlob.mockResolvedValue({ content: '# Plan\nRemote work.', encoding: 'utf-8' });
        mockRemoteEnqueue.mockResolvedValue({ task: { id: 'task-src-remote' } });
        renderDialog({
            planFilePath: '/home/u/.coc/x.plan.md',
            selectedPlanFile: '/home/u/.coc/x.plan.md',
            workspaceId: 'ws-remote',
            workingDirectory: '/home/u/repo',
            sourceIsRemote: true,
            sourceBaseUrl: 'http://127.0.0.1:4000',
        });
        await waitReady();

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-launch-confirm-btn'));
        });

        await waitFor(() => expect(mockRemoteReadTrustedBlob).toHaveBeenCalledWith('/home/u/.coc/x.plan.md'));
        await waitFor(() => expect(mockRemoteEnqueue).toHaveBeenCalledTimes(1));
        expect(mockEnqueue).not.toHaveBeenCalled();
        expect(mockReadTrustedBlob).not.toHaveBeenCalled();
        const payload = mockRemoteEnqueue.mock.calls[0][0];
        expect(payload.payload.context).toBeUndefined();
        expect(payload.payload.prompt).toContain('Remote work.');
    });

    // ── Canvas-backed plans ──────────────────────────────────────────────

    it('reads the canvas content and embeds it inline for a local run', async () => {
        mockCanvasGet.mockResolvedValue({ id: 'plan-1', title: 'My plan', content: '# Plan\nCanvas work.' });
        mockEnqueue.mockResolvedValue({ task: { id: 'task-canvas' } });
        renderDialog({ planFilePath: 'My plan', selectedPlanFile: 'My plan', planCanvasId: 'plan-1' });
        await waitReady();

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-launch-confirm-btn'));
        });

        await waitFor(() => expect(mockCanvasGet).toHaveBeenCalledWith('ws-local', 'plan-1'));
        expect(mockReadTrustedBlob).not.toHaveBeenCalled();
        await waitFor(() => expect(mockEnqueue).toHaveBeenCalledTimes(1));
        const payload = mockEnqueue.mock.calls[0][0];
        expect(payload.payload.context).toBeUndefined();
        expect(payload.payload.prompt).toContain('Canvas work.');
        expect(payload.payload.prompt).toContain('My plan');
    });

    // ── Record persistence (AC-05) ───────────────────────────────────────

    it('persists an implementation record with the chosen AI selection', async () => {
        mockModalSelection.mockReturnValue({ resolved: { provider: 'codex', effortTier: 'high' } });
        mockEnqueue.mockResolvedValue({ task: { id: 'task-new' } });
        mockProcessUpdate.mockResolvedValue({ process: {} });
        renderDialog({
            sourceProcessId: 'queue_source-1',
            sourceMetadata: { type: 'chat' },
            onRecordPersisted,
        });
        await waitReady();

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-launch-confirm-btn'));
        });

        await waitFor(() => expect(mockProcessUpdate).toHaveBeenCalledTimes(1));
        const [pid, patch] = mockProcessUpdate.mock.calls[0];
        expect(pid).toBe('queue_source-1');
        const rec = patch.set.implementations[0];
        expect(rec.processId).toBe('queue_task-new');
        expect(rec.planFilePath).toBe('/repo/plan.md');
        expect(rec.provider).toBe('codex');
        expect(rec.effortTier).toBe('high');
        expect(onRecordPersisted).toHaveBeenCalledTimes(1);
    });

    it('records remote target identity via the source client', async () => {
        mockReadTrustedBlob.mockResolvedValue({ content: 'plan body', encoding: 'utf-8' });
        mockRemoteEnqueue.mockResolvedValue({ task: { id: 'task-remote' } });
        mockProcessUpdate.mockResolvedValue({ process: {} });
        renderDialog({
            sourceProcessId: 'queue_source-1',
            sourceMetadata: { type: 'chat' },
            onRecordPersisted,
            availableTargets: [localTarget, remoteTarget],
        });
        await waitReady();

        await act(async () => {
            fireEvent.change(screen.getByTestId('implement-launch-target-select'), {
                target: { value: 'ws-remote' },
            });
        });
        await waitReady();
        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-launch-confirm-btn'));
        });

        await waitFor(() => expect(mockProcessUpdate).toHaveBeenCalledTimes(1));
        expect(mockRemoteUpdate).not.toHaveBeenCalled();
        const rec = mockProcessUpdate.mock.calls[0][1].set.implementations[0];
        expect(rec.isRemoteTarget).toBe(true);
        expect(rec.targetWorkspaceId).toBe('ws-remote');
        expect(rec.targetServerLabel).toBe('dev-vm');
    });

    it('still navigates and closes even if persistence fails', async () => {
        mockEnqueue.mockResolvedValue({ task: { id: 'task-ok' } });
        mockProcessUpdate.mockRejectedValue(new Error('Server error'));
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        renderDialog({ sourceProcessId: 'queue_source-1', sourceMetadata: {}, onRecordPersisted });
        await waitReady();

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-launch-confirm-btn'));
        });

        await waitFor(() => expect(onImplemented).toHaveBeenCalledWith('queue_task-ok'));
        expect(onRecordPersisted).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);
        consoleSpy.mockRestore();
    });

    // ── Error + close-without-enqueue paths (AC-01) ───────────────────────

    it('shows an error and stays open when enqueue fails', async () => {
        mockEnqueue.mockRejectedValue(new Error('Network down'));
        renderDialog();
        await waitReady();

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-launch-confirm-btn'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('implement-launch-error').textContent).toContain('Network down');
        });
        expect(onImplemented).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('closes without enqueuing on Cancel', () => {
        renderDialog();
        fireEvent.click(screen.getByText('Cancel'));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('closes without enqueuing on Escape', () => {
        renderDialog();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('closes without enqueuing via the header close button', () => {
        renderDialog();
        fireEvent.click(screen.getByLabelText('Close'));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('renders as an inline panel, not a fixed modal overlay', () => {
        renderDialog();
        const panel = screen.getByTestId('implement-launch-dialog');
        expect(panel.className).not.toContain('fixed');
        expect(panel.className).not.toContain('inset-0');
    });

    // ── AC-04: remote-target provider/tier resolution ────────────────────

    it('fetches providers and effort tiers from the remote client when a remote target is selected (AC-04-a)', async () => {
        mockRemoteAgentProvidersList.mockResolvedValue({
            providers: [
                { id: 'codex', label: 'Codex', enabled: true, available: true },
                { id: 'copilot', label: 'Copilot', enabled: true, available: true },
            ],
        });
        mockRemoteAgentProvidersGetEffortTiers.mockResolvedValue({
            effortTiers: { medium: { model: 'gpt-4o', reasoningEffort: null, source: 'default' } },
            defaults: {},
        });

        renderDialog({ availableTargets: [localTarget, remoteTarget] });

        await act(async () => {
            fireEvent.change(screen.getByTestId('implement-launch-target-select'), {
                target: { value: 'ws-remote' },
            });
        });

        await waitFor(() => expect(mockRemoteAgentProvidersList).toHaveBeenCalledTimes(1));

        // The hook must have been called with the externally-fetched providers from the remote server.
        const calls = mockModalSelection.mock.calls;
        const lastOptions = calls[calls.length - 1][0] as Record<string, unknown>;
        expect(Array.isArray(lastOptions.externalAgentProviders)).toBe(true);
        expect((lastOptions.externalAgentProviders as any[]).length).toBeGreaterThan(0);
        expect(lastOptions.externalEffortTierMap).toBeDefined();
    });

    it('disables AI controls with a hint when the remote target server is unreachable (AC-04-b)', async () => {
        mockRemoteAgentProvidersList.mockRejectedValue(new Error('ECONNREFUSED'));

        renderDialog({ availableTargets: [localTarget, remoteTarget] });

        await act(async () => {
            fireEvent.change(screen.getByTestId('implement-launch-target-select'), {
                target: { value: 'ws-remote' },
            });
        });

        await waitFor(() => {
            expect(screen.getByTestId('implement-launch-remote-ai-unavailable')).toBeTruthy();
        });
        expect(screen.getByTestId('implement-launch-remote-ai-unavailable').textContent).toContain(
            'Cannot reach target server',
        );
        // AI controls hidden; Implement button must remain enabled.
        expect(screen.queryByTestId('implement-launch-ai-controls')).toBeNull();
        expect(screen.getByTestId('implement-launch-confirm-btn')).not.toBeDisabled();
    });

    // ── AC-01: plan content preview ──────────────────────────────────────

    it('shows the exact local plan-file content in a read-only preview (AC-01-1)', async () => {
        mockReadTrustedBlob.mockResolvedValue({ content: '# Plan A\nStep one.\nStep two.', encoding: 'utf-8' });
        renderDialog();

        await waitFor(() =>
            expect((screen.getByTestId('implement-launch-preview') as HTMLTextAreaElement).value)
                .toBe('# Plan A\nStep one.\nStep two.'),
        );
        expect(mockReadTrustedBlob).toHaveBeenCalledWith('/repo/plan.md');
        // Compact provenance remains visible alongside the content.
        expect(screen.getByTestId('implement-launch-summary').textContent).toBe('/repo/plan.md');
    });

    it('decodes base64 blob content for the preview', async () => {
        mockReadTrustedBlob.mockResolvedValue({ content: btoa('# Encoded plan'), encoding: 'base64' });
        renderDialog();

        await waitFor(() =>
            expect((screen.getByTestId('implement-launch-preview') as HTMLTextAreaElement).value)
                .toBe('# Encoded plan'),
        );
    });

    it('reloads the preview when the selected plan file changes (AC-01-1)', async () => {
        mockReadTrustedBlob.mockImplementation((path: string) =>
            Promise.resolve({
                content: path === '/repo/a.plan.md' ? 'Content of A' : 'Content of B',
                encoding: 'utf-8',
            }),
        );
        const { rerender } = renderDialog({
            planFilePath: '/repo/a.plan.md',
            planFiles: ['/repo/a.plan.md', '/repo/b.plan.md'],
            selectedPlanFile: '/repo/a.plan.md',
        });

        await waitFor(() =>
            expect((screen.getByTestId('implement-launch-preview') as HTMLTextAreaElement).value)
                .toBe('Content of A'),
        );

        rerender(
            <ImplementPlanLaunchDialog
                open
                onClose={onClose}
                planFilePath="/repo/a.plan.md"
                planFiles={['/repo/a.plan.md', '/repo/b.plan.md']}
                selectedPlanFile="/repo/b.plan.md"
                onSelectPlanFile={onSelectPlanFile}
                workspaceId="ws-local"
                onImplemented={onImplemented}
            />,
        );

        await waitFor(() =>
            expect((screen.getByTestId('implement-launch-preview') as HTMLTextAreaElement).value)
                .toBe('Content of B'),
        );
    });

    it('shows the exact canvas content and its label in the preview (AC-01-2)', async () => {
        mockCanvasGet.mockResolvedValue({ id: 'plan-1', title: 'My plan', content: '# Canvas plan\nbody' });
        renderDialog({ planFilePath: 'My plan', selectedPlanFile: 'My plan', planCanvasId: 'plan-1' });

        await waitFor(() =>
            expect((screen.getByTestId('implement-launch-preview') as HTMLTextAreaElement).value)
                .toBe('# Canvas plan\nbody'),
        );
        expect(mockCanvasGet).toHaveBeenCalledWith('ws-local', 'plan-1');
        expect(mockReadTrustedBlob).not.toHaveBeenCalled();
        // The label (planFilePath) is the provenance for a canvas-backed plan.
        expect(screen.getByTestId('implement-launch-summary').textContent).toBe('My plan');
    });

    it('renders the preview as a read-only, multiline, vertically-resizable textarea (AC-01-3)', async () => {
        renderDialog();
        await waitFor(() => expect(screen.getByTestId('implement-launch-preview')).toBeTruthy());
        const preview = screen.getByTestId('implement-launch-preview') as HTMLTextAreaElement;
        expect(preview.tagName).toBe('TEXTAREA');
        expect(preview.readOnly).toBe(true);
        expect(preview.rows).toBeGreaterThan(1);
        expect(preview.className).toContain('resize-y');
        // The old single-line, path-only summary block is gone.
        expect(screen.queryByTestId('implement-launch-preview-loading')).toBeNull();
    });

    // ── AC-02: source-safe, race-safe loading ────────────────────────────

    it('reads a remote-source preview via the remote reader, never the local reader (AC-02-1)', async () => {
        mockRemoteReadTrustedBlob.mockResolvedValue({ content: 'remote plan text', encoding: 'utf-8' });
        renderDialog({
            planFilePath: '/home/u/.coc/x.plan.md',
            selectedPlanFile: '/home/u/.coc/x.plan.md',
            workspaceId: 'ws-remote',
            sourceIsRemote: true,
            sourceBaseUrl: 'http://127.0.0.1:4000',
        });

        await waitFor(() =>
            expect((screen.getByTestId('implement-launch-preview') as HTMLTextAreaElement).value)
                .toBe('remote plan text'),
        );
        expect(mockRemoteReadTrustedBlob).toHaveBeenCalledWith('/home/u/.coc/x.plan.md');
        expect(mockReadTrustedBlob).not.toHaveBeenCalled();
    });

    it('shows a loading state and disables Implement until the preview resolves (AC-02-2)', async () => {
        let resolveRead: (v: any) => void = () => {};
        mockReadTrustedBlob.mockReturnValue(new Promise((r) => { resolveRead = r; }));
        renderDialog();

        expect(screen.getByTestId('implement-launch-preview-loading')).toBeTruthy();
        expect(screen.getByTestId('implement-launch-confirm-btn')).toBeDisabled();

        await act(async () => {
            resolveRead({ content: 'loaded', encoding: 'utf-8' });
        });

        await waitFor(() => expect(screen.getByTestId('implement-launch-confirm-btn')).not.toBeDisabled());
        expect(screen.queryByTestId('implement-launch-preview-loading')).toBeNull();
    });

    it('shows a read error, enqueues nothing, and retries on reopen (AC-02-2)', async () => {
        mockReadTrustedBlob.mockRejectedValueOnce(new Error('boom'));
        const { rerender } = renderDialog();

        await waitFor(() =>
            expect(screen.getByTestId('implement-launch-preview-error').textContent).toContain('boom'),
        );
        expect(screen.getByTestId('implement-launch-confirm-btn')).toBeDisabled();

        // Clicking the disabled button enqueues nothing and leaves the panel open.
        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-launch-confirm-btn'));
        });
        expect(mockEnqueue).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();

        // Reopen: the effect reruns on `open` and the now-successful read resolves.
        mockReadTrustedBlob.mockResolvedValue({ content: 'recovered', encoding: 'utf-8' });
        rerender(
            <ImplementPlanLaunchDialog
                open={false}
                onClose={onClose}
                planFilePath="/repo/plan.md"
                selectedPlanFile="/repo/plan.md"
                onSelectPlanFile={onSelectPlanFile}
                workspaceId="ws-local"
                workingDirectory="/repo"
                onImplemented={onImplemented}
            />,
        );
        rerender(
            <ImplementPlanLaunchDialog
                open
                onClose={onClose}
                planFilePath="/repo/plan.md"
                selectedPlanFile="/repo/plan.md"
                onSelectPlanFile={onSelectPlanFile}
                workspaceId="ws-local"
                workingDirectory="/repo"
                onImplemented={onImplemented}
            />,
        );

        await waitFor(() =>
            expect((screen.getByTestId('implement-launch-preview') as HTMLTextAreaElement).value)
                .toBe('recovered'),
        );
    });

    it('does not let a stale first-file response overwrite the newer selection (AC-02-3)', async () => {
        let resolveA: (v: any) => void = () => {};
        mockReadTrustedBlob.mockImplementation((path: string) => {
            if (path === '/repo/a.plan.md') return new Promise((r) => { resolveA = r; });
            return Promise.resolve({ content: 'Content of B', encoding: 'utf-8' });
        });
        const { rerender } = renderDialog({
            planFilePath: '/repo/a.plan.md',
            planFiles: ['/repo/a.plan.md', '/repo/b.plan.md'],
            selectedPlanFile: '/repo/a.plan.md',
        });

        // Switch to B before A's (deferred) read resolves.
        rerender(
            <ImplementPlanLaunchDialog
                open
                onClose={onClose}
                planFilePath="/repo/a.plan.md"
                planFiles={['/repo/a.plan.md', '/repo/b.plan.md']}
                selectedPlanFile="/repo/b.plan.md"
                onSelectPlanFile={onSelectPlanFile}
                workspaceId="ws-local"
                onImplemented={onImplemented}
            />,
        );

        await waitFor(() =>
            expect((screen.getByTestId('implement-launch-preview') as HTMLTextAreaElement).value)
                .toBe('Content of B'),
        );

        // A's late response must be ignored — B's preview stays.
        await act(async () => {
            resolveA({ content: 'STALE Content of A', encoding: 'utf-8' });
        });
        expect((screen.getByTestId('implement-launch-preview') as HTMLTextAreaElement).value).toBe('Content of B');
    });
});
