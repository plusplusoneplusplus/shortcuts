/**
 * Tests for RepoMemorySection — bounded/raw sub-tab switching.
 *
 * Verifies the segmented control renders, default tab is bounded,
 * and switching to raw renders the RawMemoryViewer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// jsdom doesn't implement scrollIntoView
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
}

const mockFetch = vi.fn();

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockDefaultFetch() {
    mockFetch.mockImplementation(async (url: string) => {
        const urlStr = String(url);
        // Bounded endpoints
        if (urlStr.includes('/memory/bounded')) {
            return {
                ok: true,
                status: 200,
                json: () => Promise.resolve({ content: '', charCount: 0, charLimit: 2200, lastModified: null }),
            };
        }
        if (urlStr.includes('/memory/overview')) {
            return {
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    charCount: 0, charLimit: 2200, lastModified: null,
                    pendingRawCount: 0, claimedRawCount: 0, promotionStatus: 'idle',
                }),
            };
        }
        // Raw DB endpoints
        if (urlStr.includes('/db-browser/repo-raw-memory-db/tables')) {
            return { ok: true, status: 200, json: () => Promise.resolve({ tables: [] }) };
        }
        // Preferences
        if (urlStr.includes('/preferences')) {
            return { ok: true, status: 200, json: () => Promise.resolve({}) };
        }
        return { ok: true, status: 200, json: () => Promise.resolve({}) };
    });
}

async function renderSection() {
    const { RepoMemorySection } = await import(
        '../../../../src/server/spa/client/react/features/memory/RepoMemorySection'
    );
    return render(<RepoMemorySection repoId="ws-test-1" />);
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RepoMemorySection', () => {
    it('renders the sub-tab segmented control', async () => {
        mockDefaultFetch();
        await renderSection();
        expect(screen.getByTestId('memory-sub-tabs')).toBeDefined();
    });

    it('shows bounded memory tab by default', async () => {
        mockDefaultFetch();
        await renderSection();
        await waitFor(() => {
            expect(screen.getByTestId('bounded-memory-tab')).toBeDefined();
        });
    });

    it('switches to raw records tab when clicked', async () => {
        mockDefaultFetch();
        await renderSection();
        // Click the "Raw Records" tab
        fireEvent.click(screen.getByTestId('memory-tab-raw'));
        await waitFor(() => {
            // Should show raw viewer empty state (no DB)
            expect(screen.getByTestId('raw-viewer-empty')).toBeDefined();
        });
        // Bounded tab should not be visible
        expect(screen.queryByTestId('bounded-memory-tab')).toBeNull();
    });

    it('switches back to bounded tab', async () => {
        mockDefaultFetch();
        await renderSection();
        // Switch to raw
        fireEvent.click(screen.getByTestId('memory-tab-raw'));
        await waitFor(() => {
            expect(screen.getByTestId('raw-viewer-empty')).toBeDefined();
        });
        // Switch back to bounded
        fireEvent.click(screen.getByTestId('memory-tab-bounded'));
        await waitFor(() => {
            expect(screen.getByTestId('bounded-memory-tab')).toBeDefined();
        });
    });
});
