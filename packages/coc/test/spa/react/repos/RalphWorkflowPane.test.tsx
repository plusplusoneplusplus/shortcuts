/**
 * Tests for RalphWorkflowPane — pure presentational rendering with fixture data.
 *
 * Commit 5 scope: skeleton component renders header, phase badge, iteration
 * count, terminal reason (when set), and clickable iteration nodes. No data
 * fetching is exercised here — that comes in commit 7.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockModalSelection } = vi.hoisted(() => ({
    mockModalSelection: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/shared/ModalJobAiControls', () => ({
    useModalJobAiSelection: (options: unknown) => mockModalSelection(options),
    ModalJobAiControls: ({
        testIdPrefix = 'modal-job',
        disabled = false,
    }: {
        testIdPrefix?: string;
        disabled?: boolean;
    }) => (
        <div
            data-testid={`${testIdPrefix}-ai-controls`}
            data-disabled={disabled ? 'true' : 'false'}
        />
    ),
}));

import {
    RalphWorkflowPane,
    type RalphSessionView,
} from '../../../../src/server/spa/client/react/features/chat/RalphWorkflowPane';
import type {
    ParsedProgressSection,
    RalphFinalCheckRecord,
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

beforeEach(() => {
    mockModalSelection.mockReset();
    mockModalSelection.mockReturnValue({
        resolved: { provider: 'copilot' },
        dirty: false,
    });
});

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

function makeFinalCheck(overrides: Partial<RalphFinalCheckRecord> = {}): RalphFinalCheckRecord {
    return {
        checkIndex: 1,
        loopIndex: 1,
        sourceIteration: 1,
        processId: 'fc-proc-1',
        startedAt: new Date(Date.now() - 20_000).toISOString(),
        completedAt: new Date(Date.now() - 10_000).toISOString(),
        status: 'completed',
        hasGaps: false,
        ...overrides,
    };
}

function makeLoop(overrides: Partial<RalphLoopRecord> = {}): RalphLoopRecord {
    return {
        loopIndex: 1,
        goal: 'Original goal',
        startIteration: 1,
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        ...overrides,
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

    it('renders a worktree chip when the session was launched into an isolated worktree (AC-05)', () => {
        const view: RalphSessionView = {
            record: makeRecord({
                worktree: {
                    id: 'sess-1',
                    workspaceId: 'ws-1',
                    path: '/root/.coc/repos/ws-1/git-worktrees/sess-1',
                    branch: 'coc/build-dashboard-ab12cd34',
                    baseSha: 'deadbeefcafebabe0123456789abcdef01234567',
                    createdAt: new Date().toISOString(),
                    sourceDirty: false,
                    status: 'active',
                },
            }),
            sections: [],
        };
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.getByTestId('ralph-workflow-worktree-chip')).toBeInTheDocument();
        expect(screen.getByTestId('ralph-workflow-worktree-chip-branch').textContent)
            .toBe('coc/build-dashboard-ab12cd34');
    });

    it('omits the worktree chip for a non-worktree session', () => {
        const view: RalphSessionView = { record: makeRecord(), sections: [] };
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.queryByTestId('ralph-workflow-worktree-chip')).toBeNull();
    });

    describe('worktree cleanup (AC-06)', () => {
        function worktreeView(recordOverrides: Partial<RalphSessionRecord>, hasInFlightTask?: boolean): RalphSessionView {
            return {
                record: makeRecord({
                    worktree: {
                        id: 'sess-1',
                        workspaceId: 'ws-1',
                        path: '/root/.coc/repos/ws-1/git-worktrees/sess-1',
                        branch: 'coc/build-dashboard-ab12cd34',
                        baseSha: 'deadbeefcafebabe0123456789abcdef01234567',
                        createdAt: new Date().toISOString(),
                        sourceDirty: false,
                        status: 'active',
                    },
                    ...recordOverrides,
                }),
                sections: [],
                hasInFlightTask,
            };
        }

        it('cleans up from the chip on a completed session and flips the chip to cleaned', async () => {
            const onCleanupWorktree = vi.fn().mockResolvedValue({
                worktree: {
                    id: 'sess-1', workspaceId: 'ws-1', path: '/root/.coc/repos/ws-1/git-worktrees/sess-1',
                    branch: 'coc/build-dashboard-ab12cd34', baseSha: 'deadbeefcafebabe0123456789abcdef01234567',
                    createdAt: new Date().toISOString(), sourceDirty: false, status: 'cleaned',
                    cleanedAt: new Date().toISOString(),
                },
                alreadyCleaned: false,
            });
            vi.spyOn(window, 'confirm').mockReturnValue(true);
            const view = worktreeView({ phase: 'complete', terminalReason: 'RALPH_COMPLETE' }, false);
            render(
                <RalphWorkflowPane
                    workspaceId="ws-1"
                    sessionId="sess-1"
                    view={view}
                    onCleanupWorktree={onCleanupWorktree}
                />,
            );
            const btn = screen.getByTestId('ralph-workflow-worktree-chip-cleanup') as HTMLButtonElement;
            expect(btn.disabled).toBe(false);
            fireEvent.click(btn);
            await waitFor(() => expect(onCleanupWorktree).toHaveBeenCalledWith('sess-1'));
            await waitFor(() =>
                expect(screen.getByTestId('ralph-workflow-worktree-chip-status').textContent).toBe('cleaned'),
            );
        });

        it('disables cleanup while the session is still running', () => {
            const onCleanupWorktree = vi.fn();
            const view = worktreeView({ phase: 'executing' }, true);
            render(
                <RalphWorkflowPane
                    workspaceId="ws-1"
                    sessionId="sess-1"
                    view={view}
                    onCleanupWorktree={onCleanupWorktree}
                />,
            );
            const btn = screen.getByTestId('ralph-workflow-worktree-chip-cleanup') as HTMLButtonElement;
            expect(btn.disabled).toBe(true);
        });

        it('surfaces a refused-cleanup error and leaves the chip active', async () => {
            const onCleanupWorktree = vi.fn().mockRejectedValue(
                new Error("fatal: contains modified or untracked files, use --force to delete it"),
            );
            vi.spyOn(window, 'confirm').mockReturnValue(true);
            const view = worktreeView({ phase: 'complete', terminalReason: 'RALPH_COMPLETE' }, false);
            render(
                <RalphWorkflowPane
                    workspaceId="ws-1"
                    sessionId="sess-1"
                    view={view}
                    onCleanupWorktree={onCleanupWorktree}
                />,
            );
            fireEvent.click(screen.getByTestId('ralph-workflow-worktree-chip-cleanup'));
            await waitFor(() =>
                expect(screen.getByTestId('ralph-workflow-worktree-chip-cleanup-error').textContent)
                    .toContain('untracked files'),
            );
            expect(screen.getByTestId('ralph-workflow-worktree-chip-status').textContent).toBe('active');
        });
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

    it('renders the manual-verification-needed terminal reason', () => {
        const view: RalphSessionView = {
            record: makeRecord({
                phase: 'complete',
                currentIteration: 4,
                completedAt: new Date().toISOString(),
                terminalReason: 'MANUAL_VERIFICATION_ONLY',
                iterations: [makeIter(1), makeIter(2), makeIter(3), makeIter(4)],
            }),
            sections: [makeSection(4)],
        };
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.getByTestId('ralph-workflow-terminal-reason')).toHaveTextContent(/Manual verification needed/);
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

    it('renders an empty session-files state when no files are available', () => {
        const view: RalphSessionView = {
            record: makeRecord({ iterations: [makeIter(1)] }),
            sections: [makeSection(1)],
            files: [],
        };
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.getByTestId('ralph-session-files-empty')).toHaveTextContent(/No session files/i);
    });

    it('renders markdown session files with the markdown renderer', () => {
        const view: RalphSessionView = {
            record: makeRecord({ iterations: [makeIter(1)] }),
            sections: [makeSection(1)],
            files: [
                { name: 'progress.md', content: '# Progress\n\n**Done** with iteration 1.' },
            ],
        };
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        const content = screen.getByTestId('ralph-session-file-content');
        expect(content.querySelector('.markdown-body')).not.toBeNull();
        expect(content).toHaveTextContent('Progress');
        expect(content).toHaveTextContent('Done');
    });

    it('formats JSON session files as indented plain text', () => {
        const view: RalphSessionView = {
            record: makeRecord({ iterations: [makeIter(1)] }),
            sections: [makeSection(1)],
            files: [
                { name: 'session.json', content: '{"answer":42,"nested":{"ok":true}}' },
            ],
        };
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.getByTestId('ralph-session-file-text').textContent).toBe(
            '{\n  "answer": 42,\n  "nested": {\n    "ok": true\n  }\n}',
        );
    });

    it('pre-selects the file matching selectedFileName', () => {
        const view: RalphSessionView = {
            record: makeRecord({ iterations: [makeIter(1)] }),
            sections: [makeSection(1)],
            files: [
                { name: 'progress.md', content: '# Progress' },
                { name: 'session.json', content: '{"selected":true}' },
            ],
        };
        render(
            <RalphWorkflowPane
                workspaceId="ws-1"
                sessionId="sess-1"
                view={view}
                selectedFileName="session.json"
            />,
        );
        expect(screen.getByRole('button', { name: 'session.json' })).toHaveAttribute('aria-current', 'true');
        expect(screen.getByTestId('ralph-session-file-text')).toHaveTextContent('"selected": true');
    });

    it('selects the first returned file by default', () => {
        const view: RalphSessionView = {
            record: makeRecord({ iterations: [makeIter(1)] }),
            sections: [makeSection(1)],
            files: [
                { name: 'a-first.md', content: '# First file' },
                { name: 'b-second.md', content: '# Second file' },
            ],
        };
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.getByRole('button', { name: 'a-first.md' })).toHaveAttribute('aria-current', 'true');
        expect(screen.getByTestId('ralph-session-file-content')).toHaveTextContent('First file');
    });

    it('updates the displayed file when a user selects a file', async () => {
        const user = userEvent.setup();
        const onSelectFile = vi.fn();
        const view: RalphSessionView = {
            record: makeRecord({ iterations: [makeIter(1)] }),
            sections: [makeSection(1)],
            files: [
                { name: 'progress.md', content: '# Progress' },
                { name: 'session.json', content: '{"clicked":true}' },
            ],
        };
        render(
            <RalphWorkflowPane
                workspaceId="ws-1"
                sessionId="sess-1"
                view={view}
                onSelectFile={onSelectFile}
            />,
        );
        await user.click(screen.getByRole('button', { name: 'session.json' }));
        expect(onSelectFile).toHaveBeenCalledWith('session.json');
        expect(screen.getByTestId('ralph-session-file-text')).toHaveTextContent('"clicked": true');
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

    it('hides the Continue loop button when only manual verification remains', () => {
        const view: RalphSessionView = {
            record: makeRecord({
                phase: 'complete',
                currentIteration: 4,
                completedAt: new Date().toISOString(),
                terminalReason: 'MANUAL_VERIFICATION_ONLY',
                iterations: [makeIter(4)],
            }),
            sections: [makeSection(4)],
        };
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.queryByTestId('ralph-workflow-continue')).toBeNull();
    });


    it('shows the Continue loop button when NO_SIGNAL did not reach the cap (early agent failure)', () => {
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
        expect(screen.getByTestId('ralph-workflow-continue')).toBeInTheDocument();
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
        expect(screen.getByTestId('ralph-workflow-continue-ai-controls')).toBeInTheDocument();
        expect(screen.queryByTestId('ralph-workflow-resume-ai-controls')).toBeNull();
        await user.click(screen.getByTestId('ralph-workflow-continue-confirm-button'));
        // No recoverable defaults + untouched controls → the resolved selection is forwarded.
        expect(onContinue).toHaveBeenCalledWith(5, { provider: 'copilot' });
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

    function makeContinuableView(
        resumeDefaults?: RalphSessionView['resumeDefaults'],
    ): RalphSessionView {
        return {
            record: makeRecord({
                phase: 'complete',
                currentIteration: 10,
                completedAt: new Date().toISOString(),
                terminalReason: 'CAP_REACHED',
                iterations: [makeIter(10)],
            }),
            sections: [makeSection(10)],
            ...(resumeDefaults ? { resumeDefaults } : {}),
        };
    }

    it('initializes Continue AI controls from recovered defaults and omits unchanged overrides', async () => {
        const user = userEvent.setup();
        const onContinue = vi.fn().mockResolvedValue(undefined);
        const resumeDefaults = {
            provider: 'codex' as const,
            model: 'gpt-5.3-codex',
            reasoningEffort: 'high' as const,
        };
        mockModalSelection.mockReturnValue({ resolved: resumeDefaults, dirty: false });

        render(
            <RalphWorkflowPane
                workspaceId="ws-1"
                sessionId="sess-1"
                view={makeContinuableView(resumeDefaults)}
                continueDefaultIterations={5}
                onContinue={onContinue}
            />,
        );

        await user.click(screen.getByTestId('ralph-workflow-continue'));
        expect(mockModalSelection).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            mode: 'ralph',
            initialSelection: resumeDefaults,
        });
        await user.click(screen.getByTestId('ralph-workflow-continue-confirm-button'));
        // Untouched controls with recoverable defaults → omit the override entirely.
        expect(onContinue).toHaveBeenCalledWith(5, undefined);
    });

    it('passes a changed Continue AI selection to onContinue', async () => {
        const user = userEvent.setup();
        const onContinue = vi.fn().mockResolvedValue(undefined);
        const resumeDefaults = {
            provider: 'codex' as const,
            model: 'gpt-5.3-codex',
            reasoningEffort: 'medium' as const,
        };
        const changedSelection = {
            provider: 'claude' as const,
            model: 'claude-sonnet-4.6',
            reasoningEffort: 'high',
            effortTier: 'low' as const,
        };
        mockModalSelection.mockReturnValue({ resolved: changedSelection, dirty: true });

        render(
            <RalphWorkflowPane
                workspaceId="ws-1"
                sessionId="sess-1"
                view={makeContinuableView(resumeDefaults)}
                continueDefaultIterations={5}
                onContinue={onContinue}
            />,
        );

        await user.click(screen.getByTestId('ralph-workflow-continue'));
        await user.click(screen.getByTestId('ralph-workflow-continue-confirm-button'));
        expect(onContinue).toHaveBeenCalledWith(5, changedSelection);
    });

    it('disables Continue AI controls while submitting', async () => {
        const user = userEvent.setup();
        let resolveContinue!: () => void;
        const onContinue = vi.fn(() => new Promise<void>((resolve) => { resolveContinue = resolve; }));

        render(
            <RalphWorkflowPane
                workspaceId="ws-1"
                sessionId="sess-1"
                view={makeContinuableView()}
                onContinue={onContinue}
            />,
        );

        await user.click(screen.getByTestId('ralph-workflow-continue'));
        expect(screen.getByTestId('ralph-workflow-continue-ai-controls')).toHaveAttribute('data-disabled', 'false');
        await user.click(screen.getByTestId('ralph-workflow-continue-confirm-button'));
        expect(screen.getByTestId('ralph-workflow-continue-ai-controls')).toHaveAttribute('data-disabled', 'true');
        resolveContinue();
    });
});

// ---------------------------------------------------------------------------
// Final-check timeline nodes + gap-fix loop dividers
// (RALPH_MULTI_LOOP stays false — final-check visibility is not flag-gated)
// ---------------------------------------------------------------------------

describe('RalphWorkflowPane — final-check timeline', () => {
    it('renders a final-check node labeled with its index after the source iteration', () => {
        const view: RalphSessionView = {
            record: makeRecord({
                phase: 'complete',
                currentIteration: 2,
                completedAt: new Date().toISOString(),
                terminalReason: 'RALPH_COMPLETE',
                iterations: [makeIter(1), makeIter(2)],
                finalChecks: [makeFinalCheck({ checkIndex: 1, sourceIteration: 2, hasGaps: false })],
            }),
            sections: [makeSection(1), makeSection(2)],
        };
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);

        const node = screen.getByTestId('ralph-final-check-node-1');
        expect(node).toHaveTextContent('Final check #1');
        expect(screen.getByTestId('ralph-final-check-status-1')).toHaveTextContent('Completed');

        // Ordered after the source iteration (#2).
        const iter2 = screen.getByTestId('ralph-workflow-node-2');
        expect(
            iter2.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it.each([
        [{ status: 'completed' as const, hasGaps: false }, 'No gaps'],
        [{ status: 'completed' as const, hasGaps: true, gapCount: 0 }, 'No gaps'],
        [{ status: 'completed' as const, hasGaps: true, gapCount: 1 }, '1 gap'],
        [{ status: 'completed' as const, hasGaps: true, gapCount: 3 }, '3 gaps'],
        [{ status: 'running' as const, completedAt: undefined }, 'Checking for gaps'],
        [{ status: 'queued' as const, completedAt: undefined }, 'Queued for validation'],
        [{ status: 'failed' as const }, 'Check did not complete'],
    ])('renders gap-summary copy %o → %s', (partial, expected) => {
        const view: RalphSessionView = {
            record: makeRecord({
                currentIteration: 1,
                iterations: [makeIter(1)],
                finalChecks: [makeFinalCheck({ checkIndex: 1, sourceIteration: 1, ...partial })],
            }),
            sections: [makeSection(1)],
        };
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.getByTestId('ralph-final-check-gaps-1')).toHaveTextContent(expected);
    });

    it('calls onSelectFinalCheck with the recorded processId when clicked', async () => {
        const user = userEvent.setup();
        const onSelectFinalCheck = vi.fn();
        const view: RalphSessionView = {
            record: makeRecord({
                currentIteration: 1,
                iterations: [makeIter(1)],
                finalChecks: [makeFinalCheck({ checkIndex: 1, sourceIteration: 1, processId: 'fc-proc-77' })],
            }),
            sections: [makeSection(1)],
        };
        render(
            <RalphWorkflowPane
                workspaceId="ws-1"
                sessionId="sess-1"
                view={view}
                onSelectFinalCheck={onSelectFinalCheck}
            />,
        );
        await user.click(screen.getByTestId('ralph-final-check-node-1'));
        expect(onSelectFinalCheck).toHaveBeenCalledWith('fc-proc-77');
    });

    it('renders a final-check node without a processId as disabled and non-clickable', async () => {
        const user = userEvent.setup();
        const onSelectFinalCheck = vi.fn();
        const view: RalphSessionView = {
            record: makeRecord({
                currentIteration: 1,
                iterations: [makeIter(1)],
                finalChecks: [makeFinalCheck({ checkIndex: 1, sourceIteration: 1, processId: undefined, status: 'running', completedAt: undefined })],
            }),
            sections: [makeSection(1)],
        };
        render(
            <RalphWorkflowPane
                workspaceId="ws-1"
                sessionId="sess-1"
                view={view}
                onSelectFinalCheck={onSelectFinalCheck}
            />,
        );
        const node = screen.getByTestId('ralph-final-check-node-1');
        expect(node).toBeDisabled();
        await user.click(node);
        expect(onSelectFinalCheck).not.toHaveBeenCalled();
    });

    it('renders a "Gap fix loop" divider before the gap-fix loop and after its final-check node', () => {
        const view: RalphSessionView = {
            record: makeRecord({
                phase: 'complete',
                currentIteration: 3,
                completedAt: new Date().toISOString(),
                terminalReason: 'RALPH_COMPLETE',
                iterations: [makeIter(1), makeIter(2), makeIter(3)],
                loops: [
                    makeLoop({ loopIndex: 1, goal: 'Original goal', startIteration: 1 }),
                    makeLoop({ loopIndex: 2, goal: 'Close the validation gaps', startIteration: 3 }),
                ],
                finalChecks: [
                    makeFinalCheck({
                        checkIndex: 1,
                        loopIndex: 1,
                        sourceIteration: 2,
                        processId: 'fc-proc-1',
                        status: 'completed',
                        hasGaps: true,
                        gapCount: 2,
                        gapLoopStarted: true,
                        gapLoopIndex: 2,
                    }),
                ],
            }),
            sections: [makeSection(1), makeSection(2), makeSection(3)],
        };
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);

        const divider = screen.getByTestId('ralph-loop-divider-2');
        expect(divider).toHaveTextContent('Gap fix loop 2');
        expect(divider).toHaveTextContent('Close the validation gaps');

        const fcNode = screen.getByTestId('ralph-final-check-node-1');
        const iter3 = screen.getByTestId('ralph-workflow-node-3');
        // final-check node → divider → gap-fix iteration, in DOM order.
        expect(
            fcNode.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(
            divider.compareDocumentPosition(iter3) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it('keeps gap-fix iteration nodes clickable as ordinary iteration nodes', async () => {
        const user = userEvent.setup();
        const onSelectIteration = vi.fn();
        const view: RalphSessionView = {
            record: makeRecord({
                phase: 'complete',
                currentIteration: 3,
                completedAt: new Date().toISOString(),
                terminalReason: 'RALPH_COMPLETE',
                iterations: [makeIter(1), makeIter(2), { ...makeIter(3), loopIndex: 2 }],
                loops: [
                    makeLoop({ loopIndex: 1, startIteration: 1 }),
                    makeLoop({ loopIndex: 2, goal: 'fix gaps', startIteration: 3 }),
                ],
                finalChecks: [
                    makeFinalCheck({
                        checkIndex: 1,
                        sourceIteration: 2,
                        gapLoopStarted: true,
                        gapLoopIndex: 2,
                        hasGaps: true,
                        gapCount: 1,
                    }),
                ],
            }),
            sections: [makeSection(1), makeSection(2), makeSection(3)],
        };
        render(
            <RalphWorkflowPane
                workspaceId="ws-1"
                sessionId="sess-1"
                view={view}
                onSelectIteration={onSelectIteration}
            />,
        );
        await user.click(screen.getByTestId('ralph-workflow-node-3'));
        expect(onSelectIteration).toHaveBeenCalledWith(3);
    });

    it('does not render a generic Loop divider when RALPH_MULTI_LOOP is off and the loop is not a gap-fix loop', () => {
        const view: RalphSessionView = {
            record: makeRecord({
                phase: 'complete',
                currentIteration: 3,
                completedAt: new Date().toISOString(),
                terminalReason: 'RALPH_COMPLETE',
                iterations: [makeIter(1), makeIter(2), makeIter(3)],
                loops: [
                    makeLoop({ loopIndex: 1, startIteration: 1 }),
                    makeLoop({ loopIndex: 2, goal: 'second goal', startIteration: 3 }),
                ],
                finalChecks: [],
            }),
            sections: [makeSection(1), makeSection(2), makeSection(3)],
        };
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.queryByTestId('ralph-loop-divider-2')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Resume UI (stuck executing session)
// ---------------------------------------------------------------------------

describe('RalphWorkflowPane — resume stuck executing session', () => {
    // A stuck session defaults to hasInFlightTask=false (the server found no
    // queued/running task backing it). viewOverrides lets a test flip that.
    function makeStuckView(
        overrides: Partial<RalphSessionRecord> = {},
        viewOverrides: Partial<RalphSessionView> = {},
    ): RalphSessionView {
        return {
            record: makeRecord({
                phase: 'executing',
                currentIteration: 3,
                iterations: [
                    makeIter(1),
                    makeIter(2),
                    makeIter(3),
                ],
                ...overrides,
            }),
            sections: [makeSection(1), makeSection(2), makeSection(3)],
            hasInFlightTask: false,
            ...viewOverrides,
        };
    }

    it('shows Resume button when session is stuck executing', () => {
        const view = makeStuckView();
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.getByTestId('ralph-workflow-resume')).toBeInTheDocument();
    });

    it('does not show Resume when a Ralph task is still in flight', () => {
        const view = makeStuckView({}, { hasInFlightTask: true });
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.queryByTestId('ralph-workflow-resume')).toBeNull();
        expect(screen.queryByTestId('ralph-workflow-resume-ai-controls')).toBeNull();
    });

    // Regression: a session cancelled during its first iteration — before any
    // iteration was recorded — has currentIteration=0 and iterations=[]. It must
    // still offer Resume, because no task is in flight. (Previously the
    // currentIteration>0 guard hid the button and left the session un-resumable
    // from the UI.)
    it('shows Resume for a first-iteration cancellation (currentIteration 0, no in-flight task)', () => {
        const view = makeStuckView({ currentIteration: 0, iterations: [] });
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.getByTestId('ralph-workflow-resume')).toBeInTheDocument();
    });

    // The mirror case: a freshly launched session whose first iteration is
    // genuinely running also has currentIteration=0 / iterations=[], but a task
    // IS in flight, so Resume must stay hidden.
    it('does not show Resume for a freshly launched session whose first iteration is running', () => {
        const view = makeStuckView({ currentIteration: 0, iterations: [] }, { hasInFlightTask: true });
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.queryByTestId('ralph-workflow-resume')).toBeNull();
    });

    // Backward compatibility: an older/remote server that does not send
    // hasInFlightTask leaves it undefined; Resume stays hidden (no false
    // positives), matching prior behavior.
    it('does not show Resume when hasInFlightTask is absent (older/remote server)', () => {
        const view = makeStuckView({}, { hasInFlightTask: undefined });
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.queryByTestId('ralph-workflow-resume')).toBeNull();
    });

    it('does not show Resume when phase is complete', () => {
        const view: RalphSessionView = {
            record: makeRecord({
                phase: 'complete',
                currentIteration: 3,
                completedAt: new Date().toISOString(),
                terminalReason: 'RALPH_COMPLETE',
                iterations: [makeIter(1), makeIter(2), makeIter(3)],
            }),
            sections: [makeSection(1), makeSection(2), makeSection(3)],
        };
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.queryByTestId('ralph-workflow-resume')).toBeNull();
        expect(screen.queryByTestId('ralph-workflow-resume-ai-controls')).toBeNull();
    });

    it('shows confirmation panel and calls onResume on confirm', async () => {
        const user = userEvent.setup();
        const onResume = vi.fn().mockResolvedValue(undefined);
        const view = makeStuckView();
        render(
            <RalphWorkflowPane
                workspaceId="ws-1"
                sessionId="sess-1"
                view={view}
                onResume={onResume}
            />,
        );
        await user.click(screen.getByTestId('ralph-workflow-resume'));
        expect(screen.getByTestId('ralph-workflow-resume-confirm')).toBeInTheDocument();
        expect(screen.getByTestId('ralph-workflow-resume-ai-controls')).toBeInTheDocument();
        expect(screen.getByText(/iteration 4/)).toBeInTheDocument();
        await user.click(screen.getByTestId('ralph-workflow-resume-confirm-button'));
        expect(onResume).toHaveBeenCalledWith({ provider: 'copilot' });
    });

    it('initializes Resume AI controls from recovered defaults and omits unchanged overrides', async () => {
        const user = userEvent.setup();
        const onResume = vi.fn().mockResolvedValue(undefined);
        const resumeDefaults = {
            provider: 'codex' as const,
            model: 'gpt-5.3-codex',
            reasoningEffort: 'high' as const,
        };
        const view = { ...makeStuckView(), resumeDefaults };
        mockModalSelection.mockReturnValue({
            resolved: resumeDefaults,
            dirty: false,
        });

        render(
            <RalphWorkflowPane
                workspaceId="ws-1"
                sessionId="sess-1"
                view={view}
                onResume={onResume}
            />,
        );

        await user.click(screen.getByTestId('ralph-workflow-resume'));
        expect(mockModalSelection).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            mode: 'ralph',
            initialSelection: resumeDefaults,
        });
        await user.click(screen.getByTestId('ralph-workflow-resume-confirm-button'));

        expect(onResume).toHaveBeenCalledWith(undefined);
    });

    it('passes a changed Resume AI selection to onResume', async () => {
        const user = userEvent.setup();
        const onResume = vi.fn().mockResolvedValue(undefined);
        const resumeDefaults = {
            provider: 'codex' as const,
            model: 'gpt-5.3-codex',
            reasoningEffort: 'medium' as const,
        };
        const changedSelection = {
            provider: 'claude' as const,
            model: 'claude-sonnet-4.6',
            reasoningEffort: 'high',
            effortTier: 'low' as const,
        };
        mockModalSelection.mockReturnValue({
            resolved: changedSelection,
            dirty: true,
        });

        render(
            <RalphWorkflowPane
                workspaceId="ws-1"
                sessionId="sess-1"
                view={{ ...makeStuckView(), resumeDefaults }}
                onResume={onResume}
            />,
        );

        await user.click(screen.getByTestId('ralph-workflow-resume'));
        await user.click(screen.getByTestId('ralph-workflow-resume-confirm-button'));

        expect(onResume).toHaveBeenCalledWith(changedSelection);
    });

    it('disables Resume AI controls while submitting', async () => {
        const user = userEvent.setup();
        let resolveResume!: () => void;
        const onResume = vi.fn(() => new Promise<void>((resolve) => { resolveResume = resolve; }));
        const view = makeStuckView();
        render(
            <RalphWorkflowPane
                workspaceId="ws-1"
                sessionId="sess-1"
                view={view}
                onResume={onResume}
            />,
        );

        await user.click(screen.getByTestId('ralph-workflow-resume'));
        expect(screen.getByTestId('ralph-workflow-resume-ai-controls')).toHaveAttribute('data-disabled', 'false');
        await user.click(screen.getByTestId('ralph-workflow-resume-confirm-button'));
        expect(screen.getByTestId('ralph-workflow-resume-ai-controls')).toHaveAttribute('data-disabled', 'true');
        resolveResume();
    });

    it('cancel button hides the resume confirmation panel', async () => {
        const user = userEvent.setup();
        const onResume = vi.fn().mockResolvedValue(undefined);
        const view = makeStuckView();
        render(
            <RalphWorkflowPane
                workspaceId="ws-1"
                sessionId="sess-1"
                view={view}
                onResume={onResume}
            />,
        );
        await user.click(screen.getByTestId('ralph-workflow-resume'));
        await user.click(screen.getByTestId('ralph-workflow-resume-cancel'));
        expect(screen.queryByTestId('ralph-workflow-resume-confirm')).toBeNull();
        expect(onResume).not.toHaveBeenCalled();
    });

    it('shows error when resume fails', async () => {
        const user = userEvent.setup();
        const onResume = vi.fn().mockRejectedValue(new Error('Network error'));
        const view = makeStuckView();
        render(
            <RalphWorkflowPane
                workspaceId="ws-1"
                sessionId="sess-1"
                view={view}
                onResume={onResume}
            />,
        );
        await user.click(screen.getByTestId('ralph-workflow-resume'));
        await user.click(screen.getByTestId('ralph-workflow-resume-confirm-button'));
        expect(await screen.findByTestId('ralph-workflow-resume-error')).toHaveTextContent('Network error');
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
