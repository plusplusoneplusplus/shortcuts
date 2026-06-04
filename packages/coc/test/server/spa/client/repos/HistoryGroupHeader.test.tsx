/**
 * @vitest-environment jsdom
 *
 * Tests for HistoryGroupHeader — the activity-compact-style row shown for
 * plan-file task groups in the Activity tab. Covers:
 *   - `computeAggregateMode` (uniform / mixed / empty / non-chat children)
 *   - Render: data-testid + data-* attribute contract
 *   - Mode pill label + tooltip (A/A/S/M)
 *   - Status dot color via aggregateStatus
 *   - Chevron rotation reflects expand state, click toggles + stops propagation
 *   - Failed / cancelled count badges
 *   - isUnseen + isSelected visual contracts
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
    HistoryGroupHeader,
    computeAggregateMode,
    type GroupAggregateMode,
} from '../../../../../src/server/spa/client/react/features/git/commits/HistoryGroupHeader';
import type { HistoryGroup } from '../../../../../src/server/spa/client/react/features/git/history-grouping';
import type { ProcessHistoryItem } from '../../../../../src/server/spa/client/react/types/dashboard';

function makeChild(overrides: Partial<ProcessHistoryItem> & { id: string }): ProcessHistoryItem {
    return {
        type: 'chat',
        status: 'completed',
        title: overrides.id,
        startTime: 1_700_000_000_000,
        workspaceId: 'ws-1',
        turnCount: 1,
        ...overrides,
    };
}

function makeGroup(overrides: Partial<HistoryGroup> & { children: ProcessHistoryItem[] }): HistoryGroup {
    const children = overrides.children;
    return {
        kind: 'group',
        planFilePath: '/repo/auth.plan.md',
        label: 'auth.plan.md',
        children,
        latestTimestamp: Math.max(...children.map(c => c.lastActivityAt ?? c.endTime ?? c.startTime)),
        hasUnseen: false,
        aggregateStatus: 'completed',
        ...overrides,
    };
}

beforeEach(() => {
    cleanup();
});

// ─── computeAggregateMode (pure) ────────────────────────────────────────
describe('computeAggregateMode', () => {
    it('returns "auto" for empty children list', () => {
        expect(computeAggregateMode([])).toBe('auto');
    });

    it('normalizes legacy plan children to the Ask aggregate mode', () => {
        const children = [
            makeChild({ id: 'a', type: 'chat', mode: 'plan' }),
            makeChild({ id: 'b', type: 'chat', mode: 'plan' }),
        ];
        expect(computeAggregateMode(children)).toBe('ask');
    });

    it('returns the shared mode when all chat children agree on "ask"', () => {
        const children = [
            makeChild({ id: 'a', type: 'chat', mode: 'ask' }),
            makeChild({ id: 'b', type: 'chat', mode: 'ask' }),
        ];
        expect(computeAggregateMode(children)).toBe('ask');
    });

    it('returns "auto" when all chat children have mode "autopilot" or unset', () => {
        // The frontend convention: anything that is not ask on a chat task
        // is treated as autopilot.
        const children = [
            makeChild({ id: 'a', type: 'chat', mode: 'autopilot' }),
            makeChild({ id: 'b', type: 'chat' }),
        ];
        expect(computeAggregateMode(children)).toBe('auto');
    });

    it('returns "script" when all children are run-script', () => {
        const children = [
            makeChild({ id: 'a', type: 'run-script' }),
            makeChild({ id: 'b', type: 'run-script' }),
        ];
        expect(computeAggregateMode(children)).toBe('script');
    });

    it('returns "mixed" when children disagree on mode (ask vs autopilot)', () => {
        const children = [
            makeChild({ id: 'a', type: 'chat', mode: 'ask' }),
            makeChild({ id: 'b', type: 'chat', mode: 'autopilot' }),
        ];
        expect(computeAggregateMode(children)).toBe('mixed');
    });

    it('returns "mixed" when chat and run-script children are siblings', () => {
        const children = [
            makeChild({ id: 'a', type: 'chat', mode: 'autopilot' }),
            makeChild({ id: 'b', type: 'run-script' }),
        ];
        expect(computeAggregateMode(children)).toBe('mixed');
    });

    it('returns "mixed" only after the first divergence is detected', () => {
        // Three identical, then a divergent → still mixed.
        const children = [
            makeChild({ id: 'a', type: 'chat', mode: 'plan' }),
            makeChild({ id: 'b', type: 'chat', mode: 'plan' }),
            makeChild({ id: 'c', type: 'chat', mode: 'plan' }),
            makeChild({ id: 'd', type: 'chat', mode: 'autopilot' }),
        ];
        expect(computeAggregateMode(children)).toBe('mixed');
    });

    it('treats a single child group as that child\'s mode', () => {
        // Sanity: degenerate one-child group still returns the child's mode.
        const children = [makeChild({ id: 'a', type: 'chat', mode: 'plan' })];
        expect(computeAggregateMode(children)).toBe('ask');
    });
});

// ─── HistoryGroupHeader render ──────────────────────────────────────────
describe('HistoryGroupHeader render', () => {
    function renderHeader(props: Partial<React.ComponentProps<typeof HistoryGroupHeader>> = {}) {
        const defaultGroup = makeGroup({
            children: [
                makeChild({ id: 'c1', type: 'chat', mode: 'plan', startTime: 1_000, lastActivityAt: 2_000 }),
                makeChild({ id: 'c2', type: 'chat', mode: 'plan', startTime: 1_500, lastActivityAt: 3_000 }),
            ],
        });
        const onToggle = vi.fn();
        const onContextMenu = vi.fn();
        const result = render(
            <HistoryGroupHeader
                group={props.group ?? defaultGroup}
                isExpanded={props.isExpanded ?? false}
                aggregateMode={props.aggregateMode ?? 'ask'}
                onToggle={props.onToggle ?? onToggle}
                onContextMenu={props.onContextMenu ?? onContextMenu}
                isSelected={props.isSelected}
                isUnseen={props.isUnseen}
                onClick={props.onClick}
                isDense={props.isDense}
            />,
        );
        return { ...result, onToggle, onContextMenu };
    }

    it('renders with data-testid="history-group-header"', () => {
        renderHeader();
        expect(screen.getByTestId('history-group-header')).toBeTruthy();
    });

    it('exposes data-plan-file, data-aggregate-mode, data-aggregate-status, data-expanded', () => {
        renderHeader({
            isExpanded: true,
            aggregateMode: 'ask',
            group: makeGroup({
                planFilePath: '/repo/foo.plan.md',
                aggregateStatus: 'failed',
                children: [makeChild({ id: 'c1' })],
            }),
        });
        const header = screen.getByTestId('history-group-header');
        expect(header.getAttribute('data-plan-file')).toBe('/repo/foo.plan.md');
        expect(header.getAttribute('data-aggregate-mode')).toBe('ask');
        expect(header.getAttribute('data-aggregate-status')).toBe('failed');
        expect(header.getAttribute('data-expanded')).toBe('true');
    });

    it('shows the group label as the title text', () => {
        renderHeader({
            group: makeGroup({
                label: 'auth.plan.md',
                children: [makeChild({ id: 'c1' })],
            }),
        });
        expect(screen.getByText('auth.plan.md')).toBeTruthy();
    });

    it('shows the child count via group-child-count testid', () => {
        renderHeader({
            group: makeGroup({
                children: [
                    makeChild({ id: 'c1' }),
                    makeChild({ id: 'c2' }),
                    makeChild({ id: 'c3' }),
                ],
            }),
        });
        expect(screen.getByTestId('group-child-count').textContent).toBe('3');
    });

    // Mode pill labels ─────────────────────────────────────────────────
    const modeCases: Array<{ mode: GroupAggregateMode; label: string }> = [
        { mode: 'ask', label: 'A' },
        { mode: 'auto', label: 'A' },
        { mode: 'script', label: 'S' },
        { mode: 'mixed', label: 'M' },
    ];
    modeCases.forEach(({ mode, label }) => {
        it(`renders "${label}" as the mode pill text for aggregateMode="${mode}"`, () => {
            renderHeader({ aggregateMode: mode });
            expect(screen.getByText(label)).toBeTruthy();
        });
    });

    it('mode pill tooltip describes mixed-mode child breakdown', () => {
        renderHeader({
            aggregateMode: 'mixed',
            group: makeGroup({
                children: [
                    makeChild({ id: 'c1', type: 'chat', mode: 'plan' }),
                    makeChild({ id: 'c2', type: 'chat', mode: 'plan' }),
                    makeChild({ id: 'c3', type: 'chat', mode: 'autopilot' }),
                    makeChild({ id: 'c4', type: 'chat', mode: 'ask' }),
                ],
            }),
        });
        const mixSpan = screen.getByText('M');
        const tooltip = mixSpan.getAttribute('title') ?? '';
        expect(tooltip).toContain('Mixed modes');
        // Tooltip surfaces every distinct normalized mode + its child count.
        expect(tooltip).not.toContain('PLAN');
        expect(tooltip).toContain('1 AUTO');
        expect(tooltip).toContain('3 ASK');
    });

    it('mode pill tooltip describes uniform mode in human-readable form', () => {
        renderHeader({ aggregateMode: 'ask' });
        const askSpan = screen.getByText('A');
        expect(askSpan.getAttribute('title')).toContain('read-only');
    });

    // Chevron behaviour ────────────────────────────────────────────────
    it('chevron has aria-expanded="false" when collapsed', () => {
        renderHeader({ isExpanded: false });
        const chevron = screen.getByTestId('group-chevron');
        expect(chevron.getAttribute('aria-expanded')).toBe('false');
    });

    it('chevron has aria-expanded="true" and rotate-90 class when expanded', () => {
        renderHeader({ isExpanded: true });
        const chevron = screen.getByTestId('group-chevron');
        expect(chevron.getAttribute('aria-expanded')).toBe('true');
        expect(chevron.className).toContain('rotate-90');
    });

    it('clicking the chevron calls onToggle and stops propagation', () => {
        const onToggle = vi.fn();
        const onClick = vi.fn();
        renderHeader({ onToggle, onClick });
        fireEvent.click(screen.getByTestId('group-chevron'));
        expect(onToggle).toHaveBeenCalledTimes(1);
        // Row-level onClick should not fire because the chevron stops propagation
        expect(onClick).not.toHaveBeenCalled();
    });

    it('clicking the row body falls back to onToggle when no onClick is supplied', () => {
        const onToggle = vi.fn();
        renderHeader({ onToggle });
        fireEvent.click(screen.getByTestId('history-group-header'));
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('clicking the row body invokes onClick when provided (instead of onToggle)', () => {
        const onToggle = vi.fn();
        const onClick = vi.fn();
        renderHeader({ onToggle, onClick });
        fireEvent.click(screen.getByTestId('history-group-header'));
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(onToggle).not.toHaveBeenCalled();
    });

    it('right-click bubbles to onContextMenu', () => {
        const onContextMenu = vi.fn();
        renderHeader({ onContextMenu });
        fireEvent.contextMenu(screen.getByTestId('history-group-header'));
        expect(onContextMenu).toHaveBeenCalledTimes(1);
    });

    // Failed / cancelled badges ────────────────────────────────────────
    it('renders group-failed-count when at least one child failed', () => {
        renderHeader({
            group: makeGroup({
                aggregateStatus: 'failed',
                children: [
                    makeChild({ id: 'c1', status: 'failed' }),
                    makeChild({ id: 'c2', status: 'failed' }),
                    makeChild({ id: 'c3', status: 'completed' }),
                ],
            }),
        });
        const badge = screen.getByTestId('group-failed-count');
        expect(badge.textContent).toContain('2');
    });

    it('renders group-cancelled-count when there are cancellations and zero failures', () => {
        renderHeader({
            group: makeGroup({
                aggregateStatus: 'cancelled',
                children: [
                    makeChild({ id: 'c1', status: 'cancelled' }),
                    makeChild({ id: 'c2', status: 'completed' }),
                ],
            }),
        });
        const badge = screen.getByTestId('group-cancelled-count');
        expect(badge.textContent).toContain('1');
        expect(screen.queryByTestId('group-failed-count')).toBeNull();
    });

    it('hides the cancelled badge when failures are also present (failures take priority)', () => {
        renderHeader({
            group: makeGroup({
                aggregateStatus: 'failed',
                children: [
                    makeChild({ id: 'c1', status: 'failed' }),
                    makeChild({ id: 'c2', status: 'cancelled' }),
                ],
            }),
        });
        expect(screen.getByTestId('group-failed-count').textContent).toContain('1');
        expect(screen.queryByTestId('group-cancelled-count')).toBeNull();
    });

    // Unseen + selected ───────────────────────────────────────────────
    it('renders group-unseen-dot when isUnseen is true', () => {
        renderHeader({ isUnseen: true });
        expect(screen.getByTestId('group-unseen-dot')).toBeTruthy();
    });

    it('omits group-unseen-dot when isUnseen is false', () => {
        renderHeader({ isUnseen: false });
        expect(screen.queryByTestId('group-unseen-dot')).toBeNull();
    });

    it('exposes data-selected="true" when isSelected is true', () => {
        renderHeader({ isSelected: true });
        expect(screen.getByTestId('history-group-header').getAttribute('data-selected')).toBe('true');
    });

    it('omits data-selected when isSelected is false', () => {
        renderHeader({ isSelected: false });
        expect(screen.getByTestId('history-group-header').hasAttribute('data-selected')).toBe(false);
    });

    // Layout contract — row grid matches activity-compact reference ───
    it('uses the chat-row grid layout (10px dot, 36px mode, 1fr title, auto right)', () => {
        renderHeader();
        const header = screen.getByTestId('history-group-header');
        expect(header.className).toContain('grid-cols-[10px_36px_minmax(0,1fr)_auto]');
    });

    it('uses border-b and h-[26px] to match the compact-row visual rhythm', () => {
        renderHeader();
        const header = screen.getByTestId('history-group-header');
        expect(header.className).toContain('h-[26px]');
        expect(header.className).toContain('border-b');
    });
});
