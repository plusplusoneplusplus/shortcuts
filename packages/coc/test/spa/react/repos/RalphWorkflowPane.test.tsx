/**
 * Tests for RalphWorkflowPane — pure presentational rendering with fixture data.
 *
 * Commit 5 scope: skeleton component renders header, phase badge, iteration
 * count, terminal reason (when set), and clickable iteration nodes. No data
 * fetching is exercised here — that comes in commit 7.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
    RalphWorkflowPane,
    type RalphSessionView,
} from '../../../../src/server/spa/client/react/features/chat/RalphWorkflowPane';
import type {
    ParsedProgressSection,
    RalphIterationRecord,
    RalphLoopRecord,
    RalphSessionRecord,
} from '@plusplusoneplusplus/coc-client';

// Default feature flags: RALPH_MULTI_LOOP off so existing tests are unaffected.
vi.mock('../../../../src/server/spa/client/react/featureFlags', () => ({
    RALPH_MULTI_LOOP: false,
    SHOW_WELCOME_TUTORIAL: true,
    SHOW_FOCUSED_DIFF: true,
    SHOW_EXCALIDRAW_DIAGRAMS: true,
}));

function makeRecord(overrides: Partial<RalphSessionRecord> = {}): RalphSessionRecord {
    return {
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        originalGoal: 'Build the new dashboard with charts and filters',
        maxIterations: 10,
        currentIteration: 1,
        phase: 'executing',
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        iterations: [],
        ...overrides,
    };
}

function makeIter(n: number, status: RalphIterationRecord['status'] = 'completed'): RalphIterationRecord {
    return {
        iteration: n,
        taskId: `task-${n}`,
        processId: `proc-${n}`,
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        endedAt: new Date(Date.now() - 30_000).toISOString(),
        status,
        exitSignal: 'RALPH_NEXT',
    };
}

function makeSection(n: number, signal: ParsedProgressSection['signal'] = 'RALPH_NEXT'): ParsedProgressSection {
    return {
        iteration: n,
        signal,
        timestamp: new Date(Date.now() - 30_000).toISOString(),
        body: `Files: src/file${n}.ts\nDecisions: chose path A\nRemaining: tests`,
    };
}

describe('RalphWorkflowPane', () => {
    it('renders the loading state when view is undefined', () => {
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={undefined} />);
        expect(screen.getByTestId('ralph-workflow-pane-loading')).toBeInTheDocument();
    });

    it('renders the empty state when view is null', () => {
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-not-found" view={null} />);
        expect(screen.getByTestId('ralph-workflow-pane-empty')).toBeInTheDocument();
        expect(screen.getByText(/sess-not-found/)).toBeInTheDocument();
    });

    it('renders a live (executing) session header and one node per iteration', () => {
        const view: RalphSessionView = {
            record: makeRecord({
                currentIteration: 2,
                iterations: [makeIter(1), makeIter(2, 'running')],
            }),
            sections: [makeSection(1), makeSection(2)],
        };
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);

        expect(screen.getByTestId('ralph-workflow-pane')).toBeInTheDocument();
        expect(screen.getByTestId('ralph-workflow-phase')).toHaveTextContent(/Executing/i);
        expect(screen.getByTestId('ralph-workflow-iteration-count')).toHaveTextContent('Iteration 2 / 10');
        expect(screen.getByTestId('ralph-workflow-node-1')).toBeInTheDocument();
        expect(screen.getByTestId('ralph-workflow-node-2')).toBeInTheDocument();
        // No terminal reason for a still-running session.
        expect(screen.queryByTestId('ralph-workflow-terminal-reason')).toBeNull();
    });

    it('renders the terminal reason when the session is complete', () => {
        const view: RalphSessionView = {
            record: makeRecord({
                phase: 'complete',
                currentIteration: 3,
                completedAt: new Date().toISOString(),
                terminalReason: 'RALPH_COMPLETE',
                iterations: [makeIter(1), makeIter(2), makeIter(3)],
            }),
            sections: [makeSection(1), makeSection(2), makeSection(3, 'RALPH_COMPLETE')],
        };
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.getByTestId('ralph-workflow-terminal-reason')).toHaveTextContent(/Completed/);
    });

    it('renders the cap-reached terminal reason', () => {
        const view: RalphSessionView = {
            record: makeRecord({
                phase: 'complete',
                currentIteration: 10,
                maxIterations: 10,
                completedAt: new Date().toISOString(),
                terminalReason: 'CAP_REACHED',
                iterations: Array.from({ length: 10 }, (_, i) => makeIter(i + 1)),
            }),
            sections: Array.from({ length: 10 }, (_, i) => makeSection(i + 1)),
        };
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.getByTestId('ralph-workflow-terminal-reason')).toHaveTextContent(/Iteration cap reached/);
    });

    it('renders the grilling-only state with the empty timeline', () => {
        const view: RalphSessionView = {
            record: makeRecord({ phase: 'grilling', currentIteration: 0, iterations: [] }),
            sections: [],
        };
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.getByTestId('ralph-workflow-phase')).toHaveTextContent(/Clarifying/i);
        expect(screen.getByTestId('ralph-workflow-timeline')).toHaveTextContent(/Waiting for the first iteration/i);
    });

    it('calls onSelectIteration when an iteration node is clicked', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        const view: RalphSessionView = {
            record: makeRecord({ currentIteration: 2, iterations: [makeIter(1), makeIter(2)] }),
            sections: [makeSection(1), makeSection(2)],
        };
        render(
            <RalphWorkflowPane
                workspaceId="ws-1"
                sessionId="sess-1"
                view={view}
                onSelectIteration={onSelect}
            />,
        );
        await user.click(screen.getByTestId('ralph-workflow-node-2'));
        expect(onSelect).toHaveBeenCalledWith(2);
    });

    it('calls onClose when the close button is clicked', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        const view: RalphSessionView = {
            record: makeRecord({ iterations: [makeIter(1)] }),
            sections: [makeSection(1)],
        };
        render(
            <RalphWorkflowPane
                workspaceId="ws-1"
                sessionId="sess-1"
                view={view}
                onClose={onClose}
            />,
        );
        await user.click(screen.getByTestId('ralph-workflow-close'));
        expect(onClose).toHaveBeenCalled();
    });

    it('renders a node for an iteration that exists in sections but not in the record', () => {
        const view: RalphSessionView = {
            record: makeRecord({ currentIteration: 1, iterations: [makeIter(1)] }),
            sections: [makeSection(1), makeSection(2), makeSection(3)],
        };
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.getByTestId('ralph-workflow-node-1')).toBeInTheDocument();
        expect(screen.getByTestId('ralph-workflow-node-2')).toBeInTheDocument();
        expect(screen.getByTestId('ralph-workflow-node-3')).toBeInTheDocument();
    });

    // ----------------------------------------------------------------------
    // Continue loop button
    // ----------------------------------------------------------------------

    it('shows the Continue loop button when the session hit CAP_REACHED', () => {
        const view: RalphSessionView = {
            record: makeRecord({
                phase: 'complete',
                currentIteration: 10,
                completedAt: new Date().toISOString(),
                terminalReason: 'CAP_REACHED',
                iterations: [makeIter(10)],
            }),
            sections: [makeSection(10)],
        };
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.getByTestId('ralph-workflow-continue')).toBeInTheDocument();
    });

    it('shows the Continue loop button when NO_SIGNAL hits the cap', () => {
        const view: RalphSessionView = {
            record: makeRecord({
                phase: 'complete',
                currentIteration: 10,
                maxIterations: 10,
                completedAt: new Date().toISOString(),
                terminalReason: 'NO_SIGNAL',
                iterations: [makeIter(10)],
            }),
            sections: [makeSection(10)],
        };
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.getByTestId('ralph-workflow-continue')).toBeInTheDocument();
    });

    it('hides the Continue loop button when terminalReason is RALPH_COMPLETE', () => {
        const view: RalphSessionView = {
            record: makeRecord({
                phase: 'complete',
                currentIteration: 5,
                completedAt: new Date().toISOString(),
                terminalReason: 'RALPH_COMPLETE',
                iterations: [makeIter(5)],
            }),
            sections: [makeSection(5)],
        };
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.queryByTestId('ralph-workflow-continue')).toBeNull();
    });

    it('hides the Continue loop button when terminalReason is CANCELLED', () => {
        const view: RalphSessionView = {
            record: makeRecord({
                phase: 'complete',
                currentIteration: 3,
                completedAt: new Date().toISOString(),
                terminalReason: 'CANCELLED',
                iterations: [makeIter(3)],
            }),
            sections: [makeSection(3)],
        };
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.queryByTestId('ralph-workflow-continue')).toBeNull();
    });

    it('hides the Continue loop button when NO_SIGNAL did not reach the cap', () => {
        const view: RalphSessionView = {
            record: makeRecord({
                phase: 'complete',
                currentIteration: 4,
                maxIterations: 10,
                completedAt: new Date().toISOString(),
                terminalReason: 'NO_SIGNAL',
                iterations: [makeIter(4)],
            }),
            sections: [makeSection(4)],
        };
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.queryByTestId('ralph-workflow-continue')).toBeNull();
    });

    it('opens a confirmation panel and calls onContinue when confirmed', async () => {
        const user = userEvent.setup();
        const onContinue = vi.fn().mockResolvedValue(undefined);
        const view: RalphSessionView = {
            record: makeRecord({
                phase: 'complete',
                currentIteration: 10,
                completedAt: new Date().toISOString(),
                terminalReason: 'CAP_REACHED',
                iterations: [makeIter(10)],
            }),
            sections: [makeSection(10)],
        };
        render(
            <RalphWorkflowPane
                workspaceId="ws-1"
                sessionId="sess-1"
                view={view}
                continueDefaultIterations={5}
                onContinue={onContinue}
            />,
        );
        await user.click(screen.getByTestId('ralph-workflow-continue'));
        expect(screen.getByTestId('ralph-workflow-continue-confirm')).toBeInTheDocument();
        await user.click(screen.getByTestId('ralph-workflow-continue-confirm-button'));
        expect(onContinue).toHaveBeenCalledWith(5);
    });

    it('cancel button hides the confirmation panel', async () => {
        const user = userEvent.setup();
        const onContinue = vi.fn().mockResolvedValue(undefined);
        const view: RalphSessionView = {
            record: makeRecord({
                phase: 'complete',
                currentIteration: 10,
                completedAt: new Date().toISOString(),
                terminalReason: 'CAP_REACHED',
                iterations: [makeIter(10)],
            }),
            sections: [makeSection(10)],
        };
        render(
            <RalphWorkflowPane
                workspaceId="ws-1"
                sessionId="sess-1"
                view={view}
                onContinue={onContinue}
            />,
        );
        await user.click(screen.getByTestId('ralph-workflow-continue'));
        await user.click(screen.getByTestId('ralph-workflow-continue-cancel'));
        expect(screen.queryByTestId('ralph-workflow-continue-confirm')).toBeNull();
        expect(onContinue).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// New Loop UI (requires RALPH_MULTI_LOOP=true, tested in isolation)
// ---------------------------------------------------------------------------

describe('RalphWorkflowPane — new-loop UI (RALPH_MULTI_LOOP enabled)', () => {
    beforeEach(() => {
        vi.resetModules();
        // Override the module-level flag for this suite.
        vi.doMock('../../../../src/server/spa/client/react/featureFlags', () => ({
            RALPH_MULTI_LOOP: true,
            SHOW_WELCOME_TUTORIAL: true,
            SHOW_FOCUSED_DIFF: true,
            SHOW_EXCALIDRAW_DIAGRAMS: true,
        }));
    });

    afterEach(() => {
        vi.doUnmock('../../../../src/server/spa/client/react/featureFlags');
        vi.resetModules();
    });

    function makeRalphCompleteView(overrides: Partial<RalphSessionRecord> = {}): RalphSessionView {
        return {
            record: makeRecord({
                phase: 'complete',
                currentIteration: 5,
                completedAt: new Date().toISOString(),
                terminalReason: 'RALPH_COMPLETE',
                iterations: [makeIter(5)],
                ...overrides,
            }),
            sections: [makeSection(5, 'RALPH_COMPLETE')],
        };
    }

    it('hides the new-loop button when RALPH_MULTI_LOOP is false (global mock)', () => {
        // This test runs with the module-level RALPH_MULTI_LOOP=false mock set in the outer describe.
        // It verifies the default-off behaviour.
        const view = makeRalphCompleteView();
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.queryByTestId('ralph-workflow-new-loop')).toBeNull();
    });
});
