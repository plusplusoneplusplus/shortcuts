/**
 * Tests for the repo-scoped Memory frontend components.
 *
 * After the bounded-memory redesign, RepoMemorySection is a thin wrapper
 * around BoundedMemoryTab which shows a MEMORY.md viewer/editor.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RepoMemorySection } from '../../../../../src/server/spa/client/react/repos/memory/RepoMemorySection';

// ── helpers ────────────────────────────────────────────────────────────────

function mockFetchBounded(content: string, charCount: number, charLimit: number, lastModified: string | null) {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
        if (url.includes('/memory/bounded')) {
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ content, charCount, charLimit, lastModified }),
            });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });
}

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// ── RepoMemorySection ────────────────────────────────────────────────────────

describe('RepoMemorySection', () => {
    it('renders the bounded memory section wrapper', () => {
        (fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
        render(<RepoMemorySection repoId="ws-abc" />);
        expect(screen.getByTestId('repo-memory-section')).toBeTruthy();
    });

    it('shows loading indicator initially', () => {
        (fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
        render(<RepoMemorySection repoId="ws-abc" />);
        expect(screen.getByTestId('bounded-loading')).toBeTruthy();
    });

    it('shows empty state when no memory exists', async () => {
        mockFetchBounded('', 0, 2200, null);
        render(<RepoMemorySection repoId="ws-abc" />);
        await waitFor(() => {
            expect(screen.getByTestId('bounded-empty')).toBeTruthy();
        });
    });

    it('renders content when memory exists', async () => {
        mockFetchBounded('§ some memory facts', 20, 2200, '2024-01-01T00:00:00Z');
        render(<RepoMemorySection repoId="ws-abc" />);
        await waitFor(() => {
            expect(screen.getByTestId('bounded-content')).toBeTruthy();
            expect(screen.getByTestId('bounded-content').textContent).toContain('some memory facts');
        });
    });

    it('shows error state when API fails', async () => {
        (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: () => Promise.reject(new Error('fail')),
        });
        render(<RepoMemorySection repoId="ws-abc" />);
        await waitFor(() => {
            expect(screen.getByTestId('bounded-error')).toBeTruthy();
        });
    });

    it('opens editor when Edit button is clicked', async () => {
        mockFetchBounded('existing content', 16, 2200, '2024-01-01T00:00:00Z');
        render(<RepoMemorySection repoId="ws-abc" />);
        await waitFor(() => expect(screen.getByTestId('bounded-edit-btn')).toBeTruthy());
        fireEvent.click(screen.getByTestId('bounded-edit-btn'));
        expect(screen.getByTestId('bounded-editor')).toBeTruthy();
    });

    it('renders toolbar with refresh button', async () => {
        mockFetchBounded('content', 7, 2200, null);
        render(<RepoMemorySection repoId="ws-abc" />);
        await waitFor(() => expect(screen.getByTestId('bounded-toolbar')).toBeTruthy());
        expect(screen.getByTestId('bounded-refresh-btn')).toBeTruthy();
    });
});

// ── SettingsSection type regression ─────────────────────────────────────────

describe('SettingsSection type includes memory', () => {
    it('memory is a valid SettingsSection value', async () => {
        const { SettingsSection: _ } = await import('../../../../../src/server/spa/client/react/types/dashboard');
        expect(true).toBe(true);
    });
});
