// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopBrowserPreferences } from '../../../../src/server/spa/client/react/admin/DesktopBrowserPreferences';
import type { BrowserPreferences, DesktopBrowserBridge } from '../../../../src/server/spa/client/react/shared/file-path/browser-bridge';

const mocks = vi.hoisted(() => ({ bridge: undefined as DesktopBrowserBridge | undefined }));
vi.mock('../../../../src/server/spa/client/react/shared/file-path/browser-bridge', async importOriginal => ({
    ...await importOriginal<typeof import('../../../../src/server/spa/client/react/shared/file-path/browser-bridge')>(),
    desktopBrowserBridge: () => mocks.bridge,
}));
let preferences: BrowserPreferences;
let changed: (() => void) | undefined;
let getPreferences: ReturnType<typeof vi.fn>;
let clearData: ReturnType<typeof vi.fn>;
let setDefaultEngine: ReturnType<typeof vi.fn>;

beforeEach(() => {
    preferences = { defaultEngine: 'electron', engines: [{ engine: 'electron', available: true }, { engine: 'webview2', available: true }], clearing: [] };
    getPreferences = vi.fn(async () => preferences);
    clearData = vi.fn(async () => ({ ok: true }));
    setDefaultEngine = vi.fn(async (engine: 'electron' | 'webview2') => { preferences = { ...preferences, defaultEngine: engine }; return { ok: true }; });
    mocks.bridge = {
        getPreferences, clearData, setDefaultEngine,
        onPreferencesChanged: callback => { changed = callback; return () => { changed = undefined; }; },
        open: vi.fn(), navigate: vi.fn(), nav: vi.fn(), hide: vi.fn(), close: vi.fn(), focus: vi.fn(),
        setBounds: vi.fn(), openExternal: vi.fn(), onState: vi.fn(), onNewTab: vi.fn(), onDownload: vi.fn(), onClosed: vi.fn(),
    };
});
afterEach(() => { cleanup(); mocks.bridge = undefined; vi.restoreAllMocks(); });

describe('Desktop Preferences browser engines', () => {
    it('saves via the local desktop bridge, not workspace server preferences', async () => {
        const fetch = vi.spyOn(globalThis, 'fetch');
        render(<DesktopBrowserPreferences />);
        const selector = await screen.findByLabelText('Default browser engine');
        fireEvent.change(selector, { target: { value: 'webview2' } });
        await screen.findByText('Default browser engine saved. Existing tabs are unchanged.');
        expect(setDefaultEngine).toHaveBeenCalledWith('webview2');
        expect(fetch).not.toHaveBeenCalled();
        expect(mocks.bridge?.open).not.toHaveBeenCalled();
    });

    it('shows platform restrictions without offering unsupported selection or cleanup', async () => {
        preferences.engines[1] = { engine: 'webview2', available: false, reason: 'unsupported-platform', message: 'WebView2 is available only on Windows x64.' };
        render(<DesktopBrowserPreferences />);
        const selector = await screen.findByLabelText('Default browser engine');
        expect(selector.querySelectorAll('option')).toHaveLength(1);
        expect(screen.getByText('WebView2 is available only on Windows x64.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Clear WebView2 data...' })).toBeNull();
    });

    it('permits retaining an unavailable Windows choice with explicit runtime guidance', async () => {
        preferences.defaultEngine = 'webview2';
        preferences.engines[1] = { engine: 'webview2', available: false, reason: 'missing-runtime', message: 'Install the WebView2 Runtime, then retry.' };
        render(<DesktopBrowserPreferences />);
        const selector = await screen.findByLabelText('Default browser engine');
        expect((selector as HTMLSelectElement).value).toBe('webview2');
        expect(screen.getByRole('button', { name: 'Get WebView2 Runtime' })).toBeTruthy();
        expect(setDefaultEngine).not.toHaveBeenCalled();
    });

    it('does not report success after cancelled cleanup', async () => {
        clearData.mockResolvedValue({ ok: false, reason: 'cancelled' });
        render(<DesktopBrowserPreferences />);
        fireEvent.click(await screen.findByRole('button', { name: 'Clear Electron data...' }));
        await waitFor(() => expect(clearData).toHaveBeenCalledWith('electron'));
        expect(screen.queryByText(/browser data cleared/)).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('surfaces cleanup failure and allows explicit retry', async () => {
        clearData.mockResolvedValueOnce({ ok: false, reason: 'cleanup-failed', message: 'Storage is locked. Retry.' });
        render(<DesktopBrowserPreferences />);
        fireEvent.click(await screen.findByRole('button', { name: 'Clear WebView2 data...' }));
        await screen.findByRole('alert');
        expect(screen.getByText('Storage is locked. Retry.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Clear WebView2 data...' }));
        await screen.findByText('WebView2 browser data cleared across all workspaces.');
    });

    it('refreshes cross-window preferences and removes its listener on unmount', async () => {
        const view = render(<DesktopBrowserPreferences />);
        const selector = await screen.findByLabelText('Default browser engine');
        preferences = { ...preferences, defaultEngine: 'webview2', clearing: ['webview2'] };
        await act(async () => changed?.());
        expect((selector as HTMLSelectElement).value).toBe('webview2');
        expect(screen.getByRole('button', { name: 'Clearing...' }).hasAttribute('disabled')).toBe(true);
        view.unmount();
        expect(changed).toBeUndefined();
    });

    it('renders nothing outside the desktop shell', () => {
        mocks.bridge = undefined;
        expect(render(<DesktopBrowserPreferences />).container.textContent).toBe('');
    });
});
