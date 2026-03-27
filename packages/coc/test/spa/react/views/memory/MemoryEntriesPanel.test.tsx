/**
 * Tests for MemoryEntriesPanel component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryEntriesPanel } from '../../../../../src/server/spa/client/react/views/memory/MemoryEntriesPanel';

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const makeEntry = (id: string, summary = `Entry ${id}`) => ({
    id,
    summary,
    tags: ['tag1'],
    source: 'system',
    createdAt: new Date('2024-01-01').toISOString(),
    updatedAt: new Date('2024-01-01').toISOString(),
});

const makeListResponse = (entries: any[], total = entries.length) => ({
    entries,
    total,
    page: 1,
    pageSize: 20,
    totalPages: 1,
});

describe('MemoryEntriesPanel', () => {
    it('shows spinner while loading', () => {
        (fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
        render(<MemoryEntriesPanel />);
        expect(screen.getByLabelText('Loading')).toBeTruthy();
    });

    it('renders memory entries from API', async () => {
        (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeListResponse([
                makeEntry('e1', 'First entry'),
                makeEntry('e2', 'Second entry'),
            ])),
        });
        render(<MemoryEntriesPanel />);
        await waitFor(() => {
            expect(screen.getByText('First entry')).toBeTruthy();
            expect(screen.getByText('Second entry')).toBeTruthy();
        });
    });

    it('shows empty state when no entries', async () => {
        (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeListResponse([])),
        });
        render(<MemoryEntriesPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('memory-entries-empty')).toBeTruthy();
        });
    });

    it('shows error message when API fails', async () => {
        (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500 });
        render(<MemoryEntriesPanel />);
        await waitFor(() => {
            expect(screen.getByText(/HTTP 500/)).toBeTruthy();
        });
    });

    it('renders view button for each entry', async () => {
        (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeListResponse([makeEntry('e1')])),
        });
        render(<MemoryEntriesPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('memory-entry-view-btn')).toBeTruthy();
        });
    });

    it('renders delete button for each entry', async () => {
        (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeListResponse([makeEntry('e1')])),
        });
        render(<MemoryEntriesPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('memory-entry-delete-btn')).toBeTruthy();
        });
    });

    it('shows confirm/cancel buttons after clicking delete', async () => {
        (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeListResponse([makeEntry('e1')])),
        });
        render(<MemoryEntriesPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('memory-entry-delete-btn')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('memory-entry-delete-btn'));
        expect(screen.getByTestId('memory-entry-confirm-btn')).toBeTruthy();
        expect(screen.getByTestId('memory-entry-cancel-btn')).toBeTruthy();
    });

    it('cancels delete when cancel button is clicked', async () => {
        (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeListResponse([makeEntry('e1')])),
        });
        render(<MemoryEntriesPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('memory-entry-delete-btn')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('memory-entry-delete-btn'));
        fireEvent.click(screen.getByTestId('memory-entry-cancel-btn'));
        expect(screen.queryByTestId('memory-entry-confirm-btn')).toBeNull();
        expect(screen.getByTestId('memory-entry-delete-btn')).toBeTruthy();
    });

    it('calls DELETE endpoint when confirm is clicked', async () => {
        const mockFetch = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(makeListResponse([makeEntry('entry-123')])),
            })
            .mockResolvedValue({ ok: true, json: () => Promise.resolve(makeListResponse([])) });
        vi.stubGlobal('fetch', mockFetch);

        render(<MemoryEntriesPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('memory-entry-delete-btn')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('memory-entry-delete-btn'));
        fireEvent.click(screen.getByTestId('memory-entry-confirm-btn'));
        await waitFor(() => {
            const deleteCalls = mockFetch.mock.calls.filter(
                ([url, opts]: [string, RequestInit]) => opts?.method === 'DELETE'
            );
            expect(deleteCalls.length).toBe(1);
            expect(deleteCalls[0][0]).toContain('entry-123');
        });
    });

    it('filters results when search query is typed', async () => {
        (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeListResponse([])),
        });
        render(<MemoryEntriesPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('memory-entries-empty')).toBeTruthy();
        });
        const searchInput = screen.getByPlaceholderText('Search entries…');
        fireEvent.change(searchInput, { target: { value: 'hello' } });
        await waitFor(() => {
            const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
            const hasQuery = calls.some(([url]: [string]) => url.includes('q=hello'));
            expect(hasQuery).toBe(true);
        });
    });

    it('renders a refresh button', async () => {
        (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeListResponse([makeEntry('e1')])),
        });
        render(<MemoryEntriesPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('memory-entries-refresh-btn')).toBeTruthy();
        });
    });

    it('calls fetch again when refresh button is clicked', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeListResponse([makeEntry('e1')])),
        });
        vi.stubGlobal('fetch', mockFetch);
        render(<MemoryEntriesPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('memory-entries-refresh-btn')).toBeTruthy();
        });
        const callsBefore = mockFetch.mock.calls.length;
        fireEvent.click(screen.getByTestId('memory-entries-refresh-btn'));
        await waitFor(() => {
            expect(mockFetch.mock.calls.length).toBeGreaterThan(callsBefore);
        });
    });
});
