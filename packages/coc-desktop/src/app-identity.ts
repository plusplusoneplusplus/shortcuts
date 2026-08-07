/**
 * App identity for the CoC desktop app: the product name, copyright, version
 * lookup, and the native "About" panel options.
 *
 * Kept electron-free so the logic is unit-testable without an Electron runtime.
 * main.ts wires the result into app.setName() / app.setAboutPanelOptions().
 */

import * as path from 'path';
import { elevationAboutLine, type ElevationState } from './elevation';

/** Product name shown in the menu bar, dock, window title, and About panel. */
export const APP_NAME = 'CoC';

/** Copyright line shown in the About panel (matches the electron-builder build). */
export const APP_COPYRIGHT = 'Copyright © plusplusoneplusplus';

/**
 * Reads the desktop app's version from its package.json. In dev (Electron
 * launched against this package) and when packaged (asar) the file sits one
 * directory above the compiled `dist/main.js`, so we resolve relative to
 * `fromDir` (normally `__dirname`). Falls back gracefully if it can't be read.
 *
 * @param fromDir    The directory main.js runs from (normally `__dirname`).
 * @param readFileFn Injectable reader — defaults to `fs.readFileSync` so unit
 *                   tests can supply fixture contents without touching disk.
 */
export function readDesktopVersion(
    fromDir: string,
    readFileFn: (p: string) => string = (p) => require('fs').readFileSync(p, 'utf8'),
    fallback = '0.0.0',
): string {
    try {
        const parsed = JSON.parse(readFileFn(path.join(fromDir, '..', 'package.json')));
        const version = parsed?.version;
        return typeof version === 'string' && version.length > 0 ? version : fallback;
    } catch {
        return fallback;
    }
}

/** The shape Electron's `app.setAboutPanelOptions()` accepts (subset we use). */
export interface AboutPanelOptions {
    applicationName: string;
    applicationVersion: string;
    copyright: string;
    version?: string;
    iconPath?: string;
}

/**
 * Builds the About-panel options: always the CoC name + copyright + the desktop
 * version, plus the brand icon and the underlying Electron build when available.
 * On macOS this renders as e.g. "CoC — Version 0.1.0 (Electron 35.7.5)".
 *
 * When an elevation state is supplied it is appended to that same free-form
 * detail line — e.g. "Electron 35.7.5 — Running as administrator" — so the
 * About panel answers whether the app was started with admin/root privileges.
 * `elevationAboutLine` decides when the line is worth showing (see elevation.ts).
 */
export function buildAboutPanelOptions(opts: {
    version: string;
    iconPath?: string | null;
    electronVersion?: string;
    platform?: NodeJS.Platform;
    elevation?: ElevationState;
}): AboutPanelOptions {
    const about: AboutPanelOptions = {
        applicationName: APP_NAME,
        applicationVersion: opts.version,
        copyright: APP_COPYRIGHT,
    };
    if (opts.iconPath) {
        about.iconPath = opts.iconPath;
    }
    const elevationLine = opts.elevation
        ? elevationAboutLine(opts.platform ?? process.platform, opts.elevation)
        : undefined;
    const details = [
        opts.electronVersion ? `Electron ${opts.electronVersion}` : undefined,
        elevationLine,
    ].filter((part): part is string => Boolean(part));
    if (details.length > 0) {
        about.version = details.join(' — ');
    }
    return about;
}
