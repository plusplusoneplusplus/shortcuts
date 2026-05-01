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

    it('renders table with date and model header when data is present', () => {
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
        expect(screen.getByText('gpt-4o')).toBeTruthy();
        expect(screen.getAllByText('Total').length).toBeGreaterThan(0);
    });

    it('renders — for missing model data in a row', () => {
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

    it('shows premium units only in rightmost total cells', () => {
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
        expect(screen.getAllByText('· 416.38 units').length).toBe(2);
    });
});
