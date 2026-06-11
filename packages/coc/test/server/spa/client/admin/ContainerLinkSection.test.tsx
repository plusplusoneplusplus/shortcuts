/**
 * @vitest-environment jsdom
 *
 * Tests for ContainerLinkSection — focuses on the infinite-loop regression
 * where an inline onError prop causes a new fetchStatus identity on every
 * render, re-triggering the fetch effect endlessly during server restarts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('../../../../../src/server/spa/client/react/ui', () => ({
    Spinner: () => <div data-testid="spinner">Loading...</div>,
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockContainerResponse(status = 'disconnected', overrides: Record<string, unknown> = {}) {
    return {
        ok: true,
        json: async () => ({
            status,
            containerUrl: null,
            agentId: null,
            agentName: null,
            ...overrides,
        }),
    };
}

import { ContainerLinkSection } from '../../../../../src/server/spa/client/react/admin/ContainerLinkSection';

/** Return all setInterval calls with the component's 3-second polling interval. */
function pollingCalls(spy: ReturnType<typeof vi.spyOn>) {
    return spy.mock.calls.filter(([, ms]) => ms === 3000);
}

describe('ContainerLinkSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('fetches status on mount', async () => {
        mockFetch.mockResolvedValue(mockContainerResponse());
        render(<ContainerLinkSection />);
        await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/config/container'));
    });

    it('shows disconnected status after fetch', async () => {
        mockFetch.mockResolvedValue(mockContainerResponse('disconnected'));
        render(<ContainerLinkSection />);
        await waitFor(() => expect(screen.getByText('Disconnected')).toBeTruthy());
    });

    it('shows registered status', async () => {
        mockFetch.mockResolvedValue(mockContainerResponse('registered', {
            containerUrl: 'http://c:5000',
            agentId: 'ag-1',
            agentName: 'my-agent',
        }));
        render(<ContainerLinkSection />);
        await waitFor(() => expect(screen.getByText('Registered')).toBeTruthy());
    });

    it('calls onError on fetch failure (non-silent)', async () => {
        mockFetch.mockRejectedValue(new Error('Network error'));
        const onError = vi.fn();
        render(<ContainerLinkSection onError={onError} />);
        await waitFor(() => expect(onError).toHaveBeenCalledWith(
            expect.stringContaining('Failed to fetch container link status')
        ));
    });

    // ── Regression: infinite loop fix ────────────────────────────────────────
    // Previously, passing an inline `onError` arrow function caused new references
    // on every AdminPanel render. fetchStatus listed onError as a dep, so it got
    // a new identity on every render, which re-fired the effect → fetch → error
    // → parent state change → re-render → repeat.
    it('does not re-fetch when a new onError reference is passed (infinite loop regression)', async () => {
        mockFetch.mockResolvedValue(mockContainerResponse());

        const onError1 = vi.fn();
        const onError2 = vi.fn();

        const { rerender } = render(<ContainerLinkSection onError={onError1} />);
        await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

        // Simulate parent re-render with a new inline function reference
        rerender(<ContainerLinkSection onError={onError2} />);
        await act(async () => { await Promise.resolve(); });

        // Should still be 1 — no second fetch triggered by the new onError ref
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // ── Polling behavior ─────────────────────────────────────────────────────
    // Spy on setInterval and filter by the component's 3000ms interval to avoid
    // noise from @testing-library/dom's internal 50ms waitFor polls.

    it('sets up 3-second polling interval when status is connecting', async () => {
        mockFetch.mockResolvedValue(mockContainerResponse('connecting'));
        const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

        render(<ContainerLinkSection />);
        // "Connecting..." appears in both the status label and the connect button
        await waitFor(() => expect(screen.getAllByText('Connecting\u2026').length).toBeGreaterThan(0));

        await waitFor(() => expect(pollingCalls(setIntervalSpy)).toHaveLength(1));
    });

    it('does not set up 3-second polling interval when status is disconnected', async () => {
        mockFetch.mockResolvedValue(mockContainerResponse('disconnected'));
        const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

        render(<ContainerLinkSection />);
        await waitFor(() => expect(screen.getByText('Disconnected')).toBeTruthy());
        await act(async () => { await Promise.resolve(); });

        expect(pollingCalls(setIntervalSpy)).toHaveLength(0);
    });

    it('poll callback suppresses onError (silent=true during restart)', async () => {
        // Capture the 3-second interval callback so we can invoke it directly
        let capturedCallback: (() => void) | null = null;
        const realSetInterval = globalThis.setInterval.bind(globalThis);
        const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(
            (fn: TimerHandler, ms?: number, ...args: unknown[]) => {
                if (ms === 3000) {
                    capturedCallback = fn as () => void;
                    return 99 as unknown as ReturnType<typeof setInterval>;
                }
                return realSetInterval(fn as TimerHandler, ms, ...args);
            }
        );

        mockFetch
            .mockResolvedValueOnce(mockContainerResponse('connecting'))
            .mockRejectedValue(new Error('ECONNREFUSED'));

        const onError = vi.fn();
        render(<ContainerLinkSection onError={onError} />);
        // "Connecting..." appears in both status label and button
        await waitFor(() => expect(screen.getAllByText('Connecting\u2026').length).toBeGreaterThan(0));
        await waitFor(() => expect(capturedCallback).not.toBeNull());

        // Invoke the polling callback directly (simulates timer tick)
        await act(async () => { capturedCallback!(); });
        await act(async () => { await Promise.resolve(); });

        // onError must NOT be called — polling fetch failures are silent
        expect(onError).not.toHaveBeenCalled();
    });

    it('updated onError reference is used after re-render (no stale closure)', async () => {
        mockFetch.mockResolvedValue(mockContainerResponse());

        const onError1 = vi.fn();
        const onError2 = vi.fn();

        const { rerender } = render(<ContainerLinkSection onError={onError1} />);
        await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

        // Swap onError to a new reference (simulates parent re-render with inline arrow)
        rerender(<ContainerLinkSection onError={onError2} />);
        await act(async () => { await Promise.resolve(); });

        // No error occurred, so neither should have been called.
        // Critically: onError1 was NOT called via a stale closure from a re-triggered fetch.
        expect(onError1).not.toHaveBeenCalled();
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });
});
