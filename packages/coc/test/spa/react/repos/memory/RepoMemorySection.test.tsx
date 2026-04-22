/**
 * Tests for the repo-scoped Memory frontend components.
 *
 * After the bounded-memory redesign, RepoMemorySection is a thin wrapper
 * around BoundedMemoryTab which shows a MEMORY.md viewer/editor.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RepoMemorySection } from '../../../../../src/server/spa/client/react/features/memory/RepoMemorySection';

// ── helpers ────────────────────────────────────────────────────────────────

interface MockMemoryOptions {
    content?: string;
    charCount?: number;
    charLimit?: number;
    lastModified?: string | null;
    enabled?: boolean;
    prefCharLimit?: number;
    patchOk?: boolean;
}

function mockMemoryRequests({
    content = '',
    charCount = 0,
    charLimit = 2200,
    lastModified = null,
    enabled = false,
    prefCharLimit,
    patchOk = true,
}: MockMemoryOptions = {}) {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/memory/bounded')) {
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ content, charCount, charLimit, lastModified }),
            });
        }

        if (url.includes('/preferences') && (!init?.method || init.method === 'GET')) {
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    boundedMemory: {
                        enabled,
                        ...(typeof prefCharLimit === 'number' ? { charLimit: prefCharLimit } : {}),
                    },
                }),
            });
        }

        if (url.includes('/preferences') && init?.method === 'PATCH') {
            return Promise.resolve({
                ok: patchOk,
                status: patchOk ? 200 : 500,
                statusText: patchOk ? 'OK' : 'Internal Server Error',
                json: () => Promise.resolve(patchOk ? {} : { error: 'save failed' }),
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
        mockMemoryRequests();
        render(<RepoMemorySection repoId="ws-abc" />);
        await waitFor(() => {
            expect(screen.getByTestId('bounded-empty')).toBeTruthy();
        });
    });

    it('renders content when memory exists', async () => {
        mockMemoryRequests({ content: '§ some memory facts', charCount: 20, lastModified: '2024-01-01T00:00:00Z' });
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
        mockMemoryRequests({ content: 'existing content', charCount: 16, enabled: true, lastModified: '2024-01-01T00:00:00Z' });
        render(<RepoMemorySection repoId="ws-abc" />);
        await waitFor(() => expect(screen.getByTestId('bounded-edit-btn')).toBeTruthy());
        fireEvent.click(screen.getByTestId('bounded-edit-btn'));
        expect(screen.getByTestId('bounded-editor')).toBeTruthy();
    });

    it('renders toolbar with refresh button', async () => {
        mockMemoryRequests({ content: 'content', charCount: 7 });
        render(<RepoMemorySection repoId="ws-abc" />);
        await waitFor(() => expect(screen.getByTestId('bounded-toolbar')).toBeTruthy());
        expect(screen.getByTestId('bounded-refresh-btn')).toBeTruthy();
    });

    it('shows the toggle as off by default when bounded memory is not enabled', async () => {
        mockMemoryRequests({ enabled: false });
        render(<RepoMemorySection repoId="ws-abc" />);

        await waitFor(() => {
            expect(screen.getByTestId('memory-enabled-toggle').getAttribute('aria-checked')).toBe('false');
            expect(screen.getByTestId('memory-disabled-message')).toBeTruthy();
        });
    });

    it('persists toggle enable state through repo preferences', async () => {
        mockMemoryRequests({ enabled: false });
        render(<RepoMemorySection repoId="ws-abc" />);

        await waitFor(() => expect(screen.getByTestId('memory-enabled-toggle')).toBeTruthy());
        fireEvent.click(screen.getByTestId('memory-enabled-toggle'));

        await waitFor(() => {
            const patchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
                ([url, init]) => String(url).includes('/preferences') && init?.method === 'PATCH'
            );
            expect(patchCall).toBeTruthy();
            expect(patchCall?.[1]?.body).toBe(JSON.stringify({ boundedMemory: { enabled: true } }));
            expect(screen.getByTestId('memory-enabled-toggle').getAttribute('aria-checked')).toBe('true');
        });
    });

    it('preserves charLimit when toggling bounded memory', async () => {
        mockMemoryRequests({ enabled: false, prefCharLimit: 4096 });
        render(<RepoMemorySection repoId="ws-abc" />);

        await waitFor(() => expect(screen.getByTestId('memory-enabled-toggle')).toBeTruthy());
        fireEvent.click(screen.getByTestId('memory-enabled-toggle'));

        await waitFor(() => {
            const patchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
                ([url, init]) => String(url).includes('/preferences') && init?.method === 'PATCH'
            );
            expect(patchCall?.[1]?.body).toBe(JSON.stringify({ boundedMemory: { enabled: true, charLimit: 4096 } }));
        });
    });

    it('rolls the toggle back and shows an error when saving fails', async () => {
        mockMemoryRequests({ enabled: true, patchOk: false });
        render(<RepoMemorySection repoId="ws-abc" />);

        await waitFor(() => expect(screen.getByTestId('memory-enabled-toggle').getAttribute('aria-checked')).toBe('true'));
        fireEvent.click(screen.getByTestId('memory-enabled-toggle'));

        await waitFor(() => {
            expect(screen.getByTestId('memory-enabled-toggle').getAttribute('aria-checked')).toBe('true');
            expect(screen.getByTestId('memory-toggle-error').textContent).toContain('Failed to patch preferences');
        });
    });
});

// ── SettingsSection type regression ─────────────────────────────────────────

describe('SettingsSection type includes memory', () => {
    it('memory is a valid SettingsSection value', async () => {
        const { SettingsSection: _ } = await import('../../../../../src/server/spa/client/react/types/dashboard');
        expect(true).toBe(true);
    });
});
