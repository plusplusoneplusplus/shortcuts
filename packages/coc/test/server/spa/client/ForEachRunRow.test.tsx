/**
 * @vitest-environment jsdom
 *
 * Tests for ForEachRunRow — the compact, Ralph-like but distinct For Each
 * parent-run group row in the chat list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ForEachRunStatus, ForEachRunSummary } from '@plusplusoneplusplus/coc-client';

vi.mock('../../../../src/server/spa/client/react/ui/cn', () => ({
    cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: (iso: string) => `rel(${iso})`,
}));

import { ForEachRunRow } from '../../../../src/server/spa/client/react/features/chat/ForEachRunRow';
import type { ForEachRunGroup } from '../../../../src/server/spa/client/react/features/chat/for-each-run-grouping';

const FIXED_TS = 1_700_000_000_000;

function makeRun(overrides: Partial<ForEachRunSummary> = {}): ForEachRunSummary {
    return {
        runId: 'run-1',
        workspaceId: 'ws-1',
        status: 'approved',
        originalRequest: 'Split durable parent work into isolated child chats',
        childMode: 'ask',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:01:00.000Z',
        itemCount: 2,
        itemStatusCounts: {
            pending: 2,
            running: 0,
            completed: 0,
            failed: 0,
            skipped: 0,
        },
        ...overrides,
    };
}

function makeGroup(options: {
    run?: Partial<ForEachRunSummary>;
    children?: any[];
    latestTimestamp?: number;
    hasUnseen?: boolean;
} = {}): ForEachRunGroup {
    const run = makeRun(options.run);
    return {
        kind: 'for-each-run',
        runId: run.runId,
        run,
        children: options.children ?? [],
        latestTimestamp: options.latestTimestamp ?? FIXED_TS,
        hasUnseen: options.hasUnseen ?? false,
    };
}

const mockRenderTaskCard = vi.fn((task: any) => (
    <div data-testid={`task-card-${task.id}`}>{task.id}</div>
));

const defaultProps = {
    selectedRunId: null as string | null,
    now: FIXED_TS,
    renderTaskCard: mockRenderTaskCard,
};

describe('ForEachRunRow', () => {
    beforeEach(() => {
        mockRenderTaskCard.mockClear();
    });

    it('renders the row and header with the persisted run id', () => {
        render(<ForEachRunRow group={makeGroup()} {...defaultProps} />);

        expect(screen.getByTestId('for-each-run-row').getAttribute('data-run-id')).toBe('run-1');
        expect(screen.getByTestId('for-each-run-body')).toBeTruthy();
    });

    it('uses a distinct compact For Each mode pill instead of the Ralph pill', () => {
        const { container } = render(<ForEachRunRow group={makeGroup()} {...defaultProps} />);

        expect(screen.getByText('FE')).toBeTruthy();
        expect(screen.getByTitle('For Each run')).toBeTruthy();
        expect(container.textContent).toContain('For Each');
        expect(container.textContent).not.toContain('Ralph Session');
    });

    it('uses the compact group-row grid layout', () => {
        render(<ForEachRunRow group={makeGroup()} {...defaultProps} />);

        const body = screen.getByTestId('for-each-run-body');
        expect(body.className).toContain('grid-cols-[10px_20px_minmax(0,1fr)_auto]');
        expect(body.className).toContain('h-[26px]');
    });

    it('distinguishes every parent run status through row metadata and dot color', () => {
        const expectedDotClass: Record<ForEachRunStatus, RegExp> = {
            draft: /bg-zinc-400/,
            approved: /bg-sky-500/,
            running: /animate-pulse/,
            failed: /bg-\[#e5534b\]/,
            completed: /bg-emerald-500/,
            cancelled: /bg-\[#bbbbbb\]/,
        };

        for (const status of Object.keys(expectedDotClass) as ForEachRunStatus[]) {
            const { unmount } = render(<ForEachRunRow group={makeGroup({ run: { status } })} {...defaultProps} />);

            expect(screen.getByTestId('for-each-run-body').getAttribute('data-run-status')).toBe(status);
            expect(screen.getByLabelText(`status: ${status}`).className).toMatch(expectedDotClass[status]);

            unmount();
        }
    });

    it('renders status-count summary in the For Each status order', () => {
        render(
            <ForEachRunRow
                group={makeGroup({
                    run: {
                        itemCount: 5,
                        itemStatusCounts: {
                            running: 1,
                            failed: 2,
                            pending: 1,
                            completed: 1,
                            skipped: 0,
                        },
                    },
                })}
                {...defaultProps}
            />,
        );

        expect(screen.getByTestId('for-each-run-status-summary').textContent).toBe('1 running · 2 failed · 1 pending · 1 completed');
    });

    it('renders a zero-item summary for empty persisted runs', () => {
        render(
            <ForEachRunRow
                group={makeGroup({
                    run: {
                        itemCount: 0,
                        itemStatusCounts: {
                            running: 0,
                            failed: 0,
                            pending: 0,
                            completed: 0,
                            skipped: 0,
                        },
                    },
                })}
                {...defaultProps}
            />,
        );

        expect(screen.getByTestId('for-each-run-status-summary').textContent).toBe('0 items');
    });

    it('shows selection, unseen activity, child count, and relative timestamp', () => {
        const children = [{ id: 'child-1' }, { id: 'child-2' }];
        render(
            <ForEachRunRow
                group={makeGroup({ children, hasUnseen: true })}
                {...defaultProps}
                selectedRunId="run-1"
            />,
        );

        expect(screen.getByTestId('for-each-run-row').getAttribute('data-selected')).toBe('true');
        expect(screen.getByTestId('for-each-run-row').className).toMatch(/ring-sky-500/);
        expect(screen.getByTestId('for-each-run-unseen-dot').className).toMatch(/bg-\[#0078d4\]/);
        expect(screen.getByTestId('for-each-run-child-count').textContent?.trim()).toBe('2');
        expect(screen.getByTestId('for-each-run-row').textContent).toContain(`rel(${new Date(FIXED_TS).toISOString()})`);
    });

    it('clicking the body toggles expanded state when no parent selection handler is given', () => {
        render(<ForEachRunRow group={makeGroup({ children: [{ id: 'child-1' }] })} {...defaultProps} />);

        expect(screen.queryByTestId('for-each-run-children')).toBeNull();

        fireEvent.click(screen.getByTestId('for-each-run-body'));
        expect(screen.getByTestId('for-each-run-children')).toBeTruthy();
        expect(screen.getByTestId('task-card-child-1')).toBeTruthy();

        fireEvent.click(screen.getByTestId('for-each-run-body'));
        expect(screen.queryByTestId('for-each-run-children')).toBeNull();
    });

    it('clicking the body opens the parent run without expanding when a handler is wired', () => {
        const onSelectRun = vi.fn();
        render(
            <ForEachRunRow
                group={makeGroup({ children: [{ id: 'child-1' }] })}
                {...defaultProps}
                onSelectRun={onSelectRun}
            />,
        );

        fireEvent.click(screen.getByTestId('for-each-run-body'));

        expect(onSelectRun.mock.calls[0][0]).toBe('run-1');
        expect(onSelectRun.mock.calls[0][1]).toBeTruthy();
        expect(screen.queryByTestId('for-each-run-children')).toBeNull();
    });

    it('chevron click expands children without opening the parent run', () => {
        const onSelectRun = vi.fn();
        render(
            <ForEachRunRow
                group={makeGroup({ children: [{ id: 'child-1' }, { id: 'child-2' }] })}
                {...defaultProps}
                onSelectRun={onSelectRun}
            />,
        );

        const chevron = screen.getByTestId('for-each-run-chevron');
        expect(chevron.getAttribute('aria-expanded')).toBe('false');

        fireEvent.click(chevron);

        expect(onSelectRun).not.toHaveBeenCalled();
        expect(chevron.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByTestId('task-card-child-1')).toBeTruthy();
        expect(screen.getByTestId('task-card-child-2')).toBeTruthy();
    });

    it('shows an empty expanded state for runs with no child chats yet', () => {
        render(<ForEachRunRow group={makeGroup()} {...defaultProps} />);

        fireEvent.click(screen.getByTestId('for-each-run-chevron'));

        expect(screen.getByTestId('for-each-run-no-children').textContent).toContain('No child chats yet');
    });
});
