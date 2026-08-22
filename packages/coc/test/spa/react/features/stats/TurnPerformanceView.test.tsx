/**
 * Tests for TurnPerformanceView component.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TurnPerformanceView } from '../../../../../src/server/spa/client/react/features/stats/TurnPerformanceView';
import type { TurnPerformanceGroup, TurnPerformanceStatsResponse } from '@plusplusoneplusplus/coc-client';

const mockReload = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/features/stats/hooks/useTurnPerformanceStats', () => ({
    useTurnPerformanceStats: vi.fn(),
}));

import { useTurnPerformanceStats } from '../../../../../src/server/spa/client/react/features/stats/hooks/useTurnPerformanceStats';

const mockedHook = useTurnPerformanceStats as ReturnType<typeof vi.fn>;

const makeHookResult = (overrides: Partial<{
    data: TurnPerformanceStatsResponse | null;
    loading: boolean;
    error: string | null;
    reload: () => void;
}> = {}) => ({
    data: null,
    loading: false,
    error: null,
    reload: mockReload,
    ...overrides,
});

const makeGroup = (overrides: Partial<TurnPerformanceGroup> = {}): TurnPerformanceGroup => ({
    key: { provider: 'claude' },
    turnCount: 412,
    ttftMs: { p50: 3200, p90: 8100, p99: 19400, mean: 4310, min: 780, max: 24000, n: 409 },
    tpsGeneration: { p50: 27.4, p90: 41.2, p99: 52.0, mean: 28.9, min: 3.1, max: 60.2, n: 401 },
    tpsWall: { p50: 24.1, p90: 37.0, p99: 48.3, mean: 25.6, min: 2.7, max: 55.9, n: 401 },
    outputTokens: 812430,
    ...overrides,
});

const makeResponse = (groups: TurnPerformanceGroup[], overrides: Partial<TurnPerformanceStatsResponse> = {}): TurnPerformanceStatsResponse => ({
    groups,
    groupBy: ['provider'],
    days: 30,
    totalEvents: groups.reduce((acc, g) => acc + g.turnCount, 0),
    excludedEvents: { nonCompleted: 0, noFirstToken: 0, noTokenUsage: 0 },
    generatedAt: '2026-08-20T10:00:00.000Z',
    ...overrides,
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('TurnPerformanceView', () => {
    it('renders the loading state', () => {
        mockedHook.mockReturnValue(makeHookResult({ loading: true }));
        render(<TurnPerformanceView />);
        expect(screen.getByText('Loading performance…')).toBeTruthy();
    });

    it('renders dimension picker, day range, first-turn-only toggle, and refresh', () => {
        mockedHook.mockReturnValue(makeHookResult());
        render(<TurnPerformanceView />);
        expect(screen.getByLabelText('Performance dimension')).toBeTruthy();
        expect(screen.getByText('By provider')).toBeTruthy();
        expect(screen.getByText('By model')).toBeTruthy();
        expect(screen.getByText('By workspace')).toBeTruthy();
        expect(screen.getByText('By kind')).toBeTruthy();
        expect(screen.getByLabelText('Performance day range')).toBeTruthy();
        expect(screen.getByText('First turn only')).toBeTruthy();
        expect(screen.getByText('↻ Refresh performance')).toBeTruthy();
    });

    it('renders the explicit empty state when no rows exist yet', () => {
        mockedHook.mockReturnValue(makeHookResult({ data: makeResponse([]) }));
        render(<TurnPerformanceView />);
        expect(screen.getByText(/No turn metrics recorded yet — metrics start accruing after the next turn/)).toBeTruthy();
    });

    it('does not crash on a malformed response (missing groups)', () => {
        mockedHook.mockReturnValue(makeHookResult({ data: {} as TurnPerformanceStatsResponse }));
        expect(() => render(<TurnPerformanceView />)).not.toThrow();
        expect(screen.queryByText(/No turn metrics recorded yet/)).toBeNull();
        expect(screen.getByText('↻ Refresh performance')).toBeTruthy();
    });

    it('renders the error state and retries via reload', () => {
        mockedHook.mockReturnValue(makeHookResult({ error: 'Network error' }));
        render(<TurnPerformanceView />);
        expect(screen.getByText('Network error')).toBeTruthy();
        fireEvent.click(screen.getByText('Retry'));
        expect(mockReload).toHaveBeenCalledTimes(1);
    });

    it('renders a populated table with TTFT and TPS percentiles', () => {
        mockedHook.mockReturnValue(makeHookResult({
            data: makeResponse([
                makeGroup(),
                makeGroup({
                    key: { provider: 'copilot' },
                    turnCount: 7,
                    ttftMs: { p50: 900, p90: 1500, p99: 9800, mean: 1200, min: 400, max: 9900, n: 7 },
                    tpsGeneration: { p50: 12.34, p90: 18.4, p99: 20.1, mean: 13.0, min: 4.0, max: 21.0, n: 7 },
                }),
            ]),
        }));
        render(<TurnPerformanceView />);

        const headers = screen.getAllByRole('columnheader').map(h => h.textContent);
        expect(headers).toEqual(['Group', 'Turns', 'TTFT p50', 'TTFT p90', 'TTFT p99', 'TPS p50', 'TPS p90', 'TPS p99']);

        expect(screen.getByText('claude')).toBeTruthy();
        expect(screen.getByText('copilot')).toBeTruthy();
        expect(screen.getByText('412')).toBeTruthy();
        // ms formatting: <10s stays in ms, >=10s switches to seconds
        expect(screen.getByText('3200ms')).toBeTruthy();
        expect(screen.getByText('19.4s')).toBeTruthy();
        expect(screen.getByText('900ms')).toBeTruthy();
        // tps to one decimal
        expect(screen.getByText('27.4')).toBeTruthy();
        expect(screen.getByText('12.3')).toBeTruthy();
        // totals summary in the controls bar
        expect(screen.getByText(/419 turns/)).toBeTruthy();
    });

    it('renders — for null distribution values (e.g. TTFT-less groups)', () => {
        mockedHook.mockReturnValue(makeHookResult({
            data: makeResponse([
                makeGroup({
                    ttftMs: { p50: null, p90: null, p99: null, mean: null, min: null, max: null, n: 0 },
                    tpsGeneration: { p50: null, p90: null, p99: null, mean: null, min: null, max: null, n: 0 },
                }),
            ]),
        }));
        render(<TurnPerformanceView />);
        expect(screen.getAllByText('—')).toHaveLength(6);
    });

    it('shows the excluded-events summary when rows were dropped', () => {
        mockedHook.mockReturnValue(makeHookResult({
            data: makeResponse([makeGroup()], {
                excludedEvents: { nonCompleted: 2, noFirstToken: 3, noTokenUsage: 11 },
            }),
        }));
        render(<TurnPerformanceView />);
        expect(screen.getByText(/Excluded: 2 not completed, 3 without first token, 11 without token usage/)).toBeTruthy();
    });

    it('joins composite group keys for display', () => {
        mockedHook.mockReturnValue(makeHookResult({
            data: makeResponse([makeGroup({ key: { provider: 'claude', model: 'claude-fable-5' } })]),
        }));
        render(<TurnPerformanceView />);
        expect(screen.getByText('claude · claude-fable-5')).toBeTruthy();
    });

    it('re-queries with the selected dimension', () => {
        mockedHook.mockReturnValue(makeHookResult({ data: makeResponse([makeGroup()]) }));
        render(<TurnPerformanceView />);

        expect(mockedHook).toHaveBeenLastCalledWith(30, 'provider', false);

        fireEvent.change(screen.getByLabelText('Performance dimension'), { target: { value: 'model' } });
        expect(mockedHook).toHaveBeenLastCalledWith(30, 'model', false);
    });

    it('re-queries with the selected day range including all-time', () => {
        mockedHook.mockReturnValue(makeHookResult({ data: makeResponse([makeGroup()]) }));
        render(<TurnPerformanceView />);

        fireEvent.change(screen.getByLabelText('Performance day range'), { target: { value: '7' } });
        expect(mockedHook).toHaveBeenLastCalledWith(7, 'provider', false);

        fireEvent.change(screen.getByLabelText('Performance day range'), { target: { value: '' } });
        expect(mockedHook).toHaveBeenLastCalledWith(undefined, 'provider', false);
    });

    it('re-queries when first-turn-only is toggled', () => {
        mockedHook.mockReturnValue(makeHookResult({ data: makeResponse([makeGroup()]) }));
        render(<TurnPerformanceView />);

        fireEvent.click(screen.getByRole('checkbox'));
        expect(mockedHook).toHaveBeenLastCalledWith(30, 'provider', true);
    });

    it('calls reload when the refresh button is clicked', () => {
        mockedHook.mockReturnValue(makeHookResult({ data: makeResponse([makeGroup()]) }));
        render(<TurnPerformanceView />);
        fireEvent.click(screen.getByText('↻ Refresh performance'));
        expect(mockReload).toHaveBeenCalledTimes(1);
    });
});
