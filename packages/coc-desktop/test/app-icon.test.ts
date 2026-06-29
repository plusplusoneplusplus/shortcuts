/**
 * Unit tests for app-icon path resolution.
 *
 * The module is electron-free: resolveIconPath accepts an injectable
 * existsFn so we never touch the real filesystem or Electron runtime.
 */

import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { resolveIconPath } from '../src/app-icon';

const FAKE_DIR = path.join('/fake', 'app', 'dist');

/** The three candidates resolveIconPath tries, in order. */
const [DEV_CANDIDATE, ALT_CANDIDATE, SAME_DIR_CANDIDATE] = [
    path.join(FAKE_DIR, '..', '..', '..', 'media', 'coc-icon.png'),
    path.join(FAKE_DIR, '..', 'media', 'coc-icon.png'),
    path.join(FAKE_DIR, 'media', 'coc-icon.png'),
];

describe('resolveIconPath', () => {
    it('returns null when no candidate exists', () => {
        expect(resolveIconPath(FAKE_DIR, () => false)).toBeNull();
    });

    it('resolves the dev-layout candidate (3 directories up from dist/)', () => {
        // Only the first candidate exists — mirrors the dev launch layout.
        const result = resolveIconPath(FAKE_DIR, (p) => p === DEV_CANDIDATE);
        expect(result).toBe(DEV_CANDIDATE);
    });

    it('falls back to the alternate candidate when the dev path is missing', () => {
        const result = resolveIconPath(FAKE_DIR, (p) => p === ALT_CANDIDATE);
        expect(result).toBe(ALT_CANDIDATE);
    });

    it('falls back to the same-dir candidate as a last resort', () => {
        const result = resolveIconPath(FAKE_DIR, (p) => p === SAME_DIR_CANDIDATE);
        expect(result).toBe(SAME_DIR_CANDIDATE);
    });

    it('returns the first match when multiple candidates exist', () => {
        // All exist — dev candidate should win.
        const result = resolveIconPath(FAKE_DIR, () => true);
        expect(result).toBe(DEV_CANDIDATE);
    });

    it('does not throw for unusual or empty fromDir values', () => {
        expect(() => resolveIconPath('', () => false)).not.toThrow();
        expect(() => resolveIconPath('/does/not/exist/at/all', () => false)).not.toThrow();
    });
});
