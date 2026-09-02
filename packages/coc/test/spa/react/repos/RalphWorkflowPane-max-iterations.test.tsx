/**
 * AC-03 — inline total-iteration-cap editor in the Ralph pane header.
 *
 * Covers click-to-edit, a successful submit, the client-side guard (which must
 * fire no request), the server-error path (message verbatim + previous value
 * kept), the "this stops the loop" confirmation, and the terminal session that
 * renders the counter as plain text.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { requestMock, mockModalSelection } = vi.hoisted(() => ({
    requestMock: vi.fn(),
    mockModalSelection: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    const fakeClient = { request: requestMock };
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
import type { RalphSessionRecord } from '@plusplusoneplusplus/coc-client';

const CAP_PATH = '/workspaces/ws-1/ralph-sessions/sess-1/max-iterations';

function makeView(overrides: Partial<RalphSessionRecord> = {}): RalphSessionView {
    const record: RalphSessionRecord = {
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        originalGoal: 'Adjustable Ralph cap',
        maxIterations: 10,
        currentIteration: 2,
        phase: 'executing',
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        iterations: [],
        ...overrides,
    };
    return { record, sections: [] };
}

function renderPane(view: RalphSessionView) {
    return render(<RalphWorkflowPane workspaceId="ws-1" sessionId="sess-1" view={view} />);
}

function openEditor() {
    fireEvent.click(screen.getByTestId('ralph-workflow-max-iterations-edit'));
    return screen.getByTestId('ralph-workflow-max-iterations-input') as HTMLInputElement;
}

beforeEach(() => {
    requestMock.mockReset();
    mockModalSelection.mockReset();
    mockModalSelection.mockReturnValue({ resolved: { provider: 'copilot' }, dirty: false });
});

describe('RalphWorkflowPane max-iterations editor', () => {
    it('swaps the cap for a seeded number input when clicked on a running session', () => {
        renderPane(makeView());

        const trigger = screen.getByTestId('ralph-workflow-max-iterations-edit');
        expect(trigger).toHaveTextContent('10');

        const input = openEditor();
        expect(input.value).toBe('10');
        expect(input.disabled).toBe(false);
        // The counter element itself is preserved for the existing tests.
        expect(screen.getByTestId('ralph-workflow-iteration-count')).toHaveTextContent('Iteration 2 /');
    });

    it('submits the absolute cap on Enter and shows the new value in the header', async () => {
        requestMock.mockResolvedValue({ updated: true, maxIterations: 25 });
        renderPane(makeView());

        const input = openEditor();
        fireEvent.change(input, { target: { value: '25' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        await waitFor(() => {
            expect(screen.getByTestId('ralph-workflow-max-iterations-edit')).toHaveTextContent('25');
        });
        expect(requestMock).toHaveBeenCalledTimes(1);
        expect(requestMock).toHaveBeenCalledWith(CAP_PATH, {
            method: 'POST',
            body: { maxIterations: 25 },
        });
        expect(screen.queryByTestId('ralph-workflow-max-iterations-input')).toBeNull();
        expect(screen.queryByTestId('ralph-workflow-max-iterations-error')).toBeNull();
    });

    it('submits on blur when the value changed', async () => {
        requestMock.mockResolvedValue({ updated: true, maxIterations: 40 });
        renderPane(makeView());

        const input = openEditor();
        fireEvent.change(input, { target: { value: '40' } });
        fireEvent.blur(input);

        await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
        expect(requestMock).toHaveBeenCalledWith(CAP_PATH, { method: 'POST', body: { maxIterations: 40 } });
    });

    it('does not submit on blur when the value is unchanged', () => {
        renderPane(makeView());

        const input = openEditor();
        fireEvent.blur(input);

        expect(requestMock).not.toHaveBeenCalled();
        expect(screen.queryByTestId('ralph-workflow-max-iterations-input')).toBeNull();
    });

    it('cancels on Escape and restores the previous value', () => {
        renderPane(makeView());

        const input = openEditor();
        fireEvent.change(input, { target: { value: '99' } });
        fireEvent.keyDown(input, { key: 'Escape' });

        expect(requestMock).not.toHaveBeenCalled();
        expect(screen.queryByTestId('ralph-workflow-max-iterations-input')).toBeNull();
        expect(screen.getByTestId('ralph-workflow-max-iterations-edit')).toHaveTextContent('10');
    });

    it('rejects a value above the 500 hard cap without firing a request', () => {
        renderPane(makeView());

        const input = openEditor();
        fireEvent.change(input, { target: { value: '600' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(requestMock).not.toHaveBeenCalled();
        expect(screen.getByTestId('ralph-workflow-max-iterations-error'))
            .toHaveTextContent('Iteration cap must be a whole number between 1 and 500');
    });

    it('rejects zero without firing a request', () => {
        renderPane(makeView());

        const input = openEditor();
        fireEvent.change(input, { target: { value: '0' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(requestMock).not.toHaveBeenCalled();
        expect(screen.getByTestId('ralph-workflow-max-iterations-error')).toBeInTheDocument();
    });

    it('rejects a non-integer without firing a request', () => {
        renderPane(makeView());

        const input = openEditor();
        fireEvent.change(input, { target: { value: '3.5' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(requestMock).not.toHaveBeenCalled();
        expect(screen.getByTestId('ralph-workflow-max-iterations-error')).toBeInTheDocument();
    });

    it('shows the server message verbatim and keeps the previous cap on error', async () => {
        const serverMessage = 'Session is already complete; use the continue action to add iterations';
        requestMock.mockRejectedValue(new Error(serverMessage));
        renderPane(makeView());

        const input = openEditor();
        fireEvent.change(input, { target: { value: '30' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        await waitFor(() => {
            expect(screen.getByTestId('ralph-workflow-max-iterations-error')).toHaveTextContent(serverMessage);
        });
        expect(screen.getByTestId('ralph-workflow-max-iterations-edit')).toHaveTextContent('10');
        expect(screen.getByTestId('ralph-workflow-iteration-count')).toHaveTextContent('Iteration 2 / 10');
    });

    it('confirms before writing a cap at or below the current iteration', async () => {
        requestMock.mockResolvedValue({ updated: true, maxIterations: 3 });
        renderPane(makeView({ currentIteration: 5, maxIterations: 20 }));

        const input = openEditor();
        fireEvent.change(input, { target: { value: '3' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(screen.getByTestId('ralph-workflow-max-iterations-confirm'))
            .toHaveTextContent('Loop will stop after iteration 3');
        expect(requestMock).not.toHaveBeenCalled();
        // Header must still show the old cap while the confirmation is pending.
        expect(screen.getByTestId('ralph-workflow-max-iterations-edit')).toHaveTextContent('20');

        fireEvent.click(screen.getByTestId('ralph-workflow-max-iterations-confirm-apply'));

        await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
        expect(requestMock).toHaveBeenCalledWith(CAP_PATH, { method: 'POST', body: { maxIterations: 3 } });
        await waitFor(() => {
            expect(screen.getByTestId('ralph-workflow-max-iterations-edit')).toHaveTextContent('3');
        });
    });

    it('cancels the stop confirmation without writing anything', () => {
        renderPane(makeView({ currentIteration: 5, maxIterations: 20 }));

        const input = openEditor();
        fireEvent.change(input, { target: { value: '5' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(screen.getByTestId('ralph-workflow-max-iterations-confirm'))
            .toHaveTextContent('Loop will stop after iteration 5');
        fireEvent.click(screen.getByTestId('ralph-workflow-max-iterations-confirm-cancel'));

        expect(requestMock).not.toHaveBeenCalled();
        expect(screen.queryByTestId('ralph-workflow-max-iterations-confirm')).toBeNull();
        expect(screen.getByTestId('ralph-workflow-max-iterations-edit')).toHaveTextContent('20');
    });

    it('disables the input while the request is in flight', async () => {
        let resolveRequest: ((value: unknown) => void) | undefined;
        requestMock.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
        renderPane(makeView());

        const input = openEditor();
        fireEvent.change(input, { target: { value: '30' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        await waitFor(() => {
            const pending = screen.getByTestId('ralph-workflow-max-iterations-input') as HTMLInputElement;
            expect(pending.disabled).toBe(true);
        });

        resolveRequest?.({ updated: true, maxIterations: 30 });
        await waitFor(() => {
            expect(screen.getByTestId('ralph-workflow-max-iterations-edit')).toHaveTextContent('30');
        });
    });

    it('renders a completed session cap as plain, non-interactive text', () => {
        renderPane(makeView({ phase: 'complete', terminalReason: 'RALPH_COMPLETE', currentIteration: 10 }));

        expect(screen.getByTestId('ralph-workflow-iteration-count')).toHaveTextContent('Iteration 10 / 10');
        expect(screen.queryByTestId('ralph-workflow-max-iterations-edit')).toBeNull();
        expect(screen.queryByTestId('ralph-workflow-max-iterations-input')).toBeNull();
    });
});
