// @vitest-environment jsdom
import userEvent from '@testing-library/user-event';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnifiedBrowserTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedBrowserTab';
import { useNativeViewPlacement } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/useNativeViewPlacement';
import type { BrowserHistoryResult, DesktopBrowserBridge } from '../../../../src/server/spa/client/react/shared/file-path/browser-bridge';

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
afterEach(() => { cleanup(); mocks.bridge = undefined; delete (window as { cocDesktop?: unknown }).cocDesktop; });
function tab(overrides: Partial<React.ComponentProps<typeof UnifiedBrowserTab>> = {}) {
    return render(<UnifiedBrowserTab tabId="tab" viewId="view" sessionKey="remote-workspace" url="https://example.test/" active visible onNavigate={vi.fn()} onPageState={vi.fn()} {...overrides} />);
}

describe('browser tab engine-neutral controls', () => {
    it.each(['electron', 'webview2'] as const)('uses ranked history completion in the owning %s tab and preserves Ctrl/Cmd+L', async engine => {
        open.mockResolvedValue({ ok: true, engine });
        const target = 'https://example.test/Case?Q=Value#Hash';
        mocks.bridge!.history = {
            suggest: vi.fn(async search => ({ ok: true, entries: [{ url: target, title: 'Case page',
                lastVisited: 1, visitCount: 2, completion: search ? 'example.test/Case?Q=Value#Hash' : null }],
                total: 1, recording: false, storageError: null })),
            query: vi.fn(), delete: vi.fn(), clear: vi.fn(), setRecording: vi.fn(), onChanged: vi.fn(() => vi.fn()),
        };
        const onNavigate = vi.fn();
        const props = { tabId: 'tab-a', viewId: 'view-a', sessionKey: 'remote-workspace-a', url: 'https://start.test/',
            active: true, visible: true, onNavigate, onPageState: vi.fn() };
        render(<UnifiedBrowserTab {...props} />);
        await waitFor(() => expect(screen.getByLabelText('Reload')).not.toBeDisabled());
        const address = screen.getByLabelText('Address') as HTMLInputElement;
        await userEvent.click(address);
        fireEvent.keyDown(address, { key: 'l', ctrlKey: true, metaKey: true });
        expect([address.selectionStart, address.selectionEnd]).toEqual([0, address.value.length]);
        await userEvent.keyboard('ex');
        await waitFor(() => expect(address.value).toBe('example.test/Case?Q=Value#Hash'));
        expect([address.selectionStart, address.selectionEnd]).toEqual([2, address.value.length]);
        await userEvent.keyboard('{Enter}');
        expect(onNavigate).toHaveBeenCalledExactlyOnceWith('tab-a', target);
        expect(mocks.bridge!.navigate).toHaveBeenCalledExactlyOnceWith('view-a', target);
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(address.value).toBe(target);
        fireEvent.change(address, { target: { value: 'localhost:4000' } });
        fireEvent.submit(address.form!);
        expect(address.value).toBe('http://localhost:4000/');
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('normalizes manual address entry without history and keeps invalid text editable', async () => {
        const onNavigate = vi.fn();
        render(<UnifiedBrowserTab tabId="blank" viewId="blank-view" sessionKey="workspace-a" active visible
            onNavigate={onNavigate} onPageState={vi.fn()} />);
        const address = screen.getByLabelText('Address') as HTMLInputElement;
        await userEvent.keyboard('localhost:4000/path{Enter}');
        expect(onNavigate).toHaveBeenCalledWith('blank', 'http://localhost:4000/path');
        expect(address.value).toBe('http://localhost:4000/path');
        await userEvent.clear(address);
        await userEvent.type(address, 'javascript:alert(1){Enter}');
        expect(screen.getByRole('alert')).toHaveTextContent('not supported');
        expect(address.value).toBe('javascript:alert(1)');
        expect(onNavigate).toHaveBeenCalledTimes(1);
    });

    it.each(['electron', 'webview2'])('selects the complete editable URL on a matching %s request and replaces it on typing/Enter', async engine => {
        const listeners = new Set<(event: { viewId: string }) => void>();
        mocks.bridge!.onFocusAddressRequested = callback => { listeners.add(callback); return () => { listeners.delete(callback); }; };
        open.mockResolvedValue({ ok: true, engine });
        const onNavigate = vi.fn();
        const props = { tabId: 'tab', viewId: 'view', sessionKey: 'workspace-a', url: 'https://example.test/long/path?q=value#fragment', active: true, visible: true, onNavigate, onPageState: vi.fn() };
        const rendered = render(<UnifiedBrowserTab {...props} />);
        await waitFor(() => expect(screen.getByLabelText('Reload')).not.toBeDisabled());
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
        await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
        act(() => listeners.forEach(fn => fn({ viewId: 'view' })));
        expect(screen.queryByRole('menu')).toBeNull();
        expect(address).toHaveFocus();
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
        await waitFor(() => expect(screen.getByLabelText('Reload')).not.toBeDisabled());
        const address = screen.getByLabelText('Address') as HTMLInputElement;
        const button = screen.getByRole('button', { name: 'Browser options' });
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
        await userEvent.click(button);
        const action = screen.getByRole('menuitem');
        expect(action).toHaveFocus();
        expect(fireEvent.keyDown(action, chord)).toBe(false);
        expect(screen.queryByRole('menu')).toBeNull();
        expect(address).toHaveFocus();
        expect(address.selectionEnd).toBe(address.value.length);
        platformSpy.mockRestore();
    });

    it('labels the actual engine returned by the host and hides rather than closes on unmount', async () => {
        open.mockResolvedValue({ ok: true, engine: 'webview2' });
        const view = tab();
        await waitFor(() => expect(screen.getByLabelText('Reload')).not.toBeDisabled());
        fireEvent.click(screen.getByRole('button', { name: 'Browser options' }));
        expect(screen.getByTestId('browser-engine')).toHaveTextContent('WebView2');
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
        await waitFor(() => expect(screen.getByLabelText('Reload')).not.toBeDisabled());
        fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'javascript:alert(1)' } });
        fireEvent.submit(screen.getByLabelText('Address').closest('form')!);
        expect(screen.getByRole('alert').textContent).toContain('not supported');
        expect(mocks.bridge?.navigate).not.toHaveBeenCalled();
    });
});


describe('browser toolbar overflow', () => {
    it.each(['electron', 'webview2'] as const)('keeps %s information and the live external action in the menu above the native view', async engine => {
        open.mockResolvedValue({ ok: true, engine });
        Object.assign(window, { cocDesktop: { browser: mocks.bridge } });
        tab();
        await waitFor(() => expect(screen.getByLabelText('Reload')).not.toBeDisabled());
        expect(screen.queryByTestId('browser-engine')).toBeNull();
        expect(screen.queryByTestId('browser-open-external')).toBeNull();
        const trigger = screen.getByRole('button', { name: 'Browser options' });
        await userEvent.click(trigger);
        const menu = screen.getByRole('menu', { name: 'Browser options' });
        expect(screen.getByLabelText('Address').closest('form')).not.toContainElement(menu);
        expect(menu.parentElement).toBe(document.body);
        expect(menu).toHaveAttribute('data-native-view-overlay');
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(trigger).toHaveAttribute('aria-controls', menu.id);
        expect(screen.getByTestId('browser-engine')).toHaveTextContent(engine === 'electron' ? 'Electron' : 'WebView2');
        expect(mocks.bridge!.setDefaultEngine).not.toHaveBeenCalled();
        expect(vi.mocked(useNativeViewPlacement).mock.calls.at(-1)?.[1]).toBe(true);
        const listener = vi.mocked(mocks.bridge!.onState).mock.calls[0][0];
        act(() => listener({ viewId: 'view', engine, url: 'https://redirect.test/', title: 'Redirect', loading: false, canGoBack: true, canGoForward: false }));
        await userEvent.click(screen.getByRole('menuitem', { name: 'Open in system browser' }));
        expect(mocks.bridge!.openExternal).toHaveBeenCalledWith('https://redirect.test/');
        expect(screen.queryByRole('menu')).toBeNull();
        expect(trigger).toHaveFocus();
        expect(vi.mocked(useNativeViewPlacement).mock.calls.at(-1)?.[1]).toBe(true);
        await userEvent.click(screen.getByLabelText('Back'));
        expect(mocks.bridge!.nav).toHaveBeenCalledWith('view', 'back');
        await userEvent.click(screen.getByLabelText('Reload'));
        expect(mocks.bridge!.nav).toHaveBeenCalledWith('view', 'reload');
    });

    it('supports keyboard opening, action focus, Escape, Tab and outside-click dismissal', async () => {
        tab();
        await waitFor(() => expect(screen.getByLabelText('Reload')).not.toBeDisabled());
        const trigger = screen.getByRole('button', { name: 'Browser options' });
        trigger.focus();
        await userEvent.keyboard('{ArrowDown}');
        expect(screen.getByRole('menuitem')).toHaveFocus();
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('menu')).toBeNull();
        expect(trigger).toHaveFocus();
        await userEvent.keyboard('{Enter}');
        expect(screen.getByRole('menuitem')).toHaveFocus();
        await userEvent.tab();
        expect(screen.queryByRole('menu')).toBeNull();
        await userEvent.click(trigger);
        await userEvent.click(screen.getByLabelText('Address'));
        expect(screen.queryByRole('menu')).toBeNull();
        expect(screen.getByLabelText('Address')).toHaveFocus();
    });

    it('keeps blank-tab actions disabled and removes the menu when ownership or visibility changes', async () => {
        const props = { tabId: 'blank', viewId: 'blank-view', sessionKey: 'workspace-a', active: true, visible: true, onNavigate: vi.fn(), onPageState: vi.fn() };
        const view = render(<UnifiedBrowserTab {...props} />);
        const trigger = screen.getByRole('button', { name: 'Browser options' });
        await userEvent.click(trigger);
        expect(screen.getByRole('menuitem')).toBeDisabled();
        expect(screen.getByRole('menu')).toHaveFocus();
        expect(screen.queryByTestId('browser-engine')).toBeNull();
        expect(open).not.toHaveBeenCalled();
        view.rerender(<UnifiedBrowserTab {...props} active={false} />);
        expect(screen.queryByRole('menu')).toBeNull();
        view.rerender(<UnifiedBrowserTab {...props} />);
        expect(screen.queryByRole('menu')).toBeNull();
        await userEvent.click(trigger);
        view.rerender(<UnifiedBrowserTab {...props} visible={false} />);
        expect(screen.queryByRole('menu')).toBeNull();
        view.rerender(<UnifiedBrowserTab {...props} />);
        await userEvent.click(trigger);
        view.rerender(<UnifiedBrowserTab {...props} sessionKey="workspace-b" viewId="other-window-view" />);
        expect(screen.queryByRole('menu')).toBeNull();
    });
    it.each(['older-host', 'web'] as const)('omits history controls on %s', async host => {
        if (host === 'web') mocks.bridge = undefined;
        tab();
        await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
        expect(screen.queryByRole('menuitem', { name: 'History' })).toBeNull();
    });

    it('moves keyboard focus between History and the system-browser action', async () => {
        mocks.bridge!.history = {
            query: vi.fn(async () => ({ ok: true, entries: [], total: 0, recording: true, storageError: null })),
            suggest: vi.fn(async () => ({ ok: true, entries: [], total: 0, recording: true, storageError: null })),
            delete: vi.fn(), clear: vi.fn(), setRecording: vi.fn(), onChanged: vi.fn(() => vi.fn()),
        };
        tab({ onOpenHistoryUrl: vi.fn() });
        await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
        const history = screen.getByRole('menuitem', { name: 'History' });
        const external = screen.getByRole('menuitem', { name: 'Open in system browser' });
        expect(history).toHaveFocus();
        await userEvent.keyboard('{ArrowDown}');
        expect(external).toHaveFocus();
        await userEvent.keyboard('{ArrowDown}');
        expect(history).toHaveFocus();
        await userEvent.keyboard('{End}');
        expect(external).toHaveFocus();
        await userEvent.keyboard('{Home}');
        expect(history).toHaveFocus();
    });

    it('offers history on a blank tab and navigates menu actions by keyboard', async () => {
        mocks.bridge!.history = {
            query: vi.fn(async () => ({ ok: true, entries: [], total: 0, recording: true, storageError: null })),
            suggest: vi.fn(async () => ({ ok: true, entries: [], total: 0, recording: true, storageError: null })), delete: vi.fn(), clear: vi.fn(), setRecording: vi.fn(), onChanged: vi.fn(() => vi.fn()),
        };
        const props = { tabId: 'blank', viewId: 'blank-view', sessionKey: 'workspace-a', active: true, visible: true, onNavigate: vi.fn(), onPageState: vi.fn(), onOpenHistoryUrl: vi.fn(), historyOwnerKey: 'owner-a' };
        const view = render(<UnifiedBrowserTab {...props} />);
        await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
        const historyAction = screen.getByRole('menuitem', { name: 'History' });
        expect(historyAction).toHaveFocus();
        await userEvent.keyboard('{ArrowDown}{End}{Home}{Enter}');
        await screen.findByRole('dialog');
        expect(screen.queryByRole('menu')).toBeNull();
        await screen.findByText('No browser history yet.');
        expect(open).not.toHaveBeenCalled();
        view.rerender(<UnifiedBrowserTab {...props} historyOwnerKey="owner-b" />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it.each([{ active: false }, { visible: false }, { sessionKey: 'workspace-b' }, { viewId: 'another-view' }])('dismisses history and rejects pending replies after a scope/visibility change %o', async patch => {
        let resolve!: (value: BrowserHistoryResult) => void;
        const off = vi.fn();
        mocks.bridge!.history = {
            query: vi.fn(() => new Promise(r => { resolve = r; })), suggest: vi.fn(async () => ({ ok: true, entries: [], total: 0, recording: true, storageError: null })), delete: vi.fn(), clear: vi.fn(),
            setRecording: vi.fn(), onChanged: vi.fn(() => off),
        };
        const props = { tabId: 'blank', viewId: 'blank-view', sessionKey: 'workspace-a', active: true, visible: true, onNavigate: vi.fn(), onPageState: vi.fn(), onOpenHistoryUrl: vi.fn() };
        const view = render(<UnifiedBrowserTab {...props} />);
        await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
        await userEvent.click(screen.getByRole('menuitem', { name: 'History' }));
        view.rerender(<UnifiedBrowserTab {...props} {...patch} />);
        expect(screen.queryByRole('dialog')).toBeNull();
        await act(async () => resolve({ ok: true, entries: [{ title: 'Late entry', url: 'https://late.test/', lastVisited: 1, visitCount: 1 }], total: 1, recording: true, storageError: null }));
        expect(screen.queryByText('Late entry')).toBeNull();
        expect(props.onOpenHistoryUrl).not.toHaveBeenCalled();
        expect(off).toHaveBeenCalled();
    });

});

describe('browser cookie import', () => {
    it.each(['electron', 'webview2'])('imports for an editable original domain while on the %s login page', async engine => {
        open.mockResolvedValue({ ok: true, engine });
        mocks.bridge!.importCookies = vi.fn(async () => ({ ok: true }));
        render(<UnifiedBrowserTab tabId="tab" viewId="view" sessionKey="remote-workspace" url="https://login.example.com/oauth" active visible onNavigate={vi.fn()} onPageState={vi.fn()} />);
        await waitFor(() => expect(screen.getByLabelText('Reload')).not.toBeDisabled());
        await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
        await userEvent.click(screen.getByRole('menuitem', { name: 'Import cookies…' }));
        expect(screen.getByLabelText('Domain')).toHaveValue('login.example.com');
        expect(screen.getByLabelText('Domain')).toHaveFocus();
        fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'app.example.com' } });
        fireEvent.change(screen.getByLabelText('Cookies'), { target: { value: 'session=token' } });
        await userEvent.click(screen.getByRole('button', { name: 'Import', exact: true }));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Cookies imported for app.example.com'));
        expect(mocks.bridge!.importCookies).toHaveBeenCalledWith('view', 'app.example.com', 'session=token');
        expect(mocks.bridge!.navigate).not.toHaveBeenCalled();
        expect(screen.queryByLabelText('Cookies')).toBeNull();
    });
    it('keeps the dialog open on failure and prevents closing or duplicate imports while pending', async () => {
        let finish!: (reply: { ok: false; reason: string; message: string }) => void;
        mocks.bridge!.importCookies = vi.fn(() => new Promise(resolve => { finish = resolve; }));
        tab();
        await waitFor(() => expect(screen.getByLabelText('Reload')).not.toBeDisabled());
        await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
        await userEvent.click(screen.getByRole('menuitem', { name: 'Import cookies…' }));
        fireEvent.change(screen.getByLabelText('Cookies'), { target: { value: 'a=b' } });
        await userEvent.click(screen.getByRole('button', { name: 'Import', exact: true }));
        expect(screen.getByRole('button', { name: 'Importing…' })).toBeDisabled();
        await userEvent.keyboard('{Escape}');
        expect(screen.getByLabelText('Cookies')).toBeInTheDocument();
        act(() => finish({ ok: false, reason: 'invalid', message: 'Invalid cookies.' }));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid cookies.'));
        expect(screen.getByLabelText('Cookies')).toHaveValue('a=b');
        expect(mocks.bridge!.importCookies).toHaveBeenCalledOnce();
    });
    it('hides import for desktops without the cookie API', async () => {
        tab();
        await waitFor(() => expect(screen.getByLabelText('Reload')).not.toBeDisabled());
        await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
        expect(screen.queryByRole('menuitem', { name: 'Import cookies…' })).toBeNull();
    });
});

it.each([undefined, 'webview2'] as const)('imports from a blank tab with related engine %s before opening any page', async relatedEngine => {
    mocks.bridge!.importCookies = vi.fn(async () => ({ ok: true }));
    render(<UnifiedBrowserTab tabId="tab" viewId="blank" sessionKey="workspace" relatedEngine={relatedEngine} active visible onNavigate={vi.fn()} onPageState={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
    expect(screen.getByRole('menuitem', { name: 'Import cookies…' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByLabelText('Domain')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'app.example.com' } });
    fireEvent.change(screen.getByLabelText('Cookies'), { target: { value: 'a=b' } });
    await userEvent.click(screen.getByRole('button', { name: 'Import', exact: true }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Cookies imported for app.example.com'));
    expect(mocks.bridge!.importCookies).toHaveBeenCalledWith(null, 'app.example.com', 'a=b', relatedEngine);
    expect(open).not.toHaveBeenCalled();
    expect(mocks.bridge!.navigate).not.toHaveBeenCalled();
});
