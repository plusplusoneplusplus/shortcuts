import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ElectronBrowserHost } from '../src/electron-browser-host';
import type { BrowserEventSink } from '../src/browser-host-contract';

const mocks = vi.hoisted(() => ({
    visible: false,
    handlers: new Map<string, (...args: any[]) => void>(),
    owner: { id: 7, focus: vi.fn() },
    contents: {
        id: 8, on: vi.fn(), once: vi.fn(), setWindowOpenHandler: vi.fn(),
        isDestroyed: () => false, loadURL: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
    },
}));
vi.mock('node:fs', () => ({ mkdirSync: vi.fn() }));
vi.mock('../src/browser-profile-lock', () => ({ lockElectronProfile: () => ({ close: vi.fn() }) }));
vi.mock('electron', () => ({
    BrowserWindow: { fromWebContents: () => ({
        webContents: mocks.owner, isDestroyed: () => false,
        contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    }) },
    WebContentsView: class {
        webContents = mocks.contents;
        setVisible(value: boolean) { mocks.visible = value; }
        getVisible() { return mocks.visible; }
        setBounds = vi.fn();
    },
    webContents: { fromId: () => mocks.owner },
    session: { fromPath: () => ({
        getUserAgent: () => 'Electron/42', setUserAgent: vi.fn(),
        setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), on: vi.fn(),
    }) },
    shell: {},
}));

beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.contents.on.mockImplementation((name: string, handler: (...args: any[]) => void) => {
        mocks.handlers.set(name, handler);
    });
});

async function view() {
    const sink: BrowserEventSink = {
        state: vi.fn(), newTab: vi.fn(), download: vi.fn(),
        closeRequested: vi.fn(), openMenuRequested: vi.fn(),
    };
    const hosted = await new ElectronBrowserHost('profile').create({
        ownerId: 7, viewId: 'browser', sessionKey: 'remote:workspace', url: 'https://example.test/',
    }, sink);
    const press = (overrides: Record<string, unknown> = {}) => {
        const event = { preventDefault: vi.fn() };
        mocks.handlers.get('before-input-event')!(event, {
            type: 'keyDown', key: 't', control: process.platform !== 'darwin',
            meta: process.platform === 'darwin', ...overrides,
        });
        return event;
    };
    return { sink, hosted, press };
}

describe('Electron browser add-menu forwarding', () => {
    it('claims only visible live views and returns focus before forwarding once', async () => {
        const { hosted, sink, press } = await view();
        expect(press().preventDefault).not.toHaveBeenCalled();
        await hosted.setBounds({ x: 0, y: 0, width: 300, height: 200 });
        expect(press().preventDefault).toHaveBeenCalledOnce();
        expect(sink.openMenuRequested).toHaveBeenCalledOnce();
        expect(mocks.owner.focus.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(sink.openMenuRequested).mock.invocationCallOrder[0]);
        expect(press({ isAutoRepeat: true }).preventDefault).toHaveBeenCalledOnce();
        expect(sink.openMenuRequested).toHaveBeenCalledOnce();
        await hosted.close();
        expect(press().preventDefault).not.toHaveBeenCalled();
    });

    it('preserves modified chords, keyup and existing close behavior', async () => {
        const { hosted, sink, press } = await view();
        await hosted.setBounds({ x: 0, y: 0, width: 300, height: 200 });
        for (const input of [{ shift: true }, { alt: true }, { control: false, meta: false }, { type: 'keyUp' }, { key: 'f' }]) {
            expect(press(input).preventDefault).not.toHaveBeenCalled();
        }
        expect(sink.openMenuRequested).not.toHaveBeenCalled();
        expect(press({ key: 'w' }).preventDefault).toHaveBeenCalledOnce();
        expect(sink.closeRequested).toHaveBeenCalledOnce();
        await hosted.setBounds(null);
        expect(press().preventDefault).not.toHaveBeenCalled();
        await hosted.close();
    });
});
