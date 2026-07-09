import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { WorkItemExecuteDialog } from '../../../src/server/spa/client/react/features/work-items/WorkItemExecuteDialog';

const mocks = vi.hoisted(() => ({
    execute: vi.fn(),
    recordSkillUsage: vi.fn(),
    request: vi.fn(),
    fetchApi: vi.fn(),
    trackUsage: vi.fn(),
    modalSelection: vi.fn(),
}));

vi.mock('../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: mocks.fetchApi,
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        request: mocks.request,
        workItems: {
            executeForOrigin: mocks.execute,
        },
        preferences: {
            recordSkillUsage: mocks.recordSkillUsage,
        },
    }),
}));

vi.mock('../../../src/server/spa/client/react/features/skills/hooks/useRecentSkills', () => ({
    useRecentSkills: () => ({
        recentItems: [],
        trackUsage: mocks.trackUsage,
    }),
}));

vi.mock('../../../src/server/spa/client/react/shared/ModalJobAiControls', () => ({
    useModalJobAiSelection: () => mocks.modalSelection(),
    ModalJobAiControls: ({ testIdPrefix = 'modal-job' }: { testIdPrefix?: string }) => (
        <div data-testid={`${testIdPrefix}-ai-controls`} />
    ),
}));

describe('WorkItemExecuteDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.execute.mockResolvedValue({ taskId: 'task-1' });
        mocks.recordSkillUsage.mockResolvedValue({});
        // Skills now load via the clone-aware cloneClient.request (AC-07), which for the
        // unregistered ws-1 resolves to this getSpaCocClient() mock.
        mocks.request.mockResolvedValue({
            skills: [
                { name: 'impl', description: 'Implement changes' },
                { name: 'code-review', description: 'Review changes' },
            ],
        });
        mocks.modalSelection.mockReturnValue({
            resolved: {
                provider: 'codex',
                model: 'gpt-5.3-codex',
                reasoningEffort: 'high',
            },
        });
    });

    it('renders modal AI controls instead of the legacy model select', async () => {
        await act(async () => {
            render(
                <WorkItemExecuteDialog
                    open
                    workspaceId="ws-1"
                    workItemId="wi-1"
                    workItemTitle="Implement auth"
                    onClose={vi.fn()}
                    onExecuted={vi.fn()}
                />,
            );
        });

        expect(screen.getByTestId('wi-exec-ai-controls')).toBeDefined();
        expect(document.getElementById('wi-exec-model')).toBeNull();
    });

    it('submits selected skills with resolved provider, model, and reasoning effort', async () => {
        const onClose = vi.fn();
        const onExecuted = vi.fn();
        await act(async () => {
            render(
                <WorkItemExecuteDialog
                    open
                    workspaceId="ws-1"
                    workItemId="wi-1"
                    workItemTitle="Implement auth"
                    onClose={onClose}
                    onExecuted={onExecuted}
                />,
            );
        });

        await waitFor(() => expect(screen.getByText('impl')).toBeDefined());
        fireEvent.click(screen.getByText('impl'));

        await act(async () => {
            fireEvent.click(screen.getByTestId('wi-execute-submit'));
        });

        expect(mocks.execute).toHaveBeenCalledWith('local_ws-1', 'wi-1', {
            skillNames: ['impl'],
            provider: 'codex',
            model: 'gpt-5.3-codex',
            reasoningEffort: 'high',
        }, { workspaceId: 'ws-1' });
        expect(mocks.trackUsage).toHaveBeenCalledWith('impl');
        expect(onExecuted).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    describe('worktree controls (AC-05)', () => {
        beforeEach(() => {
            (window as unknown as { __DASHBOARD_CONFIG__?: unknown }).__DASHBOARD_CONFIG__ = {
                apiBasePath: '/api',
                wsPath: '/ws',
                gitWorktreeExecutionEnabled: true,
            };
            // Capability probe hits the clone server's /config/runtime.
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ features: { gitWorktreeExecutionEnabled: true } }),
            }));
        });

        afterEach(() => {
            delete (window as unknown as { __DASHBOARD_CONFIG__?: unknown }).__DASHBOARD_CONFIG__;
            vi.unstubAllGlobals();
        });

        it('is hidden when the feature flag is off', async () => {
            (window as unknown as { __DASHBOARD_CONFIG__?: unknown }).__DASHBOARD_CONFIG__ = {
                apiBasePath: '/api',
                wsPath: '/ws',
                gitWorktreeExecutionEnabled: false,
            };
            await act(async () => {
                render(
                    <WorkItemExecuteDialog open workspaceId="ws-1" workItemId="wi-1" workItemTitle="Implement auth" onClose={vi.fn()} onExecuted={vi.fn()} />,
                );
            });
            expect(screen.queryByTestId('wi-exec-worktree-controls')).toBeNull();
        });

        it('sends the worktree request with the execute payload when opted in', async () => {
            await act(async () => {
                render(
                    <WorkItemExecuteDialog open workspaceId="ws-1" workItemId="wi-1" workItemTitle="Implement auth" onClose={vi.fn()} onExecuted={vi.fn()} />,
                );
            });

            await waitFor(() => expect(screen.getByText('impl')).toBeDefined());
            fireEvent.click(screen.getByText('impl'));
            fireEvent.click(screen.getByTestId('wi-exec-worktree-checkbox'));
            fireEvent.change(screen.getByTestId('wi-exec-worktree-base-ref'), {
                target: { value: ' main ' },
            });

            await act(async () => {
                fireEvent.click(screen.getByTestId('wi-execute-submit'));
            });

            expect(mocks.execute).toHaveBeenCalledWith(
                'local_ws-1',
                'wi-1',
                expect.objectContaining({ worktree: { enabled: true, baseRef: 'main' } }),
                { workspaceId: 'ws-1' },
            );
        });
    });
});
