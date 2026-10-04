// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnifiedBrowserTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedBrowserTab';
import type { DesktopBrowserBridge } from '../../../../src/server/spa/client/react/shared/file-path/browser-bridge';

const mocks = vi.hoisted(() => ({ bridge: undefined as DesktopBrowserBridge | undefined }));
vi.mock('../../../../src/server/spa/client/react/shared/file-path/browser-bridge', async importOriginal => ({
    ...await importOriginal<typeof import('../../../../src/server/spa/client/react/shared/file-path/browser-bridge')>(),
    desktopBrowserBridge: () => mocks.bridge,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/useNativeViewPlacement', () => ({ useNativeViewPlacement: vi.fn() }));
const offState = vi.fn();
const open = vi.fn();
const hide = vi.fn();
const close = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    open.mockResolvedValue({ ok: true, engine: 'electron' });
    mocks.bridge = {
        open, hide, close, navigate: vi.fn(async () => ({ ok: true, engine: 'electron' })),
        nav: vi.fn(), focus: vi.fn(), setBounds: vi.fn(), openExternal: vi.fn(),
        onState: vi.fn(() => offState), onDownload: vi.fn(() => vi.fn()), onNewTab: vi.fn(), onClosed: vi.fn(),
        getPreferences: vi.fn(), setDefaultEngine: vi.fn(), clearData: vi.fn(), onPreferencesChanged: vi.fn(),
    };
});
afterEach(() => { cleanup(); mocks.bridge = undefined; });
function tab() {
    return render(<UnifiedBrowserTab tabId="tab" viewId="view" sessionKey="remote-workspace" url="https://example.test/" active visible onNavigate={vi.fn()} onPageState={vi.fn()} />);
}

describe('browser tab engine-neutral controls', () => {
    it('labels the actual engine returned by the host and hides rather than closes on unmount', async () => {
        open.mockResolvedValue({ ok: true, engine: 'webview2' });
        const view = tab();
        await screen.findByText('WebView2');
        expect(open).toHaveBeenCalledWith('view', 'https://example.test/', 'remote-workspace', undefined);
        view.unmount();
        expect(offState).toHaveBeenCalled();
        expect(hide).toHaveBeenCalledWith('view');
        expect(close).not.toHaveBeenCalled();
    });

    it('shows explicit missing-runtime guidance without silently selecting Electron', async () => {
        open.mockResolvedValueOnce({ ok: false, engine: 'webview2', reason: 'missing-runtime', message: 'Install the WebView2 Runtime, then retry.' });
        open.mockResolvedValue({ ok: true, engine: 'webview2' });
        tab();
        await screen.findByText('Install the WebView2 Runtime, then retry.');
        expect(screen.getByRole('link', { name: 'Desktop Preferences' }).getAttribute('href')).toBe('#admin/settings/appearance');
        expect(screen.getByRole('button', { name: 'Get WebView2 Runtime' })).toBeTruthy();
        expect(mocks.bridge?.setDefaultEngine).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.queryByText('Install the WebView2 Runtime, then retry.')).toBeNull());
    });

    it('rejects unsafe address input without sending a navigation command', async () => {
        tab();
        await screen.findByText('Electron');
        fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'javascript:alert(1)' } });
        fireEvent.submit(screen.getByLabelText('Address').closest('form')!);
        expect(screen.getByRole('alert').textContent).toContain('not supported');
        expect(mocks.bridge?.navigate).not.toHaveBeenCalled();
    });
});
