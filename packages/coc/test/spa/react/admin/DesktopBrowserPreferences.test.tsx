// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopBrowserPreferences } from '../../../../src/server/spa/client/react/admin/DesktopBrowserPreferences';
import type { BrowserHistoryResult, BrowserPreferences, DesktopBrowserBridge, DesktopBrowserHistory } from '../../../../src/server/spa/client/react/shared/file-path/browser-bridge';

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

describe('Desktop history recording preferences', () => {
    let recording: boolean;
    let historyChanged: (() => void) | undefined;
    let query: ReturnType<typeof vi.fn>;
    let setRecording: ReturnType<typeof vi.fn>;
    let history: DesktopBrowserHistory;
    const result = (): BrowserHistoryResult => ({ ok: true, entries: [], total: 0, recording, storageError: null });

    beforeEach(() => {
        recording = true;
        historyChanged = undefined;
        query = vi.fn(async () => result());
        setRecording = vi.fn(async (enabled: boolean) => { recording = enabled; return { ok: true }; });
        const listeners = new Set<() => void>();
        history = {
            query, setRecording, suggest: vi.fn(), delete: vi.fn(), clear: vi.fn(),
            onChanged: callback => {
                listeners.add(callback);
                historyChanged = () => listeners.forEach(listener => listener());
                return () => { listeners.delete(callback); if (!listeners.size) { historyChanged = undefined; } };
            },
        };
        mocks.bridge!.history = history;
    });

    it('loads the saved state and pauses/resumes through desktop IPC without clearing history or profiles', async () => {
        const fetch = vi.spyOn(globalThis, 'fetch');
        render(<DesktopBrowserPreferences />);
        const toggle = await screen.findByRole('checkbox', { name: 'Record browser history' });
        expect((toggle as HTMLInputElement).checked).toBe(true);
        expect(query).toHaveBeenCalledWith('', 0, 1);
        fireEvent.click(toggle);
        await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(false));
        fireEvent.click(toggle);
        await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true));
        expect(setRecording.mock.calls).toEqual([[false], [true]]);
        expect(history.clear).not.toHaveBeenCalled();
        expect(clearData).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
        expect(screen.getByText(/Pausing keeps existing history available/)).toBeTruthy();
    });

    it('restores persisted pause on remount and refreshes changes from another window', async () => {
        const view = render(<DesktopBrowserPreferences />);
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Record browser history' }));
        await waitFor(() => expect(recording).toBe(false));
        view.unmount();
        expect(historyChanged).toBeUndefined();
        render(<DesktopBrowserPreferences />);
        const toggle = await screen.findByRole('checkbox', { name: 'Record browser history' });
        expect((toggle as HTMLInputElement).checked).toBe(false);
        recording = true;
        await act(async () => historyChanged?.());
        expect((toggle as HTMLInputElement).checked).toBe(true);
        expect(setRecording).toHaveBeenCalledTimes(1);
    });

    it('refreshes two desktop windows together without persisting in either renderer', async () => {
        render(<DesktopBrowserPreferences />);
        render(<DesktopBrowserPreferences />);
        await waitFor(() => expect(screen.getAllByRole('checkbox', { name: 'Record browser history' })).toHaveLength(2));
        fireEvent.click(screen.getAllByRole('checkbox')[0]);
        await waitFor(() => expect(recording).toBe(false));
        await act(async () => historyChanged?.());
        expect(screen.getAllByRole('checkbox').map(toggle => (toggle as HTMLInputElement).checked)).toEqual([false, false]);
        expect(setRecording).toHaveBeenCalledTimes(1);
    });

    it('keeps the saved state after failed mutations and permits explicit retry', async () => {
        setRecording.mockResolvedValueOnce({ ok: false, reason: 'storage-failed', message: 'Disk is full.' });
        render(<DesktopBrowserPreferences />);
        const toggle = await screen.findByRole('checkbox', { name: 'Record browser history' });
        fireEvent.click(toggle);
        await screen.findByText(/Disk is full/);
        expect((toggle as HTMLInputElement).checked).toBe(true);
        expect(toggle.hasAttribute('disabled')).toBe(false);
        fireEvent.click(toggle);
        await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(false));
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('surfaces rejected mutations without claiming a saved state', async () => {
        setRecording.mockRejectedValueOnce(new Error('IPC disconnected.'));
        render(<DesktopBrowserPreferences />);
        const toggle = await screen.findByRole('checkbox', { name: 'Record browser history' });
        fireEvent.click(toggle);
        await screen.findByText(/IPC disconnected/);
        expect((toggle as HTMLInputElement).checked).toBe(true);
        expect(toggle.hasAttribute('disabled')).toBe(false);
    });

    it.each(['result', 'rejection'])('shows initial query %s failures and retries without disabling engine settings', async failure => {
        if (failure === 'result') { query.mockResolvedValueOnce({ ok: false, reason: 'storage-failed', message: 'Cannot read history.' }); }
        else { query.mockRejectedValueOnce(new Error('Cannot read history.')); }
        render(<DesktopBrowserPreferences />);
        await screen.findByText(/Cannot read history/);
        expect(screen.queryByRole('checkbox', { name: 'Record browser history' })).toBeNull();
        expect((await screen.findByLabelText('Default browser engine')).hasAttribute('disabled')).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Retry history recording' }));
        await screen.findByRole('checkbox', { name: 'Record browser history' });
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('exposes persistent storage errors while keeping the recording control usable', async () => {
        query.mockResolvedValueOnce({ ...result(), storageError: 'Permission denied.' });
        render(<DesktopBrowserPreferences />);
        await screen.findByText('History could not be saved: Permission denied.');
        expect(screen.getByRole('checkbox', { name: 'Record browser history' }).hasAttribute('disabled')).toBe(false);
        await act(async () => historyChanged?.());
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('rejects stale queries and waits for persistence before changing the toggle', async () => {
        let resolveOld!: (value: BrowserHistoryResult) => void;
        query.mockImplementationOnce(() => new Promise<BrowserHistoryResult>(resolve => { resolveOld = resolve; }));
        render(<DesktopBrowserPreferences />);
        expect(screen.getByText('Loading history recording...')).toBeTruthy();
        recording = false;
        await act(async () => historyChanged?.());
        const toggle = screen.getByRole('checkbox', { name: 'Record browser history' });
        await act(async () => resolveOld({ ...result(), recording: true }));
        expect((toggle as HTMLInputElement).checked).toBe(false);
        let finish!: () => void;
        setRecording.mockImplementationOnce(() => new Promise(resolve => { finish = () => { recording = true; resolve({ ok: true }); }; }));
        fireEvent.click(toggle);
        expect(toggle.hasAttribute('disabled')).toBe(true);
        expect((toggle as HTMLInputElement).checked).toBe(false);
        await act(async () => finish());
        expect((toggle as HTMLInputElement).checked).toBe(true);
        expect(toggle.hasAttribute('disabled')).toBe(false);
    });

    it('removes the listener and ignores late mutation replies after unmount', async () => {
        let finish!: () => void;
        setRecording.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ ok: true }); }));
        const view = render(<DesktopBrowserPreferences />);
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Record browser history' }));
        view.unmount();
        expect(historyChanged).toBeUndefined();
        const calls = query.mock.calls.length;
        await act(async () => finish());
        expect(query).toHaveBeenCalledTimes(calls);
    });

    it('hides recording controls on older desktop hosts', async () => {
        delete mocks.bridge!.history;
        render(<DesktopBrowserPreferences />);
        await screen.findByLabelText('Default browser engine');
        expect(screen.queryByText('Record browser history')).toBeNull();
        expect(query).not.toHaveBeenCalled();
    });
});
