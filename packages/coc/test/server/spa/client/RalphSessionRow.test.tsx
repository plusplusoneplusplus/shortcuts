/**
 * @vitest-environment jsdom
 *
 * Tests for RalphSessionRow — the compact, plan-group-styled header for a
 * Ralph session in the chat list.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../../src/server/spa/client/react/ui/cn', () => ({
    cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: (iso: string) => `rel(${iso})`,
}));

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import { RalphSessionRow } from '../../../../src/server/spa/client/react/features/chat/RalphSessionRow';
import type { RalphSession } from '../../../../src/server/spa/client/react/features/chat/ralph-session-grouping';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_TS = 1_700_000_000_000;

function makeSession(overrides: Partial<RalphSession> = {}): RalphSession {
    return {
        kind: 'ralph-session',
        sessionId: 'sess-1',
        grillingProcess: { id: 'grilling-1', type: 'chat' },
        iterations: [],
        latestTimestamp: FIXED_TS,
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
    now: FIXED_TS,
    unseenProcessIds: undefined as Set<string> | undefined,
    onSelectTask: vi.fn(),
    renderTaskCard: mockRenderTaskCard,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RalphSessionRow', () => {
    it('renders the row + header with session id', () => {
        render(<RalphSessionRow session={makeSession()} {...defaultProps} />);
        const row = screen.getByTestId('ralph-session-row');
        expect(row.getAttribute('data-session-id')).toBe('sess-1');
        expect(screen.getByTestId('ralph-session-header')).toBeTruthy();
    });

    it('shows the RALPH mode pill', () => {
        render(<RalphSessionRow session={makeSession()} {...defaultProps} />);
        expect(screen.getByText('RALPH')).toBeTruthy();
    });

    it('shows the title "Ralph Session"', () => {
        const { container } = render(<RalphSessionRow session={makeSession()} {...defaultProps} />);
        expect(container.textContent).toContain('Ralph Session');
    });

    it('renders a phase status dot', () => {
        render(<RalphSessionRow session={makeSession({ phase: 'executing' })} {...defaultProps} />);
        expect(screen.getByLabelText('phase: executing')).toBeTruthy();
    });

    it('encodes phase via data-session-phase on header', () => {
        render(<RalphSessionRow session={makeSession({ phase: 'complete' })} {...defaultProps} />);
        expect(screen.getByTestId('ralph-session-header').getAttribute('data-session-phase')).toBe('complete');
    });

    it('does NOT render the legacy "Done" / "Executing" / "Clarifying" phase pill text outside the title suffix', () => {
        const { container } = render(<RalphSessionRow session={makeSession({ phase: 'complete' })} {...defaultProps} />);
        expect(container.textContent).not.toContain('Done');
        expect(container.textContent).not.toContain('Executing');
    });

    it('does NOT render the legacy 🔄 emoji icon', () => {
        const { container } = render(<RalphSessionRow session={makeSession()} {...defaultProps} />);
        expect(container.textContent).not.toContain('🔄');
    });

    it('renders a relative timestamp from latestTimestamp', () => {
        const { container } = render(<RalphSessionRow session={makeSession()} {...defaultProps} />);
        expect(container.textContent).toContain(`rel(${new Date(FIXED_TS).toISOString()})`);
    });

    it('is collapsed by default when hasUnseen=false', () => {
        render(<RalphSessionRow session={makeSession({ hasUnseen: false })} {...defaultProps} />);
        expect(screen.queryByTestId('ralph-session-children')).toBeNull();
    });

    it('is expanded by default when hasUnseen=true', () => {
        render(<RalphSessionRow session={makeSession({ hasUnseen: true })} {...defaultProps} />);
        expect(screen.getByTestId('ralph-session-children')).toBeTruthy();
    });

    it('clicking the header toggles expanded state', () => {
        render(<RalphSessionRow session={makeSession()} {...defaultProps} />);
        expect(screen.queryByTestId('ralph-session-children')).toBeNull();

        fireEvent.click(screen.getByTestId('ralph-session-header'));
        expect(screen.getByTestId('ralph-session-children')).toBeTruthy();

        fireEvent.click(screen.getByTestId('ralph-session-header'));
        expect(screen.queryByTestId('ralph-session-children')).toBeNull();
    });

    it('clicking the chevron also toggles expanded state', () => {
        render(<RalphSessionRow session={makeSession()} {...defaultProps} />);
        const chevron = screen.getByTestId('ralph-session-chevron');
        fireEvent.click(chevron);
        expect(screen.getByTestId('ralph-session-children')).toBeTruthy();
        expect(chevron.getAttribute('aria-expanded')).toBe('true');
    });

    it('renders the chevron with aria-expanded reflecting state', () => {
        render(<RalphSessionRow session={makeSession({ hasUnseen: true })} {...defaultProps} />);
        expect(screen.getByTestId('ralph-session-chevron').getAttribute('aria-expanded')).toBe('true');
    });

    it('renders grilling process and iteration children via renderTaskCard with isGroupChild=true', () => {
        mockRenderTaskCard.mockClear();
        const grillingProcess = { id: 'grilling-1', type: 'chat' };
        const iter1 = { id: 'iter-1' };
        const iter2 = { id: 'iter-2' };
        const session = makeSession({ grillingProcess, iterations: [iter1, iter2], hasUnseen: true });

        render(<RalphSessionRow session={session} {...defaultProps} />);

        expect(screen.getByTestId('task-card-grilling-1')).toBeTruthy();
        expect(screen.getByTestId('task-card-iter-1')).toBeTruthy();
        expect(screen.getByTestId('task-card-iter-2')).toBeTruthy();

        for (const call of mockRenderTaskCard.mock.calls) {
            expect(call[1]).toMatchObject({ isGroupChild: true });
        }
    });

    it('nests expanded children under a left guide-line + indent (parity with plan-file groups)', () => {
        const { container } = render(<RalphSessionRow session={makeSession({ hasUnseen: true })} {...defaultProps} />);
        const children = container.querySelector('[data-testid="ralph-session-children"]');
        expect(children).not.toBeNull();
        // Same wrapper classes as HistoryGroupHeader's expanded children container,
        // so the parent + children read as one cohesive group block.
        expect(children!.className).toMatch(/ml-3/);
        expect(children!.className).toMatch(/pl-2/);
        expect(children!.className).toMatch(/border-l\b/);
    });

    it('strengthens the row background when expanded (parity with plan-file groups)', () => {
        const { container } = render(<RalphSessionRow session={makeSession({ hasUnseen: true })} {...defaultProps} />);
        const row = container.querySelector('[data-testid="ralph-session-row"]')!;
        expect(row.className).toMatch(/bg-\[#f7f7f8\]/);
    });

    it('does not apply the expanded background when collapsed', () => {
        const { container } = render(<RalphSessionRow session={makeSession({ hasUnseen: false })} {...defaultProps} />);
        const row = container.querySelector('[data-testid="ralph-session-row"]')!;
        expect(row.className).not.toMatch(/bg-\[#f7f7f8\]/);
    });

    it('shows blue (not purple) unseen dot when hasUnseen=true', () => {
        render(<RalphSessionRow session={makeSession({ hasUnseen: true })} {...defaultProps} />);
        const dot = screen.getByTestId('ralph-session-unseen-dot');
        expect(dot.className).toMatch(/bg-\[#0078d4\]/);
        expect(dot.className).not.toMatch(/bg-purple/);
    });

    it('does not show unseen dot when hasUnseen=false', () => {
        render(<RalphSessionRow session={makeSession({ hasUnseen: false })} {...defaultProps} />);
        expect(screen.queryByTestId('ralph-session-unseen-dot')).toBeNull();
    });

    it('shows child-count badge equal to grilling + iterations', () => {
        const grillingProcess = { id: 'grilling-1', type: 'chat' };
        const iters = [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }];
        render(<RalphSessionRow session={makeSession({ grillingProcess, iterations: iters })} {...defaultProps} />);
        const badge = screen.getByTestId('ralph-session-child-count');
        expect(badge.textContent?.trim()).toBe('4');
    });

    it('uses "Clarifying" sub-label for grilling phase', () => {
        const { container } = render(<RalphSessionRow session={makeSession({ phase: 'grilling' })} {...defaultProps} />);
        expect(container.textContent).toContain('Clarifying');
    });

    it('uses "{N} iter" sub-label outside grilling phase', () => {
        const { container } = render(
            <RalphSessionRow
                session={makeSession({ phase: 'executing', iterations: [{ id: 'i1' }, { id: 'i2' }] })}
                {...defaultProps}
            />,
        );
        expect(container.textContent).toContain('2 iter');
        // No verbose plural variant left over from the old design.
        expect(container.textContent).not.toContain('iterations');
    });

    it('uses the plan-group grid layout (grid-cols-[10px_36px_minmax(0,1fr)_auto])', () => {
        render(<RalphSessionRow session={makeSession()} {...defaultProps} />);
        const header = screen.getByTestId('ralph-session-header');
        expect(header.className).toContain('grid-cols-[10px_36px_minmax(0,1fr)_auto]');
        expect(header.className).toContain('h-[26px]');
    });
});
