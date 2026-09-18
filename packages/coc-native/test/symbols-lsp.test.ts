/**
 * Resolution of the stdio symbol language server.
 *
 * The point of these is that the executable is found by the same rules as the
 * `.node` addon — override, package root, `prebuilt/<triple>/` — and that a
 * missing one is a reported reason rather than a thrown startup failure, since
 * a workspace with no C code never starts this server at all.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nativeBinaryCandidates, nativeTriple } from '../src/loader';
import {
    loadSymbolsLspBinary,
    resetSymbolsLspCache,
    symbolsLspBinaryCandidates,
    symbolsLspBinaryName,
    symbolsLspStatus,
    SymbolsLspBinaryError,
} from '../src/symbols-lsp';

// @ts-expect-error — a .mjs build script with no type declarations.
import { symbolsLspBinaryName as scriptBinaryName } from '../scripts/build-symbols-lsp.mjs';

let saved: string | undefined;

beforeEach(() => {
    saved = process.env.COC_SYMBOLS_LSP_PATH;
    delete process.env.COC_SYMBOLS_LSP_PATH;
    resetSymbolsLspCache();
});

afterEach(() => {
    if (saved === undefined) delete process.env.COC_SYMBOLS_LSP_PATH;
    else process.env.COC_SYMBOLS_LSP_PATH = saved;
    resetSymbolsLspCache();
});

describe('binary naming', () => {
    it('qualifies the name with the same triple as the addon', () => {
        expect(symbolsLspBinaryName('linux', 'x64')).toBe('coc-symbols-lsp.linux-x64-gnu');
        expect(symbolsLspBinaryName('linux', 'arm64')).toBe('coc-symbols-lsp.linux-arm64-gnu');
        expect(symbolsLspBinaryName('darwin', 'arm64')).toBe('coc-symbols-lsp.darwin-arm64');
        expect(symbolsLspBinaryName('darwin', 'x64')).toBe('coc-symbols-lsp.darwin-x64');
    });

    it('adds .exe on windows', () => {
        expect(symbolsLspBinaryName('win32', 'x64')).toBe('coc-symbols-lsp.win32-x64-msvc.exe');
        expect(symbolsLspBinaryName('win32', 'arm64')).toBe('coc-symbols-lsp.win32-arm64-msvc.exe');
    });

    // The build script names the artifact and the resolver computes the name
    // independently. If they diverge the preset finds nothing at runtime.
    it.each([
        ['linux', 'x64'],
        ['linux', 'arm64'],
        ['darwin', 'arm64'],
        ['darwin', 'x64'],
        ['win32', 'x64'],
        ['win32', 'arm64'],
    ])('agrees with the build script for %s-%s', (platform, arch) => {
        expect(scriptBinaryName(platform, arch)).toBe(symbolsLspBinaryName(platform, arch));
    });
});

describe('candidate paths', () => {
    it('mirrors the addon: package root, then prebuilt/<triple>/', () => {
        const root = path.join('/tmp', 'pkg');
        const candidates = symbolsLspBinaryCandidates(root, 'linux', 'x64');
        expect(candidates).toEqual([
            path.join(root, 'coc-symbols-lsp.linux-x64-gnu'),
            path.join(root, 'prebuilt', 'linux-x64-gnu', 'coc-symbols-lsp.linux-x64-gnu'),
            path.join(root, 'prebuilt', 'linux-x64-gnu', 'coc-symbols-lsp'),
        ]);
    });

    it('uses the same directories the addon does', () => {
        const root = path.join('/tmp', 'pkg');
        const dirs = (paths: string[]) => paths.map(p => path.dirname(p));
        expect(dirs(symbolsLspBinaryCandidates(root, 'darwin', 'arm64'))).toEqual(
            dirs(nativeBinaryCandidates(root, 'darwin', 'arm64')),
        );
    });

    it('keeps the windows fallback name executable', () => {
        expect(symbolsLspBinaryCandidates('C:\\pkg', 'win32', 'x64').at(-1)).toContain(
            'coc-symbols-lsp.exe',
        );
    });
});

describe('resolution', () => {
    function scratch(): string {
        return fs.mkdtempSync(path.join(os.tmpdir(), 'coc-symbols-lsp-'));
    }

    it('honours COC_SYMBOLS_LSP_PATH', () => {
        const dir = scratch();
        const binary = path.join(dir, 'anywhere');
        fs.writeFileSync(binary, '');
        process.env.COC_SYMBOLS_LSP_PATH = binary;

        expect(symbolsLspStatus()).toEqual({ loaded: true, binaryPath: binary });
        expect(loadSymbolsLspBinary()).toBe(binary);
    });

    it('reports a reason rather than throwing when there is no binary', () => {
        process.env.COC_SYMBOLS_LSP_PATH = path.join(scratch(), 'absent');

        const status = symbolsLspStatus();
        expect(status.loaded).toBe(false);
        expect(status.binaryPath).toBeUndefined();
        expect(status.reason).toContain(nativeTriple());
        expect(status.reason).toContain('absent');
    });

    it('throws from the spawning accessor, naming what was tried', () => {
        const absent = path.join(scratch(), 'absent');
        process.env.COC_SYMBOLS_LSP_PATH = absent;

        expect(() => loadSymbolsLspBinary()).toThrow(SymbolsLspBinaryError);
        expect(() => loadSymbolsLspBinary()).toThrow(/absent/);
    });

    it('skips a directory that shares the binary name', () => {
        const dir = scratch();
        const asDirectory = path.join(dir, 'coc-symbols-lsp');
        fs.mkdirSync(asDirectory);
        process.env.COC_SYMBOLS_LSP_PATH = asDirectory;

        expect(symbolsLspStatus().loaded).toBe(false);
    });

    it('caches the resolution until it is reset', () => {
        const dir = scratch();
        const binary = path.join(dir, 'server');
        process.env.COC_SYMBOLS_LSP_PATH = binary;
        expect(symbolsLspStatus().loaded).toBe(false);

        fs.writeFileSync(binary, '');
        expect(symbolsLspStatus().loaded).toBe(false);

        resetSymbolsLspCache();
        expect(symbolsLspStatus()).toEqual({ loaded: true, binaryPath: binary });
    });
});
