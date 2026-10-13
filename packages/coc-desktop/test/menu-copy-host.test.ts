import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ focused: vi.fn(), isSpa: vi.fn() }));
vi.mock('electron', () => ({ webContents: { getFocusedWebContents: mocks.focused } }));
vi.mock('../src/browser-webview-guard', () => ({ isBrowserEmbedder: mocks.isSpa }));

import { createDesktopMenuCopyDelegate } from '../src/menu-copy-host';
import { MENU_COPY_CHANNEL, MENU_COPY_FALLBACK_DELAY_MS } from '../src/terminal-copy';

describe('desktop Copy routing', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); });
    afterEach(() => vi.useRealTimers());

    it.each(['docked DevTools', 'detached DevTools', 'browser guest'])('copies focused %s without SPA IPC', () => {
        const focused = { id: 8, send: vi.fn(), copy: vi.fn(), isDestroyed: () => false };
        mocks.focused.mockReturnValue(focused);
        mocks.isSpa.mockReturnValue(false);

        createDesktopMenuCopyDelegate().requestCopy();

        expect(mocks.isSpa).toHaveBeenCalledWith(focused);
        expect(focused.copy).toHaveBeenCalledTimes(1);
        expect(focused.send).not.toHaveBeenCalled();
    });

    it('delegates terminal copying to the focused SPA, including a second window', () => {
        const first = { id: 7, send: vi.fn(), copy: vi.fn(), isDestroyed: () => false };
        const second = { id: 9, send: vi.fn(), copy: vi.fn(), isDestroyed: () => false };
        mocks.focused.mockReturnValueOnce(first).mockReturnValueOnce(second);
        mocks.isSpa.mockReturnValue(true);
        const delegate = createDesktopMenuCopyDelegate();
        delegate.requestCopy();
        delegate.markHandled(first.id);
        delegate.requestCopy();
        delegate.markHandled(second.id);
        vi.advanceTimersByTime(MENU_COPY_FALLBACK_DELAY_MS);

        expect(first.send).toHaveBeenCalledWith(MENU_COPY_CHANNEL);
        expect(second.send).toHaveBeenCalledWith(MENU_COPY_CHANNEL);
        expect(first.copy).not.toHaveBeenCalled();
        expect(second.copy).not.toHaveBeenCalled();
    });

    it('does not fall back to another window when nothing is focused', () => {
        mocks.focused.mockReturnValue(null);
        expect(() => createDesktopMenuCopyDelegate().requestCopy()).not.toThrow();
        expect(mocks.isSpa).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
});
