import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ExploreCachePanel } from '../../../../src/server/spa/client/react/views/memory/ExploreCachePanel';

const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    global.fetch = mockFetch;
});

const defaultStats = {
    rawCount: 12,
    consolidatedCount: 4,
    consolidatedExists: true,
    lastAggregation: '2024-01-15T10:00:00.000Z',
};

function mockStatsOk(stats = defaultStats) {
    mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(stats),
    });
}

describe('ExploreCachePanel', () => {
    it('renders loading spinner on mount', async () => {
        // Never resolves — keeps spinner visible
        mockFetch.mockReturnValue(new Promise(() => {}));
        render(<ExploreCachePanel />);
        expect(screen.getByLabelText('Loading')).toBeDefined();
    });

    it('renders stats after mount', async () => {
        mockStatsOk();
        await act(async () => {
            render(<ExploreCachePanel />);
        });
        await waitFor(() => {
            expect(screen.getByText('12')).toBeDefined();
            expect(screen.getByText('4')).toBeDefined();
            // locale date is rendered — just check it contains "2024"
            const dateText = screen.getByText((text) => text.includes('2024'));
            expect(dateText).toBeDefined();
        });
    });

    it('renders "Never" when lastAggregation is null', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ ...defaultStats, lastAggregation: null }),
        });
        await act(async () => {
            render(<ExploreCachePanel />);
        });
        await waitFor(() => {
            expect(screen.getByText('Never')).toBeDefined();
        });
    });

    it('"Aggregate now" button disabled while aggregating', async () => {
        // Stats resolves immediately; POST hangs
        let resolvePost!: (v: any) => void;
        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (opts?.method === 'POST') {
                return new Promise((res) => { resolvePost = res; });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(defaultStats) });
        });

        await act(async () => {
            render(<ExploreCachePanel />);
        });

        await waitFor(() => {
            expect(screen.getByText('Aggregate now')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('Aggregate now'));
        });

        await waitFor(() => {
            const btn = screen.getByText('Aggregating…').closest('button') as HTMLButtonElement;
            expect(btn.disabled).toBe(true);
        });

        // Clean up
        resolvePost({ ok: true, json: () => Promise.resolve({ aggregated: true, rawCount: 0, consolidatedCount: 4 }) });
    });

    it('shows "Aggregating…" label while POST is in-flight', async () => {
        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (opts?.method === 'POST') {
                return new Promise(() => {});
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(defaultStats) });
        });

        await act(async () => {
            render(<ExploreCachePanel />);
        });

        await waitFor(() => {
            expect(screen.getByText('Aggregate now')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('Aggregate now'));
        });

        await waitFor(() => {
            expect(screen.getByText('Aggregating…')).toBeDefined();
        });
    });

    it('shows success message after aggregation', async () => {
        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (opts?.method === 'POST') {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ aggregated: true, rawCount: 5, consolidatedCount: 3 }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(defaultStats) });
        });

        await act(async () => {
            render(<ExploreCachePanel />);
        });

        await waitFor(() => {
            expect(screen.getByText('Aggregate now')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('Aggregate now'));
        });

        await waitFor(() => {
            expect(screen.getByText('Aggregated 5 entries → 3 consolidated')).toBeDefined();
        });
    });

    it('refreshes stats after successful aggregation', async () => {
        let statsCallCount = 0;
        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (opts?.method === 'POST') {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ aggregated: true, rawCount: 5, consolidatedCount: 3 }),
                });
            }
            if (url.includes('/stats')) {
                statsCallCount++;
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(defaultStats) });
        });

        await act(async () => {
            render(<ExploreCachePanel />);
        });

        await waitFor(() => {
            expect(screen.getByText('Aggregate now')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('Aggregate now'));
        });

        await waitFor(() => {
            expect(screen.getByText('Aggregated 5 entries → 3 consolidated')).toBeDefined();
        });

        // Stats should have been fetched at least twice (mount + after POST)
        expect(statsCallCount).toBeGreaterThanOrEqual(2);
    });

    it('shows error message on POST failure', async () => {
        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (opts?.method === 'POST') {
                return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(defaultStats) });
        });

        await act(async () => {
            render(<ExploreCachePanel />);
        });

        await waitFor(() => {
            expect(screen.getByText('Aggregate now')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('Aggregate now'));
        });

        await waitFor(() => {
            expect(screen.getByText((text) => text.includes('HTTP 500'))).toBeDefined();
        });
    });

    it('shows stats fetch error', async () => {
        mockFetch.mockRejectedValue(new Error('Network error'));
        await act(async () => {
            render(<ExploreCachePanel />);
        });
        await waitFor(() => {
            expect(screen.getByText('Network error')).toBeDefined();
        });
        // No stat rows should be present
        expect(screen.queryByText('Raw entries')).toBeNull();
    });

    it('"Refresh" button re-fetches stats', async () => {
        let statsCallCount = 0;
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/stats')) {
                statsCallCount++;
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(defaultStats) });
        });

        await act(async () => {
            render(<ExploreCachePanel />);
        });

        await waitFor(() => {
            expect(screen.getByText('Refresh')).toBeDefined();
        });

        const countBeforeRefresh = statsCallCount;

        await act(async () => {
            fireEvent.click(screen.getByText('Refresh'));
        });

        await waitFor(() => {
            expect(statsCallCount).toBeGreaterThan(countBeforeRefresh);
        });
    });
});
