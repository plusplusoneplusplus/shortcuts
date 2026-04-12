/**
 * Tests for DbBrowserSection inline editing UI.
 * Validates edit button rendering, edit mode transitions, save/cancel,
 * PK column read-only behavior, and API integration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
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
