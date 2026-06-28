/**
 * Unit tests for the app-identity helpers.
 *
 * The module is electron-free: readDesktopVersion takes an injectable reader and
 * buildAboutPanelOptions is pure, so we never touch disk or the Electron runtime.
 */

import * as path from 'path';
import { describe, it, expect } from 'vitest';
import {
    APP_NAME,
    APP_COPYRIGHT,
    readDesktopVersion,
    buildAboutPanelOptions,
} from '../src/app-identity';

const FAKE_DIR = path.join('/fake', 'app', 'dist');
const PKG_PATH = path.join(FAKE_DIR, '..', 'package.json');

describe('readDesktopVersion', () => {
    it('reads the version from the adjacent package.json', () => {
        const read = (p: string) => {
            expect(p).toBe(PKG_PATH); // resolves one dir up from dist/
            return JSON.stringify({ name: 'x', version: '1.2.3' });
        };
        expect(readDesktopVersion(FAKE_DIR, read)).toBe('1.2.3');
    });

    it('falls back when the file cannot be read (throws)', () => {
        const read = () => {
            throw new Error('ENOENT');
        };
        expect(readDesktopVersion(FAKE_DIR, read)).toBe('0.0.0');
        expect(readDesktopVersion(FAKE_DIR, read, '9.9.9')).toBe('9.9.9');
    });

    it('falls back on invalid JSON or a missing/blank version field', () => {
        expect(readDesktopVersion(FAKE_DIR, () => 'not json')).toBe('0.0.0');
        expect(readDesktopVersion(FAKE_DIR, () => JSON.stringify({ name: 'x' }))).toBe('0.0.0');
        expect(readDesktopVersion(FAKE_DIR, () => JSON.stringify({ version: '' }))).toBe('0.0.0');
        expect(readDesktopVersion(FAKE_DIR, () => JSON.stringify({ version: 42 }))).toBe('0.0.0');
    });
});

describe('buildAboutPanelOptions', () => {
    it('always sets the CoC name, copyright, and the supplied version', () => {
        const about = buildAboutPanelOptions({ version: '0.1.0' });
        expect(about.applicationName).toBe(APP_NAME);
        expect(about.applicationName).toBe('CoC');
        expect(about.copyright).toBe(APP_COPYRIGHT);
        expect(about.applicationVersion).toBe('0.1.0');
    });

    it('includes the brand icon path only when one is provided', () => {
        const withIcon = buildAboutPanelOptions({ version: '0.1.0', iconPath: '/p/coc-icon.png' });
        expect(withIcon.iconPath).toBe('/p/coc-icon.png');

        expect(buildAboutPanelOptions({ version: '0.1.0' }).iconPath).toBeUndefined();
        expect(buildAboutPanelOptions({ version: '0.1.0', iconPath: null }).iconPath).toBeUndefined();
    });

    it('shows the Electron build line only when an electron version is supplied', () => {
        expect(buildAboutPanelOptions({ version: '0.1.0', electronVersion: '35.7.5' }).version).toBe(
            'Electron 35.7.5',
        );
        expect(buildAboutPanelOptions({ version: '0.1.0' }).version).toBeUndefined();
    });
});
