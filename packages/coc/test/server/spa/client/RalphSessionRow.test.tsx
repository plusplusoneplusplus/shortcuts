/**
 * @vitest-environment jsdom
 *
 * Tests for RalphSessionRow component.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../../src/server/spa/client/react/ui/cn', () => ({
    cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import { RalphSessionRow } from '../../../../src/server/spa/client/react/features/chat/RalphSessionRow';
import type { RalphSession } from '../../../../src/server/spa/client/react/features/chat/ralph-session-grouping';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<RalphSession> = {}): RalphSession {
    return {
        kind: 'ralph-session',
        sessionId: 'sess-1',
        grillingProcess: { id: 'grilling-1', type: 'chat' },
        iterations: [],
        latestTimestamp: Date.now(),
        hasUnseen: false,
        phase: 'grilling',
        ...overrides,
    };
}

const mockRenderTaskCard = vi.fn((task: any) => (
    <div data-testid={`task-card-${task.id}`}>{task.id}</div>
));

const defaultProps = {
    selectedTaskId: null as string | null,
    now: Date.now(),
    unseenProcessIds: undefined as Set<string> | undefined,
    onSelectTask: vi.fn(),
    renderTaskCard: mockRenderTaskCard,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RalphSessionRow', () => {
    it('renders the session header', () => {
        render(<RalphSessionRow session={makeSession()} {...defaultProps} />);
        expect(screen.getByTestId('ralph-session-row')).toBeTruthy();
        expect(screen.getByTestId('ralph-session-header')).toBeTruthy();
    });

    it('is collapsed by default when hasUnseen=false', () => {
        render(<RalphSessionRow session={makeSession({ hasUnseen: false })} {...defaultProps} />);
        expect(screen.queryByTestId('ralph-session-grilling')).toBeNull();
    });

    it('is expanded by default when hasUnseen=true', () => {
        const session = makeSession({
            hasUnseen: true,
            grillingProcess: { id: 'grilling-1', type: 'chat' },
        });
        render(<RalphSessionRow session={session} {...defaultProps} />);
        expect(screen.getByTestId('ralph-session-grilling')).toBeTruthy();
    });

    it('clicking the header toggles expanded state', () => {
        const session = makeSession({ grillingProcess: { id: 'grilling-1', type: 'chat' } });
        render(<RalphSessionRow session={session} {...defaultProps} />);

        // Initially collapsed
        expect(screen.queryByTestId('ralph-session-grilling')).toBeNull();

        // Click to expand
        fireEvent.click(screen.getByTestId('ralph-session-header'));
        expect(screen.getByTestId('ralph-session-grilling')).toBeTruthy();

        // Click to collapse
        fireEvent.click(screen.getByTestId('ralph-session-header'));
        expect(screen.queryByTestId('ralph-session-grilling')).toBeNull();
    });

    it('shows grilling process and iterations when expanded', () => {
        const grillingProcess = { id: 'grilling-1', type: 'chat' };
        const iter1 = { id: 'iter-1', payload: { mode: 'ralph', context: { ralph: { currentIteration: 1 } } } };
        const iter2 = { id: 'iter-2', payload: { mode: 'ralph', context: { ralph: { currentIteration: 2 } } } };
        const session = makeSession({ grillingProcess, iterations: [iter1, iter2], hasUnseen: true });

        render(<RalphSessionRow session={session} {...defaultProps} />);

        expect(screen.getByTestId('ralph-session-grilling')).toBeTruthy();
        expect(screen.getByTestId('ralph-iteration-1')).toBeTruthy();
        expect(screen.getByTestId('ralph-iteration-2')).toBeTruthy();
    });

    it('calls renderTaskCard for grilling process when expanded', () => {
        mockRenderTaskCard.mockClear();
        const grillingProcess = { id: 'grilling-1', type: 'chat' };
        const session = makeSession({ grillingProcess, hasUnseen: true });

        render(<RalphSessionRow session={session} {...defaultProps} />);

        expect(mockRenderTaskCard).toHaveBeenCalledWith(
            grillingProcess,
            expect.objectContaining({ indented: true, iterationLabel: '🎯 Goal Setting' }),
        );
    });

    it('calls renderTaskCard for each iteration when expanded', () => {
        mockRenderTaskCard.mockClear();
        const iter1 = { id: 'iter-1', payload: { mode: 'ralph', context: { ralph: { currentIteration: 1 } } } };
        const session = makeSession({ iterations: [iter1], hasUnseen: true, grillingProcess: undefined });

        render(<RalphSessionRow session={session} {...defaultProps} />);

        expect(mockRenderTaskCard).toHaveBeenCalledWith(
            iter1,
            expect.objectContaining({ indented: true, iterationLabel: 'Iteration 1' }),
        );
    });

    describe('phase badges', () => {
        it('shows Clarifying badge for grilling phase', () => {
            render(<RalphSessionRow session={makeSession({ phase: 'grilling' })} {...defaultProps} />);
            expect(screen.getByText('Clarifying')).toBeTruthy();
        });

        it('shows Executing badge for executing phase', () => {
            render(<RalphSessionRow session={makeSession({ phase: 'executing' })} {...defaultProps} />);
            expect(screen.getByText('Executing')).toBeTruthy();
        });

        it('shows Done badge for complete phase', () => {
            render(<RalphSessionRow session={makeSession({ phase: 'complete' })} {...defaultProps} />);
            expect(screen.getByText('Done')).toBeTruthy();
        });
    });

    it('shows unseen dot when hasUnseen=true', () => {
        render(<RalphSessionRow session={makeSession({ hasUnseen: true })} {...defaultProps} />);
        expect(screen.getByLabelText('Unseen activity')).toBeTruthy();
    });

    it('does not show unseen dot when hasUnseen=false', () => {
        render(<RalphSessionRow session={makeSession({ hasUnseen: false })} {...defaultProps} />);
        expect(screen.queryByLabelText('Unseen activity')).toBeNull();
    });

    it('shows iteration count when iterations exist', () => {
        const iter1 = { id: 'iter-1', payload: { mode: 'ralph', context: { ralph: { currentIteration: 1 } } } };
        const iter2 = { id: 'iter-2', payload: { mode: 'ralph', context: { ralph: { currentIteration: 2 } } } };
        render(<RalphSessionRow session={makeSession({ iterations: [iter1, iter2] })} {...defaultProps} />);
        expect(screen.getByText('2 iterations')).toBeTruthy();
    });

    it('shows "Clarifying goal…" when no iterations', () => {
        render(<RalphSessionRow session={makeSession({ iterations: [] })} {...defaultProps} />);
        expect(screen.getByText('Clarifying goal…')).toBeTruthy();
    });
});
