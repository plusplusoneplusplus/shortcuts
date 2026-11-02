import { loadNativeAddon, NativeAddonLoadError } from './loader';
import { AuthError, decodeOAuthRefreshError } from './auth';
import type { AuthErrorCode, OAuthRefreshRejection } from './auth';
import type * as Bindings from './native-bindings';

export type ClaudeCredentialOptions = Bindings.ClaudeCredentialOptions;
export type ClaudeCredentialSnapshot = Readonly<Omit<Bindings.ClaudeCredentialSnapshot, 'scopes'>> & {
    readonly scopes: readonly string[];
};

export class ClaudeCredentialError extends AuthError {
    constructor(code: AuthErrorCode, readonly status?: number, readonly rejection?: OAuthRefreshRejection) {
        super(code);
    }
}

export function loadNativeClaudeAuth(): Pick<typeof Bindings, 'NativeClaudeCredentialRequest'> {
    const addon = loadNativeAddon() as Partial<Pick<typeof Bindings, 'NativeClaudeCredentialRequest'>>;
    const request = addon.NativeClaudeCredentialRequest;
    if (typeof request !== 'function'
        || !['acquire', 'cancel'].every(method => typeof Reflect.get(request.prototype, method) === 'function')) {
        throw new NativeAddonLoadError(
            '@plusplusoneplusplus/coc-native: missing Claude authentication capability. ' +
            'Rebuild with `npm run build:native -w packages/coc-native`.',
        );
    }
    return { NativeClaudeCredentialRequest: request };
}

/** One source-pinned acquisition with native renewal and persistence. JS token strings cannot be zeroized. */
export async function acquireClaudeCredential(
    options: ClaudeCredentialOptions,
    signal?: AbortSignal,
): Promise<ClaudeCredentialSnapshot> {
    if (signal?.aborted) throw new AuthError('Cancelled');
    let request: Bindings.NativeClaudeCredentialRequest | undefined;
    let abort: (() => void) | undefined;
    try {
        if (!options || typeof options.homeDir !== 'string' || typeof options.coordinationDirectory !== 'string'
            || (options.credentialsFile !== undefined && typeof options.credentialsFile !== 'string')
            || (options.skipKeychain !== undefined && typeof options.skipKeychain !== 'boolean')
            || (options.forceRefresh !== undefined && typeof options.forceRefresh !== 'boolean')
            || (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs)
                || options.timeoutMs < 100 || options.timeoutMs > 900_000))) {
            throw new AuthError('InvalidConfiguration');
        }
        request = new (loadNativeClaudeAuth().NativeClaudeCredentialRequest)(options);
        abort = () => { request?.cancel(); };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        const snapshot = await request.acquire();
        if (signal?.aborted) throw new AuthError('Cancelled');
        return Object.freeze({ ...snapshot, scopes: Object.freeze([...snapshot.scopes]) });
    } catch (error) {
        return decodeOAuthRefreshError(error, ClaudeCredentialError);
    } finally {
        if (abort) signal?.removeEventListener('abort', abort);
        request?.cancel();
    }
}
