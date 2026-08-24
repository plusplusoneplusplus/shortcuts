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
 *   4. nothing — which is a fatal {@link NativeAddonLoadError}.
 *
 * The addon is required, not optional: a binary that is missing or will not
 * load is a packaging or build failure, and failing loudly at startup beats
 * silently serving a slower, subtly different implementation for the life of
 * the process.
 *
 * The one exception is `COC_NATIVE=0`, which is an operator deliberately
 * turning the addon off rather than a failure to load it. That returns `null`
 * so capabilities with a JavaScript path can opt out. Native-only capabilities
 * such as Notes content search reject that state.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { NativeAddon, NativeAddonStatus } from './types';

/** Package root — one level above the compiled `dist/`. */
const PACKAGE_ROOT = path.resolve(__dirname, '..');

/** Triples the release workflow publishes a prebuilt binary for. */
const RELEASED_TRIPLES = [
    'linux-x64-gnu',
    'linux-arm64-gnu',
    'darwin-arm64',
    'darwin-x64',
    'win32-x64-msvc',
] as const;

/** Raised when the addon is required but cannot be loaded. */
export class NativeAddonLoadError extends Error {
    override readonly name = 'NativeAddonLoadError';

    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
    }
}

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

/**
 * The actionable half of a load failure: what was expected, what was tried and
 * what the reader should do about it.
 */
function remedy(triple: string): string {
    const released = (RELEASED_TRIPLES as readonly string[]).includes(triple);
    const build =
        'Build it with `npm run build:native -w packages/coc-native` (needs a Rust toolchain)';
    const platformNote = released
        ? 'A prebuilt binary is published for this platform, so this is a packaging or install problem.'
        : `No prebuilt binary is published for ${triple} — the released triples are ${RELEASED_TRIPLES.join(', ')}.`;
    return (
        `${platformNote}\n${build}. COC_NATIVE=0 is valid only for consumers whose capabilities ` +
        'have a JavaScript fallback; production Notes content search still requires the addon.'
    );
}

/** A load failure phrased for whoever has to fix it. */
function failure(
    summary: string,
    tried: string[],
    cause?: unknown,
): { addon: null; status: NativeAddonStatus; error: NativeAddonLoadError } {
    const triple = nativeTriple();
    const causeText = cause instanceof Error ? `\nCaused by: ${cause.message}` : '';
    const message =
        `@plusplusoneplusplus/coc-native: ${summary}\n` +
        `Expected the ${triple} binary at one of:\n` +
        tried.map(candidate => `  - ${candidate}`).join('\n') +
        `\n${remedy(triple)}${causeText}`;
    return {
        addon: null,
        status: { loaded: false, reason: summary },
        error: new NativeAddonLoadError(message, cause === undefined ? undefined : { cause }),
    };
}

interface Resolution {
    addon: NativeAddon | null;
    status: NativeAddonStatus;
    /** Set when loading failed; thrown by {@link loadNativeAddon}. */
    error?: NativeAddonLoadError;
}

let cached: Resolution | undefined;

/** Resolve the addon. Records failures rather than throwing, so status works. */
function resolveAddon(): Resolution {
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
                return failure(`${candidate} is not a native addon module`, candidates);
            }
            return { addon: addon as NativeAddon, status: { loaded: true, binaryPath: candidate } };
        } catch (err) {
            return failure(`failed to load ${candidate}`, candidates, err);
        }
    }

    return failure(`no native binary for ${nativeTriple()}`, candidates);
}

/**
 * The loaded addon.
 *
 * Throws {@link NativeAddonLoadError} when no binary could be loaded. Returns
 * `null` only for `COC_NATIVE=0`, the deliberate opt-out. Cached, so the
 * failure is raised identically on every call.
 */
export function loadNativeAddon(): NativeAddon | null {
    cached ??= resolveAddon();
    if (cached.error) throw cached.error;
    return cached.addon;
}

/**
 * Whether the addon is usable, and why not when it is not.
 *
 * Never throws — this is the introspection path behind `/api/health`, which has
 * to be able to report a failed load rather than become one. `loaded: false`
 * means the addon is unavailable for any reason: deliberately disabled, or a
 * load failure that {@link loadNativeAddon} would throw for. Cached.
 */
export function nativeAddonStatus(): NativeAddonStatus {
    cached ??= resolveAddon();
    return cached.status;
}

/** Drop the cached resolution — for tests that flip the environment. */
export function resetNativeAddonCache(): void {
    cached = undefined;
}
