// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserSiteInfoButton, type BrowserSiteInfoSource } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/BrowserSiteInfo';
import { DESKTOP_BROWSER_PREFERENCES_HASH, type BrowserSiteInfo, type BrowserSiteInfoResult } from '../../../../src/server/spa/client/react/shared/file-path/browser-bridge';

afterEach(() => cleanup());

function info(patch: Partial<BrowserSiteInfo> = {}): BrowserSiteInfo {
    return { viewId: 'view', engine: 'electron', sourceKind: 'url', url: 'https://arxiv.org/abs/1', host: 'arxiv.org',
        connection: 'secure', cookies: { available: true, count: 2 }, revision: 1, ...patch };
}

function deferred() {
    let resolve!: (value: BrowserSiteInfoResult) => void;
    const promise = new Promise<BrowserSiteInfoResult>(r => { resolve = r; });
    return { promise, resolve };
}

function renderButton(source: BrowserSiteInfoSource, scopeKey = 'scope-1', enabled = true) {
    const view = render(<><input aria-label="Elsewhere" /><BrowserSiteInfoButton source={source} scopeKey={scopeKey} enabled={enabled} /></>);
    return { ...view, rerenderWith: (next: BrowserSiteInfoSource, key: string, on = true) =>
        view.rerender(<><input aria-label="Elsewhere" /><BrowserSiteInfoButton source={next} scopeKey={key} enabled={on} /></>) };
}

const trigger = () => screen.getByRole('button', { name: 'View site information' });

describe('BrowserSiteInfoButton popover', () => {
    it('opens an anchored overlay dialog from the leading control and restores focus on Escape and Close', async () => {
        const load = vi.fn(async (): Promise<BrowserSiteInfoResult> => ({ ok: true, info: info({
            certificate: { subject: 'arxiv.org', issuer: 'Fixture CA', validStart: 0, validExpiry: 1_900_000_000 } }) }));
        renderButton({ kind: 'web', load });
        expect(trigger()).toHaveAttribute('aria-haspopup', 'dialog');
        expect(trigger()).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(trigger());
        const dialog = await screen.findByRole('dialog', { name: 'arxiv.org' });
        expect(trigger()).toHaveAttribute('aria-expanded', 'true');
        expect(trigger()).toHaveAttribute('aria-controls', dialog.id);
        expect(dialog).toHaveAttribute('data-native-view-overlay');
        expect(dialog).toHaveClass('fixed', 'rounded-xl');
        expect(document.activeElement).toBe(dialog);
        expect(screen.getByTestId('site-info-connection')).toHaveTextContent('Connection is secure');
        expect(screen.getByTestId('site-info-connection')).toHaveTextContent('Electron verified');
        expect(screen.getByTestId('site-info-connection')).toHaveTextContent('Issued to arxiv.org by Fixture CA');
        expect(screen.getByTestId('site-info-cookies')).toHaveTextContent('2 cookies are sent to this page.');
        expect(screen.getByTestId('site-info-settings')).toHaveTextContent('blocked for every site');
        expect(screen.getByRole('link', { name: 'Desktop Preferences' })).toHaveAttribute('href', DESKTOP_BROWSER_PREFERENCES_HASH);
        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(trigger());

        fireEvent.click(trigger());
        await screen.findByRole('dialog', { name: 'arxiv.org' });
        fireEvent.click(screen.getByRole('button', { name: 'Close site information' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(trigger());
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('dismisses on an outside pointer press without moving focus, and when the tab is hidden', async () => {
        const { rerenderWith } = renderButton({ kind: 'web', load: async () => ({ ok: true, info: info() }) });
        fireEvent.click(trigger());
        await screen.findByRole('dialog');
        const elsewhere = screen.getByLabelText('Elsewhere');
        elsewhere.focus();
        fireEvent.pointerDown(elsewhere);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(elsewhere);
        fireEvent.click(trigger());
        await screen.findByRole('dialog');
        rerenderWith({ kind: 'web', load: async () => ({ ok: true, info: info() }) }, 'scope-1', false);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it.each([
        ['https-unverified', 'webview2', 'Connection uses HTTPS', 'WebView2 does not share certificate details'],
        ['insecure', 'electron', 'Connection is not secure', 'uses HTTP'],
        ['certificate-error', 'electron', 'Certificate error', 'could not be verified'],
        ['failed', 'electron', 'Page did not load', 'No connection details'],
        ['loading', 'webview2', 'Page is loading', 'after the page loads'],
        ['unknown', 'electron', 'Connection details unavailable', 'No loaded page'],
    ] as const)('describes %s on %s without claiming a secure connection', async (connection, engine, title, detail) => {
        renderButton({ kind: 'web', load: async () => ({ ok: true, info: info({ connection, engine,
            certificate: { subject: 'arxiv.org', issuer: 'Fixture CA', validStart: 0, validExpiry: 1 },
            cookies: { available: false, reason: 'not-applicable' } }) }) });
        fireEvent.click(trigger());
        const row = await screen.findByTestId('site-info-connection');
        expect(row).toHaveTextContent(title);
        expect(row).toHaveTextContent(detail);
        expect(row).not.toHaveTextContent(/is secure|verified this site/);
        expect(row).not.toHaveTextContent('Issued to');
        expect(screen.getByTestId('site-info-cookies')).toHaveTextContent('Available after a page loads.');
    });

    it.each([
        [{ available: true, count: 0 } as const, 'No cookies are sent to this page.'],
        [{ available: true, count: 1 } as const, '1 cookie is sent to this page.'],
        [{ available: false, reason: 'unsupported' } as const, 'This desktop version cannot read cookies.'],
        [{ available: false, reason: 'failed' } as const, 'Cookies could not be read.'],
    ])('reports cookie state %j explicitly', async (cookies, text) => {
        renderButton({ kind: 'web', load: async () => ({ ok: true, info: info({ cookies }) }) });
        fireEvent.click(trigger());
        expect(await screen.findByTestId('site-info-cookies')).toHaveTextContent(text);
    });

    it('drops a late reply after navigation or owner changes and shows only the current document', async () => {
        const first = deferred(), second = deferred();
        const firstLoad = vi.fn(() => first.promise), secondLoad = vi.fn(() => second.promise);
        const { rerenderWith } = renderButton({ kind: 'web', load: firstLoad }, 'owner-a|rev-1');
        fireEvent.click(trigger());
        expect(screen.getByRole('status')).toHaveTextContent('Loading site information');
        trigger().focus();
        rerenderWith({ kind: 'web', load: secondLoad }, 'owner-b|rev-1');
        expect(screen.queryByRole('dialog')).toBeNull();
        await act(async () => first.resolve({ ok: true, info: info({ host: 'stale.example' }) }));
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(trigger());
        expect(secondLoad).toHaveBeenCalledOnce();
        await act(async () => second.resolve({ ok: true, info: info({ host: 'current.example' }) }));
        expect(screen.getByRole('dialog', { name: 'current.example' })).toBeTruthy();
        expect(screen.queryByText('stale.example')).toBeNull();
        const dialog = screen.getByRole('dialog');
        dialog.focus();
        rerenderWith({ kind: 'web', load: secondLoad }, 'owner-b|rev-2');
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(trigger());
    });

    it('shows refusals and unavailable sources as explicit states with no site rows', async () => {
        const { rerenderWith } = renderButton({ kind: 'web', load: async () => ({ ok: false, reason: 'busy', message: 'The page changed. Open site information again.' }) });
        fireEvent.click(trigger());
        expect(await screen.findByTestId('site-info-unavailable')).toHaveTextContent('The page changed.');
        expect(screen.queryByTestId('site-info-connection')).toBeNull();
        rerenderWith({ kind: 'web', load: async () => ({ ok: false, reason: 'bad-session' }) }, 'scope-2');
        fireEvent.click(trigger());
        expect(await screen.findByTestId('site-info-unavailable')).toHaveTextContent('This page is no longer open here.');
        rerenderWith({ kind: 'web', load: () => Promise.reject(new Error('secret')) }, 'scope-3');
        fireEvent.click(trigger());
        await waitFor(() => expect(screen.getByTestId('site-info-unavailable')).toHaveTextContent('Site information is unavailable.'));
        expect(screen.getByRole('dialog')).not.toHaveTextContent('secret');
        rerenderWith({ kind: 'unavailable', message: 'This desktop version cannot report site information.' }, 'scope-4');
        fireEvent.click(trigger());
        expect(screen.getByTestId('site-info-unavailable')).toHaveTextContent('This desktop version cannot report site information.');
        expect(screen.getByRole('dialog', { name: 'Site information' })).toBeTruthy();
    });

    it('describes a local preview as a file, not a network connection', () => {
        renderButton({ kind: 'local-file', path: 'C:\\work\\pages\\index.html' });
        fireEvent.click(trigger());
        const dialog = screen.getByRole('dialog', { name: 'index.html' });
        expect(screen.getByTestId('site-info-connection')).toHaveTextContent('Not a network connection');
        expect(screen.getByTestId('site-info-settings')).toHaveTextContent('no site settings for local previews');
        expect(dialog).not.toHaveTextContent(/secure|HTTPS/);
        expect(screen.queryByRole('link')).toBeNull();
    });
});
