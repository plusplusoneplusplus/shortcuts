/**
 * Dynamic ESM Loader for @github/copilot-sdk
 *
 * The SDK is ESM-only ("type": "module" with only an "import" export condition).
 * Since forge compiles to CommonJS, static `import ... from '@github/copilot-sdk'`
 * becomes `require()` at runtime, which Node.js rejects with
 * ERR_PACKAGE_PATH_NOT_EXPORTED.
 *
 * TypeScript's CJS emit also transforms `await import(...)` into `require(...)`.
 * We use an indirect dynamic import via `new Function` to preserve the native
 * ESM `import()` at runtime, which works from CJS to load ESM modules.
 */

// Preserve native import() — TypeScript CJS emit would rewrite a bare `import()` to `require()`.
// eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

let cachedModule: typeof import('@github/copilot-sdk') | null = null;

/**
 * Dynamically import the @github/copilot-sdk ESM module.
 * The result is cached after the first successful load.
 */
export async function loadCopilotSdk(): Promise<typeof import('@github/copilot-sdk')> {
    if (cachedModule) return cachedModule;
    const mod: typeof import('@github/copilot-sdk') = await dynamicImport('@github/copilot-sdk');
    cachedModule = mod;
    return mod;
}

/** Dynamically import an arbitrary ESM module without TypeScript rewriting it to require(). */
export async function dynamicImportModule<T = any>(specifier: string): Promise<T> {
    return dynamicImport(specifier) as Promise<T>;
}

/**
 * Return the cached SDK module if already loaded, or `null`.
 * Useful for synchronous access after an earlier `loadCopilotSdk()` call.
 */
export function getCachedCopilotSdk(): typeof import('@github/copilot-sdk') | null {
    return cachedModule;
}

/** Reset the cache (for testing). */
export function resetSdkCache(): void {
    cachedModule = null;
}
