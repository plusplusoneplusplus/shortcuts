/**
 * Tests for ConsolidatedTab — inline panel showing consolidated memory markdown.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ConsolidatedTab } from '../../../../../src/server/spa/client/react/repos/memory/ConsolidatedTab';

const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2025-06-15T12:00:00.000Z'));
});

afterEach(() => {
    vi.useRealTimers();
});

function mockConsolidatedOk(content: string | null = '# Summary\nAll is well.') {
    mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ content }),
    });
}

const defaultProps = {
    repoId: 'ws-test',
    consolidatedAt: '2025-06-15T11:30:00.000Z',
    consolidationStatus: 'idle' as const,
    onAggregate: vi.fn(),
};

describe('ConsolidatedTab', () => {
    // ── Loading state ────────────────────────────────────────────────────

    it('shows loading state while fetching', async () => {
        mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
        render(<ConsolidatedTab {...defaultProps} />);
        expect(screen.getByTestId('consolidated-tab-loading')).toBeDefined();
        expect(screen.getByText('Loading…')).toBeDefined();
    });

    // ── Content rendering ────────────────────────────────────────────────

    it('renders consolidated content after successful fetch', async () => {
        mockConsolidatedOk('This is the consolidated summary.');
        await act(async () => { render(<ConsolidatedTab {...defaultProps} />); });
        await waitFor(() => {
            expect(screen.getByTestId('consolidated-tab-content')).toBeDefined();
            expect(screen.getByText('This is the consolidated summary.')).toBeDefined();
        });
    });

    it('renders content inside a <pre> tag for preformatted display', async () => {
        mockConsolidatedOk('line1\nline2');
        await act(async () => { render(<ConsolidatedTab {...defaultProps} />); });
        await waitFor(() => {
            const pre = screen.getByTestId('consolidated-tab-content');
            expect(pre.tagName).toBe('PRE');
            expect(pre.textContent).toContain('line1');
            expect(pre.textContent).toContain('line2');
        });
    });

    // ── Empty state ──────────────────────────────────────────────────────

    it('shows empty state when content is null', async () => {
        mockConsolidatedOk(null);
        await act(async () => { render(<ConsolidatedTab {...defaultProps} />); });
        await waitFor(() => {
            expect(screen.getByTestId('consolidated-tab-empty')).toBeDefined();
            expect(screen.getByText(/No consolidated memory yet/i)).toBeDefined();
        });
    });

    it('does not show copy button when content is empty', async () => {
        mockConsolidatedOk(null);
        await act(async () => { render(<ConsolidatedTab {...defaultProps} />); });
        await waitFor(() => {
            expect(screen.getByTestId('consolidated-tab-empty')).toBeDefined();
        });
        expect(screen.queryByTestId('consolidated-tab-copy-btn')).toBeNull();
    });

    // ── Error state ──────────────────────────────────────────────────────

    it('shows error state when API call fails', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: () => Promise.resolve({}),
        });
        await act(async () => { render(<ConsolidatedTab {...defaultProps} />); });
        await waitFor(() => {
            expect(screen.getByTestId('consolidated-tab-error')).toBeDefined();
            expect(screen.getByText(/API error: 500/)).toBeDefined();
        });
    });

    it('shows error state when fetch throws a network error', async () => {
        mockFetch.mockRejectedValue(new Error('Network failure'));
        await act(async () => { render(<ConsolidatedTab {...defaultProps} />); });
        await waitFor(() => {
            expect(screen.getByTestId('consolidated-tab-error')).toBeDefined();
            expect(screen.getByText('Network failure')).toBeDefined();
        });
    });

    // ── Toolbar: "Last consolidated" label ───────────────────────────────

    it('displays "Last consolidated" relative time when consolidatedAt is provided', async () => {
        mockConsolidatedOk();
        await act(async () => { render(<ConsolidatedTab {...defaultProps} />); });
        await waitFor(() => {
            expect(screen.getByText(/Last consolidated:.*30m ago/)).toBeDefined();
        });
    });

    it('displays "Last consolidated: never" when consolidatedAt is null', async () => {
        mockConsolidatedOk();
        await act(async () => {
            render(<ConsolidatedTab {...defaultProps} consolidatedAt={null} />);
        });
        await waitFor(() => {
            expect(screen.getByText(/Last consolidated:.*never/)).toBeDefined();
        });
    });

    // ── Toolbar: Refresh button ──────────────────────────────────────────

    it('re-fetches content when Refresh is clicked', async () => {
        mockConsolidatedOk('Version 1');
        await act(async () => { render(<ConsolidatedTab {...defaultProps} />); });
        await waitFor(() => { expect(screen.getByText('Version 1')).toBeDefined(); });

        const callCountBefore = mockFetch.mock.calls.length;
        mockConsolidatedOk('Version 2');
        await act(async () => { fireEvent.click(screen.getByTestId('consolidated-tab-refresh-btn')); });
        await waitFor(() => {
            expect(mockFetch.mock.calls.length).toBeGreaterThan(callCountBefore);
            expect(screen.getByText('Version 2')).toBeDefined();
        });
    });

    // ── Toolbar: Copy button ─────────────────────────────────────────────

    it('shows copy button when content is present', async () => {
        mockConsolidatedOk('Some content');
        await act(async () => { render(<ConsolidatedTab {...defaultProps} />); });
        await waitFor(() => {
            expect(screen.getByTestId('consolidated-tab-copy-btn')).toBeDefined();
            expect(screen.getByText('Copy')).toBeDefined();
        });
    });

    it('copies content to clipboard and shows "Copied!" feedback', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });

        mockConsolidatedOk('Copy me');
        await act(async () => { render(<ConsolidatedTab {...defaultProps} />); });
        await waitFor(() => { expect(screen.getByText('Copy')).toBeDefined(); });

        await act(async () => { fireEvent.click(screen.getByTestId('consolidated-tab-copy-btn')); });
        expect(writeText).toHaveBeenCalledWith('Copy me');
        expect(screen.getByText('Copied!')).toBeDefined();

        // Revert label after timeout
        await act(async () => { vi.advanceTimersByTime(2100); });
        expect(screen.getByText('Copy')).toBeDefined();
    });

    // ── Toolbar: Aggregate button ────────────────────────────────────────

    it('renders "Aggregate" button in idle state and calls onAggregate on click', async () => {
        mockConsolidatedOk();
        const onAggregate = vi.fn();
        await act(async () => {
            render(<ConsolidatedTab {...defaultProps} onAggregate={onAggregate} />);
        });
        await waitFor(() => {
            expect(screen.getByText('Aggregate')).toBeDefined();
        });

        fireEvent.click(screen.getByTestId('consolidated-tab-aggregate-btn'));
        expect(onAggregate).toHaveBeenCalledTimes(1);
    });

    it('shows "Queued…" spinner when consolidationStatus is queued', async () => {
        mockConsolidatedOk();
        await act(async () => {
            render(<ConsolidatedTab {...defaultProps} consolidationStatus="queued" />);
        });
        await waitFor(() => {
            expect(screen.getByText('Queued…')).toBeDefined();
        });
    });

    it('shows "Consolidating…" spinner when consolidationStatus is running', async () => {
        mockConsolidatedOk();
        await act(async () => {
            render(<ConsolidatedTab {...defaultProps} consolidationStatus="running" />);
        });
        await waitFor(() => {
            expect(screen.getByText('Consolidating…')).toBeDefined();
        });
    });

    it('still calls onAggregate when clicking the active-status button', async () => {
        mockConsolidatedOk();
        const onAggregate = vi.fn();
        await act(async () => {
            render(<ConsolidatedTab {...defaultProps} consolidationStatus="running" onAggregate={onAggregate} />);
        });
        await waitFor(() => {
            expect(screen.getByText('Consolidating…')).toBeDefined();
        });
        fireEvent.click(screen.getByTestId('consolidated-tab-aggregate-btn'));
        expect(onAggregate).toHaveBeenCalledTimes(1);
    });

    // ── Re-fetch on repoId change ────────────────────────────────────────

    it('re-fetches consolidated content when repoId changes', async () => {
        mockConsolidatedOk('Repo A content');
        const { rerender } = await act(async () => {
            return render(<ConsolidatedTab {...defaultProps} repoId="repo-a" />);
        });
        await waitFor(() => { expect(screen.getByText('Repo A content')).toBeDefined(); });

        const callCountBefore = mockFetch.mock.calls.length;
        mockConsolidatedOk('Repo B content');
        await act(async () => {
            rerender(<ConsolidatedTab {...defaultProps} repoId="repo-b" />);
        });
        await waitFor(() => {
            expect(mockFetch.mock.calls.length).toBeGreaterThan(callCountBefore);
            expect(screen.getByText('Repo B content')).toBeDefined();
        });
    });
});
