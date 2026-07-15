/**
 * Tests for AddWikiDialog.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddWikiDialog } from '../../../../src/server/spa/client/react/wiki/AddWikiDialog';

// Dialog uses useBreakpoint — default jsdom state is desktop (no mock needed)

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('AddWikiDialog', () => {
    it('renders nothing when closed', () => {
        render(
            <AddWikiDialog open={false} onClose={vi.fn()} onAdded={vi.fn()} />
        );
        expect(screen.queryByText('Add Wiki')).toBeNull();
    });

    it('renders dialog title when open', () => {
        render(<AddWikiDialog open={true} onClose={vi.fn()} onAdded={vi.fn()} />);
        expect(screen.getByText('Add Wiki')).toBeTruthy();
    });

    it('shows validation error when name is empty on submit', async () => {
        render(<AddWikiDialog open={true} onClose={vi.fn()} onAdded={vi.fn()} />);
        // Fill path but leave name empty
        fireEvent.change(document.getElementById('wiki-path')!, { target: { value: '/some/path' } });
        fireEvent.click(document.getElementById('add-wiki-submit')!);
        await waitFor(() => {
            expect(screen.getByText('Name is required')).toBeTruthy();
        });
    });

    it('shows validation error when repo path is empty on submit', async () => {
        render(<AddWikiDialog open={true} onClose={vi.fn()} onAdded={vi.fn()} />);
        fireEvent.change(document.getElementById('wiki-name')!, { target: { value: 'My Wiki' } });
        fireEvent.click(document.getElementById('add-wiki-submit')!);
        await waitFor(() => {
            expect(screen.getByText('Repository path is required')).toBeTruthy();
        });
    });

    it('calls fetch with POST and correct payload on valid submit', async () => {
        const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
        vi.stubGlobal('fetch', mockFetch);
        const onAdded = vi.fn();
        const onClose = vi.fn();

        render(<AddWikiDialog open={true} onClose={onClose} onAdded={onAdded} />);
        fireEvent.change(document.getElementById('wiki-name')!, { target: { value: 'Test Wiki' } });
        fireEvent.change(document.getElementById('wiki-path')!, { target: { value: '/repo/path' } });
        fireEvent.click(document.getElementById('add-wiki-submit')!);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/wikis'),
                expect.objectContaining({ method: 'POST' })
            );
        });
        expect(onAdded).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it('shows server error when API returns error', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            json: () => Promise.resolve({ error: 'Already exists' }),
        }));
        render(<AddWikiDialog open={true} onClose={vi.fn()} onAdded={vi.fn()} />);
        fireEvent.change(document.getElementById('wiki-name')!, { target: { value: 'My Wiki' } });
        fireEvent.change(document.getElementById('wiki-path')!, { target: { value: '/repo' } });
        fireEvent.click(document.getElementById('add-wiki-submit')!);

        await waitFor(() => {
            expect(screen.getByText('Already exists')).toBeTruthy();
        });
    });

    it('shows network error when fetch throws', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
        render(<AddWikiDialog open={true} onClose={vi.fn()} onAdded={vi.fn()} />);
        fireEvent.change(document.getElementById('wiki-name')!, { target: { value: 'Wiki' } });
        fireEvent.change(document.getElementById('wiki-path')!, { target: { value: '/repo' } });
        fireEvent.click(document.getElementById('add-wiki-submit')!);

        await waitFor(() => {
            expect(screen.getByText('Network error')).toBeTruthy();
        });
    });

    it('submit button is disabled while loading', async () => {
        let resolveFetch!: () => void;
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(
            new Promise(resolve => { resolveFetch = () => resolve({ ok: true, json: () => Promise.resolve({}) }); })
        ));
        render(<AddWikiDialog open={true} onClose={vi.fn()} onAdded={vi.fn()} />);
        fireEvent.change(document.getElementById('wiki-name')!, { target: { value: 'Wiki' } });
        fireEvent.change(document.getElementById('wiki-path')!, { target: { value: '/repo' } });
        fireEvent.click(document.getElementById('add-wiki-submit')!);

        await waitFor(() => {
            expect(document.getElementById('add-wiki-submit')).toBeDisabled();
        });
        resolveFetch();
    });

    it('calls onClose when Cancel is clicked', () => {
        const onClose = vi.fn();
        render(<AddWikiDialog open={true} onClose={onClose} onAdded={vi.fn()} />);
        fireEvent.click(document.getElementById('add-wiki-cancel-btn')!);
        expect(onClose).toHaveBeenCalled();
    });
});
