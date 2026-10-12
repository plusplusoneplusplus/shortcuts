import { loadNativeAddon, NativeAddonLoadError } from './loader';
import { AuthError, decodeAuthError } from './auth';
import type * as Bindings from './native-bindings';

export type GitHubAccount = Bindings.GitHubAccount;
export type GitHubCredentialSnapshot = Readonly<Bindings.GitHubCredentialSnapshot>;
export type GitHubCredentialOptions = { timeoutMs?: number } & (
    | { source: 'cli-config'; configPath: string; account: 'active-cli-account' | GitHubAccount }
    | { source: 'gh-cli'; account: GitHubAccount }
);

export function loadNativeGitHubAuth(): Pick<typeof Bindings, 'NativeGitHubCredentialRequest'> {
    const addon = loadNativeAddon() as Partial<Pick<typeof Bindings, 'NativeGitHubCredentialRequest'>>;
    const request = addon.NativeGitHubCredentialRequest;
    if (typeof request?.copilotCliConfig !== 'function' || typeof request.ghCli !== 'function'
        || !['read', 'cancel'].every(method => typeof Reflect.get(request.prototype, method) === 'function')) {
        throw new NativeAddonLoadError(
            '@plusplusoneplusplus/coc-native: missing GitHub authentication capability. ' +
            'Rebuild with `npm run build:native -w packages/coc-native`.',
        );
    }
    return { NativeGitHubCredentialRequest: request };
}

/** Reads anew, with request-scoped cancellation. Returned JS token strings cannot be zeroized. */
export async function readGitHubCredential(options: GitHubCredentialOptions, signal?: AbortSignal): Promise<GitHubCredentialSnapshot> {
    if (signal?.aborted) throw new AuthError('Cancelled');
    let request: Bindings.NativeGitHubCredentialRequest | undefined;
    let abort: (() => void) | undefined;
    try {
        if (!options || (options.timeoutMs !== undefined
            && (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 10_000))) {
            throw new AuthError('InvalidConfiguration');
        }
        const native = loadNativeGitHubAuth().NativeGitHubCredentialRequest;
        if (options.source === 'cli-config') {
            if (options.account !== 'active-cli-account'
                && (!options.account || typeof options.account !== 'object')) throw new AuthError('InvalidConfiguration');
            request = native.copilotCliConfig(options.configPath,
                options.account === 'active-cli-account' ? undefined : options.account, options.timeoutMs);
        } else if (options.source === 'gh-cli') {
            request = native.ghCli(options.account, options.timeoutMs);
        } else {
            throw new AuthError('InvalidConfiguration');
        }
        const pending = request.read();
        const cancelled = new Promise<never>((_, reject) => {
            abort = () => { request?.cancel(); reject(new AuthError('Cancelled')); };
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) abort();
        });
        const snapshot = await Promise.race([pending, cancelled]);
        if (signal?.aborted) throw new AuthError('Cancelled');
        return Object.freeze(snapshot);
    } catch (error) {
        return decodeAuthError(error);
    } finally {
        if (abort) signal?.removeEventListener('abort', abort);
        request?.cancel();
    }
}
