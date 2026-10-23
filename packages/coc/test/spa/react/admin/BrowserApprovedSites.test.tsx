import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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
});
