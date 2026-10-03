/**
 * browser-bridge — the system-browser handoff used by browser tabs: the desktop
 * bridge when there is one, else a `noopener` window; failures resolve false so
 * the tab can show a message instead of throwing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    desktopBrowserBridge,
    openUrlInSystemBrowser,
} from '../../../../src/server/spa/client/react/shared/file-path/browser-bridge';

type DesktopWindow = { cocDesktop?: { browser?: { openExternal: (url: string) => Promise<boolean> } } };

function installBridge(openExternal: (url: string) => Promise<boolean>): void {
    (window as DesktopWindow).cocDesktop = { browser: { openExternal } };
}

describe('openUrlInSystemBrowser', () => {
    afterEach(() => {
        delete (window as DesktopWindow).cocDesktop;
        vi.restoreAllMocks();
    });

    it('uses a noopener window when there is no desktop bridge', async () => {
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        expect(desktopBrowserBridge()).toBeUndefined();
        await expect(openUrlInSystemBrowser('https://example.com/')).resolves.toBe(true);
        expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
    });

    it('reports failure when the web fallback throws', async () => {
        vi.spyOn(window, 'open').mockImplementation(() => { throw new Error('blocked'); });
        await expect(openUrlInSystemBrowser('https://example.com/')).resolves.toBe(false);
    });

    it('hands the URL to the desktop bridge and never opens a web window', async () => {
        const open = vi.spyOn(window, 'open');
        const openExternal = vi.fn(async () => true);
        installBridge(openExternal);
        await expect(openUrlInSystemBrowser('https://example.com/a')).resolves.toBe(true);
        expect(openExternal).toHaveBeenCalledWith('https://example.com/a');
        expect(open).not.toHaveBeenCalled();
    });

    it('passes through a refused desktop handoff and turns a bridge error into false', async () => {
        const open = vi.spyOn(window, 'open');
        installBridge(async () => false);
        await expect(openUrlInSystemBrowser('https://example.com/a')).resolves.toBe(false);
        installBridge(async () => { throw new Error('ipc gone'); });
        await expect(openUrlInSystemBrowser('https://example.com/a')).resolves.toBe(false);
        expect(open).not.toHaveBeenCalled();
    });
});
