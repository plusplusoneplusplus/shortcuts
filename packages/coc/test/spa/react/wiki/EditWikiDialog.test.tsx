/**
 * Tests for EditWikiDialog.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EditWikiDialog } from '../../../../src/server/spa/client/react/wiki/EditWikiDialog';

const wiki = { id: 'my-wiki', name: 'My Wiki', repoPath: '/repo', color: '#3b82f6' };

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('EditWikiDialog', () => {
    it('renders nothing when closed', () => {
        render(
            <EditWikiDialog open={false} wiki={wiki} onClose={vi.fn()} onUpdated={vi.fn()} />
        );
        expect(screen.queryByText('Edit Wiki')).toBeNull();
    });

    it('renders dialog title when open', () => {
        render(<EditWikiDialog open={true} wiki={wiki} onClose={vi.fn()} onUpdated={vi.fn()} />);
        expect(screen.getByText('Edit Wiki')).toBeTruthy();
    });

    it('pre-fills the name field with current wiki name', () => {
        render(<EditWikiDialog open={true} wiki={wiki} onClose={vi.fn()} onUpdated={vi.fn()} />);
        const input = document.getElementById('edit-wiki-name') as HTMLInputElement;
        expect(input.value).toBe('My Wiki');
    });

    it('shows validation error when name is cleared on submit', async () => {
        render(<EditWikiDialog open={true} wiki={wiki} onClose={vi.fn()} onUpdated={vi.fn()} />);
        fireEvent.change(document.getElementById('edit-wiki-name')!, { target: { value: '   ' } });
        fireEvent.click(document.getElementById('edit-wiki-submit')!);
        await waitFor(() => {
            expect(screen.getByText('Name is required')).toBeTruthy();
        });
    });

    it('calls fetch PATCH with updated name and color', async () => {
        const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
        vi.stubGlobal('fetch', mockFetch);
        const onUpdated = vi.fn();
        const onClose = vi.fn();

        render(<EditWikiDialog open={true} wiki={wiki} onClose={onClose} onUpdated={onUpdated} />);
        fireEvent.change(document.getElementById('edit-wiki-name')!, {
            target: { value: 'Updated Name' },
        });
        fireEvent.click(document.getElementById('edit-wiki-submit')!);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/wikis/my-wiki'),
                expect.objectContaining({ method: 'PATCH' })
            );
        });
        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.name).toBe('Updated Name');
        expect(onUpdated).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it('shows server error when API returns error', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            json: () => Promise.resolve({ error: 'Update failed' }),
        }));
        render(<EditWikiDialog open={true} wiki={wiki} onClose={vi.fn()} onUpdated={vi.fn()} />);
        fireEvent.click(document.getElementById('edit-wiki-submit')!);

        await waitFor(() => {
            expect(screen.getByText('Update failed')).toBeTruthy();
        });
    });

    it('calls onClose when Cancel is clicked', () => {
        const onClose = vi.fn();
        render(<EditWikiDialog open={true} wiki={wiki} onClose={onClose} onUpdated={vi.fn()} />);
        fireEvent.click(document.getElementById('edit-wiki-cancel-btn')!);
        expect(onClose).toHaveBeenCalled();
    });

    it('submit button is disabled while loading', async () => {
        let resolveFetch!: () => void;
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(
            new Promise(resolve => { resolveFetch = () => resolve({ ok: true, json: () => Promise.resolve({}) }); })
        ));
        render(<EditWikiDialog open={true} wiki={wiki} onClose={vi.fn()} onUpdated={vi.fn()} />);
        fireEvent.click(document.getElementById('edit-wiki-submit')!);

        await waitFor(() => {
            expect(document.getElementById('edit-wiki-submit')).toBeDisabled();
        });
        resolveFetch();
    });
});
