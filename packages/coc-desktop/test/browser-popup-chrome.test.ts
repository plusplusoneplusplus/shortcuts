import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browserPopupChrome } from '../src/browser-popup-chrome';

const mocks = vi.hoisted(() => ({ toolbars: [] as any[], ipc: null as any }));
vi.mock('electron', async () => {
    const { EventEmitter } = await import('node:events');
    class View {
        children: any[] = [];
        bounds = {};
        visible = false;
        addChildView(view: any) { this.children.push(view); }
        removeChildView(view: any) { this.children = this.children.filter(child => child !== view); }
        setBounds(bounds: any) { this.bounds = bounds; }
        setVisible(visible: boolean) { this.visible = visible; }
    }
    class WebContentsView extends View {
        webContents: any;
        constructor(readonly options: any) {
            super();
            let url = '';
            this.webContents = Object.assign(new EventEmitter(), {
                mainFrame: {}, isDestroyed: () => false, close: vi.fn(),
                getURL: () => url, setWindowOpenHandler: vi.fn(),
                loadURL: vi.fn(async (next: string) => { url = next; }),
            });
            mocks.toolbars.push(this);
        }
    }
    mocks.ipc = new EventEmitter();
    return { View, WebContentsView, ipcMain: mocks.ipc, BrowserWindow: {} };
});

function fixture() {
    const page = { setBounds: vi.fn() };
    const window = Object.assign(new EventEmitter(), {
        id: 1, contentView: page as any, isDestroyed: () => false, getContentSize: () => [480, 560],
        setContentView(view: any) { this.contentView = view; },
    });
    const stop = vi.fn();
    return { page, window, stop, setActive: browserPopupChrome(window as any, stop) };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('trusted popup control chrome', () => {
    beforeEach(() => { mocks.toolbars.length = 0; mocks.ipc.removeAllListeners(); });
    it('is hidden by default, reserves the page viewport and accepts only its exact main-frame source/token', async () => {
        const h = fixture();
        h.setActive(null);
        expect(mocks.toolbars).toHaveLength(0);
        h.setActive('turn'); await tick();
        const chrome = mocks.toolbars[0], sender = chrome.webContents;
        expect(chrome.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false });
        expect(chrome.visible).toBe(true);
        expect(h.page.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 40, width: 480, height: 520 });
        for (const [event, token] of [
            [{ sender: {}, senderFrame: sender.mainFrame }, 'turn'],
            [{ sender, senderFrame: {} }, 'turn'],
            [{ sender, senderFrame: sender.mainFrame }, 'old-turn'],
        ]) mocks.ipc.emit('coc-desktop:browser-popup-stop', event, token);
        expect(h.stop).not.toHaveBeenCalled();
        const getURL = sender.getURL;
        sender.getURL = () => 'https://fixture.test/';
        mocks.ipc.emit('coc-desktop:browser-popup-stop', { sender, senderFrame: sender.mainFrame }, 'turn');
        expect(h.stop).not.toHaveBeenCalled();
        sender.getURL = getURL;
        mocks.ipc.emit('coc-desktop:browser-popup-stop', { sender, senderFrame: sender.mainFrame }, 'turn');
        expect(h.stop).toHaveBeenCalledExactlyOnceWith('turn');
        h.setActive(null);
        expect(chrome.visible).toBe(false);
        expect(h.page.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 480, height: 560 });
        mocks.ipc.emit('coc-desktop:browser-popup-stop', { sender, senderFrame: sender.mainFrame }, 'turn');
        expect(h.stop).toHaveBeenCalledOnce();
        h.window.emit('closed');
        expect(mocks.ipc.listenerCount('coc-desktop:browser-popup-stop')).toBe(0);
        expect(sender.close).toHaveBeenCalledOnce();
    });
    it('cannot reveal a cleared or superseded turn when an earlier toolbar load completes late', async () => {
        const h = fixture();
        h.setActive('first'); await tick();
        const chrome = mocks.toolbars[0];
        let loaded!: () => void;
        chrome.webContents.loadURL.mockImplementationOnce(() => new Promise<void>(resolve => { loaded = resolve; }));
        h.setActive('old');
        expect(chrome.visible).toBe(false);
        h.setActive(null);
        loaded(); await tick();
        expect(chrome.visible).toBe(false);
        h.setActive('next'); await tick();
        expect(chrome.visible).toBe(true);
        const sender = chrome.webContents;
        mocks.ipc.emit('coc-desktop:browser-popup-stop', { sender, senderFrame: sender.mainFrame }, 'old');
        expect(h.stop).not.toHaveBeenCalled();
        h.window.emit('closed');
    });
    it('recovers the same active turn after renderer crash or destruction without duplicating Stop listeners', async () => {
        const h = fixture();
        h.setActive('turn'); await tick();
        const chrome = mocks.toolbars[0];
        chrome.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
        await tick();
        expect(chrome.visible).toBe(true);
        expect(chrome.webContents.loadURL).toHaveBeenCalledTimes(2);
        chrome.webContents.emit('destroyed');
        await tick();
        const replacement = mocks.toolbars[1];
        expect(replacement.visible).toBe(true);
        expect(h.window.contentView.children).not.toContain(chrome);
        expect(mocks.ipc.listenerCount('coc-desktop:browser-popup-stop')).toBe(1);
        mocks.ipc.emit('coc-desktop:browser-popup-stop', { sender: replacement.webContents, senderFrame: replacement.webContents.mainFrame }, 'turn');
        expect(h.stop).toHaveBeenCalledExactlyOnceWith('turn');
        h.window.emit('closed');
    });
    it('surfaces load failures and cancels the owning turn instead of leaving invisible control', async () => {
        const h = fixture();
        h.setActive('first'); await tick();
        const chrome = mocks.toolbars[0];
        const error = new Error('Chrome unavailable');
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            chrome.webContents.loadURL.mockRejectedValueOnce(error);
            h.setActive('next'); await tick();
            expect(log).toHaveBeenCalledWith('[coc-desktop] Browser control chrome could not load:', error);
            expect(chrome.visible).toBe(false);
            expect(h.page.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 480, height: 560 });
            expect(h.stop).toHaveBeenCalledExactlyOnceWith('next');
        } finally { log.mockRestore(); h.window.emit('closed'); }
    });
});
