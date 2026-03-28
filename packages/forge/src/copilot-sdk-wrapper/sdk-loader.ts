/**
 * SDK Loader
 *
 * Provides a synchronous availability check for @github/copilot-sdk.
 * The SDK is a direct npm dependency — no dynamic loading needed.
 */

/**
 * Check whether `@github/copilot-sdk` is resolvable from the current
 * Node.js module graph.  Returns the resolved entry-point path on
 * success, or `undefined` when the package is not installed.
 *
 * @param resolveFn - Override for `require.resolve` (useful in tests).
 */
export function findSdkBinaryPath(
    resolveFn?: (id: string) => string,
): string | undefined {
    const resolve = resolveFn ?? ((id: string) => require.resolve(id));
    try {
        return resolve('@github/copilot-sdk');
    } catch {
        return undefined;
    }
}
