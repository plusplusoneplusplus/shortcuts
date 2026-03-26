/**
 * SDK Loader
 *
 * Isolates SDK binary discovery and the ESM dynamic-import workaround so they
 * can be unit-tested and swapped independently of CopilotSDKService.
 *
 * The `new Function('return import()')` pattern is intentional and must stay
 * verbatim: webpack transforms bare `import()` calls in ways that break ESM
 * loading for packages whose entry point is an ES module (like @github/copilot-sdk).
 * Using the Function constructor bypasses webpack's static analysis so the
 * runtime dynamic import is used instead.
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

/**
 * Find the installed @github/copilot-sdk package directory by probing several
 * candidate locations. Returns the package root (the directory that contains
 * `dist/index.js`), or `undefined` when the SDK cannot be found.
 *
 * Probe order covers the common cases:
 * 1. Adjacent `node_modules` when running from a compiled `dist/` output.
 * 2. Three levels up for monorepo layouts (e.g. `out/shortcuts/ai-service`).
 * 3. Sibling `node_modules` (packaged extension scenario).
 * 4. Four levels up for workspace-root installs during development.
 *
 * @param existsFn - Optional override for `fs.existsSync`.  Pass a custom
 *   function in tests to avoid filesystem I/O.
 */
export function findSdkBinaryPath(
    existsFn: (p: string) => boolean = fs.existsSync,
    resolveFn?: (id: string) => string,
): string | undefined {
    const possiblePaths = [
        // Development: running from dist/
        path.join(__dirname, '..', 'node_modules', '@github', 'copilot-sdk'),
        // Development: running from out/shortcuts/ai-service
        path.join(__dirname, '..', '..', '..', 'node_modules', '@github', 'copilot-sdk'),
        // Packaged extension
        path.join(__dirname, 'node_modules', '@github', 'copilot-sdk'),
        // Workspace root (for development)
        path.join(__dirname, '..', '..', '..', '..', 'node_modules', '@github', 'copilot-sdk'),
        // Published package: forge is bundled inside a consumer's node_modules
        // e.g. node_modules/@plusplusoneplusplus/coc/node_modules/@plusplusoneplusplus/forge/dist/copilot-sdk-wrapper/
        // Walk up to the consumer package root, then to its parent node_modules
        path.join(__dirname, '..', '..', '..', '..', '..', 'node_modules', '@github', 'copilot-sdk'),
        // Published package: consumer is a scoped package (@scope/pkg) so one more level
        path.join(__dirname, '..', '..', '..', '..', '..', '..', 'node_modules', '@github', 'copilot-sdk'),
        // Published package: hoisted to top-level node_modules
        path.join(__dirname, '..', '..', '..', '..', '..', '..', '..', 'node_modules', '@github', 'copilot-sdk'),
    ];

    for (const testPath of possiblePaths) {
        const indexPath = path.join(testPath, 'dist', 'index.js');
        if (existsFn(indexPath)) {
            return testPath;
        }
    }

    // Fallback: use Node's module resolution which handles hoisting correctly
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
        // require.resolve throws when the package is not installed
    }

    return undefined;
}

/**
 * Dynamically import the @github/copilot-sdk module from the given package
 * directory and return the typed module object.
 *
 * Uses the `new Function('specifier', 'return import(specifier)')` workaround
 * to bypass webpack's `import()` transformation, which is required for correct
 * ESM loading at runtime.
 *
 * @param sdkPath - Absolute path to the SDK package root (as returned by
 *   `findSdkBinaryPath()`).  Must contain `dist/index.js`.
 * @param importFn - Optional override for the dynamic import call.  Defaults
 *   to the `new Function` workaround.  Pass a custom function in tests to
 *   avoid the `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` limitation inside
 *   Vitest's VM context.
 * @throws {Error} When `CopilotClient` is not exported by the loaded module.
 */
export async function loadSdk(
    sdkPath: string,
    importFn?: (specifier: string) => Promise<unknown>,
): Promise<SdkModule> {
    const sdkIndexPath = path.join(sdkPath, 'dist', 'index.js');

    // Import using file URL for ESM compatibility
    const { pathToFileURL } = await import('url');
    const sdkUrl = pathToFileURL(sdkIndexPath).href;

    // Bypass webpack's import transformation using Function constructor.
    // This is necessary because webpack transforms import() in ways that break ESM loading.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const dynamicImport: (specifier: string) => Promise<unknown> =
        importFn ?? (new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>);
    const sdk = await dynamicImport(sdkUrl);

    if (!(sdk as any).CopilotClient) {
        throw new Error('CopilotClient not found in SDK module');
    }

    return sdk as SdkModule;
}
