// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserWebviewLayer } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/BrowserWebviewLayer';
import { NativeViewTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/NativeViewTab';
import {
    browserWebviewEntries, prepareBrowserWebview, removeBrowserWebview,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/browserWebviewLayerStore';
import { closeBrowserPanelView } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { UnifiedBrowserTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedBrowserTab';
import { UnifiedHtmlPageTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedHtmlPageTab';
import type { BrowserOpenResult, DesktopBrowserBridge } from '../../../../src/server/spa/client/react/shared/file-path/browser-bridge';

const result: BrowserOpenResult = { ok: true, engine: 'electron', embed: 'webview', src: 'https://example.test/', partition: 'persist:coc-browser' };
let bridge: DesktopBrowserBridge;
let left = 100;
const rect = () => ({ x: left, y: 80, left, top: 80, right: left + 400, bottom: 380, width: 400, height: 300, toJSON: () => ({}) });
const guest = () => document.querySelector('webview')!;
const host = () => guest().parentElement!;

function Placeholder({ viewId = 'view', shown = true }: { viewId?: string; shown?: boolean }) {
    return <NativeViewTab bridge={bridge} embed="webview" viewId={viewId} shown={shown} surfaceHidden={false} placeholderTestId="placeholder" toolbar={<div>Toolbar</div>} />;
}

function open(viewId = 'view') { prepareBrowserWebview(viewId)(result, bridge); }

beforeEach(() => {
    left = 100;
    bridge = {
        open: vi.fn(async () => result), adopt: vi.fn(async () => ({ ok: true })),
        navigate: vi.fn(), nav: vi.fn(), setBounds: vi.fn(), hide: vi.fn(), close: vi.fn(), focus: vi.fn(),
        openExternal: vi.fn(), onState: vi.fn(() => vi.fn()), onDownload: vi.fn(() => vi.fn()),
        onNewTab: vi.fn(() => vi.fn()), onClosed: vi.fn(() => vi.fn()), getPreferences: vi.fn(),
        setDefaultEngine: vi.fn(), clearData: vi.fn(), onPreferencesChanged: vi.fn(() => vi.fn()),
    };
    Object.assign(window, { cocDesktop: { browser: bridge } });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(rect);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
});

afterEach(() => {
    cleanup();
    for (const entry of [...browserWebviewEntries()]) removeBrowserWebview(entry.viewId);
    delete (window as { cocDesktop?: unknown }).cocDesktop;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('persistent browser webview layer', () => {
    it('keeps Electron guests live under the actual history dropdown without reattachment or navigation', async () => {
        bridge.history = {
            suggest: vi.fn(async () => ({ ok: true, entries: [{ url: 'https://recent.test/', title: 'Recent',
                lastVisited: 1, visitCount: 1, completion: null }], total: 1, recording: true, storageError: null })),
            query: vi.fn(), delete: vi.fn(), clear: vi.fn(), setRecording: vi.fn(), onChanged: vi.fn(() => vi.fn()),
        };
        render(<><BrowserWebviewLayer /><UnifiedBrowserTab tabId="tab" viewId="view" sessionKey="workspace"
            url="https://example.test/" active visible onNavigate={vi.fn()} onPageState={vi.fn()} /></>);
        await waitFor(() => expect(guest()).toBeTruthy());
        const original = guest();
        await userEvent.click(screen.getByLabelText('Address'));
        const list = await screen.findByRole('listbox');
        expect(list.parentElement!.parentElement).toBe(document.body);
        expect(list.parentElement).toHaveClass('z-50');
        expect(screen.getByTestId('browser-webview-layer').style.zIndex).toBe('1');
        expect(host().style.visibility).toBe('visible');
        expect(host().style.height).toBe('300px');
        await userEvent.keyboard('{Escape}');
        expect(guest()).toBe(original);
        expect(bridge.open).toHaveBeenCalledTimes(1);
        expect(bridge.navigate).not.toHaveBeenCalled();
    });

    it('creates one guest and adopts it exactly once without moving it across workspace remounts', async () => {
        render(<BrowserWebviewLayer />);
        const first = render(<Placeholder />);
        act(() => open());
        const webview = guest();
        const parent = webview.parentElement;
        expect(webview.getAttribute('src')).toBe('https://example.test/');
        expect(webview.getAttribute('partition')).toBe('persist:coc-browser');
        expect(webview.hasAttribute('allowpopups')).toBe(false);
        Object.defineProperty(webview, 'getWebContentsId', { value: () => 41 });
        act(() => {
            webview.dispatchEvent(new Event('did-attach'));
        });
        expect(bridge.adopt).not.toHaveBeenCalled();
        act(() => {
            webview.dispatchEvent(new Event('dom-ready'));
            webview.dispatchEvent(new Event('dom-ready'));
        });
        await waitFor(() => expect(bridge.adopt).toHaveBeenCalledExactlyOnceWith('view', 41));
        expect(host().style.visibility).toBe('visible');
        first.unmount();
        expect(host().style.visibility).toBe('hidden');
        expect(host().style.pointerEvents).toBe('none');
        expect(host().style.display).not.toBe('none');
        render(<Placeholder />);
        act(() => open());
        expect(guest()).toBe(webview);
        expect(guest().parentElement).toBe(parent);
        expect(host().style.visibility).toBe('visible');
        expect(bridge.close).not.toHaveBeenCalled();
    });

    it('positions, clips and repositions guests while leaving DOM overlays above a live page', async () => {
        render(<BrowserWebviewLayer />);
        render(<div data-testid="viewport" style={{ overflow: 'hidden' }}><Placeholder /></div>);
        Object.defineProperty(screen.getByTestId('viewport'), 'getBoundingClientRect', {
            value: () => ({ ...rect(), left: 120, top: 100, right: 480, bottom: 360 }),
        });
        act(() => open());
        expect(host().style.left).toBe('100px');
        expect(host().style.top).toBe('80px');
        expect(host().style.width).toBe('400px');
        expect(host().style.height).toBe('300px');
        expect(host().style.clipPath).toBe('inset(20px 20px 20px 20px)');
        render(<div role="dialog" aria-modal="true" data-native-view-overlay>Overlay</div>);
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
        expect(host().style.visibility).toBe('visible');
        left = 140;
        act(() => window.dispatchEvent(new Event('scroll')));
        await waitFor(() => expect(host().style.left).toBe('140px'));
        expect(bridge.setBounds).toHaveBeenLastCalledWith('view', { x: 140, y: 80, width: 400, height: 300 });
    });

    it('uses visibility on collapse and keeps independent workspace guests until explicitly closed', () => {
        render(<BrowserWebviewLayer />);
        const panel = render(<Placeholder />);
        act(() => { open(); open('other-workspace'); });
        const original = guest();
        panel.rerender(<Placeholder shown={false} />);
        expect(host().style.visibility).toBe('hidden');
        expect(bridge.setBounds).toHaveBeenLastCalledWith('view', null);
        panel.rerender(<Placeholder />);
        expect(guest()).toBe(original);
        expect(host().style.visibility).toBe('visible');
        expect(document.querySelectorAll('webview')).toHaveLength(2);
        act(() => closeBrowserPanelView('other-workspace'));
        expect(document.querySelectorAll('webview')).toHaveLength(1);
        act(() => closeBrowserPanelView('view'));
        expect(document.querySelector('webview')).toBeNull();
    });

    it('does not resurrect a tab from an open reply arriving after close', () => {
        render(<BrowserWebviewLayer />);
        const finish = prepareBrowserWebview('closed');
        act(() => {
            removeBrowserWebview('closed');
            finish(result, bridge);
        });
        expect(document.querySelector('webview')).toBeNull();
    });

    it('keeps the Electron page live under both panel overlays and the toolbar dropdown without shrinking it', async () => {
        render(<BrowserWebviewLayer />);
        const props = { tabId: 'tab', viewId: 'view', sessionKey: 'workspace', url: 'https://example.test/', active: true, visible: true, onNavigate: vi.fn(), onPageState: vi.fn() };
        const panel = render(<UnifiedBrowserTab {...props} />);
        await waitFor(() => expect(guest()).toBeTruthy());
        const webview = guest();
        expect(bridge.hide).not.toHaveBeenCalled();
        panel.rerender(<UnifiedBrowserTab {...props} nativeCovered />);
        expect(host().style.visibility).toBe('visible');
        await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
        expect(screen.getByRole('menu').parentElement).toBe(document.body);
        expect(host().style.visibility).toBe('visible');
        expect(host().style.height).toBe('300px');
        await userEvent.keyboard('{Escape}');
        expect(guest()).toBe(webview);
        expect(bridge.open).toHaveBeenCalledTimes(1);
        expect(bridge.navigate).not.toHaveBeenCalled();
    });

    it('surfaces adoption rejection in the owning tab rather than showing a blank page', async () => {
        vi.mocked(bridge.adopt!).mockResolvedValue({ ok: false, reason: 'bad-id', message: 'Guest attachment rejected.' });
        render(<><BrowserWebviewLayer /><UnifiedBrowserTab tabId="tab" viewId="view" sessionKey="workspace" url="https://example.test/" active visible onNavigate={vi.fn()} onPageState={vi.fn()} /></>);
        await waitFor(() => expect(guest()).toBeTruthy());
        Object.defineProperty(guest(), 'getWebContentsId', { value: () => 99 });
        act(() => guest().dispatchEvent(new Event('dom-ready')));
        expect(await screen.findByText('Guest attachment rejected.')).toBeInTheDocument();
        expect(host().style.visibility).toBe('hidden');
    });

    it('retains isolated HTML guests across workspace remounts and keeps them visible below overlays', async () => {
        bridge.sources = ['url', 'file'];
        bridge.openViewExternal = vi.fn();
        vi.mocked(bridge.open).mockResolvedValue({
            ok: true, engine: 'electron', sourceKind: 'file', embed: 'webview',
            src: 'file:///preview/page.html', partition: 'file-attachment-token',
        });
        render(<BrowserWebviewLayer />);
        const props = { tabId: 'html-tab', pageId: 'page', filePath: '/preview/page.html', wsId: 'workspace', active: true, visible: true, onErrorChange: vi.fn() };
        const first = render(<UnifiedHtmlPageTab {...props} />);
        await waitFor(() => expect(guest()).toBeTruthy());
        const original = guest();
        expect(original.getAttribute('src')).toBe('file:///preview/page.html');
        expect(original.getAttribute('partition')).toBe('file-attachment-token');
        expect(bridge.open).toHaveBeenCalledWith('html-page:page', { kind: 'file', path: '/preview/page.html' }, 'html-page');
        expect(bridge.hide).not.toHaveBeenCalled();
        first.rerender(<UnifiedHtmlPageTab {...props} nativeCovered />);
        expect(host().style.visibility).toBe('visible');
        first.unmount();
        expect(host().style.visibility).toBe('hidden');
        expect(bridge.close).not.toHaveBeenCalled();
        render(<UnifiedHtmlPageTab {...props} />);
        await waitFor(() => expect(host().style.visibility).toBe('visible'));
        expect(guest()).toBe(original);
        act(() => closeBrowserPanelView('html-page:page'));
        expect(document.querySelector('webview')).toBeNull();
    });
});
