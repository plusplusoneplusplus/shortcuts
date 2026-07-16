/**
 * Tests for DeleteWikiDialog.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeleteWikiDialog } from '../../../../src/server/spa/client/react/wiki/DeleteWikiDialog';

const wiki = { id: 'my-wiki', name: 'My Wiki' };

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('DeleteWikiDialog', () => {
    it('renders nothing when closed', () => {
        render(
            <DeleteWikiDialog open={false} wiki={wiki} onClose={vi.fn()} onDeleted={vi.fn()} />
        );
        expect(screen.queryByText('Delete Wiki')).toBeNull();
    });

    it('displays dialog title when open', () => {
        render(
            <DeleteWikiDialog open={true} wiki={wiki} onClose={vi.fn()} onDeleted={vi.fn()} />
        );
        expect(screen.getByText('Delete Wiki')).toBeTruthy();
    });

    it('displays the wiki name in the confirmation message', () => {
        render(
            <DeleteWikiDialog open={true} wiki={wiki} onClose={vi.fn()} onDeleted={vi.fn()} />
        );
        expect(document.getElementById('delete-wiki-name')!.textContent).toBe('My Wiki');
    });

    it('falls back to wiki.title when wiki.name is missing', () => {
        render(
            <DeleteWikiDialog
                open={true}
                wiki={{ id: 'w', title: 'Title Only' }}
                onClose={vi.fn()}
                onDeleted={vi.fn()}
            />
        );
        expect(document.getElementById('delete-wiki-name')!.textContent).toBe('Title Only');
    });

    it('falls back to wiki.id when name and title are missing', () => {
        render(
            <DeleteWikiDialog
                open={true}
                wiki={{ id: 'fallback-id' }}
                onClose={vi.fn()}
                onDeleted={vi.fn()}
            />
        );
        expect(document.getElementById('delete-wiki-name')!.textContent).toBe('fallback-id');
    });

    it('calls onDeleted when delete is confirmed successfully', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
        const onDeleted = vi.fn();
        render(
            <DeleteWikiDialog open={true} wiki={wiki} onClose={vi.fn()} onDeleted={onDeleted} />
        );
        fireEvent.click(document.getElementById('delete-wiki-confirm')!);
        await waitFor(() => {
            expect(onDeleted).toHaveBeenCalledTimes(1);
        });
    });

    it('calls fetch DELETE with correct URL', async () => {
        const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
        vi.stubGlobal('fetch', mockFetch);
        render(
            <DeleteWikiDialog open={true} wiki={wiki} onClose={vi.fn()} onDeleted={vi.fn()} />
        );
        fireEvent.click(document.getElementById('delete-wiki-confirm')!);
        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/wikis/my-wiki'),
                expect.objectContaining({ method: 'DELETE' })
            );
        });
    });

    it('shows server error when delete API returns error', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            json: () => Promise.resolve({ error: 'Not found' }),
        }));
        render(
            <DeleteWikiDialog open={true} wiki={wiki} onClose={vi.fn()} onDeleted={vi.fn()} />
        );
        fireEvent.click(document.getElementById('delete-wiki-confirm')!);
        await waitFor(() => {
            expect(screen.getByText('Not found')).toBeTruthy();
        });
    });

    it('calls onClose when Cancel is clicked (no delete)', () => {
        const onClose = vi.fn();
        const onDeleted = vi.fn();
        render(
            <DeleteWikiDialog open={true} wiki={wiki} onClose={onClose} onDeleted={onDeleted} />
        );
        fireEvent.click(document.getElementById('delete-wiki-cancel-btn')!);
        expect(onClose).toHaveBeenCalled();
        expect(onDeleted).not.toHaveBeenCalled();
    });
});
