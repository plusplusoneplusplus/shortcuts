/**
 * SDK Loader
 *
 * Isolates SDK discovery and the ESM dynamic-import workaround so they
 * can be unit-tested and swapped independently of CopilotSDKService.
 *
 * **Resolution strategy (loadSdk):**
 * 1. Try Node's standard module resolution via dynamic `import('@github/copilot-sdk')`.
 *    This works for published npm packages (CoC, deep-wiki) regardless of hoisting.
 * 2. Fall back to `__dirname`-relative file probing + file-URL import.  This covers
 *    the VS Code extension where webpack rewrites `import()` and the SDK is marked
 *    external — `new Function('specifier','return import(specifier)')` bypasses
 *    webpack's static analysis so the runtime import is used.
 *
 * **findSdkBinaryPath** is kept for the availability check (`isAvailable()`) which
 * needs a sync answer before any async import happens.
 */

import * as path from 'path';
import * as fs from 'fs';

/**
 * The minimal shape of the loaded @github/copilot-sdk module that callers need.
 */
export interface SdkModule {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    CopilotClient: new (options?: any) => any;
}

// Bypass webpack's import() transformation using the Function constructor.
// Webpack rewrites bare `import()` calls; `new Function` is opaque to static analysis.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const nativeImport: (specifier: string) => Promise<unknown> =
    new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;

/**
 * Find the installed @github/copilot-sdk package directory.  Returns the
 * package root (the directory containing `dist/index.js`), or `undefined`.
 *
 * Uses `require.resolve` first (works for any npm install layout including
 * hoisting), then falls back to `__dirname`-relative probing for edge cases
 * like the VS Code extension webpack bundle.
 */
export function findSdkBinaryPath(
    existsFn: (p: string) => boolean = fs.existsSync,
    resolveFn?: (id: string) => string,
): string | undefined {
    // Primary: Node's standard module resolution — handles hoisting correctly
    const resolve = resolveFn ?? ((id: string) => require.resolve(id));
    try {
        const sdkEntry = resolve('@github/copilot-sdk');
        const sdkDir = path.dirname(sdkEntry);
        const sdkRoot = sdkDir.endsWith('dist') ? path.dirname(sdkDir) : sdkDir;
        const indexPath = path.join(sdkRoot, 'dist', 'index.js');
        if (existsFn(indexPath)) {
            return sdkRoot;
        }
    } catch {
        // require.resolve throws when the package is not installed — fall through
    }

    // Fallback: __dirname-relative probing (VS Code extension / monorepo layouts)
    const relativeCandidates = [
        path.join(__dirname, '..', 'node_modules', '@github', 'copilot-sdk'),
        path.join(__dirname, '..', '..', '..', 'node_modules', '@github', 'copilot-sdk'),
        path.join(__dirname, 'node_modules', '@github', 'copilot-sdk'),
        path.join(__dirname, '..', '..', '..', '..', 'node_modules', '@github', 'copilot-sdk'),
    ];

    for (const testPath of relativeCandidates) {
        const indexPath = path.join(testPath, 'dist', 'index.js');
        if (existsFn(indexPath)) {
            return testPath;
        }
    }

    return undefined;
}

/**
 * Load the @github/copilot-sdk module and return the typed module object.
 *
 * 1. Try `import('@github/copilot-sdk')` via Node's native resolution (npm).
 * 2. If that fails, resolve the SDK by file path and import via file URL
 *    (needed for the webpack VS Code extension bundle).
 *
 * @param sdkPath - Absolute path to the SDK package root (as returned by
 *   `findSdkBinaryPath()`).  Used only when the npm-style import fails.
 * @param importFn - Optional override for the dynamic import call.  Pass a
 *   custom function in tests to avoid `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`
 *   inside Vitest's VM context.
 * @throws {Error} When `CopilotClient` is not exported by the loaded module.
 */
export async function loadSdk(
    sdkPath: string,
    importFn?: (specifier: string) => Promise<unknown>,
): Promise<SdkModule> {
    const doImport = importFn ?? nativeImport;

    // Strategy 1: import by package name — works for any standard npm install
    try {
        const sdk = await doImport('@github/copilot-sdk');
        if ((sdk as any)?.CopilotClient) {
            return sdk as SdkModule;
        }
    } catch {
        // Package not resolvable by name — fall through to file-path import
    }

    // Strategy 2: import by absolute file URL (webpack / extension scenario)
    const sdkIndexPath = path.join(sdkPath, 'dist', 'index.js');
    const { pathToFileURL } = await import('url');
    const sdkUrl = pathToFileURL(sdkIndexPath).href;

    const sdk = await doImport(sdkUrl);

    if (!(sdk as any).CopilotClient) {
        throw new Error('CopilotClient not found in SDK module');
    }

    return sdk as SdkModule;
}
