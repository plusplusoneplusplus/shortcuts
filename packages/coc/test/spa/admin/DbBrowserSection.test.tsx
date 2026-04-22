/**
 * Tests for DbBrowserSection inline editing UI.
 * Validates edit button rendering, edit mode transitions, save/cancel,
 * PK column read-only behavior, and API integration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/contexts/AppContext';
import { DbBrowserSection } from '../../../src/server/spa/client/react/admin/DbBrowserSection';

// jsdom doesn't implement scrollIntoView
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
}

const mockFetch = vi.fn();

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TABLES_RESPONSE = {
    tables: [
        { name: 'users', rowCount: 3 },
        { name: 'logs', rowCount: 100 },
    ],
};

const COLUMNS = [
    { name: 'id', type: 'INTEGER', notnull: true, pk: true },
    { name: 'name', type: 'TEXT', notnull: true, pk: false },
    { name: 'email', type: 'TEXT', notnull: false, pk: false },
];

const ROWS = [
    { id: 1, name: 'Alice', email: 'alice@example.com' },
    { id: 2, name: 'Bob', email: null },
];

const TABLE_DATA_RESPONSE = {
    table: 'users',
    columns: COLUMNS,
    rows: ROWS,
    total: 2,
    page: 1,
    pageSize: 50,
    totalPages: 1,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function Wrap({ children }: { children: ReactNode }) {
    return <AppProvider>{children}</AppProvider>;
}

function mockDefaultFetch() {
    mockFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.includes('/admin/db/tables/') && opts?.method === 'PUT') {
            return {
                ok: true,
                json: () => Promise.resolve({ row: { id: 1, name: 'Updated', email: 'new@example.com' }, changes: 1 }),
            };
        }
        if (urlStr.includes('/rows/delete-bulk') && opts?.method === 'POST') {
            const body = JSON.parse(opts.body as string);
            return {
                ok: true,
                json: () => Promise.resolve({ deleted: body.rows.length, requested: body.rows.length }),
            };
        }
        if (urlStr.includes('/admin/db/tables/') && opts?.method === 'DELETE') {
            return {
                ok: true,
                json: () => Promise.resolve({ deleted: 1 }),
            };
        }
        if (urlStr.match(/\/admin\/db\/tables\/[^/]+\?/)) {
            return {
                ok: true,
                json: () => Promise.resolve(TABLE_DATA_RESPONSE),
            };
        }
        if (urlStr.includes('/admin/db/tables')) {
            return {
                ok: true,
                json: () => Promise.resolve(TABLES_RESPONSE),
            };
        }
        return { ok: true, json: () => Promise.resolve([]) };
    });
}

function renderSection() {
    return render(
        <Wrap>
            <DbBrowserSection />
        </Wrap>
    );
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    mockDefaultFetch();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DbBrowserSection — inline editing', () => {
    it('renders an edit button for each data row', async () => {
        renderSection();
        await waitFor(() => {
            expect(screen.getByTestId('db-edit-row-0')).toBeDefined();
            expect(screen.getByTestId('db-edit-row-1')).toBeDefined();
        });
    });

    it('renders the Actions column header', async () => {
        renderSection();
        await waitFor(() => {
            expect(screen.getByText('Actions')).toBeDefined();
        });
    });

    it('clicking edit enters edit mode with input fields for non-PK columns', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-edit-row-0'));

        fireEvent.click(screen.getByTestId('db-edit-row-0'));

        await waitFor(() => {
            // Non-PK columns should have input fields
            expect(screen.getByTestId('db-edit-name')).toBeDefined();
            expect(screen.getByTestId('db-edit-email')).toBeDefined();
            // PK column should NOT have an input
            expect(screen.queryByTestId('db-edit-id')).toBeNull();
        });
    });

    it('shows Save and Cancel buttons when editing', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-edit-row-0'));

        fireEvent.click(screen.getByTestId('db-edit-row-0'));

        await waitFor(() => {
            expect(screen.getByTestId('db-edit-save')).toBeDefined();
            expect(screen.getByTestId('db-edit-cancel')).toBeDefined();
        });
    });

    it('disables other edit buttons while a row is being edited', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-edit-row-0'));

        fireEvent.click(screen.getByTestId('db-edit-row-0'));

        await waitFor(() => {
            const otherBtn = screen.getByTestId('db-edit-row-1');
            expect(otherBtn.closest('button')?.disabled || otherBtn.hasAttribute('disabled')).toBeTruthy();
        });
    });

    it('cancel exits edit mode without making an API call', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-edit-row-0'));

        fireEvent.click(screen.getByTestId('db-edit-row-0'));
        await waitFor(() => screen.getByTestId('db-edit-cancel'));

        const fetchCountBefore = mockFetch.mock.calls.length;
        fireEvent.click(screen.getByTestId('db-edit-cancel'));

        await waitFor(() => {
            // Edit button should reappear
            expect(screen.getByTestId('db-edit-row-0')).toBeDefined();
            // No new fetch calls made
            expect(mockFetch.mock.calls.length).toBe(fetchCountBefore);
        });
    });

    it('save sends PUT request with correct pkColumns and updates', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-edit-row-0'));

        fireEvent.click(screen.getByTestId('db-edit-row-0'));
        await waitFor(() => screen.getByTestId('db-edit-name'));

        // Change the name field
        fireEvent.change(screen.getByTestId('db-edit-name'), { target: { value: 'Updated' } });

        fireEvent.click(screen.getByTestId('db-edit-save'));

        await waitFor(() => {
            const putCall = mockFetch.mock.calls.find(
                (call: any[]) => call[1]?.method === 'PUT'
            );
            expect(putCall).toBeDefined();
            const body = JSON.parse(putCall![1].body);
            expect(body.pkColumns).toEqual({ id: 1 });
            expect(body.updates).toHaveProperty('name', 'Updated');
        });
    });

    it('successful save exits edit mode and refreshes data', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-edit-row-0'));

        fireEvent.click(screen.getByTestId('db-edit-row-0'));
        await waitFor(() => screen.getByTestId('db-edit-name'));

        fireEvent.change(screen.getByTestId('db-edit-name'), { target: { value: 'Updated' } });
        fireEvent.click(screen.getByTestId('db-edit-save'));

        await waitFor(() => {
            // Should exit edit mode — edit button reappears
            expect(screen.getByTestId('db-edit-row-0')).toBeDefined();
            // Save/Cancel should be gone
            expect(screen.queryByTestId('db-edit-save')).toBeNull();
        });
    });

    it('displays error message on save failure', async () => {
        // Override PUT to fail
        mockFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
            const urlStr = String(url);
            if (urlStr.includes('/admin/db/tables/') && opts?.method === 'PUT') {
                return {
                    ok: false,
                    status: 400,
                    json: () => Promise.resolve({ error: 'Cannot update primary key column "id"' }),
                };
            }
            if (urlStr.match(/\/admin\/db\/tables\/[^/]+\?/)) {
                return { ok: true, json: () => Promise.resolve(TABLE_DATA_RESPONSE) };
            }
            if (urlStr.includes('/admin/db/tables')) {
                return { ok: true, json: () => Promise.resolve(TABLES_RESPONSE) };
            }
            return { ok: true, json: () => Promise.resolve([]) };
        });

        renderSection();
        await waitFor(() => screen.getByTestId('db-edit-row-0'));

        fireEvent.click(screen.getByTestId('db-edit-row-0'));
        await waitFor(() => screen.getByTestId('db-edit-name'));

        fireEvent.change(screen.getByTestId('db-edit-name'), { target: { value: 'Bad' } });
        fireEvent.click(screen.getByTestId('db-edit-save'));

        await waitFor(() => {
            expect(screen.getByTestId('db-edit-error')).toBeDefined();
            expect(screen.getByTestId('db-edit-error').textContent).toContain('Cannot update primary key');
        });

        // Edit mode should remain open
        expect(screen.getByTestId('db-edit-save')).toBeDefined();
    });

    it('input fields are pre-filled with current values', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-edit-row-0'));

        fireEvent.click(screen.getByTestId('db-edit-row-0'));

        await waitFor(() => {
            const nameInput = screen.getByTestId('db-edit-name') as HTMLInputElement;
            expect(nameInput.value).toBe('Alice');
            const emailInput = screen.getByTestId('db-edit-email') as HTMLInputElement;
            expect(emailInput.value).toBe('alice@example.com');
        });
    });

    it('save with no changes cancels edit mode without PUT', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-edit-row-0'));

        fireEvent.click(screen.getByTestId('db-edit-row-0'));
        await waitFor(() => screen.getByTestId('db-edit-save'));

        // Click save without changing anything
        fireEvent.click(screen.getByTestId('db-edit-save'));

        await waitFor(() => {
            // Should exit edit mode
            expect(screen.getByTestId('db-edit-row-0')).toBeDefined();
        });

        // No PUT call should have been made
        const putCalls = mockFetch.mock.calls.filter(
            (call: any[]) => call[1]?.method === 'PUT'
        );
        expect(putCalls.length).toBe(0);
    });

    it('empty string input sets null in the update payload', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-edit-row-0'));

        fireEvent.click(screen.getByTestId('db-edit-row-0'));
        await waitFor(() => screen.getByTestId('db-edit-email'));

        // Clear the email field
        fireEvent.change(screen.getByTestId('db-edit-email'), { target: { value: '' } });
        fireEvent.click(screen.getByTestId('db-edit-save'));

        await waitFor(() => {
            const putCall = mockFetch.mock.calls.find(
                (call: any[]) => call[1]?.method === 'PUT'
            );
            expect(putCall).toBeDefined();
            const body = JSON.parse(putCall![1].body);
            expect(body.updates.email).toBeNull();
        });
    });
});

describe('DbBrowserSection — row selection', () => {
    it('renders a checkbox for each data row', async () => {
        renderSection();
        await waitFor(() => {
            expect(screen.getByTestId('db-select-row-0')).toBeDefined();
            expect(screen.getByTestId('db-select-row-1')).toBeDefined();
        });
    });

    it('renders a select-all checkbox in the header', async () => {
        renderSection();
        await waitFor(() => {
            expect(screen.getByTestId('db-select-all')).toBeDefined();
        });
    });

    it('clicking a row checkbox toggles selection', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-select-row-0'));

        const checkbox = screen.getByTestId('db-select-row-0') as HTMLInputElement;
        expect(checkbox.checked).toBe(false);

        fireEvent.click(checkbox);
        expect(checkbox.checked).toBe(true);

        fireEvent.click(checkbox);
        expect(checkbox.checked).toBe(false);
    });

    it('select-all toggles all visible row checkboxes on', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-select-all'));

        fireEvent.click(screen.getByTestId('db-select-all'));

        await waitFor(() => {
            expect((screen.getByTestId('db-select-row-0') as HTMLInputElement).checked).toBe(true);
            expect((screen.getByTestId('db-select-row-1') as HTMLInputElement).checked).toBe(true);
        });
    });

    it('select-all toggles all off when all are selected', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-select-all'));

        // Select all
        fireEvent.click(screen.getByTestId('db-select-all'));
        await waitFor(() => {
            expect((screen.getByTestId('db-select-row-0') as HTMLInputElement).checked).toBe(true);
        });

        // Deselect all
        fireEvent.click(screen.getByTestId('db-select-all'));
        await waitFor(() => {
            expect((screen.getByTestId('db-select-row-0') as HTMLInputElement).checked).toBe(false);
            expect((screen.getByTestId('db-select-row-1') as HTMLInputElement).checked).toBe(false);
        });
    });

    it('shows bulk action bar when rows are selected', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-select-row-0'));

        expect(screen.queryByTestId('db-bulk-bar')).toBeNull();

        fireEvent.click(screen.getByTestId('db-select-row-0'));

        await waitFor(() => {
            expect(screen.getByTestId('db-bulk-bar')).toBeDefined();
            expect(screen.getByTestId('db-bulk-count').textContent).toBe('1 row selected');
        });
    });

    it('bulk action bar shows correct plural count', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-select-all'));

        fireEvent.click(screen.getByTestId('db-select-all'));

        await waitFor(() => {
            expect(screen.getByTestId('db-bulk-count').textContent).toBe('2 rows selected');
        });
    });

    it('clear selection button clears all checkboxes and hides bulk bar', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-select-all'));

        fireEvent.click(screen.getByTestId('db-select-all'));
        await waitFor(() => screen.getByTestId('db-bulk-bar'));

        fireEvent.click(screen.getByTestId('db-bulk-clear'));

        await waitFor(() => {
            expect(screen.queryByTestId('db-bulk-bar')).toBeNull();
            expect((screen.getByTestId('db-select-row-0') as HTMLInputElement).checked).toBe(false);
        });
    });
});

describe('DbBrowserSection — single row delete', () => {
    it('renders a delete button for each data row', async () => {
        renderSection();
        await waitFor(() => {
            expect(screen.getByTestId('db-delete-row-0')).toBeDefined();
            expect(screen.getByTestId('db-delete-row-1')).toBeDefined();
        });
    });

    it('clicking delete button shows confirmation dialog', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-delete-row-0'));

        fireEvent.click(screen.getByTestId('db-delete-row-0'));

        await waitFor(() => {
            expect(screen.getByTestId('db-delete-message')).toBeDefined();
            expect(screen.getByTestId('db-delete-message').textContent).toContain('delete 1 row?');
        });
    });

    it('cancel dismisses dialog without API call', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-delete-row-0'));

        fireEvent.click(screen.getByTestId('db-delete-row-0'));
        await waitFor(() => screen.getByTestId('db-delete-cancel'));

        const fetchCountBefore = mockFetch.mock.calls.length;
        fireEvent.click(screen.getByTestId('db-delete-cancel'));

        await waitFor(() => {
            expect(screen.queryByTestId('db-delete-message')).toBeNull();
        });
        expect(mockFetch.mock.calls.length).toBe(fetchCountBefore);
    });

    it('confirm sends DELETE request with correct pkColumns', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-delete-row-0'));

        fireEvent.click(screen.getByTestId('db-delete-row-0'));
        await waitFor(() => screen.getByTestId('db-delete-confirm'));

        fireEvent.click(screen.getByTestId('db-delete-confirm'));

        await waitFor(() => {
            const deleteCall = mockFetch.mock.calls.find(
                (call: any[]) => call[1]?.method === 'DELETE'
            );
            expect(deleteCall).toBeDefined();
            const body = JSON.parse(deleteCall![1].body);
            expect(body.pkColumns).toEqual({ id: 1 });
        });
    });

    it('successful delete refreshes data and shows success toast', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-delete-row-0'));

        const fetchCountBefore = mockFetch.mock.calls.length;
        fireEvent.click(screen.getByTestId('db-delete-row-0'));
        await waitFor(() => screen.getByTestId('db-delete-confirm'));
        fireEvent.click(screen.getByTestId('db-delete-confirm'));

        await waitFor(() => {
            // Dialog should close
            expect(screen.queryByTestId('db-delete-message')).toBeNull();
            // A new data fetch should have been made (refresh)
            const newCalls = mockFetch.mock.calls.slice(fetchCountBefore);
            expect(newCalls.length).toBeGreaterThan(0);
        });

        // Success toast
        await waitFor(() => {
            expect(screen.getByText('1 row deleted')).toBeDefined();
        });
    });

    it('delete error shows error toast', async () => {
        mockFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
            const urlStr = String(url);
            if (opts?.method === 'DELETE') {
                return {
                    ok: false,
                    status: 404,
                    json: () => Promise.resolve({ error: 'Row not found' }),
                };
            }
            if (urlStr.match(/\/admin\/db\/tables\/[^/]+\?/)) {
                return { ok: true, json: () => Promise.resolve(TABLE_DATA_RESPONSE) };
            }
            if (urlStr.includes('/admin/db/tables')) {
                return { ok: true, json: () => Promise.resolve(TABLES_RESPONSE) };
            }
            return { ok: true, json: () => Promise.resolve([]) };
        });

        renderSection();
        await waitFor(() => screen.getByTestId('db-delete-row-0'));

        fireEvent.click(screen.getByTestId('db-delete-row-0'));
        await waitFor(() => screen.getByTestId('db-delete-confirm'));
        fireEvent.click(screen.getByTestId('db-delete-confirm'));

        await waitFor(() => {
            expect(screen.getByText('Row not found')).toBeDefined();
        });
    });

    it('delete button is disabled while editing a row', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-edit-row-0'));

        fireEvent.click(screen.getByTestId('db-edit-row-0'));

        await waitFor(() => {
            const deleteBtn = screen.getByTestId('db-delete-row-1');
            expect(deleteBtn.closest('button')?.disabled || deleteBtn.hasAttribute('disabled')).toBeTruthy();
        });
    });
});

describe('DbBrowserSection — UI enhancements', () => {
    it('renders row numbers starting from 1', async () => {
        renderSection();
        await waitFor(() => {
            expect(screen.getByTestId('db-row-num-0').textContent).toBe('1');
            expect(screen.getByTestId('db-row-num-1').textContent).toBe('2');
        });
    });

    it('renders column type badges in header', async () => {
        renderSection();
        await waitFor(() => {
            expect(screen.getByTestId('db-col-type-id').textContent).toBe('INTEGER');
            expect(screen.getByTestId('db-col-type-name').textContent).toBe('TEXT');
        });
    });

    it('renders table filter input', async () => {
        renderSection();
        await waitFor(() => {
            expect(screen.getByTestId('db-table-search')).toBeDefined();
        });
    });

    it('filters table list when typing in search', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-table-search'));

        fireEvent.change(screen.getByTestId('db-table-search'), { target: { value: 'log' } });

        await waitFor(() => {
            expect(screen.queryByTestId('db-table-users')).toBeNull();
            expect(screen.getByTestId('db-table-logs')).toBeDefined();
        });
    });

    it('shows "No matching tables" when filter matches nothing', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-table-search'));

        fireEvent.change(screen.getByTestId('db-table-search'), { target: { value: 'zzzzz' } });

        await waitFor(() => {
            expect(screen.getByText('No matching tables')).toBeDefined();
        });
    });

    it('renders page size selector', async () => {
        renderSection();
        await waitFor(() => {
            expect(screen.getByTestId('db-page-size')).toBeDefined();
        });
    });

    it('renders refresh button', async () => {
        renderSection();
        await waitFor(() => {
            expect(screen.getByTestId('db-refresh')).toBeDefined();
        });
    });

    it('renders row and column count badges', async () => {
        renderSection();
        await waitFor(() => {
            expect(screen.getAllByText('2 rows').length).toBeGreaterThanOrEqual(1);
            expect(screen.getByText('3 cols')).toBeDefined();
        });
    });
});

describe('DbBrowserSection — bulk delete', () => {
    it('Delete Selected button shows confirmation with correct count', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-select-all'));

        fireEvent.click(screen.getByTestId('db-select-all'));
        await waitFor(() => screen.getByTestId('db-bulk-delete'));

        fireEvent.click(screen.getByTestId('db-bulk-delete'));

        await waitFor(() => {
            expect(screen.getByTestId('db-delete-message').textContent).toContain('delete 2 rows?');
        });
    });

    it('confirm bulk delete sends POST to bulk-delete endpoint', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-select-all'));

        fireEvent.click(screen.getByTestId('db-select-all'));
        await waitFor(() => screen.getByTestId('db-bulk-delete'));

        fireEvent.click(screen.getByTestId('db-bulk-delete'));
        await waitFor(() => screen.getByTestId('db-delete-confirm'));

        fireEvent.click(screen.getByTestId('db-delete-confirm'));

        await waitFor(() => {
            const bulkCall = mockFetch.mock.calls.find(
                (call: any[]) => String(call[0]).includes('/delete-bulk') && call[1]?.method === 'POST'
            );
            expect(bulkCall).toBeDefined();
            const body = JSON.parse(bulkCall![1].body);
            expect(body.rows).toHaveLength(2);
            expect(body.rows).toContainEqual({ id: 1 });
            expect(body.rows).toContainEqual({ id: 2 });
        });
    });

    it('successful bulk delete clears selection and shows toast', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-select-all'));

        fireEvent.click(screen.getByTestId('db-select-all'));
        await waitFor(() => screen.getByTestId('db-bulk-delete'));

        fireEvent.click(screen.getByTestId('db-bulk-delete'));
        await waitFor(() => screen.getByTestId('db-delete-confirm'));

        fireEvent.click(screen.getByTestId('db-delete-confirm'));

        await waitFor(() => {
            // Bulk bar should be gone (selection cleared)
            expect(screen.queryByTestId('db-bulk-bar')).toBeNull();
        });

        // Success toast
        await waitFor(() => {
            expect(screen.getByText('2 row(s) deleted')).toBeDefined();
        });
    });

    it('bulk delete error shows error toast', async () => {
        mockFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
            const urlStr = String(url);
            if (urlStr.includes('/delete-bulk') && opts?.method === 'POST') {
                return {
                    ok: false,
                    status: 500,
                    json: () => Promise.resolve({ error: 'Database locked' }),
                };
            }
            if (urlStr.match(/\/admin\/db\/tables\/[^/]+\?/)) {
                return { ok: true, json: () => Promise.resolve(TABLE_DATA_RESPONSE) };
            }
            if (urlStr.includes('/admin/db/tables')) {
                return { ok: true, json: () => Promise.resolve(TABLES_RESPONSE) };
            }
            return { ok: true, json: () => Promise.resolve([]) };
        });

        renderSection();
        await waitFor(() => screen.getByTestId('db-select-all'));

        fireEvent.click(screen.getByTestId('db-select-all'));
        await waitFor(() => screen.getByTestId('db-bulk-delete'));

        fireEvent.click(screen.getByTestId('db-bulk-delete'));
        await waitFor(() => screen.getByTestId('db-delete-confirm'));

        fireEvent.click(screen.getByTestId('db-delete-confirm'));

        await waitFor(() => {
            expect(screen.getByText('Database locked')).toBeDefined();
        });
    });
});
