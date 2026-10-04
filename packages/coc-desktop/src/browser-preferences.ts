import * as fs from 'node:fs';
import * as path from 'node:path';
import { isBrowserEngine, type BrowserEngine } from './browser-view-policy';

export const BROWSER_PREFERENCES_FILENAME = 'desktop-browser.json';

export function browserProfilePath(dataDir: string, engine: BrowserEngine): string {
    return path.join(dataDir, 'browser', engine);
}

export function readBrowserEngine(dataDir: string, platform: string = process.platform, arch: string = process.arch): BrowserEngine {
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(path.join(dataDir, BROWSER_PREFERENCES_FILENAME), 'utf8'));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return 'electron'; }
        if (error instanceof SyntaxError) {
            console.warn('[coc-desktop] Invalid browser preference; using Electron.');
            return 'electron';
        }
        throw error;
    }
    const engine = raw && typeof raw === 'object' && 'defaultEngine' in raw ? raw.defaultEngine : undefined;
    return isBrowserEngine(engine) && (engine === 'electron' || (platform === 'win32' && arch === 'x64')) ? engine : 'electron';
}

export function writeBrowserEngine(dataDir: string, engine: BrowserEngine): void {
    fs.mkdirSync(dataDir, { recursive: true });
    const destination = path.join(dataDir, BROWSER_PREFERENCES_FILENAME);
    const temporary = `${destination}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(temporary, JSON.stringify({ version: 1, defaultEngine: engine }) + '\n');
        fs.renameSync(temporary, destination);
    } finally {
        fs.rmSync(temporary, { force: true });
    }
}
