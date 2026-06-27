/**
 * @vitest-environment jsdom
 *
 * Tests for ImplementPlanCard — verifies enqueue payload, navigation handoff,
 * disabled / submitted states, existing-runs banner, and persistence.
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

// Stable remote client so observing fns survive useCocClient's memo per baseUrl.
const remoteClient = {
    queue: { enqueue: mockRemoteEnqueue },
    processes: { patchMetadata: mockRemoteUpdate },
    explorer: { readTrustedBlob: mockRemoteReadTrustedBlob },
    canvases: { get: mockRemoteCanvasGet },
};

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        queue: { enqueue: mockEnqueue },
        processes: { patchMetadata: mockProcessUpdate },
        explorer: { readTrustedBlob: mockReadTrustedBlob },
        canvases: { get: mockCanvasGet },
    }),
    // Routed remote client (remote target → baseUrl → getCocClientFor).
    getCocClientFor: (_baseUrl: string) => remoteClient,
    getSpaCocClientErrorMessage: (err: any, fallback: string) =>
        (err instanceof Error ? err.message : undefined) || fallback,
}));

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import { ImplementPlanCard } from '../../../../../src/server/spa/client/react/features/chat/ImplementPlanCard';
import type { ExistingRun, ImplementTarget } from '../../../../../src/server/spa/client/react/features/chat/ImplementPlanCard';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImplementPlanCard', () => {
    const onImplemented = vi.fn();
    const onViewRun = vi.fn();
    const onRecordPersisted = vi.fn();

    beforeEach(() => {
        mockEnqueue.mockReset();
        mockProcessUpdate.mockReset();
        mockReadTrustedBlob.mockReset();
        mockCanvasGet.mockReset();
        mockRemoteEnqueue.mockReset();
        mockRemoteUpdate.mockReset();
        mockRemoteReadTrustedBlob.mockReset();
        mockRemoteCanvasGet.mockReset();
        onImplemented.mockReset();
        onViewRun.mockReset();
        onRecordPersisted.mockReset();
    });

    // Local current repo + one online remote clone.
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

    // ── Existing tests (no-runs / baseline) ────────────────────────────

    it('renders the plan path and CTA button', () => {
        render(
            <ImplementPlanCard
                planFilePath="/repo/.vscode/tasks/feature.plan.md"
                workspaceId="ws-1"
                workingDirectory="/repo"
                onImplemented={onImplemented}
            />,
        );
        expect(screen.getByTestId('implement-plan-card')).toBeTruthy();
        const btn = screen.getByTestId('implement-plan-card-btn') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
        expect(btn.textContent).toContain('Implement');
        expect(screen.getByText('/repo/.vscode/tasks/feature.plan.md')).toBeTruthy();
    });

    it('renders unchanged when no prior runs exist (no status pill)', () => {
        render(
            <ImplementPlanCard
                planFilePath="/repo/plan.md"
                onImplemented={onImplemented}
                existingRuns={[]}
            />,
        );
        expect(screen.queryByTestId('implement-plan-card-status-pill')).toBeNull();
        expect(screen.getByTestId('implement-plan-card-btn').textContent).toContain('Implement →');
    });

    it('enqueues an autopilot chat task with the plan file path', async () => {
        mockEnqueue.mockResolvedValue({ task: { id: 'task-abc' } });

        render(
            <ImplementPlanCard
                planFilePath="/repo/.vscode/tasks/feature.plan.md"
                workspaceId="ws-1"
                workingDirectory="/repo"
                onImplemented={onImplemented}
            />,
        );

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        });

        await waitFor(() => {
            expect(mockEnqueue).toHaveBeenCalledTimes(1);
        });

        const payload = mockEnqueue.mock.calls[0][0];
        expect(payload.type).toBe('chat');
        expect(payload.priority).toBe('normal');
        expect(payload.payload.kind).toBe('chat');
        expect(payload.payload.mode).toBe('autopilot');
        expect(payload.payload.workspaceId).toBe('ws-1');
        expect(payload.payload.workingDirectory).toBe('/repo');
        expect(payload.payload.context.files).toEqual(['/repo/.vscode/tasks/feature.plan.md']);
        expect(payload.payload.prompt).toContain('/repo/.vscode/tasks/feature.plan.md');
    });

    it('navigates via onImplemented with a queue_-prefixed processId', async () => {
        mockEnqueue.mockResolvedValue({ task: { id: 'task-xyz' } });

        render(
            <ImplementPlanCard
                planFilePath="/p.md"
                workspaceId="ws-1"
                onImplemented={onImplemented}
            />,
        );

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        });

        await waitFor(() => {
            expect(onImplemented).toHaveBeenCalledTimes(1);
        });
        const id = onImplemented.mock.calls[0][0];
        expect(id).toBe('queue_task-xyz');
    });

    it('passes through an already-prefixed queue process id unchanged', async () => {
        mockEnqueue.mockResolvedValue({ task: { id: 'queue_existing-id' } });

        render(<ImplementPlanCard planFilePath="/p.md" onImplemented={onImplemented} />);

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        });

        await waitFor(() => {
            expect(onImplemented).toHaveBeenCalledWith('queue_existing-id');
        });
    });

    it('marks the button as submitted after success and prevents re-clicks', async () => {
        mockEnqueue.mockResolvedValue({ task: { id: 'task-1' } });

        render(<ImplementPlanCard planFilePath="/p.md" onImplemented={onImplemented} />);

        const btn = screen.getByTestId('implement-plan-card-btn') as HTMLButtonElement;
        await act(async () => {
            fireEvent.click(btn);
        });

        await waitFor(() => {
            expect(btn.disabled).toBe(true);
            expect(btn.textContent).toContain('Implementing');
        });

        // Second click is a no-op
        await act(async () => {
            fireEvent.click(btn);
        });
        expect(mockEnqueue).toHaveBeenCalledTimes(1);
    });

    it('shows an error message and stays enabled when enqueue fails', async () => {
        mockEnqueue.mockRejectedValue(new Error('Network down'));

        render(<ImplementPlanCard planFilePath="/p.md" onImplemented={onImplemented} />);

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('implement-plan-card-error').textContent).toContain('Network down');
        });

        const btn = screen.getByTestId('implement-plan-card-btn') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
        expect(onImplemented).not.toHaveBeenCalled();
    });

    // ── New tests: existing runs banner ────────────────────────────────

    it('renders a status chip when a single completed run exists', () => {
        const runs: ExistingRun[] = [{
            processId: 'queue_impl-1',
            planFilePath: '/plan.md',
            enqueuedAt: new Date(Date.now() - 300000).toISOString(), // 5 min ago
            liveStatus: 'completed',
        }];

        render(
            <ImplementPlanCard
                planFilePath="/plan.md"
                onImplemented={onImplemented}
                existingRuns={runs}
                onViewRun={onViewRun}
            />,
        );

        const pill = screen.getByTestId('implement-plan-card-status-pill');
        expect(pill.textContent).toContain('Completed');
        expect(screen.getByTestId('implement-plan-card-view-btn')).toBeTruthy();
    });

    it('shows "Implement again" with secondary style when latest run is active', () => {
        const runs: ExistingRun[] = [{
            processId: 'queue_impl-1',
            planFilePath: '/plan.md',
            enqueuedAt: new Date().toISOString(),
            liveStatus: 'running',
        }];

        render(
            <ImplementPlanCard
                planFilePath="/plan.md"
                onImplemented={onImplemented}
                existingRuns={runs}
                onViewRun={onViewRun}
            />,
        );

        const btn = screen.getByTestId('implement-plan-card-btn') as HTMLButtonElement;
        expect(btn.textContent).toContain('Implement again');
        expect(btn.title).toContain('already running');
        // Secondary style: border instead of bg-blue-600
        expect(btn.className).toContain('border');
    });

    it('shows run count and expandable list for multiple runs', () => {
        const runs: ExistingRun[] = [
            { processId: 'queue_impl-1', planFilePath: '/p.md', enqueuedAt: new Date(Date.now() - 600000).toISOString(), liveStatus: 'failed' },
            { processId: 'queue_impl-2', planFilePath: '/p.md', enqueuedAt: new Date().toISOString(), liveStatus: 'running' },
        ];

        render(
            <ImplementPlanCard
                planFilePath="/p.md"
                onImplemented={onImplemented}
                existingRuns={runs}
                onViewRun={onViewRun}
            />,
        );

        // Status chip shows latest run (running); title tooltip has the run count
        const pill = screen.getByTestId('implement-plan-card-status-pill');
        expect(pill.textContent).toContain('Running');
        expect(pill.getAttribute('title')).toContain('2 runs total');

        // Expandable button exists
        const expandBtn = screen.getByTestId('implement-plan-card-expand-btn');
        expect(expandBtn.textContent).toContain('Show all 2 runs');

        // List not visible until expanded
        expect(screen.queryByTestId('implement-plan-card-run-list')).toBeNull();

        // Expand
        fireEvent.click(expandBtn);
        expect(screen.getByTestId('implement-plan-card-run-list')).toBeTruthy();
    });

    it('navigates via onViewRun when View button is clicked', () => {
        const runs: ExistingRun[] = [{
            processId: 'queue_impl-42',
            planFilePath: '/p.md',
            enqueuedAt: new Date().toISOString(),
            liveStatus: 'completed',
        }];

        render(
            <ImplementPlanCard
                planFilePath="/p.md"
                onImplemented={onImplemented}
                existingRuns={runs}
                onViewRun={onViewRun}
            />,
        );

        fireEvent.click(screen.getByTestId('implement-plan-card-view-btn'));
        expect(onViewRun).toHaveBeenCalledWith('queue_impl-42', undefined);
    });

    it('persists implementation record after successful enqueue', async () => {
        mockEnqueue.mockResolvedValue({ task: { id: 'task-new' } });
        mockProcessUpdate.mockResolvedValue({ process: {} });

        render(
            <ImplementPlanCard
                planFilePath="/plan.md"
                workspaceId="ws-1"
                onImplemented={onImplemented}
                sourceProcessId="queue_source-1"
                sourceMetadata={{ type: 'chat', workspaceId: 'ws-1' }}
                onRecordPersisted={onRecordPersisted}
            />,
        );

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        });

        await waitFor(() => {
            expect(mockProcessUpdate).toHaveBeenCalledTimes(1);
        });

        const [pid, patch] = mockProcessUpdate.mock.calls[0];
        expect(pid).toBe('queue_source-1');
        const impls = patch.set.implementations;
        expect(impls).toHaveLength(1);
        expect(impls[0].processId).toBe('queue_task-new');
        expect(impls[0].planFilePath).toBe('/plan.md');
        expect(impls[0].enqueuedAt).toBeTruthy();

        // onRecordPersisted should be called
        expect(onRecordPersisted).toHaveBeenCalledTimes(1);

        // onImplemented should still be called
        expect(onImplemented).toHaveBeenCalledWith('queue_task-new');
    });

    it('appends to existing implementations without overwriting', async () => {
        mockEnqueue.mockResolvedValue({ task: { id: 'task-second' } });
        mockProcessUpdate.mockResolvedValue({ process: {} });

        const existingImpls = [
            { processId: 'queue_first', planFilePath: '/plan.md', enqueuedAt: '2026-01-01T00:00:00Z' },
        ];

        render(
            <ImplementPlanCard
                planFilePath="/plan.md"
                onImplemented={onImplemented}
                sourceProcessId="queue_source-1"
                sourceMetadata={{ type: 'chat', implementations: existingImpls }}
                onRecordPersisted={onRecordPersisted}
            />,
        );

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        });

        await waitFor(() => {
            expect(mockProcessUpdate).toHaveBeenCalledTimes(1);
        });

        const impls = mockProcessUpdate.mock.calls[0][1].set.implementations;
        expect(impls).toHaveLength(2);
        expect(impls[0].processId).toBe('queue_first');
        expect(impls[1].processId).toBe('queue_task-second');
    });

    it('still navigates even if persistence fails', async () => {
        mockEnqueue.mockResolvedValue({ task: { id: 'task-ok' } });
        mockProcessUpdate.mockRejectedValue(new Error('Server error'));
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        render(
            <ImplementPlanCard
                planFilePath="/plan.md"
                onImplemented={onImplemented}
                sourceProcessId="queue_source-1"
                sourceMetadata={{}}
                onRecordPersisted={onRecordPersisted}
            />,
        );

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        });

        await waitFor(() => {
            expect(onImplemented).toHaveBeenCalledWith('queue_task-ok');
        });

        // Persistence failed but navigation succeeded
        expect(onRecordPersisted).not.toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('does not show tooltip when no active run', () => {
        const runs: ExistingRun[] = [{
            processId: 'queue_impl-1',
            planFilePath: '/p.md',
            enqueuedAt: new Date().toISOString(),
            liveStatus: 'completed',
        }];

        render(
            <ImplementPlanCard
                planFilePath="/p.md"
                onImplemented={onImplemented}
                existingRuns={runs}
            />,
        );

        const btn = screen.getByTestId('implement-plan-card-btn') as HTMLButtonElement;
        expect(btn.title).toBeFalsy();
    });

    // ── Target selector (AC-01, AC-02, AC-06) ───────────────────────────

    it('hides the target selector when fewer than two targets are available', () => {
        render(
            <ImplementPlanCard
                planFilePath="/repo/plan.md"
                workspaceId="ws-local"
                onImplemented={onImplemented}
                availableTargets={[localTarget]}
            />,
        );
        expect(screen.queryByTestId('implement-plan-card-target')).toBeNull();
    });

    it('hides the target selector when no targets are supplied (local-only gating)', () => {
        render(
            <ImplementPlanCard
                planFilePath="/repo/plan.md"
                workspaceId="ws-local"
                onImplemented={onImplemented}
            />,
        );
        expect(screen.queryByTestId('implement-plan-card-target')).toBeNull();
    });

    it('shows the selector defaulting to the current repo when remote targets exist', () => {
        render(
            <ImplementPlanCard
                planFilePath="/repo/plan.md"
                workspaceId="ws-local"
                workingDirectory="/repo"
                onImplemented={onImplemented}
                availableTargets={[localTarget, remoteTarget]}
            />,
        );
        const select = screen.getByTestId('implement-plan-card-target-select') as HTMLSelectElement;
        expect(select).toBeTruthy();
        // Defaults to the current repo so one-click local behavior is unchanged.
        expect(select.value).toBe('ws-local');
        // Both reachable targets are listed.
        expect(select.options.length).toBe(2);
        expect(screen.getByText('my-app (current)')).toBeTruthy();
        expect(screen.getByText('my-app · dev-vm')).toBeTruthy();
    });

    it('keeps the path-based local enqueue when the current repo stays selected', async () => {
        mockEnqueue.mockResolvedValue({ task: { id: 'task-local' } });

        render(
            <ImplementPlanCard
                planFilePath="/repo/plan.md"
                workspaceId="ws-local"
                workingDirectory="/repo"
                onImplemented={onImplemented}
                availableTargets={[localTarget, remoteTarget]}
            />,
        );

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        });

        await waitFor(() => expect(mockEnqueue).toHaveBeenCalledTimes(1));
        // Remote client untouched; plan content never read for local runs.
        expect(mockRemoteEnqueue).not.toHaveBeenCalled();
        expect(mockReadTrustedBlob).not.toHaveBeenCalled();

        const payload = mockEnqueue.mock.calls[0][0];
        expect(payload.payload.workspaceId).toBe('ws-local');
        expect(payload.payload.workingDirectory).toBe('/repo');
        expect(payload.payload.context.files).toEqual(['/repo/plan.md']);
        expect(payload.payload.prompt).toBe('Read and implement the plan file at /repo/plan.md');
    });

    // ── Remote routing + plan-content embedding (AC-03, AC-04) ──────────

    it('routes a remote run to the target client with the plan content embedded', async () => {
        mockReadTrustedBlob.mockResolvedValue({
            content: '# Plan\nDo the thing.',
            encoding: 'utf-8',
            mimeType: 'text/markdown',
        });
        mockRemoteEnqueue.mockResolvedValue({ task: { id: 'task-remote' } });

        render(
            <ImplementPlanCard
                planFilePath="/repo/plan.md"
                workspaceId="ws-local"
                workingDirectory="/repo"
                onImplemented={onImplemented}
                availableTargets={[localTarget, remoteTarget]}
            />,
        );

        // Select the remote clone.
        await act(async () => {
            fireEvent.change(screen.getByTestId('implement-plan-card-target-select'), {
                target: { value: 'ws-remote' },
            });
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        });

        // Plan content is read on the initiating (source) server.
        await waitFor(() => expect(mockReadTrustedBlob).toHaveBeenCalledWith('/repo/plan.md'));
        // Enqueue is routed to the remote client, not the local one.
        await waitFor(() => expect(mockRemoteEnqueue).toHaveBeenCalledTimes(1));
        expect(mockEnqueue).not.toHaveBeenCalled();

        const payload = mockRemoteEnqueue.mock.calls[0][0];
        expect(payload.payload.workspaceId).toBe('ws-remote');
        expect(payload.payload.workingDirectory).toBe('/remote/repo');
        // No local file reference on the remote machine.
        expect(payload.payload.context).toBeUndefined();
        // Plan content is inlined.
        expect(payload.payload.prompt).toContain('Do the thing.');
        expect(payload.payload.prompt).toContain('BEGIN PLAN');
        expect(payload.payload.prompt).toContain('/repo/plan.md');

        // Navigation handoff uses the remote task id.
        await waitFor(() => expect(onImplemented).toHaveBeenCalledWith('queue_task-remote'));
    });

    // ── Canvas-backed plans (purpose: 'plan') ───────────────────────────

    it('reads the canvas content and embeds it inline for a local run', async () => {
        mockCanvasGet.mockResolvedValue({ id: 'plan-abc123', title: 'My plan', content: '# Plan\nDo canvas work.' });
        mockEnqueue.mockResolvedValue({ task: { id: 'task-canvas' } });

        render(
            <ImplementPlanCard
                planFilePath="My plan"
                planCanvasId="plan-abc123"
                workspaceId="ws-local"
                workingDirectory="/repo"
                onImplemented={onImplemented}
            />,
        );

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        });

        // Canvas content is read from the source server by id.
        await waitFor(() => expect(mockCanvasGet).toHaveBeenCalledWith('ws-local', 'plan-abc123'));
        // No file read — the plan has no on-disk path.
        expect(mockReadTrustedBlob).not.toHaveBeenCalled();
        await waitFor(() => expect(mockEnqueue).toHaveBeenCalledTimes(1));

        const payload = mockEnqueue.mock.calls[0][0];
        // Inlined content, no local file context.
        expect(payload.payload.context).toBeUndefined();
        expect(payload.payload.prompt).toContain('Do canvas work.');
        expect(payload.payload.prompt).toContain('BEGIN PLAN');
        expect(payload.payload.prompt).toContain('My plan');

        await waitFor(() => expect(onImplemented).toHaveBeenCalledWith('queue_task-canvas'));
    });

    it('reads the canvas on the source server and routes a remote canvas-backed run', async () => {
        mockCanvasGet.mockResolvedValue({ id: 'plan-abc123', title: 'My plan', content: '# Plan\nRemote canvas work.' });
        mockRemoteEnqueue.mockResolvedValue({ task: { id: 'task-remote-canvas' } });

        render(
            <ImplementPlanCard
                planFilePath="My plan"
                planCanvasId="plan-abc123"
                workspaceId="ws-local"
                workingDirectory="/repo"
                onImplemented={onImplemented}
                availableTargets={[localTarget, remoteTarget]}
            />,
        );

        await act(async () => {
            fireEvent.change(screen.getByTestId('implement-plan-card-target-select'), {
                target: { value: 'ws-remote' },
            });
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        });

        // Content read on the SOURCE client; enqueue routed to the REMOTE client.
        await waitFor(() => expect(mockCanvasGet).toHaveBeenCalledWith('ws-local', 'plan-abc123'));
        expect(mockRemoteCanvasGet).not.toHaveBeenCalled();
        await waitFor(() => expect(mockRemoteEnqueue).toHaveBeenCalledTimes(1));
        expect(mockEnqueue).not.toHaveBeenCalled();

        const payload = mockRemoteEnqueue.mock.calls[0][0];
        expect(payload.payload.workspaceId).toBe('ws-remote');
        expect(payload.payload.context).toBeUndefined();
        expect(payload.payload.prompt).toContain('Remote canvas work.');
    });

    it('surfaces an error and does not enqueue when the canvas read fails', async () => {
        mockCanvasGet.mockRejectedValue(new Error('canvas gone'));

        render(
            <ImplementPlanCard
                planFilePath="My plan"
                planCanvasId="plan-abc123"
                workspaceId="ws-local"
                onImplemented={onImplemented}
            />,
        );

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('implement-plan-card-error').textContent)
                .toContain('Could not read the plan canvas');
        });
        expect(mockEnqueue).not.toHaveBeenCalled();
        expect(onImplemented).not.toHaveBeenCalled();
    });

    it('surfaces an error and does not enqueue when the source plan read fails', async () => {
        mockReadTrustedBlob.mockRejectedValue(new Error('outside trusted directories'));

        render(
            <ImplementPlanCard
                planFilePath="/repo/plan.md"
                workspaceId="ws-local"
                onImplemented={onImplemented}
                availableTargets={[localTarget, remoteTarget]}
            />,
        );

        await act(async () => {
            fireEvent.change(screen.getByTestId('implement-plan-card-target-select'), {
                target: { value: 'ws-remote' },
            });
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('implement-plan-card-error').textContent)
                .toContain('Could not read the plan file');
        });
        expect(mockRemoteEnqueue).not.toHaveBeenCalled();
        expect(onImplemented).not.toHaveBeenCalled();
    });

    // ── Target identity in records (AC-05) ──────────────────────────────

    it('records remote target identity on the source task via the source client', async () => {
        mockReadTrustedBlob.mockResolvedValue({ content: 'plan body', encoding: 'utf-8', mimeType: 'text/markdown' });
        mockRemoteEnqueue.mockResolvedValue({ task: { id: 'task-remote' } });
        mockProcessUpdate.mockResolvedValue({ process: {} });

        render(
            <ImplementPlanCard
                planFilePath="/repo/plan.md"
                workspaceId="ws-local"
                onImplemented={onImplemented}
                sourceProcessId="queue_source-1"
                sourceMetadata={{ type: 'chat' }}
                onRecordPersisted={onRecordPersisted}
                availableTargets={[localTarget, remoteTarget]}
            />,
        );

        await act(async () => {
            fireEvent.change(screen.getByTestId('implement-plan-card-target-select'), {
                target: { value: 'ws-remote' },
            });
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        });

        // Record persists on the source task through the SOURCE client (not remote).
        await waitFor(() => expect(mockProcessUpdate).toHaveBeenCalledTimes(1));
        expect(mockRemoteUpdate).not.toHaveBeenCalled();

        const [pid, patch] = mockProcessUpdate.mock.calls[0];
        expect(pid).toBe('queue_source-1');
        const rec = patch.set.implementations[0];
        expect(rec.processId).toBe('queue_task-remote');
        expect(rec.isRemoteTarget).toBe(true);
        expect(rec.targetWorkspaceId).toBe('ws-remote');
        expect(rec.targetServerLabel).toBe('dev-vm');
        expect(rec.targetLabel).toBe('my-app');
    });

    it('records a local target identity for the current repo', async () => {
        mockEnqueue.mockResolvedValue({ task: { id: 'task-local' } });
        mockProcessUpdate.mockResolvedValue({ process: {} });

        render(
            <ImplementPlanCard
                planFilePath="/repo/plan.md"
                workspaceId="ws-local"
                onImplemented={onImplemented}
                sourceProcessId="queue_source-1"
                sourceMetadata={{ type: 'chat' }}
                onRecordPersisted={onRecordPersisted}
                availableTargets={[localTarget, remoteTarget]}
            />,
        );

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        });

        await waitFor(() => expect(mockProcessUpdate).toHaveBeenCalledTimes(1));
        const rec = mockProcessUpdate.mock.calls[0][1].set.implementations[0];
        expect(rec.isRemoteTarget).toBe(false);
        expect(rec.targetWorkspaceId).toBe('ws-local');
        expect(rec.targetServerLabel).toBeUndefined();
    });

    it('shows the target repo/server for a prior remote run and routes View to it', () => {
        const runs: ExistingRun[] = [{
            processId: 'queue_impl-r',
            planFilePath: '/repo/plan.md',
            enqueuedAt: new Date().toISOString(),
            liveStatus: 'running',
            isRemoteTarget: true,
            targetWorkspaceId: 'ws-remote',
            targetLabel: 'my-app',
            targetServerLabel: 'dev-vm',
        }];

        render(
            <ImplementPlanCard
                planFilePath="/repo/plan.md"
                workspaceId="ws-local"
                onImplemented={onImplemented}
                existingRuns={runs}
                onViewRun={onViewRun}
            />,
        );

        // Target info is in the pill's title tooltip in the compact layout
        const pill = screen.getByTestId('implement-plan-card-status-pill');
        expect(pill.getAttribute('title')).toContain('my-app');
        expect(pill.getAttribute('title')).toContain('dev-vm');

        fireEvent.click(screen.getByTestId('implement-plan-card-view-btn'));
        expect(onViewRun).toHaveBeenCalledWith('queue_impl-r', 'ws-remote');
    });
});
