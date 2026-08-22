/**
 * Resolves the native file-index addon from disk.
 *
 * Resolution order:
 *   1. `COC_NATIVE_FILE_INDEX_PATH`, for tests and unusual packaging.
 *   2. a locally built binary next to this package (`npm run build:native`).
 *   3. a CI/release binary in `prebuilt/<triple>/`.
 *   4. nothing — the caller falls back to the JavaScript implementation.
 *
 * Never throws: a missing or unloadable binary is a degraded mode, not a fatal
 * error, so a machine without a Rust toolchain still runs the server.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { NativeFileIndexAddon, NativeFileIndexStatus } from './types';

/** Package root — one level above the compiled `dist/`. */
const PACKAGE_ROOT = path.resolve(__dirname, '..');

/** Platform/arch/abi triple used in binary file names. */
export function nativeTriple(platform: string = process.platform, arch: string = process.arch): string {
    if (platform === 'linux') return `linux-${arch}-gnu`;
    if (platform === 'win32') return `win32-${arch}-msvc`;
    return `${platform}-${arch}`;
}

/** Binary file name for a platform/arch. */
export function nativeBinaryName(platform: string = process.platform, arch: string = process.arch): string {
    return `coc-native.${nativeTriple(platform, arch)}.node`;
}

/** Every path the loader will try, in order. */
export function nativeBinaryCandidates(
    packageRoot: string = PACKAGE_ROOT,
    platform: string = process.platform,
    arch: string = process.arch,
): string[] {
    const name = nativeBinaryName(platform, arch);
    const triple = nativeTriple(platform, arch);
    return [
        path.join(packageRoot, name),
        path.join(packageRoot, 'prebuilt', triple, name),
        path.join(packageRoot, 'prebuilt', triple, 'coc-native.node'),
    ];
}

let cached: { addon: NativeFileIndexAddon | null; status: NativeFileIndexStatus } | undefined;

function resolveAddon(): { addon: NativeFileIndexAddon | null; status: NativeFileIndexStatus } {
    if (process.env.COC_NATIVE_FILE_INDEX === '0') {
        return { addon: null, status: { loaded: false, reason: 'disabled by COC_NATIVE_FILE_INDEX=0' } };
    }

    const override = process.env.COC_NATIVE_FILE_INDEX_PATH;
    const candidates = override ? [override] : nativeBinaryCandidates();

    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const addon = require(candidate) as NativeFileIndexAddon;
            if (typeof addon?.buildFileIndex !== 'function') {
                return {
                    addon: null,
                    status: { loaded: false, reason: `${candidate} is not a coc-native addon` },
                };
            }
            return { addon, status: { loaded: true, binaryPath: candidate } };
        } catch (err) {
            return {
                addon: null,
                status: {
                    loaded: false,
                    reason: `failed to load ${candidate}: ${err instanceof Error ? err.message : String(err)}`,
                },
            };
        }
    }

    return {
        addon: null,
        status: { loaded: false, reason: `no prebuilt binary for ${nativeTriple()}` },
    };
}

/** The addon, or `null` when this platform has no usable binary. Cached. */
export function loadNativeFileIndex(): NativeFileIndexAddon | null {
    cached ??= resolveAddon();
    return cached.addon;
}

/** Whether the addon loaded, and why not when it did not. Cached. */
export function nativeFileIndexStatus(): NativeFileIndexStatus {
    cached ??= resolveAddon();
    return cached.status;
}

/** Drop the cached resolution — for tests that flip the environment. */
export function resetNativeFileIndexCache(): void {
    cached = undefined;
}
