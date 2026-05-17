/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@plusplusoneplusplus/forge', () => ({}));

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }),
}));

const mocks = vi.hoisted(() => ({
    admin: {
        getStorageStatus: vi.fn(),
        getStorageMigrateToken: vi.fn(),
        migrateStorageStream: vi.fn(),
        cancelStorageMigration: vi.fn(),
        scanStorageDirectory: vi.fn(),
        getStorageImportDirectoryToken: vi.fn(),
        importStorageDirectoryStream: vi.fn(),
    },
}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ admin: mocks.admin }),
    getSpaCocClientErrorMessage: (err: unknown, fallback: string) => err instanceof Error ? err.message : fallback,
}));

import StorageSection from '../../../../../src/server/spa/client/react/admin/StorageSection';

// ── Helpers ────────────────────────────────────────────────────────────────

function setStatusResponse(data: any) {
    mocks.admin.getStorageStatus.mockResolvedValue(data);
}

function setStatusError(msg = 'Network error') {
    mocks.admin.getStorageStatus.mockRejectedValue(new Error(msg));
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks();
    mocks.admin.getStorageStatus.mockResolvedValue({ backend: 'file', stats: { processes: 0, workspaces: 0 } });
    mocks.admin.getStorageMigrateToken.mockResolvedValue({ token: 'tok', expiresIn: 300 });
    mocks.admin.cancelStorageMigration.mockResolvedValue({ success: true });
    mocks.admin.scanStorageDirectory.mockResolvedValue({ matched: [], unmatched: [], totalProcesses: 0, totalMatchedProcesses: 0 });
    mocks.admin.getStorageImportDirectoryToken.mockResolvedValue({ token: 'dir-token', expiresIn: 300 });
    mocks.admin.importStorageDirectoryStream.mockResolvedValue(sseResponse('data: {"type":"done","success":true,"summary":{"imported":0,"skipped":0,"failed":0,"perWorkspace":[]}}\n\n'));
});

afterEach(() => {
    cleanup();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('StorageSection — status display', () => {
    it('shows spinner while loading', () => {
        // Never resolve the fetch
        mocks.admin.getStorageStatus.mockImplementation(() => new Promise(() => {}));
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
            expect(screen.getByText(/^Current: SQLite/)).toBeTruthy();
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
        mocks.admin.getStorageStatus.mockResolvedValue({ backend: 'file', stats: { processes: 10, workspaces: 2 } });
        mocks.admin.getStorageMigrateToken.mockResolvedValue({ token: 'test-token-123', expiresIn: 300 });

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
        mocks.admin.getStorageStatus.mockResolvedValue({ backend: 'file', stats: { processes: 10, workspaces: 2 } });
        mocks.admin.getStorageMigrateToken.mockResolvedValue({ token: 'tok', expiresIn: 300 });

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
        mocks.admin.getStorageStatus.mockResolvedValue({ backend: 'file', stats: { processes: 5, workspaces: 1 } });
        mocks.admin.getStorageMigrateToken.mockResolvedValue({ token: 'tok', expiresIn: 300 });

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

        mocks.admin.migrateStorageStream.mockResolvedValue({
            ok: true,
            body: { getReader: () => mockReader },
        });

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

        // Should eventually reach the done state with auto-polling
        await waitFor(() => {
            expect(screen.getByText(/Successfully migrated to SQLite/)).toBeTruthy();
        }, { timeout: 5000 });

        expect(screen.getByText(/5 processes migrated/)).toBeTruthy();
        // Polling starts automatically — spinner shown without user interaction
        expect(screen.getByText(/Waiting for server restart/)).toBeTruthy();

        expect(mocks.admin.migrateStorageStream).toHaveBeenCalledWith({ token: 'tok', skipValidation: false, signal: expect.any(AbortSignal) });
    });

    it('shows error state on migration failure', async () => {
        mocks.admin.getStorageStatus.mockResolvedValue({ backend: 'file', stats: { processes: 5, workspaces: 1 } });
        mocks.admin.getStorageMigrateToken.mockResolvedValue({ token: 'tok', expiresIn: 300 });

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

        mocks.admin.migrateStorageStream.mockResolvedValue({
            ok: true,
            body: { getReader: () => mockReader },
        });

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

    });

    it('handles non-ok HTTP response', async () => {
        mocks.admin.getStorageStatus.mockResolvedValue({ backend: 'file', stats: { processes: 5, workspaces: 1 } });
        mocks.admin.getStorageMigrateToken.mockResolvedValue({ token: 'tok', expiresIn: 300 });

        mocks.admin.migrateStorageStream.mockResolvedValue({
            ok: false,
            text: async () => 'Migration already in progress',
        });

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

    });
});

describe('StorageSection — directory import', () => {
    beforeEach(() => {
        setStatusResponse({ backend: 'sqlite', stats: { processes: 100, workspaces: 5 }, dbPath: 'C:\\data\\processes.db' });
    });

    it('scans a directory and renders matched import preview', async () => {
        mocks.admin.scanStorageDirectory.mockResolvedValue({
            matched: [{
                workspaceId: 'repo-1',
                activeCount: 2,
                archivedCount: 1,
                archivedBuckets: [],
                registeredName: 'Repo One',
                registeredRootPath: 'C:\\repos\\one',
            }],
            unmatched: [{ workspaceId: 'old-repo', activeCount: 1, archivedCount: 0 }],
            totalProcesses: 4,
            totalMatchedProcesses: 3,
        });

        render(<StorageSection />);

        await waitFor(() => {
            expect(screen.getByText('Import History from Directory')).toBeTruthy();
        });
        fireEvent.change(screen.getByPlaceholderText('e.g. ~/.coc/repos/ or /backup/coc-data/'), {
            target: { value: 'C:\\backup\\.coc\\repos' },
        });
        fireEvent.click(screen.getByText('Scan'));

        await waitFor(() => {
            expect(screen.getByText('Matched workspaces (1)')).toBeTruthy();
        });
        expect(screen.getByText('Repo One')).toBeTruthy();
        expect(screen.getByText(/3 processes from 1 workspaces ready to import/)).toBeTruthy();
        expect(mocks.admin.scanStorageDirectory).toHaveBeenCalledWith({ path: 'C:\\backup\\.coc\\repos' });
    });

    it('imports matched directory history from a streaming response', async () => {
        mocks.admin.scanStorageDirectory.mockResolvedValue({
            matched: [{
                workspaceId: 'repo-1',
                activeCount: 2,
                archivedCount: 0,
                archivedBuckets: [],
                registeredName: 'Repo One',
                registeredRootPath: 'C:\\repos\\one',
            }],
            unmatched: [],
            totalProcesses: 2,
            totalMatchedProcesses: 2,
        });
        mocks.admin.getStorageImportDirectoryToken.mockResolvedValue({ token: 'dir-token', expiresIn: 300 });
        mocks.admin.importStorageDirectoryStream.mockResolvedValue(sseResponse(
            'data: {"type":"progress","message":"Importing Repo One"}\n\n' +
            'data: {"type":"done","success":true,"summary":{"imported":2,"skipped":1,"failed":0,"perWorkspace":[{"workspaceId":"repo-1","name":"Repo One","imported":2,"skipped":1}]}}\n\n'
        ));

        render(<StorageSection />);

        await waitFor(() => {
            expect(screen.getByText('Import History from Directory')).toBeTruthy();
        });
        fireEvent.change(screen.getByPlaceholderText('e.g. ~/.coc/repos/ or /backup/coc-data/'), {
            target: { value: 'C:\\backup\\.coc\\repos' },
        });
        fireEvent.click(screen.getByText('Scan'));
        await waitFor(() => {
            expect(screen.getByText('Import')).toBeTruthy();
        });
        fireEvent.click(screen.getByText('Import'));

        await waitFor(() => {
            expect(screen.getByText(/Import complete/)).toBeTruthy();
        });
        expect(screen.getByText(/2 processes imported/)).toBeTruthy();
        expect(screen.getByText(/1 duplicates skipped/)).toBeTruthy();
        expect(mocks.admin.importStorageDirectoryStream).toHaveBeenCalledWith({
            token: 'dir-token',
            path: 'C:\\backup\\.coc\\repos',
        });
    });
});

describe('StorageSection — feature flag gating', () => {
    it('exports a default component (for lazy loading)', async () => {
        const mod = await import('../../../../../src/server/spa/client/react/admin/StorageSection');
        expect(mod.default).toBeDefined();
        expect(typeof mod.default).toBe('function');
    });
});

function sseResponse(text: string): any {
    const chunks = [new TextEncoder().encode(text)];
    return {
        ok: true,
        body: {
            getReader: () => ({
                read: vi.fn()
                    .mockResolvedValueOnce({ done: false, value: chunks[0] })
                    .mockResolvedValueOnce({ done: true, value: undefined }),
            }),
        },
    };
}
