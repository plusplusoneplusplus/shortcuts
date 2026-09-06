/**
 * Tests for the What's New modal (AC-05): it renders nothing unless the server
 * says there is unseen content, renders the release title and notes when there
 * is, and always closes on dismiss — even when the ack request rejects.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const fetchApi = vi.fn();
vi.mock('../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: unknown[]) => fetchApi(...args),
}));

import { WhatsNewModal } from '../../../src/server/spa/client/react/whats-new/WhatsNewModal';

const CONTENT = {
    show: true,
    version: '3.4.9',
    tag: 'v3.4.9',
    title: 'CoC v3.4.9',
    notes: "## What's New\n\n### Added\n\n- Release notes now appear in the app\n",
    htmlUrl: 'https://github.com/plusplusoneplusplus/shortcuts/releases/tag/v3.4.9',
    isPrerelease: false,
};

// `ack` is a factory, not a promise: a pre-built rejected promise would be
// flagged as an unhandled rejection before the component ever attaches to it.
function respond(get: unknown, ack: () => Promise<unknown> = () => Promise.resolve({ ok: true })) {
    fetchApi.mockImplementation((path: string) => {
        if (path === '/whats-new') return Promise.resolve(get);
        if (path === '/whats-new/ack') return ack();
        return Promise.reject(new Error(`unexpected path ${path}`));
    });
}

async function renderModal() {
    render(<WhatsNewModal />);
    // Let the mount-time GET settle.
    await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
    fetchApi.mockReset();
});

describe('WhatsNewModal', () => {
    it('renders nothing when the server reports nothing unseen', async () => {
        respond({ show: false, version: '3.4.9', reason: 'seen' });
        await renderModal();

        expect(screen.queryByTestId('whats-new-modal')).toBeNull();
        expect(fetchApi).toHaveBeenCalledTimes(1);
    });

    it('renders nothing while the request is still in flight', () => {
        fetchApi.mockReturnValue(new Promise(() => { /* never settles */ }));
        render(<WhatsNewModal />);

        expect(screen.queryByTestId('whats-new-modal')).toBeNull();
    });

    it('renders nothing when the request fails', async () => {
        fetchApi.mockRejectedValue(new Error('offline'));
        await renderModal();

        expect(screen.queryByTestId('whats-new-modal')).toBeNull();
    });

    it('renders the release title, notes and link when there is unseen content', async () => {
        respond(CONTENT);
        await renderModal();

        expect(await screen.findByTestId('whats-new-modal')).toBeTruthy();
        expect(screen.getByText('CoC v3.4.9')).toBeTruthy();
        expect(screen.getByTestId('whats-new-notes').textContent)
            .toContain('Release notes now appear in the app');
        expect(screen.getByTestId('whats-new-release-link').getAttribute('href'))
            .toBe(CONTENT.htmlUrl);
        expect(screen.queryByTestId('whats-new-prerelease-badge')).toBeNull();
    });

    it('escapes untrusted markup in the notes instead of injecting it', async () => {
        respond({ ...CONTENT, notes: 'hello <img src=x onerror="alert(1)">' });
        await renderModal();

        const body = await screen.findByTestId('whats-new-notes');
        expect(body.querySelector('img')).toBeNull();
        expect(body.innerHTML).toContain('&lt;img');
        expect(body.textContent).toContain('<img src=x onerror="alert(1)">');
    });

    it('shows an early-build badge for a prerelease', async () => {
        respond({ ...CONTENT, tag: 'v3.4.9-alpha.1', isPrerelease: true });
        await renderModal();

        expect(await screen.findByTestId('whats-new-prerelease-badge')).toBeTruthy();
    });

    it('acks the version and closes when dismissed', async () => {
        respond(CONTENT);
        await renderModal();
        fireEvent.click(await screen.findByTestId('whats-new-dismiss'));

        await waitFor(() => expect(screen.queryByTestId('whats-new-modal')).toBeNull());
        expect(fetchApi).toHaveBeenCalledWith('/whats-new/ack', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ version: '3.4.9' }),
        }));
    });

    it('closes on Escape and on a backdrop click', async () => {
        respond(CONTENT);
        await renderModal();
        await screen.findByTestId('whats-new-modal');

        fireEvent.keyDown(document, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByTestId('whats-new-modal')).toBeNull());
        expect(fetchApi).toHaveBeenCalledWith('/whats-new/ack', expect.anything());

        fetchApi.mockReset();
        respond(CONTENT);
        render(<WhatsNewModal />);
        fireEvent.click(await screen.findByTestId('whats-new-backdrop'));
        await waitFor(() => expect(screen.queryByTestId('whats-new-modal')).toBeNull());
    });

    it('stays open when the modal panel itself is clicked', async () => {
        respond(CONTENT);
        await renderModal();
        fireEvent.click(await screen.findByTestId('whats-new-modal'));

        expect(screen.queryByTestId('whats-new-modal')).toBeTruthy();
        expect(fetchApi).toHaveBeenCalledTimes(1);
    });

    it('closes anyway when the ack request rejects', async () => {
        respond(CONTENT, () => Promise.reject(new Error('ack failed')));
        await renderModal();
        fireEvent.click(await screen.findByTestId('whats-new-dismiss'));

        await waitFor(() => expect(screen.queryByTestId('whats-new-modal')).toBeNull());
    });

    it('only requests once and only acks once even on a repeated dismiss', async () => {
        respond(CONTENT);
        await renderModal();
        const dismiss = await screen.findByTestId('whats-new-dismiss');
        fireEvent.click(dismiss);
        fireEvent.click(dismiss);

        await waitFor(() => expect(screen.queryByTestId('whats-new-modal')).toBeNull());
        const acks = fetchApi.mock.calls.filter(([path]) => path === '/whats-new/ack');
        expect(acks).toHaveLength(1);
        const gets = fetchApi.mock.calls.filter(([path]) => path === '/whats-new');
        expect(gets).toHaveLength(1);
    });

    it('renders nothing when show is true but the payload has no notes', async () => {
        respond({ show: true, version: '3.4.9', tag: 'v3.4.9', title: 'CoC v3.4.9', notes: '' });
        await renderModal();

        expect(screen.queryByTestId('whats-new-modal')).toBeNull();
    });
});
