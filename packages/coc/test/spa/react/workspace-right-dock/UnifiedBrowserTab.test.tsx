// @vitest-environment jsdom
import userEvent from '@testing-library/user-event';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    it.each(['electron', 'webview2'])('selects the complete editable URL on a matching %s request and replaces it on typing/Enter', async engine => {
        const listeners = new Set<(event: { viewId: string }) => void>();
        mocks.bridge!.onFocusAddressRequested = callback => { listeners.add(callback); return () => { listeners.delete(callback); }; };
        open.mockResolvedValue({ ok: true, engine });
        const onNavigate = vi.fn();
        const props = { tabId: 'tab', viewId: 'view', sessionKey: 'workspace-a', url: 'https://example.test/long/path?q=value#fragment', active: true, visible: true, onNavigate, onPageState: vi.fn() };
        const rendered = render(<UnifiedBrowserTab {...props} />);
        await screen.findByTestId('browser-engine');
        const address = screen.getByLabelText('Address') as HTMLInputElement;
        fireEvent.change(address, { target: { value: 'https://draft.test/edit?full=url#end' } });
        const outside = document.createElement('input');
        document.body.append(outside);
        outside.focus();
        act(() => listeners.forEach(fn => fn({ viewId: 'other-view' })));
        expect(document.activeElement).toBe(outside);
        act(() => listeners.forEach(fn => fn({ viewId: 'view' })));
        expect(document.activeElement).toBe(address);
        expect([address.selectionStart, address.selectionEnd]).toEqual([0, address.value.length]);
        await userEvent.keyboard('https://replacement.test/{Enter}');
        expect(onNavigate).toHaveBeenCalledWith('tab', 'https://replacement.test/');
        expect(mocks.bridge!.navigate).toHaveBeenCalledWith('view', 'https://replacement.test/');
        rendered.rerender(<UnifiedBrowserTab {...props} active={false} />);
        outside.focus();
        act(() => listeners.forEach(fn => fn({ viewId: 'view' })));
        expect(document.activeElement).toBe(outside);
        rendered.rerender(<UnifiedBrowserTab {...props} visible={false} />);
        act(() => listeners.forEach(fn => fn({ viewId: 'view' })));
        expect(document.activeElement).toBe(outside);
        rendered.unmount();
        expect(listeners.size).toBe(0);
        outside.remove();
    });

    it.each(['Win32', 'MacIntel'])('handles the platform address shortcut throughout the toolbar on %s', async platform => {
        const platformSpy = vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
        tab();
        await screen.findByText('Electron');
        const address = screen.getByLabelText('Address') as HTMLInputElement;
        const button = screen.getByTestId('browser-open-external');
        button.focus();
        const chord = { key: 'l', ctrlKey: platform === 'Win32', metaKey: platform === 'MacIntel' };
        expect(fireEvent.keyDown(button, { ...chord, shiftKey: true })).toBe(true);
        expect(document.activeElement).toBe(button);
        expect(fireEvent.keyDown(button, chord)).toBe(false);
        expect(document.activeElement).toBe(address);
        expect([address.selectionStart, address.selectionEnd]).toEqual([0, address.value.length]);
        address.setSelectionRange(2, 2);
        expect(fireEvent.keyDown(address, chord)).toBe(false);
        expect(address.selectionEnd).toBe(address.value.length);
        expect(fireEvent.keyDown(document.body, chord)).toBe(true);
        expect(fireEvent.keyDown(address, { ...chord, key: 'Tab' })).toBe(true);
        platformSpy.mockRestore();
    });

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
