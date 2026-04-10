/**
 * Tests for ConsolidatedPanel — Dialog-based consolidated memory viewer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ConsolidatedPanel } from '../../../../../src/server/spa/client/react/repos/memory/ConsolidatedPanel';

const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    vi.useFakeTimers({ shouldAdvanceTime: true });
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
    onClose: vi.fn(),
};

describe('ConsolidatedPanel', () => {
    // ── Loading state ────────────────────────────────────────────────────

    it('shows loading state on mount', async () => {
        mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
        render(<ConsolidatedPanel {...defaultProps} />);
        expect(screen.getByTestId('consolidated-loading')).toBeDefined();
        expect(screen.getByText('Loading…')).toBeDefined();
    });

    // ── Content rendering ────────────────────────────────────────────────

    it('renders consolidated content in a <pre> block', async () => {
        mockConsolidatedOk('Hello world\nLine two');
        await act(async () => { render(<ConsolidatedPanel {...defaultProps} />); });
        await waitFor(() => {
            const pre = screen.getByTestId('consolidated-content');
            expect(pre.tagName).toBe('PRE');
            expect(pre.textContent).toContain('Hello world');
            expect(pre.textContent).toContain('Line two');
        });
    });

    it('renders empty <pre> when content is empty string', async () => {
        mockConsolidatedOk('');
        await act(async () => { render(<ConsolidatedPanel {...defaultProps} />); });
        await waitFor(() => {
            const pre = screen.getByTestId('consolidated-content');
            expect(pre.tagName).toBe('PRE');
            expect(pre.textContent).toBe('');
        });
    });

    it('renders content preserving whitespace (pre-wrap)', async () => {
        mockConsolidatedOk('  indented\n  text');
        await act(async () => { render(<ConsolidatedPanel {...defaultProps} />); });
        await waitFor(() => {
            const pre = screen.getByTestId('consolidated-content');
            expect(pre.textContent).toContain('  indented');
        });
    });

    // ── Error state ──────────────────────────────────────────────────────

    it('shows error when API returns non-ok response', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found',
            json: () => Promise.resolve({}),
        });
        await act(async () => { render(<ConsolidatedPanel {...defaultProps} />); });
        await waitFor(() => {
            expect(screen.getByTestId('consolidated-error')).toBeDefined();
            expect(screen.getByText(/API error: 404/)).toBeDefined();
        });
    });

    it('shows error when fetch throws', async () => {
        mockFetch.mockRejectedValue(new Error('Connection refused'));
        await act(async () => { render(<ConsolidatedPanel {...defaultProps} />); });
        await waitFor(() => {
            expect(screen.getByTestId('consolidated-error')).toBeDefined();
            expect(screen.getByText('Connection refused')).toBeDefined();
        });
    });

    // ── Dialog integration ───────────────────────────────────────────────

    it('renders inside a Dialog with title "Consolidated Memory"', async () => {
        mockConsolidatedOk();
        await act(async () => { render(<ConsolidatedPanel {...defaultProps} />); });
        await waitFor(() => {
            expect(screen.getByText('Consolidated Memory')).toBeDefined();
        });
    });

    it('calls onClose when Close button is clicked', async () => {
        const onClose = vi.fn();
        mockConsolidatedOk();
        await act(async () => { render(<ConsolidatedPanel {...defaultProps} onClose={onClose} />); });
        await waitFor(() => {
            expect(screen.getByTestId('consolidated-close-btn')).toBeDefined();
        });
        fireEvent.click(screen.getByTestId('consolidated-close-btn'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    // ── Copy button ──────────────────────────────────────────────────────

    it('shows copy button when content is present', async () => {
        mockConsolidatedOk('Some content');
        await act(async () => { render(<ConsolidatedPanel {...defaultProps} />); });
        await waitFor(() => {
            expect(screen.getByTestId('consolidated-copy-btn')).toBeDefined();
            expect(screen.getByText('Copy')).toBeDefined();
        });
    });

    it('does not show copy button when content is null', async () => {
        mockConsolidatedOk(null);
        await act(async () => { render(<ConsolidatedPanel {...defaultProps} />); });
        await waitFor(() => {
            // Content area should be rendered (even if empty pre)
            expect(screen.getByTestId('consolidated-content')).toBeDefined();
        });
        expect(screen.queryByTestId('consolidated-copy-btn')).toBeNull();
    });

    it('copies content to clipboard and shows "Copied!" feedback', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });

        mockConsolidatedOk('Copy this text');
        await act(async () => { render(<ConsolidatedPanel {...defaultProps} />); });
        await waitFor(() => { expect(screen.getByText('Copy')).toBeDefined(); });

        await act(async () => { fireEvent.click(screen.getByTestId('consolidated-copy-btn')); });
        expect(writeText).toHaveBeenCalledWith('Copy this text');
        expect(screen.getByText('Copied!')).toBeDefined();

        // Label reverts after 2 seconds
        await act(async () => { vi.advanceTimersByTime(2100); });
        expect(screen.getByText('Copy')).toBeDefined();
    });

    // ── Re-fetch on repoId change ────────────────────────────────────────

    it('re-fetches when repoId changes', async () => {
        mockConsolidatedOk('Repo A data');
        const { rerender } = await act(async () => {
            return render(<ConsolidatedPanel {...defaultProps} repoId="repo-a" />);
        });
        await waitFor(() => { expect(screen.getByText('Repo A data')).toBeDefined(); });

        const callCountBefore = mockFetch.mock.calls.length;
        mockConsolidatedOk('Repo B data');
        await act(async () => {
            rerender(<ConsolidatedPanel {...defaultProps} repoId="repo-b" />);
        });
        await waitFor(() => {
            expect(mockFetch.mock.calls.length).toBeGreaterThan(callCountBefore);
            expect(screen.getByText('Repo B data')).toBeDefined();
        });
    });
});
