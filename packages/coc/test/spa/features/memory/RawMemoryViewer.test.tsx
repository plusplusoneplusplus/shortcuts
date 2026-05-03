/**
 * Tests for RawMemoryViewer — read-only raw-memory.db browser.
 *
 * Covers: empty state (no DB), table list rendering, table selection,
 * data grid rendering, pagination, sort, expandable cells.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// jsdom doesn't implement scrollIntoView
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
}

const mockFetch = vi.fn();

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TABLES_RESPONSE = {
    tables: [
        { name: 'raw_memory_records', rowCount: 5 },
    ],
};

const EMPTY_TABLES_RESPONSE = {
    tables: [],
};

const COLUMNS = [
    { name: 'id', type: 'TEXT', notnull: true, pk: true },
    { name: 'content', type: 'TEXT', notnull: true, pk: false },
    { name: 'status', type: 'TEXT', notnull: true, pk: false },
    { name: 'created_at', type: 'TEXT', notnull: true, pk: false },
];

const ROWS = [
    { id: 'r1', content: 'fact alpha', status: 'pending', created_at: '2025-01-01T00:00:00Z' },
    { id: 'r2', content: 'fact beta', status: 'aggregated', created_at: '2025-01-02T00:00:00Z' },
];

const TABLE_DATA_RESPONSE = {
    table: 'raw_memory_records',
    columns: COLUMNS,
    rows: ROWS,
    total: 2,
    page: 1,
    pageSize: 50,
    totalPages: 1,
};

const LONG_CONTENT = 'x'.repeat(200);

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockDefaultFetch() {
    mockFetch.mockImplementation(async (url: string) => {
        const urlStr = String(url);
        if (urlStr.includes('/db-browser/repo-raw-memory-db/tables/')) {
            return { ok: true, status: 200, json: () => Promise.resolve(TABLE_DATA_RESPONSE) };
        }
        if (urlStr.includes('/db-browser/repo-raw-memory-db/tables')) {
            return { ok: true, status: 200, json: () => Promise.resolve(TABLES_RESPONSE) };
        }
        return { ok: true, status: 200, json: () => Promise.resolve({}) };
    });
}

function mockEmptyDbFetch() {
    mockFetch.mockImplementation(async () => {
        return { ok: true, status: 200, json: () => Promise.resolve(EMPTY_TABLES_RESPONSE) };
    });
}

async function renderViewer() {
    const { RawMemoryViewer } = await import(
        '../../../../src/server/spa/client/react/features/memory/RawMemoryViewer'
    );
    return render(<RawMemoryViewer repoId="ws-test-1" />);
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RawMemoryViewer', () => {
    describe('empty / no DB state', () => {
        it('shows empty state when no tables returned', async () => {
            mockEmptyDbFetch();
            await renderViewer();
            await waitFor(() => {
                expect(screen.getByTestId('raw-viewer-empty')).toBeDefined();
            });
            expect(screen.getByText(/No raw memory database found/)).toBeDefined();
        });

        it('shows refresh button in empty state', async () => {
            mockEmptyDbFetch();
            await renderViewer();
            await waitFor(() => {
                expect(screen.getByTestId('raw-viewer-retry')).toBeDefined();
            });
        });
    });

    describe('table list', () => {
        it('renders table list with row counts', async () => {
            mockDefaultFetch();
            await renderViewer();
            await waitFor(() => {
                expect(screen.getByTestId('raw-table-list')).toBeDefined();
            });
            expect(screen.getByTestId('raw-table-raw_memory_records')).toBeDefined();
            expect(screen.getByText('5')).toBeDefined();
        });

        it('auto-selects first table', async () => {
            mockDefaultFetch();
            await renderViewer();
            await waitFor(() => {
                expect(screen.getByText('raw_memory_records')).toBeDefined();
            });
            // Table data should load automatically — the table header appears
            await waitFor(() => {
                expect(screen.getByTestId('raw-sort-id')).toBeDefined();
            });
        });
    });

    describe('data grid', () => {
        it('renders column headers', async () => {
            mockDefaultFetch();
            await renderViewer();
            await waitFor(() => {
                expect(screen.getByTestId('raw-sort-id')).toBeDefined();
                expect(screen.getByTestId('raw-sort-content')).toBeDefined();
                expect(screen.getByTestId('raw-sort-status')).toBeDefined();
            });
        });

        it('renders row data', async () => {
            mockDefaultFetch();
            await renderViewer();
            await waitFor(() => {
                expect(screen.getByText('fact alpha')).toBeDefined();
                expect(screen.getByText('fact beta')).toBeDefined();
            });
        });

        it('shows row numbers', async () => {
            mockDefaultFetch();
            await renderViewer();
            await waitFor(() => {
                expect(screen.getByTestId('raw-row-num-0')).toBeDefined();
                expect(screen.getByTestId('raw-row-num-0').textContent).toBe('1');
            });
        });

        it('shows "No rows" when table is empty', async () => {
            mockFetch.mockImplementation(async (url: string) => {
                const urlStr = String(url);
                if (urlStr.includes('/db-browser/repo-raw-memory-db/tables/')) {
                    return {
                        ok: true,
                        status: 200,
                        json: () => Promise.resolve({ ...TABLE_DATA_RESPONSE, rows: [], total: 0 }),
                    };
                }
                if (urlStr.includes('/db-browser/repo-raw-memory-db/tables')) {
                    return { ok: true, status: 200, json: () => Promise.resolve(TABLES_RESPONSE) };
                }
                return { ok: true, status: 200, json: () => Promise.resolve({}) };
            });
            await renderViewer();
            await waitFor(() => {
                expect(screen.getByTestId('raw-no-rows')).toBeDefined();
            });
        });
    });

    describe('sorting', () => {
        it('calls API with sort params when column header clicked', async () => {
            mockDefaultFetch();
            await renderViewer();
            await waitFor(() => {
                expect(screen.getByTestId('raw-sort-content')).toBeDefined();
            });

            fireEvent.click(screen.getByTestId('raw-sort-content'));

            await waitFor(() => {
                const calls = mockFetch.mock.calls.map(c => String(c[0]));
                const sortCall = calls.find(u => u.includes('sort=content') && u.includes('order=desc'));
                expect(sortCall).toBeDefined();
            });
        });
    });

    describe('pagination', () => {
        it('shows page info', async () => {
            mockDefaultFetch();
            await renderViewer();
            await waitFor(() => {
                expect(screen.getByText('Page 1 of 1')).toBeDefined();
            });
        });

        it('shows page size selector', async () => {
            mockDefaultFetch();
            await renderViewer();
            await waitFor(() => {
                expect(screen.getByTestId('raw-page-size')).toBeDefined();
            });
        });
    });

    describe('expandable cells', () => {
        it('truncates long cell values', async () => {
            mockFetch.mockImplementation(async (url: string) => {
                const urlStr = String(url);
                if (urlStr.includes('/db-browser/repo-raw-memory-db/tables/')) {
                    return {
                        ok: true,
                        status: 200,
                        json: () => Promise.resolve({
                            ...TABLE_DATA_RESPONSE,
                            rows: [{ id: 'r1', content: LONG_CONTENT, status: 'pending', created_at: '2025-01-01' }],
                            total: 1,
                        }),
                    };
                }
                if (urlStr.includes('/db-browser/repo-raw-memory-db/tables')) {
                    return { ok: true, status: 200, json: () => Promise.resolve(TABLES_RESPONSE) };
                }
                return { ok: true, status: 200, json: () => Promise.resolve({}) };
            });
            await renderViewer();
            await waitFor(() => {
                expect(screen.getByTestId('raw-cell-truncated')).toBeDefined();
            });
        });

        it('expands truncated cell on click', async () => {
            mockFetch.mockImplementation(async (url: string) => {
                const urlStr = String(url);
                if (urlStr.includes('/db-browser/repo-raw-memory-db/tables/')) {
                    return {
                        ok: true,
                        status: 200,
                        json: () => Promise.resolve({
                            ...TABLE_DATA_RESPONSE,
                            rows: [{ id: 'r1', content: LONG_CONTENT, status: 'pending', created_at: '2025-01-01' }],
                            total: 1,
                        }),
                    };
                }
                if (urlStr.includes('/db-browser/repo-raw-memory-db/tables')) {
                    return { ok: true, status: 200, json: () => Promise.resolve(TABLES_RESPONSE) };
                }
                return { ok: true, status: 200, json: () => Promise.resolve({}) };
            });
            await renderViewer();
            await waitFor(() => {
                expect(screen.getByTestId('raw-cell-truncated')).toBeDefined();
            });
            fireEvent.click(screen.getByTestId('raw-cell-truncated'));
            await waitFor(() => {
                expect(screen.getByTestId('raw-cell-expanded')).toBeDefined();
            });
        });
    });

    describe('error handling', () => {
        it('shows error state on fetch failure', async () => {
            mockFetch.mockRejectedValue(new Error('Network error'));
            await renderViewer();
            await waitFor(() => {
                expect(screen.getByTestId('raw-viewer-error')).toBeDefined();
            });
        });
    });
});
