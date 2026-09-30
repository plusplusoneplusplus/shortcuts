/**
 * AC-04 — "Awaiting input" timeline node in the Ralph pane.
 *
 * Covers placement after the asking iteration, hiding when the server does not
 * report `awaiting-input`, Submit (answers + note), "Use recommendation",
 * "Stop session", the default client calls, and error display.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { submitRalphInputMock, stopRalphSessionMock, mockModalSelection } = vi.hoisted(() => ({
    submitRalphInputMock: vi.fn(),
    stopRalphSessionMock: vi.fn(),
    mockModalSelection: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    const fakeClient = {
        workspaces: { submitRalphInput: submitRalphInputMock, stopRalphSession: stopRalphSessionMock },
    };
    return {
        ...actual,
        getSpaCocClient: () => fakeClient,
        getCocClientFor: () => fakeClient,
    };
});

vi.mock('../../../../src/server/spa/client/react/shared/ModalJobAiControls', () => ({
    useModalJobAiSelection: (options: unknown) => mockModalSelection(options),
    ModalJobAiControls: ({ testIdPrefix = 'modal-job' }: { testIdPrefix?: string }) => (
        <div data-testid={`${testIdPrefix}-ai-controls`} />
    ),
}));

vi.mock('../../../../src/server/spa/client/react/featureFlags', () => ({
    RALPH_MULTI_LOOP: false,
    SHOW_WELCOME_TUTORIAL: true,
    SHOW_FOCUSED_DIFF: true,
    SHOW_EXCALIDRAW_DIAGRAMS: true,
}));

import {
    RalphWorkflowPane,
    type RalphSessionView,
} from '../../../../src/server/spa/client/react/features/chat/RalphWorkflowPane';
import type { RalphPendingInput, RalphSessionRecord } from '@plusplusoneplusplus/coc-client';

const PENDING: RalphPendingInput = {
    iteration: 2,
    taskId: 'task-2',
    processId: 'proc-2',
    requestedAt: '2026-09-29T03:00:00.000Z',
    request: {
        context: 'The goal says **SQLite** but the repo uses Postgres.',
        questions: [
            {
                question: 'Which database should we target?',
                type: 'select',
                options: [
                    { value: 'sqlite', label: 'SQLite' },
                    { value: 'postgres', label: 'Postgres' },
                ],
                recommendation: 'postgres',
            },
            {
                question: 'Drop the old table?',
                type: 'yes-no',
                recommendation: 'No',
            },
            {
                question: 'Which envs?',
                type: 'multi-select',
                options: [
                    { value: 'dev', label: 'Dev' },
                    { value: 'prod', label: 'Prod' },
                ],
                recommendation: ['dev'],
            },
        ],
    },
};

function makeView(overrides: Partial<RalphSessionRecord> = {}): RalphSessionView {
    const now = Date.now();
    const record: RalphSessionRecord = {
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        originalGoal: 'Needs input goal',
        maxIterations: 10,
        currentIteration: 2,
        phase: 'awaiting-input',
        startedAt: new Date(now - 60_000).toISOString(),
        iterations: [1, 2, 3].slice(0, 2).map(i => ({
            iteration: i,
            loopIndex: 1,
            taskId: `task-${i}`,
            processId: `proc-${i}`,
            startedAt: new Date(now - 50_000).toISOString(),
            endedAt: new Date(now - 40_000).toISOString(),
            status: 'completed' as const,
            exitSignal: i === 2 ? 'RALPH_NEEDS_INPUT' as const : 'RALPH_NEXT' as const,
        })),
        pendingInput: PENDING,
        ...overrides,
    };
    return { record, sections: [] };
}

beforeEach(() => {
    submitRalphInputMock.mockReset();
    stopRalphSessionMock.mockReset();
    mockModalSelection.mockReset();
    mockModalSelection.mockReturnValue({ resolved: { provider: 'copilot' }, dirty: false });
});

describe('RalphWorkflowPane awaiting-input node', () => {
    it('renders the node after the asking iteration with context and questions', () => {
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={makeView()} />);

        const node = screen.getByTestId('ralph-awaiting-input-node');
        expect(node).toHaveTextContent('Awaiting input');
        expect(node).toHaveTextContent('Iteration 2 asked 3 questions');
        expect(screen.getByTestId('ralph-awaiting-input-context').innerHTML).toContain('<strong>SQLite</strong>');
        expect(screen.getAllByTestId('ralph-awaiting-input-question')).toHaveLength(3);
        expect(screen.getByTestId('ralph-workflow-phase')).toHaveTextContent('Awaiting input');

        // Order: iteration 1, iteration 2, then the awaiting-input node.
        const items = Array.from(screen.getByTestId('ralph-workflow-timeline').querySelectorAll('ol > li'));
        expect(items).toHaveLength(3);
        expect(within(items[2] as HTMLElement).getByTestId('ralph-awaiting-input-node')).toBeTruthy();
    });

    it('hides the node when the phase is not awaiting-input', () => {
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={makeView({ phase: 'executing' })} />);
        expect(screen.queryByTestId('ralph-awaiting-input-node')).toBeNull();
    });

    it('keeps Submit disabled until every question is answered', () => {
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={makeView()} onSubmitInput={vi.fn()} />);
        const submit = screen.getByTestId('ralph-awaiting-input-submit') as HTMLButtonElement;
        expect(submit.disabled).toBe(true);

        const options = screen.getAllByTestId('ralph-awaiting-input-option') as HTMLInputElement[];
        // select: sqlite, postgres; yes-no: yes, no; multi: dev, prod
        fireEvent.click(options[0]);
        fireEvent.click(options[2]);
        expect(submit.disabled).toBe(true);
        fireEvent.click(options[5]);
        expect(submit.disabled).toBe(false);
    });

    it('submits typed answers and the note through onSubmitInput', async () => {
        const onSubmitInput = vi.fn().mockResolvedValue(undefined);
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={makeView()} onSubmitInput={onSubmitInput} />);

        const options = screen.getAllByTestId('ralph-awaiting-input-option') as HTMLInputElement[];
        fireEvent.click(options[0]);
        fireEvent.click(options[2]);
        fireEvent.click(options[4]);
        fireEvent.click(options[5]);
        fireEvent.change(screen.getByTestId('ralph-awaiting-input-note'), { target: { value: '  keep it small  ' } });
        fireEvent.click(screen.getByTestId('ralph-awaiting-input-submit'));

        await waitFor(() => expect(onSubmitInput).toHaveBeenCalledTimes(1));
        expect(onSubmitInput).toHaveBeenCalledWith(['sqlite', 'yes', ['dev', 'prod']], 'keep it small');
    });

    it('"Use recommendation" fills every answer from the recommendations', async () => {
        const onSubmitInput = vi.fn().mockResolvedValue(undefined);
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={makeView()} onSubmitInput={onSubmitInput} />);

        fireEvent.click(screen.getByTestId('ralph-awaiting-input-use-recommendation'));
        const options = screen.getAllByTestId('ralph-awaiting-input-option') as HTMLInputElement[];
        expect(options[1].checked).toBe(true); // postgres
        expect(options[3].checked).toBe(true); // no
        expect(options[4].checked).toBe(true); // dev
        expect(options[5].checked).toBe(false);

        fireEvent.click(screen.getByTestId('ralph-awaiting-input-submit'));
        await waitFor(() => expect(onSubmitInput).toHaveBeenCalledWith(['postgres', 'no', ['dev']], undefined));
    });

    it('selects the visible Confirm choice for a yes recommendation', async () => {
        const onSubmitInput = vi.fn().mockResolvedValue(undefined);
        const view = makeView({
            pendingInput: {
                ...PENDING,
                request: { context: 'Proceed?', questions: [{ question: 'Proceed?', type: 'confirm', recommendation: 'yes' }] },
            },
        });
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} onSubmitInput={onSubmitInput} />);
        fireEvent.click(screen.getByTestId('ralph-awaiting-input-use-recommendation'));
        const options = screen.getAllByTestId('ralph-awaiting-input-option') as HTMLInputElement[];
        expect(options[0].checked).toBe(true);
        expect(options[1].checked).toBe(false);
        fireEvent.click(screen.getByTestId('ralph-awaiting-input-submit'));
        await waitFor(() => expect(onSubmitInput).toHaveBeenCalledWith(['confirm'], undefined));
    });

    it('shows the matching option for a confirm default', () => {
        const view = makeView({
            pendingInput: {
                ...PENDING,
                request: {
                    context: 'Proceed?',
                    questions: [{ question: 'Proceed?', type: 'confirm', defaultValue: 'no', recommendation: 'yes' }],
                },
            },
        });
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        const options = screen.getAllByTestId('ralph-awaiting-input-option') as HTMLInputElement[];
        expect(options[0].checked).toBe(false);
        expect(options[1].checked).toBe(true);
    });

    it('renders a textarea for text questions and trims the answer', async () => {
        const onSubmitInput = vi.fn().mockResolvedValue(undefined);
        const view = makeView({
            pendingInput: {
                ...PENDING,
                request: {
                    context: 'Need a token name.',
                    questions: [{ question: 'Env var name?', type: 'text', recommendation: 'API_TOKEN' }],
                },
            },
        });
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} onSubmitInput={onSubmitInput} />);

        fireEvent.change(screen.getByTestId('ralph-awaiting-input-text'), { target: { value: ' MY_TOKEN ' } });
        fireEvent.click(screen.getByTestId('ralph-awaiting-input-submit'));
        await waitFor(() => expect(onSubmitInput).toHaveBeenCalledWith(['MY_TOKEN'], undefined));
    });

    it('"Stop session" calls onStopSession', async () => {
        const onStopSession = vi.fn().mockResolvedValue(undefined);
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={makeView()} onStopSession={onStopSession} />);
        fireEvent.click(screen.getByTestId('ralph-awaiting-input-stop'));
        await waitFor(() => expect(onStopSession).toHaveBeenCalledTimes(1));
    });

    it('shows the handler error inline', async () => {
        const onStopSession = vi.fn().mockRejectedValue(new Error('Session is not awaiting input'));
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={makeView()} onStopSession={onStopSession} />);
        fireEvent.click(screen.getByTestId('ralph-awaiting-input-stop'));
        expect(await screen.findByTestId('ralph-awaiting-input-error')).toHaveTextContent('Session is not awaiting input');
    });

    it('falls back to the clone client submitRalphInput / stopRalphSession', async () => {
        submitRalphInputMock.mockResolvedValue({ resumed: true });
        stopRalphSessionMock.mockResolvedValue({ stopped: true });
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={makeView()} />);

        fireEvent.click(screen.getByTestId('ralph-awaiting-input-use-recommendation'));
        fireEvent.change(screen.getByTestId('ralph-awaiting-input-note'), { target: { value: 'ship it' } });
        fireEvent.click(screen.getByTestId('ralph-awaiting-input-submit'));
        await waitFor(() => expect(submitRalphInputMock).toHaveBeenCalledTimes(1));
        expect(submitRalphInputMock).toHaveBeenCalledWith('ws-1', 'sess-1', {
            answers: ['postgres', 'no', ['dev']],
            note: 'ship it',
        });

        fireEvent.click(screen.getByTestId('ralph-awaiting-input-stop'));
        await waitFor(() => expect(stopRalphSessionMock).toHaveBeenCalledWith('ws-1', 'sess-1'));
    });

    it('labels a USER_STOPPED session and offers Submit PR', () => {
        const view = makeView({
            phase: 'complete',
            pendingInput: undefined,
            terminalReason: 'USER_STOPPED',
            completedAt: new Date().toISOString(),
        });
        render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
        expect(screen.getByTestId('ralph-workflow-terminal-reason')).toHaveTextContent('Stopped by user');
        expect(screen.getByTestId('ralph-workflow-submit-pr')).toBeTruthy();
        expect(screen.queryByTestId('ralph-awaiting-input-node')).toBeNull();
    });
});
