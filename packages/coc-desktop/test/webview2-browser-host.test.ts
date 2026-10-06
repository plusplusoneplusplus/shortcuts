import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebView2BrowserHost } from '../src/webview2-browser-host';
import type { BrowserEventSink } from '../src/browser-host-contract';

const mocks = vi.hoisted(() => ({
    request: vi.fn().mockResolvedValue(undefined),
    running: true,
    window: {
        isDestroyed: () => false,
        isFullScreen: () => false,
        getNativeWindowHandle: () => Buffer.alloc(8),
        on: vi.fn(),
        removeListener: vi.fn(),
    },
    owner: { focus: vi.fn() },
    onEvent: vi.fn<(message: Record<string, unknown>) => void>(),
}));

vi.mock('electron', () => ({
    BrowserWindow: { fromWebContents: () => ({ ...mocks.window, webContents: mocks.owner }) },
    webContents: { fromId: () => mocks.owner },
    shell: {},
}));

vi.mock('../src/webview2-process', () => ({
    WebView2Process: class {
        constructor(_binary: () => string, _profile: string, onEvent: (message: Record<string, unknown>) => void) {
            mocks.onEvent.mockImplementation(onEvent);
        }
        get running() { return mocks.running; }
        request = mocks.request;
    },
}));

const sink: BrowserEventSink = { state: vi.fn(), newTab: vi.fn(), download: vi.fn(), closeRequested: vi.fn(), openMenuRequested: vi.fn() };
const bounds = { x: 10, y: 20, width: 300, height: 200 };

describe('WebView2 native focus handoff', () => {
    beforeEach(() => {
        mocks.request.mockReset().mockResolvedValue(undefined);
        mocks.owner.focus.mockClear();
        vi.mocked(sink.closeRequested).mockClear();
        vi.mocked(sink.openMenuRequested).mockClear();
        mocks.running = true;
    });

    it('forwards close only for the matching live visible native view', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'remote-workspace', url: 'https://example.test' }, sink);
        mocks.onEvent({ event: 'close-requested', viewId: '7:tab:1' });
        expect(sink.closeRequested).not.toHaveBeenCalled();
        await view.setBounds(bounds);
        mocks.onEvent({ event: 'close-requested', viewId: '8:tab:1' });
        expect(sink.closeRequested).not.toHaveBeenCalled();
        mocks.onEvent({ event: 'close-requested', viewId: '7:tab:1' });
        expect(sink.closeRequested).toHaveBeenCalledOnce();
        expect(mocks.request).not.toHaveBeenCalledWith('close', expect.anything());
        await view.close();
        mocks.onEvent({ event: 'close-requested', viewId: '7:tab:1' });
        expect(sink.closeRequested).toHaveBeenCalledOnce();
    });

    it('returns focus and forwards add-menu only for a live visible source view', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'remote-workspace', url: 'https://example.test' }, sink);
        mocks.onEvent({ event: 'open-menu-requested', viewId: '7:tab:1' });
        expect(sink.openMenuRequested).not.toHaveBeenCalled();
        await view.setBounds(bounds);
        mocks.onEvent({ event: 'open-menu-requested', viewId: '8:tab:1' });
        expect(sink.openMenuRequested).not.toHaveBeenCalled();
        mocks.onEvent({ event: 'open-menu-requested', viewId: '7:tab:1' });
        await vi.waitFor(() => expect(sink.openMenuRequested).toHaveBeenCalledOnce());
        expect(mocks.owner.focus).toHaveBeenCalled();
        expect(mocks.request).toHaveBeenCalledWith('focus-host', { viewId: '7:tab:1' });
        await view.close();
        mocks.onEvent({ event: 'open-menu-requested', viewId: '7:tab:1' });
        expect(sink.openMenuRequested).toHaveBeenCalledOnce();
    });

    it('does not start a helper when no browser view is present', async () => {
        const host = new WebView2BrowserHost('profile');
        await host.focusOwner(1);
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it('returns focus only for visible views belonging to the requesting window', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 1, viewId: 'tab', sessionKey: 'workspace', url: 'https://example.test' }, sink);
        await view.setBounds(bounds);
        mocks.request.mockClear();
        await host.focusOwner(2);
        expect(mocks.request).not.toHaveBeenCalled();
        await host.focusOwner(1);
        expect(mocks.request).toHaveBeenCalledExactlyOnceWith('focus-host', { viewId: '1:tab:1' });
        await view.setBounds(null);
        mocks.request.mockClear();
        await host.focusOwner(1);
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it('ignores closed views and stopped helpers', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 1, viewId: 'tab', sessionKey: 'workspace', url: 'https://example.test' }, sink);
        await view.setBounds(bounds);
        mocks.running = false;
        mocks.request.mockClear();
        await host.focusOwner(1);
        expect(mocks.request).not.toHaveBeenCalled();
        mocks.running = true;
        await view.close();
        mocks.request.mockClear();
        await host.focusOwner(1);
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it('surfaces native focus handoff failures', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 1, viewId: 'tab', sessionKey: 'workspace', url: 'https://example.test' }, sink);
        await view.setBounds(bounds);
        mocks.request.mockRejectedValueOnce(new Error('Native focus failed'));
        await expect(host.focusOwner(1)).rejects.toThrow('Native focus failed');
    });

    it('also releases native keyboard focus when the browser tabs back into the host', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 1, viewId: 'tab', sessionKey: 'workspace', url: 'https://example.test' }, sink);
        await view.setBounds(bounds);
        mocks.request.mockClear();
        mocks.onEvent({ event: 'focus-host', viewId: '1:tab:1' });
        expect(mocks.owner.focus).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledExactlyOnceWith('focus-host', { viewId: '1:tab:1' }));
    });
});
