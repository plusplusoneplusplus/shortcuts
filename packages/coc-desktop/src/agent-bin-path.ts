/**
 * CoC Desktop — bundled agent-CLI PATH resolution.
 *
 * The CoC server spawns the agent CLIs by bare name (`copilot`, `codex`,
 * `claude`; see `process-resume-handler.ts`), resolving them on `PATH`. The
 * desktop app already *bundles* those real CLIs as platform-specific packages:
 *
 *   - `@github/copilot-<plat>-<arch>/copilot`
 *   - `@openai/codex-<plat>-<arch>/vendor/<triple>/bin/codex`   (nested)
 *   - `@anthropic-ai/claude-agent-sdk-<plat>-<arch>/claude`
 *
 * but their directories are not on the forked server's `PATH`, so the server
 * can't find them and the preflight nags the user to install them again. Worse,
 * a Finder/Dock-launched macOS app inherits launchd's minimal `PATH`, so even
 * a user-installed CLI is invisible. This module resolves the bundled binaries'
 * directories so callers can prepend them to `PATH` — making the app
 * self-contained for both the server and the preflight.
 *
 * It imports NOTHING from `electron` (unit-testable under plain Node/vitest) and
 * every resolution is best-effort: a provider that can't be resolved is silently
 * skipped, never throwing, so a packaging quirk degrades to today's behavior
 * (rely on the user's PATH) instead of breaking startup.
 */

import * as fs from 'fs';
import * as path from 'path';

/** A bundled agent CLI and the platform-package family that ships it. */
export interface BundledAgent {
    /** Stable provider id — matches the coc server's provider ids. */
    id: 'copilot' | 'codex' | 'claude';
    /** Executable name probed on PATH / searched for (no extension). */
    bin: string;
    /**
     * Scoped package *family*; the installed platform package is
     * `${family}-${platform}-${arch}` (e.g. `@github/copilot-darwin-arm64`).
     */
    packageFamily: string;
}

/**
 * The three agent CLIs the desktop app bundles. `bin` mirrors exactly what the
 * server spawns, so a resolved directory on PATH means the runtime finds the
 * same executable.
 */
export const BUNDLED_AGENTS: readonly BundledAgent[] = [
    { id: 'copilot', bin: 'copilot', packageFamily: '@github/copilot' },
    { id: 'codex', bin: 'codex', packageFamily: '@openai/codex' },
    { id: 'claude', bin: 'claude', packageFamily: '@anthropic-ai/claude-agent-sdk' },
];

/** Injectable seams so tests never touch the real module graph or disk. */
export interface BinResolveEnv {
    /** Defaults to `process.platform`. */
    platform?: NodeJS.Platform;
    /** Defaults to `process.arch`. */
    arch?: string;
    /** Resolve a package name to its on-disk directory, or null. */
    resolvePackageDir?: (packageName: string) => string | null;
    /** Find an executable named `binName` under `dir` (bounded depth), or null. */
    findExecutable?: (dir: string, binName: string) => string | null;
}

/** The installed platform package name for a bundled agent family. */
export function platformPackageName(family: string, platform: NodeJS.Platform, arch: string): string {
    return `${family}-${platform}-${arch}`;
}

/**
 * Rewrite an `app.asar` path segment to `app.asar.unpacked` so a binary that
 * electron-builder unpacked resolves to the real on-disk file (an executable
 * inside the asar archive can't be spawned or `PATH`-resolved). Handles both
 * POSIX and Windows separators and is a no-op in dev (no asar in the path).
 */
export function toUnpackedPath(p: string): string {
    return p.replace(/([\\/])app\.asar([\\/])/g, '$1app.asar.unpacked$2');
}

/** Default package-dir resolver: locate the package's directory via Node resolution. */
function defaultResolvePackageDir(packageName: string): string | null {
    // Prefer resolving the package.json (gives the package root directly).
    try {
        return path.dirname(require.resolve(`${packageName}/package.json`));
    } catch {
        // Some packages block deep `package.json` resolution via "exports" — fall
        // back to scanning the resolution roots for the package directory.
    }
    let roots: string[] = [];
    try {
        roots = require.resolve.paths(packageName) ?? [];
    } catch {
        return null;
    }
    const segments = packageName.split('/');
    for (const root of roots) {
        const candidate = path.join(root, ...segments);
        try {
            if (fs.existsSync(path.join(candidate, 'package.json'))) {
                return candidate;
            }
        } catch {
            // ignore and keep scanning
        }
    }
    return null;
}

/** Default executable finder: bounded-depth search for a file named `binName`. */
function defaultFindExecutable(dir: string, binName: string): string | null {
    const MAX_DEPTH = 6;
    const stack: Array<{ dir: string; depth: number }> = [{ dir, depth: 0 }];
    while (stack.length > 0) {
        const { dir: current, depth } = stack.pop() as { dir: string; depth: number };
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isFile() && entry.name === binName) {
                return full;
            }
            if (entry.isDirectory() && depth < MAX_DEPTH) {
                stack.push({ dir: full, depth: depth + 1 });
            }
        }
    }
    return null;
}

/** Candidate executable names for `bin` on the target platform. */
function binCandidates(bin: string, platform: NodeJS.Platform): string[] {
    return platform === 'win32' ? [`${bin}.exe`, bin] : [bin];
}

/**
 * Resolve the directory containing one bundled agent's executable, or null when
 * it isn't bundled/resolvable. Never throws.
 */
export function resolveBundledBinDir(agent: BundledAgent, env: BinResolveEnv = {}): string | null {
    const platform = env.platform ?? process.platform;
    const arch = env.arch ?? process.arch;
    const resolvePackageDir = env.resolvePackageDir ?? defaultResolvePackageDir;
    const findExecutable = env.findExecutable ?? defaultFindExecutable;

    try {
        const pkgName = platformPackageName(agent.packageFamily, platform, arch);
        const pkgDir = resolvePackageDir(pkgName);
        if (!pkgDir) {
            return null;
        }
        // Walk the real on-disk dir (rewrite asar → asar.unpacked first).
        const realPkgDir = toUnpackedPath(pkgDir);
        for (const name of binCandidates(agent.bin, platform)) {
            const found = findExecutable(realPkgDir, name);
            if (found) {
                return path.dirname(toUnpackedPath(found));
            }
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Resolve the directories of every bundled agent binary for the host platform.
 * Best-effort and de-duplicated; providers that can't be resolved are skipped.
 */
export function resolveBundledAgentBinDirs(
    env: BinResolveEnv = {},
    agents: readonly BundledAgent[] = BUNDLED_AGENTS,
): string[] {
    const dirs: string[] = [];
    const seen = new Set<string>();
    for (const agent of agents) {
        const dir = resolveBundledBinDir(agent, env);
        if (dir && !seen.has(dir)) {
            seen.add(dir);
            dirs.push(dir);
        }
    }
    return dirs;
}

/**
 * Prepend `dirs` to `basePath`, dropping any already present and de-duplicating.
 * Uses the target platform's PATH separator; comparison is case-insensitive on
 * Windows.
 */
export function prependToPath(dirs: readonly string[], basePath: string, platform: NodeJS.Platform): string {
    const sep = platform === 'win32' ? ';' : ':';
    const norm = (s: string) => (platform === 'win32' ? s.toLowerCase() : s);
    const existing = basePath.split(sep).filter(Boolean);
    const existingSet = new Set(existing.map(norm));
    const seen = new Set<string>();
    const prefix: string[] = [];
    for (const dir of dirs) {
        if (!dir) {
            continue;
        }
        const key = norm(dir);
        if (existingSet.has(key) || seen.has(key)) {
            continue;
        }
        seen.add(key);
        prefix.push(dir);
    }
    return [...prefix, ...existing].join(sep);
}

/**
 * Return `basePath` with the bundled agent binary directories prepended. The
 * single entry point callers use to make both the forked server and the
 * preflight see the bundled CLIs. Never throws; returns `basePath` unchanged
 * when nothing resolves.
 */
export function augmentPathWithBundledAgents(env: BinResolveEnv = {}, basePath?: string): string {
    const platform = env.platform ?? process.platform;
    const base = basePath ?? process.env.PATH ?? '';
    const dirs = resolveBundledAgentBinDirs(env);
    return prependToPath(dirs, base, platform);
}
