/**
 * Resolve a spawnable path to the Codex native binary for packaged desktop
 * builds, rewriting an `app.asar` path to its `app.asar.unpacked` copy.
 *
 * Why this is needed: `@openai/codex-sdk` spawns the native `codex` executable
 * directly via `child_process.spawn` (it does NOT run a JS entrypoint through
 * Node). In a packaged Electron app the SDK's own resolution lands the binary
 * inside `app.asar`, which the OS cannot execute — `spawn` fails with `ENOTDIR`
 * (it sees `app.asar` as a file, not a directory). electron-builder unpacks the
 * `@openai/codex-*` packages to `app.asar.unpacked`, so the real, spawnable file
 * lives there. We compute the same path the SDK would and hand it to the `Codex`
 * constructor via `codexPathOverride`, pointing at the unpacked copy.
 *
 * This mirrors the SDK's resolution (its `findCodexPath`): platform + arch →
 * target triple → the `@openai/codex-<platform>` vendor package, with the
 * current layout (`vendor/<triple>/bin/codex`) and a legacy fallback
 * (`vendor/<triple>/codex/codex`). It stays a no-op for a normal CLI / global
 * install (no `app.asar` segment) and returns `undefined` when nothing resolves
 * — an unsupported platform, or the optional binaries not installed — so callers
 * simply leave the SDK to resolve the binary on its own.
 */

import { createRequire } from 'module';
import * as path from 'path';
import * as fs from 'fs';
import { preferUnpackedPath } from './asar-path';

const runtimeRequire = createRequire(__filename);

/** `${process.platform}-${process.arch}` → Rust target triple (matches the SDK). */
const TARGET_TRIPLE_BY_PLATFORM: Readonly<Record<string, string>> = {
    'darwin-x64': 'x86_64-apple-darwin',
    'darwin-arm64': 'aarch64-apple-darwin',
    'win32-x64': 'x86_64-pc-windows-msvc',
    'win32-arm64': 'aarch64-pc-windows-msvc',
    'linux-x64': 'x86_64-unknown-linux-musl',
    'linux-arm64': 'aarch64-unknown-linux-musl',
};

/** Target triple → the npm package that vendors that triple's binary. */
const PLATFORM_PACKAGE_BY_TARGET: Readonly<Record<string, string>> = {
    'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
    'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
    'x86_64-apple-darwin': '@openai/codex-darwin-x64',
    'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
    'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
    'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64',
};

/** Injectable seams so the resolution is unit-testable without a real install. */
export interface CodexExecPathEnv {
    /** Defaults to `process.platform`. */
    platform?: NodeJS.Platform;
    /** Defaults to `process.arch`. */
    arch?: string;
    /**
     * Resolve a module request to an absolute path. Defaults to resolving the
     * `@openai/codex-<platform>` package relative to the `@openai/codex` CLI
     * package (exactly as the SDK does), falling back to this package's own
     * resolution. Should throw when the request cannot be resolved.
     */
    resolve?: (request: string) => string;
    /** File existence check; defaults to `fs.existsSync`. */
    existsSync?: (p: string) => boolean;
}

/** Default resolver: mirror the SDK by resolving relative to `@openai/codex`. */
function defaultResolve(request: string): string {
    let base = __filename;
    try {
        base = runtimeRequire.resolve('@openai/codex/package.json');
    } catch {
        // `@openai/codex` not resolvable from here — fall back to our own require,
        // which works when the platform package is hoisted to a shared tree.
    }
    return createRequire(base).resolve(request);
}

/**
 * The spawnable Codex binary path for the current (or supplied) platform, with
 * any `app.asar` segment rewritten to `app.asar.unpacked`. `undefined` when it
 * cannot be resolved — callers should then let the SDK resolve on its own.
 */
export function resolveCodexExecutablePath(env: CodexExecPathEnv = {}): string | undefined {
    const platform = env.platform ?? process.platform;
    const arch = env.arch ?? process.arch;
    const resolve = env.resolve ?? defaultResolve;
    const existsSync = env.existsSync ?? fs.existsSync;

    const triple = TARGET_TRIPLE_BY_PLATFORM[`${platform}-${arch}`];
    if (!triple) {
        return undefined;
    }
    const platformPackage = PLATFORM_PACKAGE_BY_TARGET[triple];
    if (!platformPackage) {
        return undefined;
    }

    let vendorRoot: string;
    try {
        const platformPkgJson = resolve(`${platformPackage}/package.json`);
        vendorRoot = path.join(path.dirname(platformPkgJson), 'vendor');
    } catch {
        return undefined;
    }

    const binName = platform === 'win32' ? 'codex.exe' : 'codex';
    const candidates = [
        path.join(vendorRoot, triple, 'bin', binName), // current SDK layout
        path.join(vendorRoot, triple, 'codex', binName), // legacy layout
    ];
    for (const candidate of candidates) {
        const resolved = preferUnpackedPath(candidate, existsSync);
        try {
            if (existsSync(resolved)) {
                return resolved;
            }
        } catch {
            // Try the next candidate on any fs error.
        }
    }
    return undefined;
}
