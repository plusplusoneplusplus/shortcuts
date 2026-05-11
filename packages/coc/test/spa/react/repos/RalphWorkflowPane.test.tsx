/**
 * Tests for RalphWorkflowPane — pure presentational rendering with fixture data.
 *
 * Commit 5 scope: skeleton component renders header, phase badge, iteration
 * count, terminal reason (when set), and clickable iteration nodes. No data
 * fetching is exercised here — that comes in commit 7.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
    RalphWorkflowPane,
    type RalphSessionView,
} from '../../../../src/server/spa/client/react/features/chat/RalphWorkflowPane';
import type {
    ParsedProgressSection,
    RalphIterationRecord,
    RalphSessionRecord,
} from '@plusplusoneplusplus/coc-client';

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
});
