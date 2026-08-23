/**
 * Resolves the native addon from disk.
 *
 * Knows how to find and load the binary, and nothing about what the binary can
 * do: capability modules ask for their own exports off the loaded module, so a
 * new capability needs no change here.
 *
 * Resolution order:
 *   1. `COC_NATIVE_PATH`, for tests and unusual packaging.
 *   2. a locally built binary next to this package (`npm run build:native`).
 *   3. a CI/release binary in `prebuilt/<triple>/`.
 *   4. nothing — the caller falls back to a JavaScript implementation.
 *
 * Never throws: a missing or unloadable binary is a degraded mode, not a fatal
 * error, so a machine without a Rust toolchain still runs the server.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { NativeAddon, NativeAddonStatus } from './types';

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

let cached: { addon: NativeAddon | null; status: NativeAddonStatus } | undefined;

function resolveAddon(): { addon: NativeAddon | null; status: NativeAddonStatus } {
    if (process.env.COC_NATIVE === '0') {
        return { addon: null, status: { loaded: false, reason: 'disabled by COC_NATIVE=0' } };
    }

    const override = process.env.COC_NATIVE_PATH;
    const candidates = override ? [override] : nativeBinaryCandidates();

    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const addon = require(candidate) as unknown;
            if (typeof addon !== 'object' || addon === null) {
                return {
                    addon: null,
                    status: { loaded: false, reason: `${candidate} is not a native addon module` },
                };
            }
            return { addon: addon as NativeAddon, status: { loaded: true, binaryPath: candidate } };
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
export function loadNativeAddon(): NativeAddon | null {
    cached ??= resolveAddon();
    return cached.addon;
}

/** Whether the addon loaded, and why not when it did not. Cached. */
export function nativeAddonStatus(): NativeAddonStatus {
    cached ??= resolveAddon();
    return cached.status;
}

/** Drop the cached resolution — for tests that flip the environment. */
export function resetNativeAddonCache(): void {
    cached = undefined;
}
