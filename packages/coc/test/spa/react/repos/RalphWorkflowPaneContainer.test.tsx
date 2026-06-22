/**
 * @vitest-environment jsdom
 *
 * Tests for `RalphWorkflowPaneContainer` — the integration shim that
 * wires `useRalphSessionView` to the presentational `RalphWorkflowPane`.
 *
 * Verifies:
 *   - shows the loading state until the fetch resolves
 *   - renders the workflow pane with header + iteration nodes once data
 *     is available
 *   - clicking an iteration node calls `onSelectIteration` with the
 *     matching `processId` from the journal record
 *   - falls back to `ralph:<sessionId>:<iter>` when the record is missing
 *   - the close button calls `onClose`
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const ralphSessionMock = vi.fn();
const resumeRalphSessionMock = vi.fn();
const continueRalphSessionMock = vi.fn();
const { mockModalSelection } = vi.hoisted(() => ({
    mockModalSelection: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        workspaces: {
            ralphSession: ralphSessionMock,
            resumeRalphSession: resumeRalphSessionMock,
            continueRalphSession: continueRalphSessionMock,
        },
    }),
}));

vi.mock('../../../../src/server/spa/client/react/shared/ModalJobAiControls', () => ({
    useModalJobAiSelection: (options: unknown) => mockModalSelection(options),
    ModalJobAiControls: ({ testIdPrefix = 'modal-job' }: { testIdPrefix?: string }) => (
        <div data-testid={`${testIdPrefix}-ai-controls`} />
    ),
}));

import { RalphWorkflowPaneContainer } from '../../../../src/server/spa/client/react/features/chat/RalphWorkflowPaneContainer';

beforeEach(() => {
    ralphSessionMock.mockReset();
    resumeRalphSessionMock.mockReset();
    resumeRalphSessionMock.mockResolvedValue({
        resumed: true,
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        taskId: 'task-resumed',
        nextIteration: 3,
        maxIterations: 10,
    });
    continueRalphSessionMock.mockReset();
    continueRalphSessionMock.mockResolvedValue({
        resumed: true,
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        taskId: 'task-continued',
        nextIteration: 11,
        newMaxIterations: 30,
    });
    mockModalSelection.mockReset();
    mockModalSelection.mockReturnValue({
        resolved: { provider: 'copilot' },
        dirty: false,
    });
});

function makeRecord(overrides: any = {}) {
    return {
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        originalGoal: 'Build feature X',
        maxIterations: 10,
        currentIteration: 2,
        phase: 'complete',
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        completedAt: new Date(Date.now() - 1_000).toISOString(),
        terminalReason: 'RALPH_COMPLETE',
        iterations: [
            {
                iteration: 1,
                taskId: 't-1',
                processId: 'proc-1',
                startedAt: new Date(Date.now() - 50_000).toISOString(),
                endedAt: new Date(Date.now() - 40_000).toISOString(),
                status: 'completed',
                exitSignal: 'RALPH_NEXT',
            },
            {
                iteration: 2,
                taskId: 't-2',
                processId: 'proc-2',
                startedAt: new Date(Date.now() - 30_000).toISOString(),
                endedAt: new Date(Date.now() - 5_000).toISOString(),
                status: 'completed',
                exitSignal: 'RALPH_COMPLETE',
            },
        ],
        ...overrides,
    };
}

describe('RalphWorkflowPaneContainer', () => {
    it('shows the loading state, then the workflow pane with the iteration nodes', async () => {
        ralphSessionMock.mockResolvedValueOnce({
            record: makeRecord(),
            sections: [
                { iteration: 1, signal: 'RALPH_NEXT', timestamp: new Date().toISOString(), body: 'one' },
                { iteration: 2, signal: 'RALPH_COMPLETE', timestamp: new Date().toISOString(), body: 'two' },
            ],
            files: [
                { name: 'progress.md', content: '# Progress' },
            ],
        });

        render(<RalphWorkflowPaneContainer workspaceId="ws-1" sessionId="sess-1" />);
        expect(screen.getByTestId('ralph-workflow-pane-loading')).toBeTruthy();

        await waitFor(() => {
            expect(screen.getByTestId('ralph-workflow-pane')).toBeTruthy();
        });
        expect(screen.getByTestId('ralph-workflow-iteration-count').textContent).toContain('Iteration 2');
        expect(screen.getByTestId('ralph-workflow-terminal-reason').textContent).toMatch(/Completed/);
        expect(screen.getByTestId('ralph-session-file-list').textContent).toContain('progress.md');
    });

    it('shows the empty / not-found state when the fetch fails', async () => {
        const err: any = new Error('not found');
        err.status = 404;
        ralphSessionMock.mockRejectedValueOnce(err);

        render(<RalphWorkflowPaneContainer workspaceId="ws-1" sessionId="sess-1" />);
        await waitFor(() => {
            expect(screen.getByTestId('ralph-workflow-pane-empty')).toBeTruthy();
        });
    });

    it('clicking an iteration node calls onSelectIteration with the recorded processId', async () => {
        ralphSessionMock.mockResolvedValueOnce({
            record: makeRecord(),
            sections: [
                { iteration: 1, signal: 'RALPH_NEXT', timestamp: new Date().toISOString(), body: 'one' },
            ],
        });
        const onSelectIteration = vi.fn();
        render(
            <RalphWorkflowPaneContainer
                workspaceId="ws-1"
                sessionId="sess-1"
                onSelectIteration={onSelectIteration}
            />,
        );
        await waitFor(() => expect(screen.getByTestId('ralph-workflow-pane')).toBeTruthy());

        const node = screen.getByTestId('ralph-workflow-node-1');
        fireEvent.click(node);
        expect(onSelectIteration).toHaveBeenCalledWith('proc-1');
    });

    it('clicking a final-check node calls onSelectIteration with its recorded processId', async () => {
        ralphSessionMock.mockResolvedValueOnce({
            record: makeRecord({
                finalChecks: [
                    {
                        checkIndex: 1,
                        loopIndex: 1,
                        sourceIteration: 2,
                        processId: 'fc-proc-9',
                        startedAt: new Date(Date.now() - 20_000).toISOString(),
                        completedAt: new Date(Date.now() - 10_000).toISOString(),
                        status: 'completed',
                        hasGaps: false,
                    },
                ],
            }),
            sections: [
                { iteration: 1, signal: 'RALPH_NEXT', timestamp: new Date().toISOString(), body: 'one' },
                { iteration: 2, signal: 'RALPH_COMPLETE', timestamp: new Date().toISOString(), body: 'two' },
            ],
        });
        const onSelectIteration = vi.fn();
        render(
            <RalphWorkflowPaneContainer
                workspaceId="ws-1"
                sessionId="sess-1"
                onSelectIteration={onSelectIteration}
            />,
        );
        await waitFor(() => expect(screen.getByTestId('ralph-workflow-pane')).toBeTruthy());

        fireEvent.click(screen.getByTestId('ralph-final-check-node-1'));
        expect(onSelectIteration).toHaveBeenCalledWith('fc-proc-9');
    });

    it('falls back to ralph:<sessionId>:<iter> when the iteration record has no processId', async () => {
        ralphSessionMock.mockResolvedValueOnce({
            record: makeRecord({ iterations: [] }),
            sections: [
                { iteration: 5, signal: 'RALPH_NEXT', timestamp: new Date().toISOString(), body: '' },
            ],
        });
        const onSelectIteration = vi.fn();
        render(
            <RalphWorkflowPaneContainer
                workspaceId="ws-1"
                sessionId="sess-1"
                onSelectIteration={onSelectIteration}
            />,
        );
        await waitFor(() => expect(screen.getByTestId('ralph-workflow-pane')).toBeTruthy());

        fireEvent.click(screen.getByTestId('ralph-workflow-node-5'));
        expect(onSelectIteration).toHaveBeenCalledWith('ralph:sess-1:5');
    });

    it('clicking close calls onClose', async () => {
        ralphSessionMock.mockResolvedValueOnce({ record: makeRecord(), sections: [] });
        const onClose = vi.fn();
        render(
            <RalphWorkflowPaneContainer workspaceId="ws-1" sessionId="sess-1" onClose={onClose} />,
        );
        await waitFor(() => expect(screen.getByTestId('ralph-workflow-pane')).toBeTruthy());
        fireEvent.click(screen.getByTestId('ralph-workflow-close'));
        expect(onClose).toHaveBeenCalled();
    });

    it('passes the resolved Resume AI selection to the coc-client request', async () => {
        const resumeDefaults = {
            provider: 'codex',
            model: 'gpt-5.3-codex',
            reasoningEffort: 'medium',
        };
        ralphSessionMock
            .mockResolvedValueOnce({
                record: makeRecord({
                    phase: 'executing',
                    currentIteration: 2,
                    iterations: [
                        {
                            iteration: 1,
                            taskId: 't-1',
                            processId: 'proc-1',
                            startedAt: new Date(Date.now() - 50_000).toISOString(),
                            endedAt: new Date(Date.now() - 40_000).toISOString(),
                            status: 'completed',
                            exitSignal: 'RALPH_NEXT',
                        },
                        {
                            iteration: 2,
                            taskId: 't-2',
                            processId: 'proc-2',
                            startedAt: new Date(Date.now() - 30_000).toISOString(),
                            endedAt: new Date(Date.now() - 5_000).toISOString(),
                            status: 'failed',
                            exitSignal: 'NONE',
                        },
                    ],
                }),
                sections: [
                    { iteration: 1, signal: 'RALPH_NEXT', timestamp: new Date().toISOString(), body: 'one' },
                    { iteration: 2, signal: 'NONE', timestamp: new Date().toISOString(), body: 'two' },
                ],
                resumeDefaults,
                // Stuck executing: last iteration failed, no task in flight → Resume offered.
                hasInFlightTask: false,
            })
            .mockResolvedValueOnce({
                record: makeRecord(),
                sections: [],
            });
        mockModalSelection.mockReturnValue({
            resolved: {
                provider: 'claude',
                model: 'claude-sonnet-4.6',
                reasoningEffort: 'high',
                effortTier: 'low',
            },
            dirty: true,
        });

        render(<RalphWorkflowPaneContainer workspaceId="ws-1" sessionId="sess-1" />);
        await waitFor(() => expect(screen.getByTestId('ralph-workflow-pane')).toBeTruthy());

        fireEvent.click(screen.getByTestId('ralph-workflow-resume'));
        expect(screen.getByTestId('ralph-workflow-resume-ai-controls')).toBeTruthy();
        fireEvent.click(screen.getByTestId('ralph-workflow-resume-confirm-button'));

        await waitFor(() => {
            expect(resumeRalphSessionMock).toHaveBeenCalledWith('ws-1', 'sess-1', {
                provider: 'claude',
                config: {
                    model: 'claude-sonnet-4.6',
                    reasoningEffort: 'high',
                    effortTier: 'low',
                },
            });
        });
        expect(mockModalSelection).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            mode: 'ralph',
            initialSelection: resumeDefaults,
        });
    });

    it('passes the resolved Continue AI selection to the coc-client request', async () => {
        const resumeDefaults = {
            provider: 'codex',
            model: 'gpt-5.3-codex',
            reasoningEffort: 'medium',
        };
        ralphSessionMock
            .mockResolvedValueOnce({
                record: makeRecord({
                    phase: 'complete',
                    currentIteration: 10,
                    terminalReason: 'CAP_REACHED',
                }),
                sections: [],
                resumeDefaults,
            })
            .mockResolvedValueOnce({
                record: makeRecord(),
                sections: [],
            });
        mockModalSelection.mockReturnValue({
            resolved: {
                provider: 'claude',
                model: 'claude-sonnet-4.6',
                reasoningEffort: 'high',
                effortTier: 'low',
            },
            dirty: true,
        });

        render(<RalphWorkflowPaneContainer workspaceId="ws-1" sessionId="sess-1" />);
        await waitFor(() => expect(screen.getByTestId('ralph-workflow-pane')).toBeTruthy());

        fireEvent.click(screen.getByTestId('ralph-workflow-continue'));
        expect(screen.getByTestId('ralph-workflow-continue-ai-controls')).toBeTruthy();
        fireEvent.click(screen.getByTestId('ralph-workflow-continue-confirm-button'));

        await waitFor(() => {
            expect(continueRalphSessionMock).toHaveBeenCalledWith('ws-1', 'sess-1', {
                additionalIterations: 20,
                provider: 'claude',
                config: {
                    model: 'claude-sonnet-4.6',
                    reasoningEffort: 'high',
                    effortTier: 'low',
                },
            });
        });
        expect(mockModalSelection).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            mode: 'ralph',
            initialSelection: resumeDefaults,
        });
    });
});
