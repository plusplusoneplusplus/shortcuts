import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { BrowserApprovedSites } from '../../../../src/server/spa/client/react/admin/BrowserApprovedSites';

function json(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

describe('BrowserApprovedSites', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        global.fetch = fetchMock as unknown as typeof fetch;
    });
    afterEach(() => cleanup());

    it('lists the always-allowed sites from the admin API', async () => {
        fetchMock.mockResolvedValueOnce(json(200, { sites: ['bbc.co.uk', 'google.com'] }));
        render(<BrowserApprovedSites />);
        expect(await screen.findByTestId('browser-approved-site-bbc.co.uk')).toBeDefined();
        expect(screen.getByTestId('browser-approved-site-google.com')).toBeDefined();
        expect(fetchMock).toHaveBeenCalledWith('/api/admin/browser-approved-sites');
    });

    it('shows an empty state when no site is saved', async () => {
        fetchMock.mockResolvedValueOnce(json(200, { sites: [] }));
        render(<BrowserApprovedSites />);
        expect(await screen.findByTestId('browser-approved-sites-empty')).toBeDefined();
    });

    it('removes a site and shows the remaining list', async () => {
        fetchMock
            .mockResolvedValueOnce(json(200, { sites: ['bbc.co.uk', 'google.com'] }))
            .mockResolvedValueOnce(json(200, { site: 'google.com', removed: true, sites: ['bbc.co.uk'] }));
        render(<BrowserApprovedSites />);
        fireEvent.click(await screen.findByRole('button', { name: 'Remove google.com' }));
        await vi.waitFor(() => expect(screen.queryByTestId('browser-approved-site-google.com')).toBeNull());
        expect(screen.getByTestId('browser-approved-site-bbc.co.uk')).toBeDefined();
        expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/browser-approved-sites/google.com', { method: 'DELETE' });
    });

    it('reloads the list when the site was already removed elsewhere', async () => {
        fetchMock
            .mockResolvedValueOnce(json(200, { sites: ['google.com'] }))
            .mockResolvedValueOnce(json(404, { error: 'not found' }))
            .mockResolvedValueOnce(json(200, { sites: [] }));
        render(<BrowserApprovedSites />);
        fireEvent.click(await screen.findByRole('button', { name: 'Remove google.com' }));
        expect(await screen.findByTestId('browser-approved-sites-empty')).toBeDefined();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('reports load and remove failures', async () => {
        fetchMock.mockResolvedValueOnce(json(500, {}));
        render(<BrowserApprovedSites />);
        expect((await screen.findByRole('alert')).textContent).toContain('Could not load always-allowed sites: HTTP 500');
        cleanup();

        fetchMock
            .mockResolvedValueOnce(json(200, { sites: ['google.com'] }))
            .mockResolvedValueOnce(json(500, {}));
        render(<BrowserApprovedSites />);
        fireEvent.click(await screen.findByRole('button', { name: 'Remove google.com' }));
        expect((await screen.findByRole('alert')).textContent).toContain('Could not remove google.com: HTTP 500');
        expect(screen.getByTestId('browser-approved-site-google.com')).toBeDefined();
    });
    it('previews canonical scope and submits with Enter through the form', async () => {
        fetchMock.mockResolvedValueOnce(json(200, { sites: [] }))
            .mockResolvedValueOnce(json(200, { site: 'google.com', added: true, sites: ['google.com'] }));
        render(<BrowserApprovedSites />);
        await screen.findByTestId('browser-approved-sites-empty');
        const input = screen.getByLabelText('URL to always allow') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'https://mail.google.com/inbox' } });
        expect(screen.getByText('Site to trust: google.com')).toBeDefined();
        fireEvent.submit(input.closest('form')!);
        expect(await screen.findByText('Added google.com.')).toBeDefined();
        expect(screen.getByTestId('browser-approved-site-google.com')).toBeDefined();
        expect(input.value).toBe('');
        expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/browser-approved-sites', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'https://mail.google.com/inbox' }),
        });
    });

    it('validates unsafe URLs and explains canonical duplicates without writing', async () => {
        fetchMock.mockResolvedValueOnce(json(200, { sites: ['example.com'] }));
        render(<BrowserApprovedSites />);
        await screen.findByTestId('browser-approved-site-example.com');
        const input = screen.getByLabelText('URL to always allow');
        for (const url of ['https://user:pass@example.org', 'file:///tmp/file', 'https://*.example.org', 'https://']) {
            fireEvent.change(input, { target: { value: url } });
            expect(input.getAttribute('aria-invalid')).toBe('true');
            expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
            fireEvent.submit(input.closest('form')!);
        }
        fireEvent.change(input, { target: { value: 'http://sub.EXAMPLE.com:8080/path' } });
        expect(screen.getByText('example.com is already always allowed.')).toBeDefined();
        expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each(['write', 'network', 'response'])('keeps the input and does not claim success on %s failure', async failure => {
        fetchMock.mockResolvedValueOnce(json(200, { sites: [] }));
        if (failure === 'network') fetchMock.mockRejectedValueOnce(new Error('offline'));
        else fetchMock.mockResolvedValueOnce(json(failure === 'write' ? 500 : 200, {}));
        render(<BrowserApprovedSites />);
        await screen.findByTestId('browser-approved-sites-empty');
        const input = screen.getByLabelText('URL to always allow') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'https://example.com/path' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));
        expect((await screen.findByRole('alert')).textContent).toContain('Could not add site:');
        expect(input.value).toBe('https://example.com/path');
        expect(screen.queryByText('Added example.com.')).toBeNull();
        expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(false);
    });

    it('serializes writes and reports a duplicate returned by the server', async () => {
        let finish!: (value: unknown) => void;
        fetchMock.mockResolvedValueOnce(json(200, { sites: ['other.com'] }))
            .mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        render(<BrowserApprovedSites />);
        await screen.findByTestId('browser-approved-site-other.com');
        const input = screen.getByLabelText('URL to always allow');
        fireEvent.change(input, { target: { value: 'https://example.com' } });
        fireEvent.submit(input.closest('form')!);
        fireEvent.submit(input.closest('form')!);
        expect(screen.getByText('Saving site...')).toBeDefined();
        expect((screen.getByRole('button', { name: 'Remove other.com' }) as HTMLButtonElement).disabled).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        finish(json(200, { site: 'example.com', added: false, sites: ['example.com', 'other.com'] }));
        expect(await screen.findByText('example.com is already always allowed.')).toBeDefined();
        await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
    });

    it('keeps the saved list when an earlier list read completes late', async () => {
        let finishLoad!: (value: unknown) => void;
        fetchMock.mockReturnValueOnce(new Promise(resolve => { finishLoad = resolve; }))
            .mockResolvedValueOnce(json(200, { site: 'example.com', added: true, sites: ['example.com'] }));
        render(<BrowserApprovedSites />);
        fireEvent.change(screen.getByLabelText('URL to always allow'), { target: { value: 'https://example.com' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));
        await screen.findByText('Added example.com.');
        await act(async () => { finishLoad(json(200, { sites: [] })); });
        await waitFor(() => expect(screen.getByTestId('browser-approved-site-example.com')).toBeDefined());
        expect(screen.queryByTestId('browser-approved-sites-empty')).toBeNull();
    });

});
