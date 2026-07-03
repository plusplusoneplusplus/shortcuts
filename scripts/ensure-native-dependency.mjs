#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const requireFromCwd = createRequire(path.join(process.cwd(), "package.json"));

/**
 * Load a package so that its native addon actually dlopens. better-sqlite3
 * loads its compiled `.node` lazily inside `new Database()` — a bare require()
 * "succeeds" even when the binary was built for a different NODE_MODULE_VERSION,
 * and the ABI mismatch would only explode later inside the running server.
 * Constructing (and closing) an in-memory database forces the real load.
 */
export function loadAndExercisePackage(packageName, requireFn) {
    const mod = requireFn(packageName);
    if (packageName === "better-sqlite3") {
        new mod(":memory:").close();
    }
}

function defaultLoadPackage(packageName) {
    loadAndExercisePackage(packageName, requireFromCwd);
}

function defaultRebuildPackage(packageName) {
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    return spawnSync(npmCommand, ["rebuild", packageName], {
        cwd: process.cwd(),
        stdio: "inherit",
    });
}

function loadErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

export function ensureNativeDependency(packageName, options = {}) {
    if (!packageName || packageName.startsWith("-")) {
        throw new Error(`Invalid package name: ${packageName}`);
    }

    const loadPackage = options.loadPackage ?? defaultLoadPackage;
    const rebuildPackage = options.rebuildPackage ?? defaultRebuildPackage;
    const logger = options.logger ?? console;

    try {
        loadPackage(packageName);
        return { ok: true, rebuilt: false };
    } catch (initialError) {
        logger.warn(
            `${packageName} failed to load (${loadErrorMessage(initialError)}). Rebuilding native package...`,
        );
    }

    const rebuildResult = rebuildPackage(packageName);
    const rebuildStatus =
        typeof rebuildResult === "number" ? rebuildResult : rebuildResult?.status;

    if (rebuildStatus !== 0) {
        logger.error(`${packageName} rebuild failed with exit code ${rebuildStatus ?? "unknown"}.`);
        return { ok: false, rebuilt: true };
    }

    try {
        loadPackage(packageName);
        logger.log(`${packageName} loaded after rebuild.`);
        return { ok: true, rebuilt: true };
    } catch (finalError) {
        logger.error(`${packageName} still failed to load after rebuild: ${loadErrorMessage(finalError)}`);
        return { ok: false, rebuilt: true };
    }
}

export function ensureNativeDependencies(packageNames, options = {}) {
    const results = [];
    let ok = true;

    for (const packageName of packageNames) {
        const result = ensureNativeDependency(packageName, options);
        results.push({ packageName, ...result });
        ok = result.ok && ok;
    }

    return { ok, results };
}

function main() {
    const packageNames = process.argv.slice(2);

    if (packageNames.length === 0) {
        console.error("Usage: node scripts/ensure-native-dependency.mjs <package> [package...]");
        return 2;
    }

    return ensureNativeDependencies(packageNames).ok ? 0 : 1;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
    process.exitCode = main();
}
