/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    execute: vi.fn(),
    recordSkillUsage: vi.fn(),
    request: vi.fn(),
    fetchApi: vi.fn(),
    trackUsage: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: unknown[]) => mocks.fetchApi(...args),
}));

vi.mock('../../../../../src/server/spa/client/react/features/skills/hooks/useRecentSkills', () => ({
    useRecentSkills: () => ({
        recentItems: [],
        trackUsage: mocks.trackUsage,
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
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

vi.mock('../../../../../src/server/spa/client/react/shared/ModalJobAiControls', () => ({
    ModalJobAiControls: () => <div data-testid="mock-ai-controls" />,
    useModalJobAiSelection: () => ({
        resolved: {},
    }),
}));

import { WorkItemExecuteDialog } from '../../../../../src/server/spa/client/react/features/work-items/WorkItemExecuteDialog';

describe('WorkItemExecuteDialog execution modes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Skills load through the clone-aware cloneClient.request (AC-07); for the
        // unregistered ws-1 that resolves to this getSpaCocClient() mock.
        mocks.request.mockResolvedValue({
            skills: [{ name: 'impl', description: 'Implement changes' }],
        });
        mocks.execute.mockResolvedValue({ taskId: 'task-1' });
        mocks.recordSkillUsage.mockResolvedValue(undefined);
    });

    afterEach(() => {
        cleanup();
    });

    it('submits the default Ralph execution mode for Goals', async () => {
        const onClose = vi.fn();
        const onExecuted = vi.fn();
        render(
            <WorkItemExecuteDialog
                open
                workspaceId="ws-1"
                workItemId="goal-1"
                workItemTitle="Ship goal"
                defaultExecutionMode="ralph"
                allowExecutionModeSelection
                onClose={onClose}
                onExecuted={onExecuted}
            />,
        );

        fireEvent.click(await screen.findByText('impl'));
        fireEvent.click(screen.getByTestId('wi-execute-submit'));

        await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));
        expect(mocks.execute).toHaveBeenCalledWith('local_ws-1', 'goal-1', {
            executionMode: 'ralph',
            skillNames: ['impl'],
        }, { workspaceId: 'ws-1' });
        expect(onExecuted).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('lets users override a local workflow item run to one-shot', async () => {
        render(
            <WorkItemExecuteDialog
                open
                workspaceId="ws-1"
                workItemId="goal-1"
                workItemTitle="Ship goal"
                defaultExecutionMode="ralph"
                allowExecutionModeSelection
                onClose={vi.fn()}
                onExecuted={vi.fn()}
            />,
        );

        fireEvent.click(await screen.findByText('impl'));
        fireEvent.click(screen.getByTestId('wi-execution-mode-one-shot'));
        fireEvent.click(screen.getByTestId('wi-execute-submit'));

        await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));
        expect(mocks.execute.mock.calls[0][2]).toMatchObject({
            executionMode: 'one-shot',
            skillNames: ['impl'],
        });
        expect(mocks.execute.mock.calls[0][3]).toEqual({ workspaceId: 'ws-1' });
    });
});
