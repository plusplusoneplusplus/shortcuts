/**
 * @vitest-environment jsdom
 *
 * Tests for ImplementPlanCard — the banner is now a trigger: it renders the
 * status pill, prior-runs list, and an Implement button that opens the launch
 * dialog. The enqueue itself is exercised in ImplementPlanLaunchDialog.test.tsx;
 * here we verify display state and that the button opens the dialog with the
 * right props.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks – stub the launch dialog so the banner can be tested in isolation.
// ---------------------------------------------------------------------------

const { lastProps } = vi.hoisted(() => ({ lastProps: { current: null as any } }));

vi.mock('../../../../../src/server/spa/client/react/features/chat/ImplementPlanLaunchDialog', () => ({
    ImplementPlanLaunchDialog: (props: any) => {
        lastProps.current = props;
        return props.open ? <div data-testid="implement-launch-dialog-stub" /> : null;
    },
}));

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import { ImplementPlanCard } from '../../../../../src/server/spa/client/react/features/chat/ImplementPlanCard';
import type { ExistingRun, ImplementTarget } from '../../../../../src/server/spa/client/react/features/chat/ImplementPlanCard';

describe('ImplementPlanCard', () => {
    const onImplemented = vi.fn();
    const onViewRun = vi.fn();
    const onRecordPersisted = vi.fn();

    beforeEach(() => {
        onImplemented.mockReset();
        onViewRun.mockReset();
        onRecordPersisted.mockReset();
        lastProps.current = null;
    });

    const localTarget: ImplementTarget = { workspaceId: 'ws-local', label: 'my-app', isRemote: false, workingDirectory: '/repo' };
    const remoteTarget: ImplementTarget = {
        workspaceId: 'ws-remote', label: 'my-app', serverLabel: 'dev-vm',
        isRemote: true, baseUrl: 'http://127.0.0.1:4000', workingDirectory: '/remote/repo',
    };

    // ── Banner rendering ─────────────────────────────────────────────────

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
        // Dialog is closed until the button is clicked.
        expect(screen.queryByTestId('implement-launch-dialog-stub')).toBeNull();
    });

    it('opens a file-backed plan with an accessible path control', async () => {
        const onOpenPlanFile = vi.fn();
        const user = userEvent.setup();
        render(
            <ImplementPlanCard
                planFilePath="/repo/notes/feature.plan.md"
                onOpenPlanFile={onOpenPlanFile}
                onImplemented={onImplemented}
            />,
        );

        const pathButton = screen.getByTestId('implement-plan-card-path');
        expect(pathButton.tagName).toBe('BUTTON');
        expect(pathButton.getAttribute('aria-label')).toBe('Open feature.plan.md in the right-side file panel');

        pathButton.focus();
        await user.keyboard('{Enter}');
        expect(onOpenPlanFile).toHaveBeenCalledWith('/repo/notes/feature.plan.md');
    });

    it('does not make a canvas plan label a file control', () => {
        render(
            <ImplementPlanCard
                planFilePath="Feature plan"
                planCanvasId="canvas-1"
                onOpenPlanFile={vi.fn()}
                onImplemented={onImplemented}
            />,
        );
        expect(screen.queryByTestId('implement-plan-card-path')).toBeNull();
    });

    it('renders unchanged when no prior runs exist (no status pill)', () => {
        render(<ImplementPlanCard planFilePath="/repo/plan.md" onImplemented={onImplemented} existingRuns={[]} />);
        expect(screen.queryByTestId('implement-plan-card-status-pill')).toBeNull();
        expect(screen.getByTestId('implement-plan-card-btn').textContent).toContain('Implement →');
    });

    // ── Trigger behavior (AC-01) ─────────────────────────────────────────

    it('opens the launch dialog on click and never enqueues from the banner', () => {
        render(
            <ImplementPlanCard
                planFilePath="/repo/plan.md"
                workspaceId="ws-local"
                workingDirectory="/repo"
                onImplemented={onImplemented}
                sourceProcessId="queue_source-1"
                sourceMetadata={{ type: 'chat' }}
                onRecordPersisted={onRecordPersisted}
                availableTargets={[localTarget, remoteTarget]}
            />,
        );

        expect(screen.queryByTestId('implement-launch-dialog-stub')).toBeNull();
        fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        expect(screen.getByTestId('implement-launch-dialog-stub')).toBeTruthy();

        // Props forwarded to the dialog carry everything it needs to enqueue.
        expect(lastProps.current.open).toBe(true);
        expect(lastProps.current.planFilePath).toBe('/repo/plan.md');
        expect(lastProps.current.workspaceId).toBe('ws-local');
        expect(lastProps.current.sourceProcessId).toBe('queue_source-1');
        expect(lastProps.current.availableTargets).toEqual([localTarget, remoteTarget]);
        expect(lastProps.current.onImplemented).toBe(onImplemented);
        expect(lastProps.current.onRecordPersisted).toBe(onRecordPersisted);
    });

    it('closes the dialog via onClose', () => {
        render(<ImplementPlanCard planFilePath="/repo/plan.md" onImplemented={onImplemented} />);
        fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        expect(screen.getByTestId('implement-launch-dialog-stub')).toBeTruthy();
        act(() => lastProps.current.onClose());
        expect(screen.queryByTestId('implement-launch-dialog-stub')).toBeNull();
    });

    // ── Existing runs banner ─────────────────────────────────────────────

    it('renders a status chip when a single completed run exists', () => {
        const runs: ExistingRun[] = [{
            processId: 'queue_impl-1', planFilePath: '/plan.md',
            enqueuedAt: new Date(Date.now() - 300000).toISOString(), liveStatus: 'completed',
        }];
        render(<ImplementPlanCard planFilePath="/plan.md" onImplemented={onImplemented} existingRuns={runs} onViewRun={onViewRun} />);
        expect(screen.getByTestId('implement-plan-card-status-pill').textContent).toContain('Completed');
        expect(screen.getByTestId('implement-plan-card-view-btn')).toBeTruthy();
    });

    it('shows "Implement again" with secondary style when latest run is active', () => {
        const runs: ExistingRun[] = [{
            processId: 'queue_impl-1', planFilePath: '/plan.md', enqueuedAt: new Date().toISOString(), liveStatus: 'running',
        }];
        render(<ImplementPlanCard planFilePath="/plan.md" onImplemented={onImplemented} existingRuns={runs} onViewRun={onViewRun} />);
        const btn = screen.getByTestId('implement-plan-card-btn') as HTMLButtonElement;
        expect(btn.textContent).toContain('Implement again');
        expect(btn.title).toContain('already running');
        expect(btn.className).toContain('border');
    });

    it('shows run count and expandable list for multiple runs', () => {
        const runs: ExistingRun[] = [
            { processId: 'queue_impl-1', planFilePath: '/p.md', enqueuedAt: new Date(Date.now() - 600000).toISOString(), liveStatus: 'failed' },
            { processId: 'queue_impl-2', planFilePath: '/p.md', enqueuedAt: new Date().toISOString(), liveStatus: 'running' },
        ];
        render(<ImplementPlanCard planFilePath="/p.md" onImplemented={onImplemented} existingRuns={runs} onViewRun={onViewRun} />);

        const pill = screen.getByTestId('implement-plan-card-status-pill');
        expect(pill.textContent).toContain('Running');
        expect(pill.getAttribute('title')).toContain('2 runs total');

        const expandBtn = screen.getByTestId('implement-plan-card-expand-btn');
        expect(expandBtn.textContent).toContain('Show all 2 runs');
        expect(screen.queryByTestId('implement-plan-card-run-list')).toBeNull();
        fireEvent.click(expandBtn);
        expect(screen.getByTestId('implement-plan-card-run-list')).toBeTruthy();
    });

    it('navigates via onViewRun when View button is clicked', () => {
        const runs: ExistingRun[] = [{
            processId: 'queue_impl-42', planFilePath: '/p.md', enqueuedAt: new Date().toISOString(), liveStatus: 'completed',
        }];
        render(<ImplementPlanCard planFilePath="/p.md" onImplemented={onImplemented} existingRuns={runs} onViewRun={onViewRun} />);
        fireEvent.click(screen.getByTestId('implement-plan-card-view-btn'));
        expect(onViewRun).toHaveBeenCalledWith('queue_impl-42', undefined);
    });

    it('shows the target repo/server for a prior remote run and routes View to it', () => {
        const runs: ExistingRun[] = [{
            processId: 'queue_impl-r', planFilePath: '/repo/plan.md', enqueuedAt: new Date().toISOString(),
            liveStatus: 'running', isRemoteTarget: true, targetWorkspaceId: 'ws-remote',
            targetLabel: 'my-app', targetServerLabel: 'dev-vm',
        }];
        render(<ImplementPlanCard planFilePath="/repo/plan.md" workspaceId="ws-local" onImplemented={onImplemented} existingRuns={runs} onViewRun={onViewRun} />);
        const pill = screen.getByTestId('implement-plan-card-status-pill');
        expect(pill.getAttribute('title')).toContain('my-app');
        expect(pill.getAttribute('title')).toContain('dev-vm');
        fireEvent.click(screen.getByTestId('implement-plan-card-view-btn'));
        expect(onViewRun).toHaveBeenCalledWith('queue_impl-r', 'ws-remote');
    });

    // ── Plan-file selection is owned by the banner, driven from the dialog ─

    const PLAN_016 = '/repo/plans/016-alpha.plan.md';
    const PLAN_017 = '/repo/plans/017-beta.plan.md';
    const PLAN_018 = '/repo/plans/018-gamma.plan.md';

    it('does not render a plan-file selector in the banner (moved to the dialog)', () => {
        render(<ImplementPlanCard planFilePath={PLAN_016} planFiles={[PLAN_016, PLAN_017, PLAN_018]} onImplemented={onImplemented} />);
        expect(screen.queryByTestId('implement-plan-card-file-select')).toBeNull();
        // The default (first) file's path is shown.
        expect(screen.getByText(PLAN_016)).toBeTruthy();
    });

    it('passes the current plan-file selection to the dialog and re-scopes on change', () => {
        const runs: ExistingRun[] = [
            { processId: 'queue_r16', planFilePath: PLAN_016, enqueuedAt: new Date().toISOString(), liveStatus: 'completed' },
            { processId: 'queue_r17', planFilePath: PLAN_017, enqueuedAt: new Date().toISOString(), liveStatus: 'running' },
        ];
        render(
            <ImplementPlanCard
                planFilePath={PLAN_016}
                planFiles={[PLAN_016, PLAN_017, PLAN_018]}
                onImplemented={onImplemented}
                existingRuns={runs}
                onViewRun={onViewRun}
            />,
        );

        // Default file (016) → completed pill + "Implement again".
        expect(screen.getByTestId('implement-plan-card-status-pill').textContent).toContain('Completed');
        expect(screen.getByTestId('implement-plan-card-btn').textContent).toContain('Implement again');

        // Open the dialog and switch the selection through its callback.
        fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        expect(lastProps.current.selectedPlanFile).toBe(PLAN_016);
        expect(lastProps.current.planFiles).toEqual([PLAN_016, PLAN_017, PLAN_018]);

        act(() => lastProps.current.onSelectPlanFile(PLAN_018));
        // 018 has no runs → pill gone, "Implement →".
        expect(screen.queryByTestId('implement-plan-card-status-pill')).toBeNull();
        expect(screen.getByTestId('implement-plan-card-btn').textContent).toContain('Implement →');

        act(() => lastProps.current.onSelectPlanFile(PLAN_017));
        expect(screen.getByTestId('implement-plan-card-status-pill').textContent).toContain('Running');
    });

    it('opens the currently selected plan file from the path control', () => {
        const onOpenPlanFile = vi.fn();
        render(
            <ImplementPlanCard
                planFilePath={PLAN_016}
                planFiles={[PLAN_016, PLAN_017, PLAN_018]}
                onOpenPlanFile={onOpenPlanFile}
                onImplemented={onImplemented}
            />,
        );
        fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        act(() => lastProps.current.onSelectPlanFile(PLAN_017));
        fireEvent.click(screen.getByTestId('implement-plan-card-path'));
        expect(onOpenPlanFile).toHaveBeenCalledWith(PLAN_017);
    });
});
