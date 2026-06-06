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

vi.mock('../../../../src/server/spa/client/react/featureFlags', () => ({
    RALPH_MULTI_LOOP: false,
    SHOW_WELCOME_TUTORIAL: true,
    SHOW_FOCUSED_DIFF: true,
    SHOW_EXCALIDRAW_DIAGRAMS: true,
}));

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import { RalphSessionRow } from '../../../../src/server/spa/client/react/features/chat/RalphSessionRow';
import type { RalphSession } from '../../../../src/server/spa/client/react/features/chat/ralph-session-grouping';
import {
    RALPH_SESSION_CONTEXT_DRAG_KIND,
    RALPH_SESSION_CONTEXT_DRAG_MIME,
    type RalphSessionContextDragPayload,
} from '../../../../src/server/spa/client/react/features/chat/sessionContextDrag';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_TS = 1_700_000_000_000;

function makeSession(overrides: Partial<RalphSession> = {}): RalphSession {
    return {
        kind: 'ralph-session',
        sessionId: 'sess-1',
        title: 'Ralph Session',
        grillingProcess: { id: 'grilling-1', type: 'chat' },
        iterations: [],
        latestTimestamp: FIXED_TS,
        hasUnseen: false,
        phase: 'grilling',
        loopCount: 1,
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

function makeRalphDragPayload(overrides: Partial<RalphSessionContextDragPayload> = {}): RalphSessionContextDragPayload {
    return {
        kind: RALPH_SESSION_CONTEXT_DRAG_KIND,
        version: 1,
        sourceWorkspaceId: 'ws-1',
        sourceRalphSessionId: 'sess-1',
        title: 'Ralph Session',
        displayLabel: 'Ralph Session - 2 iter',
        phase: 'executing',
        status: 'running',
        lastActivityAt: '2026-01-01T00:00:00.000Z',
        childProcessIds: ['grilling-1', 'iter-1'],
        processCount: 2,
        iterationCount: 1,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RalphSessionRow', () => {
    it('renders the row + header with session id', () => {
        render(<RalphSessionRow session={makeSession()} {...defaultProps} />);
        const row = screen.getByTestId('ralph-session-row');
        expect(row.getAttribute('data-session-id')).toBe('sess-1');
        expect(screen.getByTestId('ralph-session-body')).toBeTruthy();
    });

    it('shows the compact RALPH mode pill', () => {
        render(<RalphSessionRow session={makeSession()} {...defaultProps} />);
        expect(screen.getByText('R')).toBeTruthy();
        expect(screen.getByTitle('Ralph · iterative goal-driven session')).toBeTruthy();
    });

    it('shows the title "Ralph Session"', () => {
        const { container } = render(<RalphSessionRow session={makeSession()} {...defaultProps} />);
        expect(container.textContent).toContain('Ralph Session');
    });

    it('renders the goal-derived session title instead of the generic label', () => {
        const session = makeSession({ title: 'Reviewing Codex skill access', phase: 'executing', iterations: [{ id: 'i1' }] });
        render(<RalphSessionRow session={session} {...defaultProps} />);
        const title = screen.getByTestId('ralph-session-title');
        expect(title.textContent).toContain('Reviewing Codex skill access');
        // The existing muted iteration suffix is preserved alongside the title.
        expect(title.textContent).toContain('1 iter');
    });

    it('preserves the "Clarifying" suffix alongside a goal-derived title in grilling phase', () => {
        const session = makeSession({ title: 'Improve Ralph session titles', phase: 'grilling' });
        render(<RalphSessionRow session={session} {...defaultProps} />);
        const title = screen.getByTestId('ralph-session-title');
        expect(title.textContent).toContain('Improve Ralph session titles');
        expect(title.textContent).toContain('Clarifying');
    });

    it('exposes the resolved title plus suffix on the title tooltip/accessibility label', () => {
        const session = makeSession({ title: 'Reviewing Codex skill access', phase: 'executing', iterations: [{ id: 'i1' }] });
        render(<RalphSessionRow session={session} {...defaultProps} />);
        const title = screen.getByTestId('ralph-session-title');
        expect(title.getAttribute('title')).toBe('Reviewing Codex skill access · 1 iter');
        expect(title.getAttribute('aria-label')).toBe('Ralph session: Reviewing Codex skill access · 1 iter');
    });

    it('falls back to the generic "Ralph Session" title when no goal is available', () => {
        render(<RalphSessionRow session={makeSession({ title: 'Ralph Session' })} {...defaultProps} />);
        expect(screen.getByTestId('ralph-session-title').textContent).toContain('Ralph Session');
    });

    it('renders a phase status dot', () => {
        render(<RalphSessionRow session={makeSession({ phase: 'executing' })} {...defaultProps} />);
        expect(screen.getByLabelText('phase: executing')).toBeTruthy();
    });

    it('renders failed phase status dot metadata', () => {
        render(<RalphSessionRow session={makeSession({ phase: 'failed' })} {...defaultProps} />);
        expect(screen.getByLabelText('phase: failed')).toBeTruthy();
        expect(screen.getByTestId('ralph-session-body').getAttribute('data-session-phase')).toBe('failed');
    });

    it('encodes phase via data-session-phase on header', () => {
        render(<RalphSessionRow session={makeSession({ phase: 'complete' })} {...defaultProps} />);
        expect(screen.getByTestId('ralph-session-body').getAttribute('data-session-phase')).toBe('complete');
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

    it('is collapsed by default when hasUnseen=true', () => {
        render(<RalphSessionRow session={makeSession({ hasUnseen: true })} {...defaultProps} />);
        expect(screen.queryByTestId('ralph-session-children')).toBeNull();
        expect(screen.getByTestId('ralph-session-unseen-dot')).toBeTruthy();
    });

    it('clicking the body toggles expanded state when no onSelectSession handler is given', () => {
        render(<RalphSessionRow session={makeSession()} {...defaultProps} />);
        expect(screen.queryByTestId('ralph-session-children')).toBeNull();

        fireEvent.click(screen.getByTestId('ralph-session-body'));
        expect(screen.getByTestId('ralph-session-children')).toBeTruthy();

        fireEvent.click(screen.getByTestId('ralph-session-body'));
        expect(screen.queryByTestId('ralph-session-children')).toBeNull();
    });

    it('clicking the body fires onSelectSession (and does NOT toggle) when handler is given', () => {
        const onSelectSession = vi.fn();
        render(
            <RalphSessionRow
                session={makeSession()}
                {...defaultProps}
                onSelectSession={onSelectSession}
            />,
        );
        expect(screen.queryByTestId('ralph-session-children')).toBeNull();

        fireEvent.click(screen.getByTestId('ralph-session-body'));
        expect(onSelectSession).toHaveBeenCalledWith('sess-1', expect.anything());
        // body click no longer toggles when onSelectSession is wired
        expect(screen.queryByTestId('ralph-session-children')).toBeNull();
    });

    it('chevron click still toggles even when onSelectSession is given (and does not fire onSelectSession)', () => {
        const onSelectSession = vi.fn();
        render(
            <RalphSessionRow
                session={makeSession()}
                {...defaultProps}
                onSelectSession={onSelectSession}
            />,
        );
        fireEvent.click(screen.getByTestId('ralph-session-chevron'));
        expect(screen.getByTestId('ralph-session-children')).toBeTruthy();
        expect(onSelectSession).not.toHaveBeenCalled();
    });

    it('row carries data-selected="true" when selectedSessionId matches', () => {
        render(
            <RalphSessionRow
                session={makeSession()}
                {...defaultProps}
                selectedSessionId="sess-1"
            />,
        );
        expect(screen.getByTestId('ralph-session-row').getAttribute('data-selected')).toBe('true');
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
        const chevron = screen.getByTestId('ralph-session-chevron');
        expect(chevron.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(chevron);
        expect(chevron.getAttribute('aria-expanded')).toBe('true');
    });

    it('renders grilling process and iteration children via renderTaskCard with isGroupChild=true', () => {
        mockRenderTaskCard.mockClear();
        const grillingProcess = { id: 'grilling-1', type: 'chat' };
        const iter1 = { id: 'iter-1' };
        const iter2 = { id: 'iter-2' };
        const session = makeSession({ grillingProcess, iterations: [iter1, iter2], hasUnseen: true });

        render(<RalphSessionRow session={session} {...defaultProps} />);
        fireEvent.click(screen.getByTestId('ralph-session-chevron'));

        expect(screen.getByTestId('task-card-grilling-1')).toBeTruthy();
        expect(screen.getByTestId('task-card-iter-1')).toBeTruthy();
        expect(screen.getByTestId('task-card-iter-2')).toBeTruthy();

        for (const call of mockRenderTaskCard.mock.calls) {
            expect(call[1]).toMatchObject({ isGroupChild: true });
        }
    });

    it('nests expanded children under a left guide-line + indent (parity with plan-file groups)', () => {
        const { container } = render(<RalphSessionRow session={makeSession({ hasUnseen: true })} {...defaultProps} />);
        fireEvent.click(screen.getByTestId('ralph-session-chevron'));
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
        fireEvent.click(screen.getByTestId('ralph-session-chevron'));
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

    it('uses the plan-group grid layout (grid-cols-[10px_30px_minmax(0,1fr)_auto])', () => {
        render(<RalphSessionRow session={makeSession()} {...defaultProps} />);
        const header = screen.getByTestId('ralph-session-body');
        expect(header.className).toContain('grid-cols-[10px_30px_minmax(0,1fr)_auto]');
        expect(header.className).toContain('h-[26px]');
    });

    it('fires onContextMenu when the body is right-clicked', () => {
        const onContextMenu = vi.fn();
        render(<RalphSessionRow session={makeSession()} {...defaultProps} onContextMenu={onContextMenu} />);
        fireEvent.contextMenu(screen.getByTestId('ralph-session-body'));
        expect(onContextMenu).toHaveBeenCalledTimes(1);
    });

    it('does not fire onContextMenu when no handler is provided', () => {
        render(<RalphSessionRow session={makeSession()} {...defaultProps} />);
        // Should not throw
        fireEvent.contextMenu(screen.getByTestId('ralph-session-body'));
    });

    it('is not a session-context drag source without a Ralph payload', () => {
        render(<RalphSessionRow session={makeSession()} {...defaultProps} />);
        const body = screen.getByTestId('ralph-session-body');
        expect(body.getAttribute('draggable')).not.toBe('true');
        expect(body.getAttribute('data-session-context-source')).toBeNull();
    });

    it('writes Ralph session drag data with copy behavior when a payload is provided', () => {
        const payload = makeRalphDragPayload();
        render(<RalphSessionRow session={makeSession({ phase: 'executing' })} {...defaultProps} sessionContextPayload={payload} />);
        const body = screen.getByTestId('ralph-session-body');
        const dataTransfer = { setData: vi.fn(), effectAllowed: 'move' as DataTransfer['effectAllowed'] };

        expect(body.getAttribute('draggable')).toBe('true');
        expect(body.getAttribute('data-session-context-source')).toBe('true');
        expect(body.getAttribute('data-session-context-kind')).toBe('ralph-session');
        expect(body.getAttribute('data-session-context-status')).toBe('running');

        fireEvent.dragStart(body, { dataTransfer });

        expect(dataTransfer.effectAllowed).toBe('copy');
        expect(dataTransfer.setData).toHaveBeenCalledWith(RALPH_SESSION_CONTEXT_DRAG_MIME, JSON.stringify(payload));
    });

    it('shows plain "{N} iter" sub-label when RALPH_MULTI_LOOP is false, even with loopCount > 1', () => {
        const { container } = render(
            <RalphSessionRow
                session={makeSession({ phase: 'executing', iterations: [{ id: 'i1' }], loopCount: 3 })}
                {...defaultProps}
            />,
        );
        expect(container.textContent).toContain('1 iter');
        expect(container.textContent).not.toContain('loops');
    });
});
