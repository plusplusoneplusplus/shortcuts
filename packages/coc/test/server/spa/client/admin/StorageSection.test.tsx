/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@plusplusoneplusplus/forge', () => ({}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }),
}));

let mockFetchApiResult: any = null;
let mockFetchApiError: Error | null = null;

vi.mock('../../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn(async () => {
        if (mockFetchApiError) throw mockFetchApiError;
        return mockFetchApiResult;
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '',
}));

import StorageSection from '../../../../../src/server/spa/client/react/admin/StorageSection';
import { fetchApi } from '../../../../../src/server/spa/client/react/hooks/useApi';

// ── Helpers ────────────────────────────────────────────────────────────────

function setStatusResponse(data: any) {
    mockFetchApiResult = data;
    mockFetchApiError = null;
}

function setStatusError(msg = 'Network error') {
    mockFetchApiError = new Error(msg);
    mockFetchApiResult = null;
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks();
    mockFetchApiResult = null;
    mockFetchApiError = null;
    // Restore the default mock implementation (clearAllMocks doesn't reset it)
    (fetchApi as any).mockImplementation(async () => {
        if (mockFetchApiError) throw mockFetchApiError;
        return mockFetchApiResult;
    });
});

afterEach(() => {
    cleanup();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('StorageSection — status display', () => {
    it('shows spinner while loading', () => {
        // Never resolve the fetch
        (fetchApi as any).mockImplementation(() => new Promise(() => {}));
        const { container } = render(<StorageSection />);
        expect(container.querySelector('[aria-label="Loading"]')).toBeTruthy();
    });

    it('displays JSON backend with stats', async () => {
        setStatusResponse({ backend: 'file', stats: { processes: 42, workspaces: 3 } });
        render(<StorageSection />);

        await waitFor(() => {
            expect(screen.getByText(/JSON files/)).toBeTruthy();
        });
        expect(screen.getByText(/42 processes/)).toBeTruthy();
        expect(screen.getByText(/3 workspaces/)).toBeTruthy();
        expect(screen.getByText('Migrate to SQLite')).toBeTruthy();
    });

    it('displays SQLite backend without migrate button', async () => {
        setStatusResponse({ backend: 'sqlite', stats: { processes: 100, workspaces: 5 }, dbPath: '/data/processes.db' });
        render(<StorageSection />);

        await waitFor(() => {
            expect(screen.getByText(/SQLite/)).toBeTruthy();
        });
        expect(screen.getByText(/100 processes/)).toBeTruthy();
        expect(screen.getByText(/\/data\/processes\.db/)).toBeTruthy();
        expect(screen.queryByText('Migrate to SQLite')).toBeNull();
    });

    it('shows fallback when status fetch fails', async () => {
        setStatusError('Server down');
        render(<StorageSection />);

        await waitFor(() => {
            expect(screen.getByText(/Unable to load storage status/)).toBeTruthy();
        });
    });

    it('renders section heading "Storage Backend"', async () => {
        setStatusResponse({ backend: 'file', stats: { processes: 0, workspaces: 0 } });
        render(<StorageSection />);

        await waitFor(() => {
            expect(screen.getByText('Storage Backend')).toBeTruthy();
        });
    });
});

describe('StorageSection — confirmation dialog', () => {
    beforeEach(() => {
        setStatusResponse({ backend: 'file', stats: { processes: 10, workspaces: 2 } });
    });

    it('opens confirmation dialog when Migrate button is clicked', async () => {
        // fetchApi will be called first for status, then for token
        let callCount = 0;
        (fetchApi as any).mockImplementation(async (path: string) => {
            callCount++;
            if (path.includes('migrate-token')) {
                return { token: 'test-token-123', expiresIn: 300 };
            }
            return { backend: 'file', stats: { processes: 10, workspaces: 2 } };
        });

        render(<StorageSection />);

        await waitFor(() => {
            expect(screen.getByText('Migrate to SQLite')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Migrate to SQLite'));

        await waitFor(() => {
            expect(screen.getByText('Migrate to SQLite', { selector: 'h2' })).toBeTruthy();
        });

        // Should show counts from status in the dialog
        expect(screen.getAllByText(/10 processes/).length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText(/2 workspaces/).length).toBeGreaterThanOrEqual(1);

        // Should have Confirm and Cancel buttons
        expect(screen.getByText('Confirm Migration')).toBeTruthy();
        expect(screen.getByText('Cancel')).toBeTruthy();
    });

    it('cancels dialog and returns to status view', async () => {
        (fetchApi as any).mockImplementation(async (path: string) => {
            if (path.includes('migrate-token')) {
                return { token: 'tok', expiresIn: 300 };
            }
            return { backend: 'file', stats: { processes: 10, workspaces: 2 } };
        });

        render(<StorageSection />);

        await waitFor(() => {
            expect(screen.getByText('Migrate to SQLite')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Migrate to SQLite'));

        await waitFor(() => {
            expect(screen.getByText('Cancel')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Cancel'));

        await waitFor(() => {
            // Back to status — the "Migrate to SQLite" button should be visible as a regular button
            expect(screen.getByText(/JSON files/)).toBeTruthy();
        });
    });
});

describe('StorageSection — migration progress', () => {
    it('shows phase checklist during migration', async () => {
        // Mock fetchApi for status + token
        (fetchApi as any).mockImplementation(async (path: string) => {
            if (path.includes('migrate-token')) {
                return { token: 'tok', expiresIn: 300 };
            }
            return { backend: 'file', stats: { processes: 5, workspaces: 1 } };
        });

        // Mock fetch for the streaming POST
        const mockReader = {
            read: vi.fn()
                .mockResolvedValueOnce({
                    done: false,
                    value: new TextEncoder().encode(
                        'data: {"phase":1,"status":"running","message":"Creating database schema..."}\n\n'
                    ),
                })
                .mockResolvedValueOnce({
                    done: false,
                    value: new TextEncoder().encode(
                        'data: {"phase":1,"status":"complete","message":"Schema created"}\n\n'
                    ),
                })
                .mockResolvedValueOnce({
                    done: false,
                    value: new TextEncoder().encode(
                        'data: {"type":"done","success":true,"processes":5,"workspaces":1,"wikis":0,"archivedProcesses":0}\n\n'
                    ),
                })
                .mockResolvedValueOnce({ done: true, value: undefined }),
        };

        const originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn(async (url: any, opts: any) => {
            if (typeof url === 'string' && url.includes('/api/admin/storage/migrate') && !url.includes('cancel') && !url.includes('token')) {
                return {
                    ok: true,
                    body: { getReader: () => mockReader },
                } as any;
            }
            return originalFetch(url, opts);
        }) as any;

        render(<StorageSection />);

        await waitFor(() => {
            expect(screen.getByText('Migrate to SQLite')).toBeTruthy();
        });

        // Open confirmation
        fireEvent.click(screen.getByText('Migrate to SQLite'));

        // Wait for Confirm button to be enabled (token fetched)
        await waitFor(() => {
            const btn = screen.getByText('Confirm Migration').closest('button');
            expect(btn?.disabled).toBe(false);
        });

        // Confirm migration
        await act(async () => {
            fireEvent.click(screen.getByText('Confirm Migration'));
        });

        // Should eventually reach the done state
        await waitFor(() => {
            expect(screen.getByText(/Successfully migrated to SQLite/)).toBeTruthy();
        }, { timeout: 5000 });

        expect(screen.getByText(/5 processes migrated/)).toBeTruthy();

        globalThis.fetch = originalFetch;
    });

    it('shows error state on migration failure', async () => {
        (fetchApi as any).mockImplementation(async (path: string) => {
            if (path.includes('migrate-token')) {
                return { token: 'tok', expiresIn: 300 };
            }
            return { backend: 'file', stats: { processes: 5, workspaces: 1 } };
        });

        const mockReader = {
            read: vi.fn()
                .mockResolvedValueOnce({
                    done: false,
                    value: new TextEncoder().encode(
                        'data: {"phase":4,"status":"error","message":"Validation failed"}\n\n'
                    ),
                })
                .mockResolvedValueOnce({
                    done: false,
                    value: new TextEncoder().encode(
                        'data: {"type":"done","success":false,"error":"Migration failed in phase 4"}\n\n'
                    ),
                })
                .mockResolvedValueOnce({ done: true, value: undefined }),
        };

        const originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn(async (url: any, opts: any) => {
            if (typeof url === 'string' && url.includes('/api/admin/storage/migrate') && !url.includes('cancel') && !url.includes('token')) {
                return {
                    ok: true,
                    body: { getReader: () => mockReader },
                } as any;
            }
            return originalFetch(url, opts);
        }) as any;

        render(<StorageSection />);

        await waitFor(() => {
            expect(screen.getByText('Migrate to SQLite')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Migrate to SQLite'));

        await waitFor(() => {
            const btn = screen.getByText('Confirm Migration').closest('button');
            expect(btn?.disabled).toBe(false);
        });

        await act(async () => {
            fireEvent.click(screen.getByText('Confirm Migration'));
        });

        await waitFor(() => {
            expect(screen.getByText('Migration Failed')).toBeTruthy();
        }, { timeout: 5000 });

        // Close error dialog returns to status
        fireEvent.click(screen.getByText('Close'));
        await waitFor(() => {
            expect(screen.getByText(/JSON files/)).toBeTruthy();
        });

        globalThis.fetch = originalFetch;
    });

    it('handles non-ok HTTP response', async () => {
        (fetchApi as any).mockImplementation(async (path: string) => {
            if (path.includes('migrate-token')) {
                return { token: 'tok', expiresIn: 300 };
            }
            return { backend: 'file', stats: { processes: 5, workspaces: 1 } };
        });

        const originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn(async (url: any, opts: any) => {
            if (typeof url === 'string' && url.includes('/api/admin/storage/migrate') && !url.includes('cancel') && !url.includes('token')) {
                return {
                    ok: false,
                    text: async () => 'Migration already in progress',
                } as any;
            }
            return originalFetch(url, opts);
        }) as any;

        render(<StorageSection />);

        await waitFor(() => {
            expect(screen.getByText('Migrate to SQLite')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Migrate to SQLite'));

        await waitFor(() => {
            const btn = screen.getByText('Confirm Migration').closest('button');
            expect(btn?.disabled).toBe(false);
        });

        await act(async () => {
            fireEvent.click(screen.getByText('Confirm Migration'));
        });

        await waitFor(() => {
            expect(screen.getByText('Migration Failed')).toBeTruthy();
        }, { timeout: 5000 });

        globalThis.fetch = originalFetch;
    });
});

describe('StorageSection — feature flag gating', () => {
    it('exports a default component (for lazy loading)', async () => {
        const mod = await import('../../../../../src/server/spa/client/react/admin/StorageSection');
        expect(mod.default).toBeDefined();
        expect(typeof mod.default).toBe('function');
    });
});
