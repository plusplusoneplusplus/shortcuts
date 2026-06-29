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
const FAKE_RESOURCES = path.join('/fake', 'app', 'Contents', 'Resources');

/** Candidates resolveIconPath tries, in order. */
const PACKAGED_CANDIDATE = path.join(FAKE_RESOURCES, 'coc-icon.png');
const [DEV_CANDIDATE, ALT_CANDIDATE, SAME_DIR_CANDIDATE] = [
    path.join(FAKE_DIR, '..', '..', '..', 'media', 'coc-icon.png'),
    path.join(FAKE_DIR, '..', 'media', 'coc-icon.png'),
    path.join(FAKE_DIR, 'media', 'coc-icon.png'),
];

describe('resolveIconPath', () => {
    it('returns null when no candidate exists', () => {
        expect(resolveIconPath(FAKE_DIR, undefined, () => false)).toBeNull();
    });

    it('resolves the packaged candidate under resourcesDir first', () => {
        // The bundled extraResources copy must win over the dev layout so a
        // production .app never falls back to the placeholder dock glyph.
        const result = resolveIconPath(FAKE_DIR, FAKE_RESOURCES, () => true);
        expect(result).toBe(PACKAGED_CANDIDATE);
    });

    it('resolves the bundled icon even when only resourcesDir has it', () => {
        const result = resolveIconPath(FAKE_DIR, FAKE_RESOURCES, (p) => p === PACKAGED_CANDIDATE);
        expect(result).toBe(PACKAGED_CANDIDATE);
    });

    it('skips the packaged candidate when no resourcesDir is given (dev)', () => {
        // Only the first candidate exists — mirrors the dev launch layout.
        const result = resolveIconPath(FAKE_DIR, undefined, (p) => p === DEV_CANDIDATE);
        expect(result).toBe(DEV_CANDIDATE);
    });

    it('falls back to the alternate candidate when the dev path is missing', () => {
        const result = resolveIconPath(FAKE_DIR, undefined, (p) => p === ALT_CANDIDATE);
        expect(result).toBe(ALT_CANDIDATE);
    });

    it('falls back to the same-dir candidate as a last resort', () => {
        const result = resolveIconPath(FAKE_DIR, undefined, (p) => p === SAME_DIR_CANDIDATE);
        expect(result).toBe(SAME_DIR_CANDIDATE);
    });

    it('returns the dev candidate when resourcesDir lacks the icon', () => {
        // Packaged path is checked but missing; dev layout wins.
        const result = resolveIconPath(FAKE_DIR, FAKE_RESOURCES, (p) => p !== PACKAGED_CANDIDATE);
        expect(result).toBe(DEV_CANDIDATE);
    });

    it('does not throw for unusual or empty fromDir values', () => {
        expect(() => resolveIconPath('', undefined, () => false)).not.toThrow();
        expect(() => resolveIconPath('/does/not/exist/at/all', undefined, () => false)).not.toThrow();
    });
});
