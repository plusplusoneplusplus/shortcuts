/**
 * Resolves the `coc-symbols-lsp` executable from disk.
 *
 * The C-family symbol index answers navigation over the language-server
 * transport, so it ships as a standalone stdio binary rather than as another
 * export of the N-API addon. What it does *not* get is its own packaging story:
 * the precedence here is the same as `nativeBinaryCandidates` — an environment
 * override, a locally built binary next to this package, then a release binary
 * under `prebuilt/<triple>/` — so one staging step in CI places both artifacts
 * and one set of rules explains where either came from.
 *
 * Unlike the addon, a missing binary is *not* fatal. The addon backs quick-open,
 * notes search and git, which the server cannot serve without; this binary backs
 * one language-server preset, and a workspace with no C code never starts it. So
 * the accessor reports a reason rather than throwing on load, and the caller
 * decides — {@link loadSymbolsLspBinary} is the throwing form, for the path that
 * is actually about to spawn it.
 */

import * as fs from 'fs';
import * as path from 'path';

import { nativeTriple } from './loader';
import type { NativeAddonStatus } from './types';

/** Package root — one level above the compiled `dist/`. */
const PACKAGE_ROOT = path.resolve(__dirname, '..');

/** Raised when the symbols language server is needed but not on disk. */
export class SymbolsLspBinaryError extends Error {
    override readonly name = 'SymbolsLspBinaryError';
}

/** Executable name for a platform/arch, triple-qualified like the addon. */
export function symbolsLspBinaryName(
    platform: string = process.platform,
    arch: string = process.arch,
): string {
    const suffix = platform === 'win32' ? '.exe' : '';
    return `coc-symbols-lsp.${nativeTriple(platform, arch)}${suffix}`;
}

/**
 * Point a path inside a packaged Electron app's `app.asar` at its
 * `app.asar.unpacked` twin. Electron's `fs` answers `stat` for a file inside
 * the archive, but nothing can exec it, so the only copy worth finding is the
 * one electron-builder unpacked. A no-op for a path with no asar segment.
 */
export function asarUnpackedPath(p: string): string {
    return p.replace(/([\\/])app\.asar([\\/])/g, '$1app.asar.unpacked$2');
}

/** Every path the resolver will try, in order. */
export function symbolsLspBinaryCandidates(
    packageRoot: string = PACKAGE_ROOT,
    platform: string = process.platform,
    arch: string = process.arch,
): string[] {
    const root = asarUnpackedPath(packageRoot);
    const name = symbolsLspBinaryName(platform, arch);
    const triple = nativeTriple(platform, arch);
    const plain = platform === 'win32' ? 'coc-symbols-lsp.exe' : 'coc-symbols-lsp';
    return [
        path.join(root, name),
        path.join(root, 'prebuilt', triple, name),
        path.join(root, 'prebuilt', triple, plain),
    ];
}

let cached: NativeAddonStatus | undefined;

function resolve(): NativeAddonStatus {
    const override = process.env.COC_SYMBOLS_LSP_PATH;
    const candidates = override ? [override] : symbolsLspBinaryCandidates();

    for (const candidate of candidates) {
        let stats: fs.Stats;
        try {
            stats = fs.statSync(candidate);
        } catch {
            continue;
        }
        // A directory named like the binary would otherwise be "found" and then
        // fail at spawn time, where the error says far less about why.
        if (!stats.isFile()) continue;
        return { loaded: true, binaryPath: candidate };
    }

    return {
        loaded: false,
        reason:
            `no coc-symbols-lsp executable for ${nativeTriple()}\n` +
            'Looked in:\n' +
            candidates.map(candidate => `  - ${candidate}`).join('\n') +
            '\nBuild it with `npm run build:native -w packages/coc-native` (needs a Rust toolchain).',
    };
}

/**
 * Where the symbols language server is, and why it is nowhere when it is not.
 * Never throws — this is what the preset consults before offering to start.
 */
export function symbolsLspStatus(): NativeAddonStatus {
    cached ??= resolve();
    return cached;
}

/**
 * The executable's absolute path, or a {@link SymbolsLspBinaryError} naming
 * everything that was tried. For the caller that is about to spawn it.
 */
export function loadSymbolsLspBinary(): string {
    const status = symbolsLspStatus();
    if (!status.binaryPath) {
        throw new SymbolsLspBinaryError(`@plusplusoneplusplus/coc-native: ${status.reason}`);
    }
    return status.binaryPath;
}

/** Drop the cached resolution — for tests that flip the environment. */
export function resetSymbolsLspCache(): void {
    cached = undefined;
}
