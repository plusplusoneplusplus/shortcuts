/**
 * Tests for UsageStatsView component.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UsageStatsView } from '../../../../../src/server/spa/client/react/features/stats/UsageStatsView';
import type { ClientTokenUsage, ClientTokenUsageStatsResponse } from '../../../../../src/server/spa/client/react/types/dashboard';

const mockReload = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/features/chat/hooks/useTokenUsageStats', () => ({
    useTokenUsageStats: vi.fn(),
}));

import { useTokenUsageStats } from '../../../../../src/server/spa/client/react/features/chat/hooks/useTokenUsageStats';

const makeHookResult = (overrides: Partial<{
    data: ClientTokenUsageStatsResponse | null;
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

const makeUsage = (overrides: Partial<ClientTokenUsage> = {}): ClientTokenUsage => ({
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 1500,
    turnCount: 1,
    ...overrides,
});

const makeEntry = (date: string, model: string, usageOverrides: Partial<ClientTokenUsage> = {}) => {
    const usage = makeUsage(usageOverrides);
    return {
        date,
        byModel: {
            [model]: usage,
        },
        dayTotal: usage,
    };
};

afterEach(() => {
    vi.clearAllMocks();
});

describe('UsageStatsView', () => {
    it('renders without crashing while loading', () => {
        (useTokenUsageStats as ReturnType<typeof vi.fn>).mockReturnValue(
            makeHookResult({ loading: true })
        );
        render(<UsageStatsView />);
        expect(screen.getByText('Loading…')).toBeTruthy();
    });

    it('renders day selector and refresh button', () => {
        (useTokenUsageStats as ReturnType<typeof vi.fn>).mockReturnValue(
            makeHookResult({ loading: true })
        );
        render(<UsageStatsView />);
        expect(screen.getByText('Last 7 days')).toBeTruthy();
        expect(screen.getByText('Last 30 days')).toBeTruthy();
        expect(screen.getByText('Last 90 days')).toBeTruthy();
        expect(screen.getByText('All time')).toBeTruthy();
        expect(screen.getByText('↻ Refresh')).toBeTruthy();
    });

    it('renders empty state when entries are empty', () => {
        (useTokenUsageStats as ReturnType<typeof vi.fn>).mockReturnValue(
            makeHookResult({
                data: { entries: [], models: [], generatedAt: '2025-01-01T00:00:00Z', totalDays: 0 },
            })
        );
        render(<UsageStatsView />);
        expect(screen.getByText(/No token usage data found/)).toBeTruthy();
    });

    it('does not crash when the response is malformed (missing entries)', () => {
        // Regression: a `{}` payload (truthy `data`, no `entries`) — produced by a
        // blanket fetch mock and observed flakily in CI — used to throw
        // "Cannot read properties of undefined (reading 'reduce')" in sumUsage,
        // crashing the whole embedded AdminPanel render. The view must tolerate it.
        (useTokenUsageStats as ReturnType<typeof vi.fn>).mockReturnValue(
            makeHookResult({ data: {} as ClientTokenUsageStatsResponse })
        );
        expect(() => render(<UsageStatsView />)).not.toThrow();
        // Controls still render; a malformed payload is neither the empty state nor a table.
        expect(screen.getByText('↻ Refresh')).toBeTruthy();
        expect(screen.queryByText(/No token usage data found/)).toBeNull();
    });

    it('renders error state with retry button', () => {
        (useTokenUsageStats as ReturnType<typeof vi.fn>).mockReturnValue(
            makeHookResult({ error: 'Network error' })
        );
        render(<UsageStatsView />);
        expect(screen.getByText('Network error')).toBeTruthy();
        const retryBtn = screen.getByText('Retry');
        expect(retryBtn).toBeTruthy();
        fireEvent.click(retryBtn);
        expect(mockReload).toHaveBeenCalledTimes(1);
    });

    it('renders table with date, model column, and "All models" summary row', () => {
        (useTokenUsageStats as ReturnType<typeof vi.fn>).mockReturnValue(
            makeHookResult({
                data: {
                    entries: [makeEntry('2025-07-10', 'gpt-4o')],
                    models: ['gpt-4o'],
                    generatedAt: '2025-07-10T12:00:00Z',
                    totalDays: 1,
                },
            })
        );
        render(<UsageStatsView />);
        expect(screen.getByText('2025-07-10')).toBeTruthy();
        expect(screen.getAllByText('gpt-4o').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('All models').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Total').length).toBeGreaterThan(0);
    });

    it('renders per-model rows under each date group', () => {
        (useTokenUsageStats as ReturnType<typeof vi.fn>).mockReturnValue(
            makeHookResult({
                data: {
                    entries: [{
                        date: '2025-07-10',
                        byModel: {
                            'gpt-4o': makeUsage({ inputTokens: 500 }),
                            'claude-3': makeUsage({ inputTokens: 800 }),
                        },
                        dayTotal: makeUsage({ inputTokens: 1300 }),
                    }],
                    models: ['gpt-4o', 'claude-3'],
                    generatedAt: '2025-07-10T12:00:00Z',
                    totalDays: 1,
                },
            })
        );
        render(<UsageStatsView />);
        expect(screen.getAllByText('gpt-4o').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('claude-3').length).toBeGreaterThanOrEqual(1);
    });

    it('only shows models that have data for a given date', () => {
        (useTokenUsageStats as ReturnType<typeof vi.fn>).mockReturnValue(
            makeHookResult({
                data: {
                    entries: [makeEntry('2025-07-10', 'gpt-4o')],
                    models: ['gpt-4o', 'claude-3'],
                    generatedAt: '2025-07-10T12:00:00Z',
                    totalDays: 1,
                },
            })
        );
        render(<UsageStatsView />);
        const gpt4oCells = screen.getAllByText('gpt-4o');
        expect(gpt4oCells.length).toBeGreaterThanOrEqual(1);
    });

    it('shows — for models with no usage in the grand total', () => {
        (useTokenUsageStats as ReturnType<typeof vi.fn>).mockReturnValue(
            makeHookResult({
                data: {
                    entries: [makeEntry('2025-07-10', 'gpt-4o')],
                    models: ['gpt-4o', 'never-used-model'],
                    generatedAt: '2025-07-10T12:00:00Z',
                    totalDays: 1,
                },
            })
        );
        render(<UsageStatsView />);
        const dashes = screen.getAllByText('—');
        expect(dashes.length).toBeGreaterThan(0);
    });

    it('calls reload when refresh button is clicked', () => {
        (useTokenUsageStats as ReturnType<typeof vi.fn>).mockReturnValue(
            makeHookResult({ loading: false })
        );
        render(<UsageStatsView />);
        fireEvent.click(screen.getByText('↻ Refresh'));
        expect(mockReload).toHaveBeenCalledTimes(1);
    });

    it('shows generated-at label when data is available', () => {
        (useTokenUsageStats as ReturnType<typeof vi.fn>).mockReturnValue(
            makeHookResult({
                data: {
                    entries: [makeEntry('2025-07-10', 'gpt-4o')],
                    models: ['gpt-4o'],
                    generatedAt: '2025-07-10T12:00:00Z',
                    totalDays: 1,
                },
            })
        );
        render(<UsageStatsView />);
        expect(screen.getByText(/Generated at:/)).toBeTruthy();
    });

    it('shows displayed USD in every populated usage cell and never premium units', () => {
        (useTokenUsageStats as ReturnType<typeof vi.fn>).mockReturnValue(
            makeHookResult({
                data: {
                    entries: [
                        makeEntry('2025-07-10', 'gpt-4o', {
                            inputTokens: 14100000,
                            outputTokens: 125400,
                            cacheReadTokens: 9500000,
                            cacheWriteTokens: 18200,
                            totalTokens: 14225400,
                            cost: 416.375,
                            displayedUsdCost: 4.25,
                            displayedUsdCostSource: 'estimated',
                        }),
                    ],
                    models: ['gpt-4o'],
                    generatedAt: '2025-07-10T12:00:00Z',
                    totalDays: 1,
                },
            })
        );

        render(<UsageStatsView />);

        expect(screen.getAllByText('↓14.1M total').length).toBe(4);
        expect(screen.getAllByText('· 9.5M cached').length).toBe(4);
        expect(screen.getAllByText('· 4.6M new').length).toBe(4);
        expect(screen.getAllByText('↑125.4k out').length).toBe(4);
        expect(screen.getAllByText('· 18.2k cache write').length).toBe(4);
        expect(screen.getAllByText('· USD $4.25').length).toBe(4);
        expect(document.body.textContent).not.toMatch(/premium\s+units/i);
        expect(document.body.textContent).not.toContain('416.38');
    });

    it('renders pricing-table estimate details alongside displayed USD in every usage cell', () => {
        (useTokenUsageStats as ReturnType<typeof vi.fn>).mockReturnValue(
            makeHookResult({
                data: {
                    entries: [
                        makeEntry('2025-07-10', 'gpt-5.5', {
                            inputTokens: 2_000_000,
                            outputTokens: 1_000_000,
                            cacheReadTokens: 500_000,
                            cacheWriteTokens: 0,
                            totalTokens: 3_000_000,
                            estimatedUsdCost: 42.31,
                            displayedUsdCost: 42.31,
                            displayedUsdCostSource: 'estimated',
                            costBreakdown: {
                                inputUsd: 7.5,
                                cachedInputUsd: 0.25,
                                cacheWriteUsd: 0,
                                outputUsd: 34.56,
                            },
                            pricingSource: 'https://docs.github.com/example',
                        }),
                    ],
                    models: ['gpt-5.5'],
                    generatedAt: '2025-07-10T12:00:00Z',
                    totalDays: 1,
                },
            })
        );

        render(<UsageStatsView />);

        expect(screen.getAllByText('· USD $42.31').length).toBe(4);
        const cellsWithDisplayedCost = screen.getAllByTitle(/Displayed USD: \$42\.31 \(pricing estimate\)/);
        expect(cellsWithDisplayedCost).toHaveLength(4);
        const cellsWithPricingSource = screen.getAllByTitle(/Pricing source: https:\/\/docs\.github\.com\/example/);
        expect(cellsWithPricingSource).toHaveLength(4);
    });

    it('does not treat SDK premium units as USD', () => {
        (useTokenUsageStats as ReturnType<typeof vi.fn>).mockReturnValue(
            makeHookResult({
                data: {
                    entries: [
                        makeEntry('2025-07-10', 'gpt-4o', {
                            cost: 12.5,
                        }),
                    ],
                    models: ['gpt-4o'],
                    generatedAt: '2025-07-10T12:00:00Z',
                    totalDays: 1,
                },
            })
        );

        render(<UsageStatsView />);

        expect(document.body.textContent).not.toContain('$12.50');
        expect(document.body.textContent).not.toMatch(/premium\s+units/i);
        expect(screen.getAllByText('· USD pricing unavailable')).toHaveLength(4);
    });

    it('shows native Claude USD, estimated Codex USD, and explicit unavailable pricing', () => {
        const claude = makeUsage({
            inputTokens: 2000,
            outputTokens: 1000,
            totalTokens: 3000,
            actualUsdCost: 0.1234,
            estimatedUsdCost: 0.45,
            displayedUsdCost: 0.1234,
            displayedUsdCostSource: 'native',
            costBreakdown: {
                inputUsd: 0.05,
                cachedInputUsd: 0,
                cacheWriteUsd: 0,
                outputUsd: 0.4,
            },
            pricingSource: 'https://docs.github.com/claude',
        });
        const codex = makeUsage({
            inputTokens: 3000,
            outputTokens: 1000,
            totalTokens: 4000,
            estimatedUsdCost: 1.5,
            displayedUsdCost: 1.5,
            displayedUsdCostSource: 'estimated',
            costBreakdown: {
                inputUsd: 0.5,
                cachedInputUsd: 0,
                cacheWriteUsd: 0,
                outputUsd: 1,
            },
            pricingSource: 'https://docs.github.com/codex',
        });
        const unknown = makeUsage({
            inputTokens: 500,
            outputTokens: 100,
            totalTokens: 600,
            pricingUnavailable: true,
        });
        const dayTotal = makeUsage({
            inputTokens: claude.inputTokens + codex.inputTokens + unknown.inputTokens,
            outputTokens: claude.outputTokens + codex.outputTokens + unknown.outputTokens,
            totalTokens: claude.totalTokens + codex.totalTokens + unknown.totalTokens,
            actualUsdCost: claude.actualUsdCost,
            estimatedUsdCost: (claude.estimatedUsdCost ?? 0) + (codex.estimatedUsdCost ?? 0),
            displayedUsdCost: (claude.displayedUsdCost ?? 0) + (codex.displayedUsdCost ?? 0),
            displayedUsdCostSource: 'mixed',
            pricingUnavailable: true,
        });

        (useTokenUsageStats as ReturnType<typeof vi.fn>).mockReturnValue(
            makeHookResult({
                data: {
                    entries: [{
                        date: '2025-07-10',
                        byModel: {
                            'claude-sonnet-4.6': claude,
                            'gpt-5.3-codex': codex,
                            'missing-model': unknown,
                        },
                        dayTotal,
                    }],
                    models: ['claude-sonnet-4.6', 'gpt-5.3-codex', 'missing-model'],
                    generatedAt: '2025-07-10T12:00:00Z',
                    totalDays: 1,
                },
            })
        );

        render(<UsageStatsView />);

        expect(screen.getAllByText('· USD $0.12')).toHaveLength(2);
        expect(screen.getAllByTitle(/Displayed USD: \$0\.12 \(native reported\)/)).toHaveLength(2);
        expect(screen.getAllByText('· USD $1.50')).toHaveLength(2);
        expect(screen.getAllByTitle(/Displayed USD: \$1\.50 \(pricing estimate\)/)).toHaveLength(2);
        expect(screen.getAllByText('· USD $1.62')).toHaveLength(2);
        expect(screen.getAllByTitle(/Displayed USD: \$1\.62 \(mixed native\/estimate\)/)).toHaveLength(2);
        expect(screen.getAllByText('· USD pricing unavailable')).toHaveLength(2);
        expect(screen.getAllByTitle(/Displayed USD: pricing unavailable/)).toHaveLength(2);
    });

    it('fits within a fixed number of columns regardless of model count', () => {
        const manyModels = Array.from({ length: 20 }, (_, i) => `model-${i}`);
        const byModel: Record<string, ClientTokenUsage> = {};
        for (const m of manyModels) {
            byModel[m] = makeUsage({ inputTokens: 100 * (manyModels.indexOf(m) + 1) });
        }
        const dayTotal = makeUsage({ inputTokens: 2000, outputTokens: 1000 });

        (useTokenUsageStats as ReturnType<typeof vi.fn>).mockReturnValue(
            makeHookResult({
                data: {
                    entries: [{ date: '2025-07-10', byModel, dayTotal }],
                    models: manyModels,
                    generatedAt: '2025-07-10T12:00:00Z',
                    totalDays: 1,
                },
            })
        );

        render(<UsageStatsView />);

        const headers = screen.getAllByRole('columnheader');
        expect(headers).toHaveLength(3);
        expect(headers[0].textContent).toBe('Date');
        expect(headers[1].textContent).toBe('Model');
        expect(headers[2].textContent).toBe('Tokens');

        for (const m of manyModels) {
            expect(screen.getAllByText(m).length).toBeGreaterThanOrEqual(1);
        }
    });

    it('shows grand total in footer with per-model breakdowns', () => {
        (useTokenUsageStats as ReturnType<typeof vi.fn>).mockReturnValue(
            makeHookResult({
                data: {
                    entries: [
                        makeEntry('2025-07-10', 'gpt-4o', { inputTokens: 2000, outputTokens: 1000 }),
                        makeEntry('2025-07-11', 'gpt-4o', { inputTokens: 3000, outputTokens: 1500 }),
                    ],
                    models: ['gpt-4o'],
                    generatedAt: '2025-07-11T12:00:00Z',
                    totalDays: 2,
                },
            })
        );

        render(<UsageStatsView />);

        expect(screen.getByText('Total')).toBeTruthy();
        expect(screen.getAllByText('All models').length).toBe(3);
    });
});
