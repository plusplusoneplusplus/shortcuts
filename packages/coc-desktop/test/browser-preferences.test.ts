import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { browserProfilePath, readBrowserEngine, writeBrowserEngine, readBrowserPageZoom, writeBrowserPageZoom, BROWSER_PREFERENCES_FILENAME } from '../src/browser-preferences';

const directories: string[] = [];
function directory(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-browser-prefs-'));
    directories.push(dir);
    return dir;
}
afterEach(() => { directories.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })); directories.length = 0; vi.restoreAllMocks(); });

describe('desktop browser preferences', () => {
    it('persists page zoom alongside the engine without either write erasing the other', () => {
        const dir = directory();
        expect(readBrowserPageZoom(dir)).toBe(100);
        writeBrowserEngine(dir, 'webview2');
        writeBrowserPageZoom(dir, 150);
        expect(readBrowserEngine(dir, 'win32', 'x64')).toBe('webview2');
        expect(readBrowserPageZoom(dir)).toBe(150);
        writeBrowserEngine(dir, 'electron');
        expect(readBrowserPageZoom(dir)).toBe(150);
        writeBrowserPageZoom(dir, 100);
        expect(readBrowserEngine(dir)).toBe('electron');
        expect(readBrowserPageZoom(dir)).toBe(100);
        expect(fs.readdirSync(dir)).toEqual([BROWSER_PREFERENCES_FILENAME]);
    });

    it('validates saved page zoom and refuses invalid writes without changing the file', () => {
        const dir = directory();
        for (const pageZoomPercent of [null, '125', 49, 201, 101]) {
            fs.writeFileSync(path.join(dir, BROWSER_PREFERENCES_FILENAME), JSON.stringify({ pageZoomPercent }));
            expect(readBrowserPageZoom(dir)).toBe(100);
        }
        writeBrowserPageZoom(dir, 50);
        expect(readBrowserPageZoom(dir)).toBe(50);
        for (const percent of [NaN, Infinity, 25, 225, 111]) expect(() => writeBrowserPageZoom(dir, percent)).toThrow('Invalid');
        expect(readBrowserPageZoom(dir)).toBe(50);
        writeBrowserPageZoom(dir, 200);
        expect(readBrowserPageZoom(dir)).toBe(200);
    });

    it('defaults to Electron and persists a Windows choice atomically', () => {
        const dir = directory();
        expect(readBrowserEngine(dir, 'win32', 'x64')).toBe('electron');
        writeBrowserEngine(dir, 'webview2');
        expect(readBrowserEngine(dir, 'win32', 'x64')).toBe('webview2');
        expect(fs.readdirSync(dir)).toEqual([BROWSER_PREFERENCES_FILENAME]);
    });

    it('uses Electron on other platforms without modifying a copied Windows preference', () => {
        const dir = directory();
        writeBrowserEngine(dir, 'webview2');
        for (const platform of ['linux', 'darwin']) {
            for (const arch of ['x64', 'arm64']) expect(readBrowserEngine(dir, platform, arch)).toBe('electron');
        }
        expect(readBrowserEngine(dir, 'win32', 'arm64')).toBe('electron');
        expect(readBrowserEngine(dir, 'win32', 'x64')).toBe('webview2');
    });

    it('defaults invalid saved values and malformed JSON to Electron', () => {
        const dir = directory();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        for (const raw of ['null', '{}', '{"defaultEngine":"unknown"}', '{broken']) {
            fs.writeFileSync(path.join(dir, BROWSER_PREFERENCES_FILENAME), raw);
            expect(readBrowserEngine(dir, 'win32', 'x64')).toBe('electron');
        }
        expect(warn).toHaveBeenCalled();
    });

    it('reports filesystem failures rather than overwriting or hiding them', () => {
        const dir = directory();
        fs.mkdirSync(path.join(dir, BROWSER_PREFERENCES_FILENAME));
        expect(() => readBrowserEngine(dir)).toThrow();
        expect(() => writeBrowserEngine(dir, 'electron')).toThrow();
        expect(fs.readdirSync(dir)).toEqual([BROWSER_PREFERENCES_FILENAME]);
    });

    it('keeps the two profiles in the configured global browser-data root', () => {
        const dir = directory();
        expect(browserProfilePath(dir, 'electron')).toBe(path.join(dir, 'browser', 'electron'));
        expect(browserProfilePath(dir, 'webview2')).toBe(path.join(dir, 'browser', 'webview2'));
    });
});
