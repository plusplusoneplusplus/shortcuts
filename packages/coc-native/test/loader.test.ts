/**
 * Loader tests. These never need a compiled binary — the point is that a
 * missing, broken or disabled addon degrades to `null` instead of throwing.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    loadNativeFileIndex,
    nativeBinaryCandidates,
    nativeBinaryName,
    nativeFileIndexStatus,
    nativeTriple,
    resetNativeFileIndexCache,
} from '../src/loader';

const ENV_KEYS = ['COC_NATIVE_FILE_INDEX', 'COC_NATIVE_FILE_INDEX_PATH'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
    resetNativeFileIndexCache();
});

afterEach(() => {
    for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
    }
    resetNativeFileIndexCache();
});

describe('binary naming', () => {
    it('uses the ABI-qualified triple on linux and windows', () => {
        expect(nativeTriple('linux', 'x64')).toBe('linux-x64-gnu');
        expect(nativeTriple('linux', 'arm64')).toBe('linux-arm64-gnu');
        expect(nativeTriple('win32', 'x64')).toBe('win32-x64-msvc');
        expect(nativeTriple('darwin', 'arm64')).toBe('darwin-arm64');
        expect(nativeTriple('darwin', 'x64')).toBe('darwin-x64');
    });

    it('names binaries after the triple', () => {
        expect(nativeBinaryName('linux', 'x64')).toBe('coc-native.linux-x64-gnu.node');
        expect(nativeBinaryName('darwin', 'arm64')).toBe('coc-native.darwin-arm64.node');
    });

    it('prefers a locally built binary over a prebuilt one', () => {
        const candidates = nativeBinaryCandidates('/pkg', 'linux', 'x64');
        expect(candidates[0]).toBe(path.join('/pkg', 'coc-native.linux-x64-gnu.node'));
        expect(candidates[1]).toBe(
            path.join('/pkg', 'prebuilt', 'linux-x64-gnu', 'coc-native.linux-x64-gnu.node'),
        );
        expect(candidates[2]).toBe(path.join('/pkg', 'prebuilt', 'linux-x64-gnu', 'coc-native.node'));
    });
});

describe('loading', () => {
    it('returns null and explains itself when disabled', () => {
        process.env.COC_NATIVE_FILE_INDEX = '0';
        expect(loadNativeFileIndex()).toBeNull();
        expect(nativeFileIndexStatus()).toEqual({
            loaded: false,
            reason: 'disabled by COC_NATIVE_FILE_INDEX=0',
        });
    });

    it('returns null when the override path does not exist', () => {
        process.env.COC_NATIVE_FILE_INDEX_PATH = path.join(os.tmpdir(), 'coc-native-absent.node');
        expect(loadNativeFileIndex()).toBeNull();
        expect(nativeFileIndexStatus().loaded).toBe(false);
        expect(nativeFileIndexStatus().reason).toContain('no prebuilt binary');
    });

    it('returns null, without throwing, when the binary is not loadable', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-loader-'));
        try {
            const broken = path.join(dir, 'broken.node');
            fs.writeFileSync(broken, 'not an addon');
            process.env.COC_NATIVE_FILE_INDEX_PATH = broken;
            expect(loadNativeFileIndex()).toBeNull();
            expect(nativeFileIndexStatus().reason).toContain('failed to load');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('rejects a module that is not the coc-native addon', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-loader-'));
        try {
            const impostor = path.join(dir, 'impostor.js');
            fs.writeFileSync(impostor, 'module.exports = { somethingElse: 1 };');
            process.env.COC_NATIVE_FILE_INDEX_PATH = impostor;
            expect(loadNativeFileIndex()).toBeNull();
            expect(nativeFileIndexStatus().reason).toContain('not a coc-native addon');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('caches the resolution until it is reset', () => {
        process.env.COC_NATIVE_FILE_INDEX = '0';
        expect(loadNativeFileIndex()).toBeNull();
        delete process.env.COC_NATIVE_FILE_INDEX;
        // Still cached — the environment is read once.
        expect(nativeFileIndexStatus().reason).toBe('disabled by COC_NATIVE_FILE_INDEX=0');
        resetNativeFileIndexCache();
        expect(nativeFileIndexStatus().reason).not.toBe('disabled by COC_NATIVE_FILE_INDEX=0');
    });
});
