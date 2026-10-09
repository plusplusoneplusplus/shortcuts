import * as fs from 'node:fs';
import * as path from 'node:path';
import { BROWSER_PAGE_ZOOM, isBrowserPageZoom, isBrowserEngine, type BrowserEngine } from './browser-view-policy';

export const BROWSER_PREFERENCES_FILENAME = 'desktop-browser.json';

export function browserProfilePath(dataDir: string, engine: BrowserEngine): string {
    return path.join(dataDir, 'browser', engine);
}

function readPreferences(dataDir: string): Record<string, unknown> {
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(path.join(dataDir, BROWSER_PREFERENCES_FILENAME), 'utf8'));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return {}; }
        if (error instanceof SyntaxError) {
            console.warn('[coc-desktop] Invalid browser preference; using Electron.');
            return {};
        }
        throw error;
    }
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

export function readBrowserEngine(dataDir: string, platform: string = process.platform, arch: string = process.arch): BrowserEngine {
    const engine = readPreferences(dataDir).defaultEngine;
    return isBrowserEngine(engine) && (engine === 'electron' || (platform === 'win32' && arch === 'x64')) ? engine : 'electron';
}

export function writeBrowserEngine(dataDir: string, engine: BrowserEngine): void {
    writePreferences(dataDir, { defaultEngine: engine });
}

export function readBrowserPageZoom(dataDir: string): number {
    const zoom = readPreferences(dataDir).pageZoomPercent;
    return isBrowserPageZoom(zoom) ? zoom : BROWSER_PAGE_ZOOM.default;
}

export function writeBrowserPageZoom(dataDir: string, percent: number): void {
    if (!isBrowserPageZoom(percent)) { throw new Error('Invalid web page zoom percentage.'); }
    writePreferences(dataDir, { pageZoomPercent: percent });
}

function writePreferences(dataDir: string, update: Record<string, unknown>): void {
    const preferences = { ...readPreferences(dataDir), version: 1, ...update };
    fs.mkdirSync(dataDir, { recursive: true });
    const destination = path.join(dataDir, BROWSER_PREFERENCES_FILENAME);
    const temporary = `${destination}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(temporary, JSON.stringify(preferences) + '\n');
        fs.renameSync(temporary, destination);
    } finally {
        fs.rmSync(temporary, { force: true });
    }
}
