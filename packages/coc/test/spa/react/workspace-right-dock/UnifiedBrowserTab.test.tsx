// @vitest-environment jsdom
import userEvent from '@testing-library/user-event';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnifiedBrowserTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedBrowserTab';
import { useNativeViewPlacement } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/useNativeViewPlacement';
import type { BrowserDemoState, BrowserHistoryResult, DesktopBrowserBridge } from '../../../../src/server/spa/client/react/shared/file-path/browser-bridge';
import { resetBrowserDemosForTest } from '../../../../src/server/spa/client/react/shared/file-path/browser-demo';

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
    it.each(['electron', 'webview2'] as const)('uses only committed %s URL/title pairs, rejecting loading, file and previous-tab state', async engine => {
        tab();
        await waitFor(() => expect(screen.getByLabelText('Reload')).not.toBeDisabled());
        const state = { viewId: 'view', engine, sourceKind: 'url' as const, url: 'https://example.test/', title: 'Untrusted snapshot title',
            committedPage: { url: 'https://example.test/', title: 'Committed fixture title', revision: 1 },
            loading: false, canGoBack: false, canGoForward: false };
        const emit = vi.mocked(mocks.bridge!.onState).mock.calls[0][0];
        const input = screen.getByLabelText('Address') as HTMLInputElement;
        const copy = () => {
            input.select();
            const event = new Event('copy', { bubbles: true, cancelable: true });
            const setData = vi.fn();
            Object.defineProperty(event, 'clipboardData', { value: { setData } });
            fireEvent(input, event);
            return setData;
        };
        expect(copy()).not.toHaveBeenCalled();
        act(() => emit({ ...state, viewId: 'foreign' }));
        expect(copy()).not.toHaveBeenCalled();
        act(() => emit(state));
        expect(copy()).toHaveBeenCalledWith('text/html', '<a href="https://example.test/">Committed fixture title</a>');
        for (const patch of [{ loading: true }, { sourceKind: 'file' as const }, { error: 'Fixture failure' },
            { url: 'https://next.test/' }, { committedPage: undefined }]) {
            act(() => emit({ ...state, ...patch }));
            expect(copy()).not.toHaveBeenCalled();
        }
        act(() => emit(state));
        fireEvent.change(input, { target: { value: 'https://example.test/' + 'draft' } });
        fireEvent.submit(input.form!);
        expect(copy()).not.toHaveBeenCalled();
    });

    it.each(['electron', 'webview2'] as const)('keeps blank %s addresses private while explicit History remains available', async engine => {
        open.mockResolvedValue({ ok: true, engine });
        const target = 'https://example.test/Case';
        const history = {
            suggest: vi.fn(async (_search: string) => ({ ok: true as const, entries: [{ url: target, title: 'Fixture page',
                lastVisited: 1, visitCount: 1, completion: 'example.test/Case' }],
                total: 1, recording: true, storageError: null })),
            query: vi.fn(async () => ({ ok: true as const, entries: [{ url: target, title: 'Fixture page',
                lastVisited: 1, visitCount: 1 }], total: 1, recording: true, storageError: null })),
            delete: vi.fn(), clear: vi.fn(), setRecording: vi.fn(), onChanged: vi.fn(() => vi.fn()),
        };
        mocks.bridge!.history = history;
        tab({ relatedEngine: engine, onOpenHistoryUrl: vi.fn() });
        const address = screen.getByLabelText('Address') as HTMLInputElement;
        await userEvent.click(address);
        await screen.findByRole('listbox');
        await userEvent.clear(address);
        fireEvent.keyDown(address, { key: 'l', ctrlKey: true, metaKey: true });
        await userEvent.keyboard('{ArrowDown}{ArrowUp}');
        expect(address.value).toBe('');
        expect(address).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(history.suggest.mock.calls.every(([search]) => Boolean(search.trim()))).toBe(true);
        await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
        await userEvent.click(screen.getByRole('menuitem', { name: 'History' }));
        await screen.findByRole('dialog');
        await screen.findByText('Fixture page');
        expect(history.query).toHaveBeenCalledWith('', 0, 50);
        expect(history.delete).not.toHaveBeenCalled();
        expect(history.clear).not.toHaveBeenCalled();
    });

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
        const action = screen.getByRole('menuitem', { name: 'Open in system browser' });
        const downloads = screen.getByRole('menuitem', { name: 'Downloads' });
        expect(downloads).toHaveFocus();
        expect(fireEvent.keyDown(downloads, chord)).toBe(false);
        expect(screen.queryByRole('menu')).toBeNull();
        expect(address).toHaveFocus();
        expect(address.selectionEnd).toBe(address.value.length);
        platformSpy.mockRestore();
    });

    it.each(['Win32', 'MacIntel'])('reloads only from its own focused toolbar on %s, never from outside or portaled overlays', async platform => {
        const platformSpy = vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
        const outside = document.body.appendChild(document.createElement('textarea'));
        const view = tab();
        await waitFor(() => expect(screen.getByLabelText('Reload')).not.toBeDisabled());
        const nav = vi.mocked(mocks.bridge!.nav);
        const address = screen.getByLabelText('Address') as HTMLInputElement;
        const button = screen.getByRole('button', { name: 'Browser options' });
        const chord = { key: 'r', ctrlKey: platform === 'Win32', metaKey: platform === 'MacIntel' };
        // Focus outside the browser (chat composer, editor, terminal) keeps the key.
        outside.focus();
        expect(fireEvent.keyDown(outside, chord)).toBe(true);
        expect(fireEvent.keyDown(document.body, chord)).toBe(true);
        expect(nav).not.toHaveBeenCalled();
        // Focus in: the address bar and toolbar buttons reload this view once.
        expect(fireEvent.keyDown(address, { ...chord, key: 'R' })).toBe(false);
        expect(nav).toHaveBeenCalledExactlyOnceWith('view', 'reload');
        expect(fireEvent.keyDown(address, { ...chord, repeat: true })).toBe(false);
        expect(fireEvent.keyDown(button, chord)).toBe(false);
        expect(nav).toHaveBeenCalledTimes(2);
        for (const patch of [{ shiftKey: true }, { altKey: true }, { ctrlKey: platform !== 'Win32', metaKey: platform !== 'MacIntel' }]) {
            expect(fireEvent.keyDown(address, { ...chord, ...patch })).toBe(true);
        }
        // Portaled overlays bubble through React but do not own the page.
        await userEvent.click(button);
        expect(fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Downloads' }), chord)).toBe(true);
        expect(nav).toHaveBeenCalledTimes(2);
        // Focus out after a reload, and an inactive tab, never reload.
        outside.focus();
        expect(fireEvent.keyDown(outside, chord)).toBe(true);
        view.rerender(<UnifiedBrowserTab tabId="tab" viewId="view" sessionKey="remote-workspace" url="https://example.test/" active={false} visible onNavigate={vi.fn()} onPageState={vi.fn()} />);
        expect(fireEvent.keyDown(address, chord)).toBe(true);
        expect(nav).toHaveBeenCalledTimes(2);
        outside.remove();
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


describe('browser toolbar navigation capsule', () => {
    it('groups back/forward/reload in one capsule with a separator before reload and swaps Stop while loading', async () => {
        tab();
        await waitFor(() => expect(screen.getByLabelText('Reload')).not.toBeDisabled());
        const capsule = screen.getByRole('group', { name: 'Page navigation' });
        expect(capsule).toHaveClass('rounded-full');
        const children = Array.from(capsule.children);
        expect(children.map(child => child.getAttribute('data-testid')))
            .toEqual(['browser-back', 'browser-forward', 'browser-nav-separator', 'browser-reload']);
        expect(screen.getByTestId('browser-nav-separator')).toHaveAttribute('aria-hidden', 'true');
        for (const name of ['Back', 'Forward', 'Reload']) {
            const button = screen.getByRole('button', { name });
            expect(button).toHaveAttribute('title', name);
            expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
            expect(button.textContent).toBe('');
        }
        expect(screen.getByLabelText('Back')).toBeDisabled();
        expect(screen.getByLabelText('Forward')).toBeDisabled();
        const emit = vi.mocked(mocks.bridge!.onState).mock.calls[0][0];
        act(() => emit({ viewId: 'view', engine: 'electron', url: 'https://example.test/', title: '', loading: true, canGoBack: true, canGoForward: false }));
        expect(screen.getByLabelText('Back')).not.toBeDisabled();
        expect(screen.getByLabelText('Forward')).toBeDisabled();
        expect(screen.queryByLabelText('Reload')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
        expect(mocks.bridge!.nav).toHaveBeenCalledWith('view', 'stop');
        expect(capsule.lastElementChild).toBe(screen.getByTestId('browser-stop'));
    });

    it('renders the address as an editable pill on a quiet toolbar with the round options button', async () => {
        tab();
        await waitFor(() => expect(screen.getByLabelText('Reload')).not.toBeDisabled());
        const address = screen.getByLabelText('Address') as HTMLInputElement;
        expect(address.form).toBe(screen.getByTestId('browser-address-pill'));
        expect(address.form).toHaveClass('rounded-full', 'flex-1', 'min-w-0');
        expect(address).toHaveClass('flex-1', 'min-w-0');
        expect(address.readOnly).toBe(false);
        expect(address.value).toBe('https://example.test/');
        expect(screen.getByTestId('browser-toolbar')).toHaveClass('flex-wrap', 'bg-[#f8f8f8]', 'dark:bg-[#252526]');
        const options = screen.getByRole('button', { name: 'Browser options' });
        expect(options).toHaveClass('rounded-full');
        expect(options.querySelector('svg')).not.toBeNull();
    });
});

describe('browser site information', () => {
    const committed = { viewId: 'view', engine: 'electron' as const, sourceKind: 'url' as const, url: 'https://example.test/', title: 'Example',
        committedPage: { url: 'https://example.test/', title: 'Example', revision: 1 }, loading: false, canGoBack: false, canGoForward: false };

    it('asks main about the owned view, never the address draft, and closes when the document changes', async () => {
        const siteInfo = vi.fn(async () => ({ ok: true as const, info: { viewId: 'view', engine: 'electron' as const, sourceKind: 'url' as const,
            url: 'https://example.test/', host: 'example.test', connection: 'secure' as const, cookies: { available: true as const, count: 1 }, revision: 1 } }));
        mocks.bridge!.siteInfo = siteInfo;
        tab();
        await waitFor(() => expect(screen.getByLabelText('Reload')).not.toBeDisabled());
        const emit = vi.mocked(mocks.bridge!.onState).mock.calls[0][0];
        act(() => emit(committed));
        const address = screen.getByLabelText('Address') as HTMLInputElement;
        const pill = screen.getByTestId('browser-address-pill');
        expect(pill.firstElementChild).toBe(screen.getByRole('button', { name: 'View site information' }));
        fireEvent.change(address, { target: { value: 'https://draft.test/' } });
        fireEvent.click(screen.getByRole('button', { name: 'View site information' }));
        expect(await screen.findByRole('dialog', { name: 'example.test' })).toHaveTextContent('1 cookie is sent to this page.');
        expect(siteInfo).toHaveBeenCalledExactlyOnceWith('view', 'remote-workspace');
        expect(screen.getByRole('dialog')).not.toHaveTextContent('draft.test');
        act(() => emit({ ...committed, title: 'Renamed', committedPage: { ...committed.committedPage, title: 'Renamed' } }));
        expect(screen.getByRole('dialog')).toBeTruthy();
        act(() => emit({ ...committed, url: 'https://next.test/', committedPage: undefined, loading: true }));
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('closes when the owner changes and states why information is unavailable', async () => {
        mocks.bridge!.siteInfo = vi.fn(async () => ({ ok: true as const, info: { viewId: 'view', engine: 'electron' as const, sourceKind: 'url' as const,
            url: 'https://example.test/', host: 'example.test', connection: 'secure' as const, cookies: { available: true as const, count: 0 } } }));
        const view = tab();
        await waitFor(() => expect(screen.getByLabelText('Reload')).not.toBeDisabled());
        fireEvent.click(screen.getByRole('button', { name: 'View site information' }));
        await screen.findByRole('dialog', { name: 'example.test' });
        view.rerender(<UnifiedBrowserTab tabId="tab" viewId="view" sessionKey="other-owner" url="https://example.test/" active visible onNavigate={vi.fn()} onPageState={vi.fn()} />);
        expect(screen.queryByRole('dialog')).toBeNull();
        cleanup();

        delete mocks.bridge!.siteInfo;
        tab();
        await waitFor(() => expect(screen.getByLabelText('Reload')).not.toBeDisabled());
        fireEvent.click(screen.getByRole('button', { name: 'View site information' }));
        expect(screen.getByTestId('site-info-unavailable')).toHaveTextContent('This desktop version cannot report site information.');
        cleanup();

        mocks.bridge = undefined;
        tab();
        fireEvent.click(screen.getByRole('button', { name: 'View site information' }));
        expect(screen.getByTestId('site-info-unavailable')).toHaveTextContent('CoC desktop app');
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
        expect(screen.getByRole('menuitem', { name: 'Downloads' })).toHaveFocus();
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('menu')).toBeNull();
        expect(trigger).toHaveFocus();
        await userEvent.keyboard('{Enter}');
        expect(screen.getByRole('menuitem', { name: 'Downloads' })).toHaveFocus();
        await userEvent.keyboard('{End}');
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
        expect(screen.getByRole('menuitem', { name: 'Open in system browser' })).toBeDisabled();
        expect(screen.getByRole('menuitem', { name: 'Downloads' })).toHaveFocus();
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

    it('moves keyboard focus between History, Downloads and the system-browser action', async () => {
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
        expect(screen.getByRole('menuitem', { name: 'Downloads' })).toHaveFocus();
        await userEvent.keyboard('{ArrowDown}');
        expect(external).toHaveFocus();
        await userEvent.keyboard('{ArrowDown}');
        expect(history).toHaveFocus();
        await userEvent.keyboard('{End}');
        expect(external).toHaveFocus();
        await userEvent.keyboard('{Home}');
        expect(history).toHaveFocus();
    });

    it('keeps History and cookie import accessible together and dismisses both on owner changes', async () => {
        mocks.bridge!.importCookies = vi.fn(async () => ({ ok: true }));
        mocks.bridge!.history = {
            query: vi.fn(async () => ({ ok: true, entries: [], total: 0, recording: true, storageError: null })),
            suggest: vi.fn(async () => ({ ok: true, entries: [], total: 0, recording: true, storageError: null })),
            delete: vi.fn(), clear: vi.fn(), setRecording: vi.fn(), onChanged: vi.fn(() => vi.fn()),
        };
        const props = { onOpenHistoryUrl: vi.fn(), historyOwnerKey: 'owner-a' };
        const view = tab(props);
        await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
        expect(screen.getByRole('menuitem', { name: 'History' })).toHaveFocus();
        await userEvent.keyboard('{End}');
        expect(screen.getByRole('menuitem', { name: 'Import cookies…' })).toHaveFocus();
        await userEvent.keyboard('{Enter}');
        expect(screen.getByLabelText('Cookies')).toBeInTheDocument();
        const renderTab = (historyOwnerKey: string) => <UnifiedBrowserTab tabId="tab" viewId="view" sessionKey="remote-workspace"
            url="https://example.test/" active visible onNavigate={vi.fn()} onPageState={vi.fn()} {...props} historyOwnerKey={historyOwnerKey} />;
        view.rerender(renderTab('owner-b'));
        expect(screen.queryByRole('dialog')).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
        await userEvent.click(screen.getByRole('menuitem', { name: 'History' }));
        await screen.findByText('No browser history yet.');
        view.rerender(renderTab('owner-c'));
        expect(screen.queryByRole('dialog')).toBeNull();
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

describe('shared desktop web page zoom controls', () => {
    function zoomBridge(engine: 'electron' | 'webview2' = 'electron') {
        let percent = 100;
        const listeners = new Set<() => void>();
        mocks.bridge!.getPreferences = vi.fn(async () => ({
            defaultEngine: engine, engines: [{ engine, available: true }], clearing: [],
            pageZoom: { percent, min: 50, max: 200, step: 25 },
        }));
        mocks.bridge!.onPreferencesChanged = callback => { listeners.add(callback); return () => { listeners.delete(callback); }; };
        mocks.bridge!.setPageZoom = vi.fn(async value => { percent = value; listeners.forEach(fn => fn()); return { ok: true }; });
        return { notify: (value: number) => { percent = value; act(() => listeners.forEach(fn => fn())); }, listeners };
    }

    it.each(['electron', 'webview2'] as const)('steps and resets all pages via the %s bridge, retaining the menu', async engine => {
        zoomBridge(engine);
        open.mockResolvedValue({ ok: true, engine });
        tab();
        await waitFor(() => expect(screen.getByLabelText('Reload')).not.toBeDisabled());
        await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
        await waitFor(() => expect(screen.getByTestId('browser-page-zoom-percent')).toHaveTextContent('100%'));
        expect(screen.getByRole('group', { name: 'Web page zoom' })).toHaveTextContent('all pages');
        await userEvent.click(screen.getByRole('menuitem', { name: 'Zoom in all web pages' }));
        await waitFor(() => expect(screen.getByTestId('browser-page-zoom-percent')).toHaveTextContent('125%'));
        expect(mocks.bridge!.setPageZoom).toHaveBeenCalledWith(125);
        expect(screen.getByRole('menu')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('menuitem', { name: 'Zoom out all web pages' }));
        await waitFor(() => expect(screen.getByTestId('browser-page-zoom-percent')).toHaveTextContent('100%'));
        await userEvent.click(screen.getByRole('menuitem', { name: 'Zoom out all web pages' }));
        await waitFor(() => expect(screen.getByTestId('browser-page-zoom-percent')).toHaveTextContent('75%'));
        await userEvent.click(screen.getByRole('menuitem', { name: 'Reset all web pages to 100%' }));
        await waitFor(() => expect(screen.getByTestId('browser-page-zoom-percent')).toHaveTextContent('100%'));
        expect(screen.getByRole('menuitem', { name: 'Reset all web pages to 100%' })).toBeDisabled();
        expect(mocks.bridge!.navigate).not.toHaveBeenCalled();
        expect(mocks.bridge!.setDefaultEngine).not.toHaveBeenCalled();
        expect(mocks.bridge!.openExternal).not.toHaveBeenCalled();
    });

    it('refreshes shared window changes, enforces bounds and unsubscribes on workspace switch', async () => {
        const h = zoomBridge();
        const props = { tabId: 'tab', viewId: 'view', sessionKey: 'workspace-a', url: 'https://example.test/', active: true, visible: true, onNavigate: vi.fn(), onPageState: vi.fn() };
        const view = render(<UnifiedBrowserTab {...props} />);
        await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
        h.notify(200);
        await waitFor(() => expect(screen.getByTestId('browser-page-zoom-percent')).toHaveTextContent('200%'));
        expect(screen.getByRole('menuitem', { name: 'Zoom in all web pages' })).toBeDisabled();
        h.notify(50);
        await waitFor(() => expect(screen.getByTestId('browser-page-zoom-percent')).toHaveTextContent('50%'));
        expect(screen.getByRole('menuitem', { name: 'Zoom out all web pages' })).toBeDisabled();
        view.rerender(<UnifiedBrowserTab {...props} viewId="other" sessionKey="workspace-b" />);
        expect(h.listeners.size).toBe(0);
        await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
        await waitFor(() => expect(screen.getByTestId('browser-page-zoom-percent')).toHaveTextContent('50%'));
    });

    it('shows disabled unavailable controls without a supported desktop bridge', async () => {
        tab();
        await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
        expect(screen.getByTestId('browser-page-zoom-percent')).toHaveTextContent('Unavailable');
        for (const name of ['Zoom in all web pages', 'Zoom out all web pages', 'Reset all web pages to 100%']) {
            expect(screen.getByRole('menuitem', { name })).toBeDisabled();
        }
        expect(mocks.bridge!.getPreferences).not.toHaveBeenCalled();
    });

    it('shows explicit engine failures and disables an unsupported bridge rather than reporting success', async () => {
        zoomBridge();
        mocks.bridge!.setPageZoom = vi.fn(async () => ({ ok: false, reason: 'unsupported', message: 'Web page zoom unavailable in this engine.' }));
        tab();
        await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
        await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Zoom in all web pages' })).not.toBeDisabled());
        await userEvent.click(screen.getByRole('menuitem', { name: 'Zoom in all web pages' }));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Web page zoom unavailable'));
        expect(screen.getByTestId('browser-page-zoom-percent')).toHaveTextContent('Unavailable');
        expect(screen.getByRole('menuitem', { name: 'Zoom in all web pages' })).toBeDisabled();
    });

    it('disables unavailable engines and reports preference read errors', async () => {
        zoomBridge();
        mocks.bridge!.getPreferences = vi.fn(async () => ({
            defaultEngine: 'electron', engines: [{ engine: 'electron', available: false }], clearing: [],
            pageZoom: { percent: 100, min: 50, max: 200, step: 25 },
        }));
        tab();
        const trigger = screen.getByRole('button', { name: 'Browser options' });
        await userEvent.click(trigger);
        expect(screen.getByRole('menuitem', { name: 'Zoom in all web pages' })).toBeDisabled();
        expect(screen.getByTestId('browser-page-zoom-percent')).toHaveTextContent('Unavailable');
        expect(mocks.bridge!.setPageZoom).not.toHaveBeenCalled();
        await userEvent.click(trigger);
        vi.mocked(mocks.bridge!.getPreferences).mockRejectedValueOnce(new Error('Preferences unavailable'));
        await userEvent.click(trigger);
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Preferences unavailable'));
    });

    it('prevents duplicate changes while awaiting the engine and surfaces rejected operations', async () => {
        zoomBridge();
        let reject!: (error: Error) => void;
        mocks.bridge!.setPageZoom = vi.fn(() => new Promise((_resolve, fail) => { reject = fail; }));
        tab();
        await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
        const plus = screen.getByRole('menuitem', { name: 'Zoom in all web pages' });
        await waitFor(() => expect(plus).not.toBeDisabled());
        fireEvent.click(plus);
        fireEvent.click(plus);
        expect(plus).toBeDisabled();
        expect(mocks.bridge!.setPageZoom).toHaveBeenCalledOnce();
        act(() => reject(new Error('Engine disconnected')));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Engine disconnected'));
        expect(screen.getByTestId('browser-page-zoom-percent')).toHaveTextContent('100%');
        expect(plus).not.toBeDisabled();
    });

    it('ignores an older preference read failure after a newer window broadcast succeeds', async () => {
        const h = zoomBridge();
        let reject!: (error: Error) => void;
        vi.mocked(mocks.bridge!.getPreferences).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
        tab();
        await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
        h.notify(150);
        await waitFor(() => expect(screen.getByTestId('browser-page-zoom-percent')).toHaveTextContent('150%'));
        await act(async () => { reject(new Error('Stale read failed')); });
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByTestId('browser-page-zoom-percent')).toHaveTextContent('150%');
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
        expect(screen.getByText(/Name=value pairs persist for 30 days across CoC restarts; JSON controls expiry, including session cookies\./)).toBeInTheDocument();
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
    expect(screen.getByRole('menuitem', { name: 'Downloads' })).toHaveFocus();
    await userEvent.keyboard('{End}');
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

it.each([{ active: false }, { visible: false }, { sessionKey: 'workspace-b' }, { historyOwnerKey: 'clone-b' }])('dismisses Downloads on ownership/visibility change %o and ignores late replies', async patch => {
    let resolve!: (reply: any) => void;
    const off = vi.fn();
    mocks.bridge!.downloads = { query: vi.fn(() => new Promise(r => { resolve = r; })), action: vi.fn(), onChanged: vi.fn(() => off) };
    const view = tab();
    await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Downloads' }));
    expect(screen.getByRole('dialog', { name: 'Downloads' })).toBeInTheDocument();
    view.rerender(<UnifiedBrowserTab tabId="tab" viewId="view" sessionKey="remote-workspace" url="https://example.test/" active visible onNavigate={vi.fn()} onPageState={vi.fn()} {...patch} />);
    await act(async () => resolve({ ok: true, entries: [], storageError: null, engines: {} }));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(off).toHaveBeenCalledOnce();
});

it.each(['web', 'older-desktop'] as const)('offers Downloads with explicit %s unavailability', async kind => {
    if (kind === 'web') mocks.bridge = undefined;
    tab({ url: undefined });
    await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Downloads' }));
    expect(screen.getByRole('dialog', { name: 'Downloads' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(kind === 'web' ? 'available in the CoC desktop app' : 'This desktop version');
});

it('redacts old-host download request URLs and raw external-open errors from notices', async () => {
    tab();
    await waitFor(() => expect(mocks.bridge!.onDownload).toHaveBeenCalled());
    const listener = vi.mocked(mocks.bridge!.onDownload).mock.calls[0][0];
    const url = 'https://user:secret@files.test/download?auth=token#private';
    act(() => listener({ viewId: 'view', url, ok: true }));
    expect(screen.getByTestId('browser-notice')).toHaveTextContent('Manage it there.');
    expect(screen.getByTestId('browser-notice').textContent).not.toMatch(/secret|token|private/);
    act(() => listener({ viewId: 'view', url, ok: false, error: 'OS rejected ' + url }));
    expect(screen.getByTestId('browser-notice').textContent).not.toMatch(/secret|token|private/);
});

describe('browser demo review', () => {
    afterEach(() => resetBrowserDemosForTest());

    it('opens the review for the demo when Stop answers, in this tab only', async () => {
        const listeners: Array<(state: BrowserDemoState) => void> = [];
        const demoState: BrowserDemoState = { id: 'demo-1', owner: { workspaceId: 'w', processId: 'chat-1', routingRef: 'remote-workspace' },
            status: 'recording', stepCount: 1, tabCount: 1, viewIds: ['view'], incomplete: false };
        const command = vi.fn(async (request: { action: string }) => {
            if (request.action === 'list') return { ok: true, drafts: [demoState] };
            if (request.action === 'draft' || request.action === 'stop') {
                return { ok: true, draft: { ...demoState, startedAt: 1, status: 'stopped',
                    tabs: [{ viewId: 'view', index: 1, url: 'https://example.test/', title: 'Example' }],
                    steps: [{ id: 1, at: 1, viewId: 'view', type: 'action', action: { kind: 'click', role: 'button', label: 'Save', url: 'https://example.test/' } }] } };
            }
            return { ok: true };
        });
        mocks.bridge!.demo = { supported: true, command: command as never, onState: callback => { listeners.push(callback); return () => undefined; } };
        tab({ workspaceId: 'w', chatId: 'chat-1' });
        fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
        expect(await screen.findByTestId('browser-demo-review')).toBeTruthy();
        expect(await screen.findByText('Clicked button \'Save\'')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Close review' }));
        expect(screen.queryByTestId('browser-demo-review')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(await screen.findByTestId('browser-demo-review')).toBeTruthy();
    });
});
