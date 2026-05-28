/**
 * Tests for DbBrowserSection inline editing UI.
 * Validates edit button rendering, edit mode transitions, save/cancel,
 * PK column read-only behavior, and API integration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, configure } from '@testing-library/react';
import { type ReactNode } from 'react';

// Slow Windows CI runners can take >1 s to flush two chained promise
// resolutions (listTables → setSelectedTable → getTable → setTableData)
// through React's state-update cycle. Raise the RTL async timeout for the
// whole file so every waitFor call uses 5 s instead of the default 1 s.
configure({ asyncUtilTimeout: 5000 });
import { CocApiError } from '@plusplusoneplusplus/coc-client';
import { AppProvider } from '../../../src/server/spa/client/react/contexts/AppContext';
import { DbBrowserSection } from '../../../src/server/spa/client/react/admin/DbBrowserSection';

// jsdom doesn't implement scrollIntoView
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
}

const mocks = vi.hoisted(() => ({
    dbBrowser: {
        listTables: vi.fn(),
        getTable: vi.fn(),
        updateRow: vi.fn(),
        deleteRow: vi.fn(),
        deleteBulk: vi.fn(),
    },
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../src/server/spa/client/react/api/cocClient')>();
    return {
        ...actual,
        getSpaCocClient: () => ({ dbBrowser: mocks.dbBrowser }),
    };
});

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

function mockDefaultResponses() {
    mocks.dbBrowser.listTables.mockResolvedValue(TABLES_RESPONSE);
    mocks.dbBrowser.getTable.mockResolvedValue(TABLE_DATA_RESPONSE);
    mocks.dbBrowser.updateRow.mockResolvedValue({ row: { id: 1, name: 'Updated', email: 'new@example.com' }, changes: 1 });
    mocks.dbBrowser.deleteRow.mockResolvedValue({ deleted: 1 });
    mocks.dbBrowser.deleteBulk.mockImplementation(async (_source: string, _table: string, req: { rows: unknown[] }) =>
        ({ deleted: req.rows.length, requested: req.rows.length }),
    );
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
    mocks.dbBrowser.listTables.mockReset();
    mocks.dbBrowser.getTable.mockReset();
    mocks.dbBrowser.updateRow.mockReset();
    mocks.dbBrowser.deleteRow.mockReset();
    mocks.dbBrowser.deleteBulk.mockReset();
    mockDefaultResponses();
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

        fireEvent.click(screen.getByTestId('db-edit-cancel'));

        await waitFor(() => {
            // Edit button should reappear
            expect(screen.getByTestId('db-edit-row-0')).toBeDefined();
            // No update call made
            expect(mocks.dbBrowser.updateRow).not.toHaveBeenCalled();
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
            expect(mocks.dbBrowser.updateRow).toHaveBeenCalled();
            const [source, table, body] = mocks.dbBrowser.updateRow.mock.calls[0];
            expect(source).toBe('process-db');
            expect(table).toBe('users');
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
        // Override updateRow to fail
        mocks.dbBrowser.updateRow.mockRejectedValue(
            new CocApiError({ status: 400, statusText: 'Bad Request', url: '/db-browser/process-db/tables/users/rows', message: 'Bad Request', body: { error: 'Cannot update primary key column "id"' } }),
        );

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

        // No updateRow call should have been made
        expect(mocks.dbBrowser.updateRow).not.toHaveBeenCalled();
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
            expect(mocks.dbBrowser.updateRow).toHaveBeenCalled();
            const [, , body] = mocks.dbBrowser.updateRow.mock.calls[0];
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

        fireEvent.click(screen.getByTestId('db-delete-cancel'));

        await waitFor(() => {
            expect(screen.queryByTestId('db-delete-message')).toBeNull();
        });
        expect(mocks.dbBrowser.deleteRow).not.toHaveBeenCalled();
    });

    it('confirm sends DELETE request with correct pkColumns', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-delete-row-0'));

        fireEvent.click(screen.getByTestId('db-delete-row-0'));
        await waitFor(() => screen.getByTestId('db-delete-confirm'));

        fireEvent.click(screen.getByTestId('db-delete-confirm'));

        await waitFor(() => {
            expect(mocks.dbBrowser.deleteRow).toHaveBeenCalled();
            const [source, table, body] = mocks.dbBrowser.deleteRow.mock.calls[0];
            expect(source).toBe('process-db');
            expect(table).toBe('users');
            expect(body.pkColumns).toEqual({ id: 1 });
        });
    });

    it('successful delete refreshes data and shows success toast', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-delete-row-0'));

        const getTableCountBefore = mocks.dbBrowser.getTable.mock.calls.length;
        fireEvent.click(screen.getByTestId('db-delete-row-0'));
        await waitFor(() => screen.getByTestId('db-delete-confirm'));
        fireEvent.click(screen.getByTestId('db-delete-confirm'));

        await waitFor(() => {
            // Dialog should close
            expect(screen.queryByTestId('db-delete-message')).toBeNull();
            // A new data fetch should have been made (refresh)
            expect(mocks.dbBrowser.getTable.mock.calls.length).toBeGreaterThan(getTableCountBefore);
        });

        // Success toast
        await waitFor(() => {
            expect(screen.getByText('1 row deleted')).toBeDefined();
        });
    });

    it('delete error shows error toast', async () => {
        mocks.dbBrowser.deleteRow.mockRejectedValue(
            new CocApiError({ status: 404, statusText: 'Not Found', url: '/db-browser/process-db/tables/users/rows', message: 'Not Found', body: { error: 'Row not found' } }),
        );

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

    it('uses concrete colors for the selected table so its label and row count stay visible', async () => {
        renderSection();
        await waitFor(() => screen.getByTestId('db-table-users'));

        const selectedButton = screen.getByTestId('db-table-users');
        const selectedCount = selectedButton.querySelector('.tabular-nums');
        expect(selectedButton.className).toContain('bg-[#0078d4]');
        expect(selectedButton.className).toContain('dark:bg-[#3794ff]');
        expect(selectedButton.className).toContain('text-white');
        expect(selectedButton.className).not.toContain('bg-[var(--accent)]');
        expect(selectedCount?.getAttribute('class')).toContain('text-white/70');

        const unselectedCount = screen.getByTestId('db-table-logs').querySelector('.tabular-nums');
        expect(unselectedCount?.getAttribute('class')).toContain('text-gray-400');
        expect(unselectedCount?.getAttribute('class')).not.toContain('text-[var(--text-tertiary)]');
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
            expect(mocks.dbBrowser.deleteBulk).toHaveBeenCalled();
            const [source, table, body] = mocks.dbBrowser.deleteBulk.mock.calls[0];
            expect(source).toBe('process-db');
            expect(table).toBe('users');
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
        mocks.dbBrowser.deleteBulk.mockRejectedValue(
            new CocApiError({ status: 500, statusText: 'Internal Server Error', url: '/db-browser/process-db/tables/users/rows/delete-bulk', message: 'Internal Server Error', body: { error: 'Database locked' } }),
        );

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
