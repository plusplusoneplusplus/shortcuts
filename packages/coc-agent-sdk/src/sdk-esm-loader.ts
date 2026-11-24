/**
 * Dynamic ESM Loader for @github/copilot-sdk
 *
 * Uses the SDK's ESM entry consistently from CommonJS builds. TypeScript's
 * CJS emit transforms `await import(...)` into `require(...)`, so an indirect
 * dynamic import preserves native module loading.
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
