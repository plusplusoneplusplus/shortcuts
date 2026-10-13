import { loadNativeAddon, NativeAddonLoadError } from './loader';
import type * as Bindings from './native-bindings';

export type MicrosoftAccount = Bindings.MicrosoftAccount;
export type MicrosoftOAuthOptions = Bindings.MicrosoftOAuthOptions;
export type MicrosoftToken = Omit<Bindings.MicrosoftToken, 'source'> & { source: 'oauth' | 'azure-cli' };
export type MicrosoftSignInInstructions = Bindings.MicrosoftSignInInstructions;
export type MicrosoftSignInResult = Omit<Bindings.MicrosoftSignInResult, 'token'> & { token: MicrosoftToken };
export type AuthErrorCode =
    | 'InvalidConfiguration' | 'CliUnavailable' | 'LoginRequired' | 'InteractionRequired'
    | 'AccountMismatch' | 'TokenExpired' | 'RefreshDisabled' | 'StorageUnavailable'
    | 'StorageFailed' | 'CoordinationUnavailable' | 'InvalidTokenResponse'
    | 'StorageLocked' | 'StorageDenied'
    | 'IdentityVerificationFailed' | 'AccessDenied' | 'TimedOut' | 'Cancelled' | 'Disposed';

const errorCodes: ReadonlySet<string> = new Set<AuthErrorCode>([
    'InvalidConfiguration', 'CliUnavailable', 'LoginRequired', 'InteractionRequired',
    'AccountMismatch', 'TokenExpired', 'RefreshDisabled', 'StorageUnavailable', 'StorageFailed',
    'StorageLocked', 'StorageDenied',
    'CoordinationUnavailable', 'InvalidTokenResponse', 'IdentityVerificationFailed',
    'AccessDenied', 'TimedOut', 'Cancelled', 'Disposed',
]);

export class AuthError extends Error {
    override readonly name = 'AuthError';
    constructor(readonly code: AuthErrorCode) {
        super(`Authentication failed: ${code}.`);
    }
}

export function decodeAuthError(error: unknown): never {
    if (error instanceof NativeAddonLoadError || error instanceof AuthError) throw error;
    const message = error instanceof Error ? error.message : '';
    const code = /^\[auth-sdk:([A-Za-z]+)\]/.exec(message)?.[1];
    // Never retain a native/provider error as cause: its payload may contain credentials.
    throw new AuthError(code && errorCodes.has(code) ? code as AuthErrorCode : 'InvalidConfiguration');
}

interface AuthAddon {
    NativeMicrosoftTokenProvider: typeof Bindings.NativeMicrosoftTokenProvider;
    NativeMicrosoftOAuthSignIn: typeof Bindings.NativeMicrosoftOAuthSignIn;
}

export function loadNativeAuth(): AuthAddon {
    const addon = loadNativeAddon() as Partial<AuthAddon>;
    const provider = addon.NativeMicrosoftTokenProvider;
    const signIn = addon.NativeMicrosoftOAuthSignIn;
    if (typeof provider?.oauth !== 'function' || typeof provider.azureCli !== 'function'
        || typeof provider.azureCliActive !== 'function'
        || !['getToken', 'invalidate', 'deleteCredentials', 'cancelOutstanding', 'dispose']
            .every(method => typeof Reflect.get(provider.prototype, method) === 'function')
        || typeof signIn !== 'function'
        || !['beginBrowser', 'beginDevice', 'wait', 'cancel', 'dispose']
            .every(method => typeof Reflect.get(signIn.prototype, method) === 'function')) {
        throw new NativeAddonLoadError(
            '@plusplusoneplusplus/coc-native: missing Microsoft authentication capability. ' +
            'Rebuild with `npm run build:native -w packages/coc-native`.',
        );
    }
    return addon as AuthAddon;
}

interface Policy {
    refresh: 'auto' | 'never';
    expiryMarginSeconds?: number;
    timeoutMs?: number;
}
export type MicrosoftTokenProviderOptions = Policy & (
    | { source: 'oauth'; oauth: MicrosoftOAuthOptions; account: MicrosoftAccount }
    | { source: 'azure-cli'; azureCli: Bindings.MicrosoftAzureCliOptions
        | (Bindings.MicrosoftActiveAzureCliOptions & { selection: 'active-account' }) }
);
export type MicrosoftTokenSource = MicrosoftTokenProviderOptions['source'];

function numberOption(value: number | undefined, min: number, max: number): void {
    if (value !== undefined && (!Number.isInteger(value) || value < min || value > max)) {
        throw new AuthError('InvalidConfiguration');
    }
}

function token(value: Bindings.MicrosoftToken): MicrosoftToken {
    if (value.source !== 'oauth' && value.source !== 'azure-cli') throw new AuthError('InvalidTokenResponse');
    return { ...value, source: value.source };
}

/** Immutable source/account/target. Construction performs validation only. */
export class MicrosoftTokenProvider {
    private readonly native: Bindings.NativeMicrosoftTokenProvider;

    constructor(options: MicrosoftTokenProviderOptions) {
        try {
            if (!options || (options.refresh !== 'auto' && options.refresh !== 'never')) {
                throw new AuthError('InvalidConfiguration');
            }
            numberOption(options.expiryMarginSeconds, 0, 3600);
            numberOption(options.timeoutMs, 100, 900_000);
            const addon = loadNativeAuth();
            if (options.source === 'oauth') {
                this.native = addon.NativeMicrosoftTokenProvider.oauth(options.oauth, options.account, options);
            } else if (options.source === 'azure-cli') {
                if ('selection' in options.azureCli) {
                    if (options.azureCli.selection !== 'active-account'
                        || 'account' in options.azureCli || 'subscription' in options.azureCli) {
                        throw new AuthError('InvalidConfiguration');
                    }
                    this.native = addon.NativeMicrosoftTokenProvider.azureCliActive(options.azureCli, options);
                } else {
                    this.native = addon.NativeMicrosoftTokenProvider.azureCli(options.azureCli, options);
                }
            } else {
                throw new AuthError('InvalidConfiguration');
            }
        } catch (error) { decodeAuthError(error); }
    }

    async getToken(options: { forceRefresh?: boolean } = {}): Promise<MicrosoftToken> {
        try {
            if (options.forceRefresh !== undefined && typeof options.forceRefresh !== 'boolean') {
                throw new AuthError('InvalidConfiguration');
            }
            return token(await this.native.getToken(options.forceRefresh));
        } catch (error) { return decodeAuthError(error); }
    }

    async invalidate(): Promise<void> {
        try { await this.native.invalidate(); } catch (error) { decodeAuthError(error); }
    }

    /** Deletes only this SDK's refresh credential. Not server-side revocation. */
    async deleteCredentials(): Promise<void> {
        try { await this.native.deleteCredentials(); } catch (error) { decodeAuthError(error); }
    }

    cancelOutstanding(): void { this.native.cancelOutstanding(); }
    dispose(): void { this.native.dispose(); }
}

/** Explicit one-shot sign-in handle. The caller displays instructions/opens a browser. */
export class MicrosoftOAuthSignIn {
    private readonly native: Bindings.NativeMicrosoftOAuthSignIn;
    constructor(options: MicrosoftOAuthOptions, expectedAccount?: MicrosoftAccount, timeoutMs?: number) {
        try {
            numberOption(timeoutMs, 100, 900_000);
            this.native = new (loadNativeAuth().NativeMicrosoftOAuthSignIn)(options, expectedAccount, timeoutMs);
        } catch (error) { decodeAuthError(error); }
    }

    async beginBrowser(): Promise<MicrosoftSignInInstructions> {
        try { return await this.native.beginBrowser(); } catch (error) { return decodeAuthError(error); }
    }

    async beginDevice(): Promise<MicrosoftSignInInstructions> {
        try { return await this.native.beginDevice(); } catch (error) { return decodeAuthError(error); }
    }

    async wait(): Promise<MicrosoftSignInResult> {
        try {
            const value = await this.native.wait();
            return { ...value, token: token(value.token) };
        } catch (error) { return decodeAuthError(error); }
    }

    cancel(): void { this.native.cancel(); }
    dispose(): void { this.native.dispose(); }
}

export type MicrosoftOAuthRefreshOptions = Bindings.MicrosoftOAuthRefreshOptions & { timeoutMs?: number };
export type MicrosoftOAuthRefreshResponse = Readonly<Bindings.MicrosoftOAuthRefreshResponse>;
export type MicrosoftOAuthRefreshRejection = 'invalid_grant' | 'interaction_required' | 'consent_required';

/** Only rejection, not the broader SDK code, identifies cache-invalidating failures. */
export class MicrosoftOAuthRefreshError extends AuthError {
    constructor(code: AuthErrorCode, readonly status?: number, readonly rejection?: MicrosoftOAuthRefreshRejection) {
        super(code);
    }
}

export function loadNativeMicrosoftOAuthRefresh(): Pick<typeof Bindings, 'NativeMicrosoftOAuthRefreshRequest'> {
    const addon = loadNativeAddon() as Partial<Pick<typeof Bindings, 'NativeMicrosoftOAuthRefreshRequest'>>;
    const request = addon.NativeMicrosoftOAuthRefreshRequest;
    if (typeof request !== 'function'
        || !['exchange', 'cancel'].every(method => typeof Reflect.get(request.prototype, method) === 'function')) {
        throw new NativeAddonLoadError(
            '@plusplusoneplusplus/coc-native: missing Microsoft OAuth refresh capability. ' +
            'Rebuild with `npm run build:native -w packages/coc-native`.',
        );
    }
    return { NativeMicrosoftOAuthRefreshRequest: request };
}

function decodeRefreshError(error: unknown): never {
    if (error instanceof NativeAddonLoadError || error instanceof AuthError) throw error;
    const message = error instanceof Error ? error.message : '';
    const match = /^\[auth-refresh:([A-Za-z]+):(\d{3})?:(invalid_grant|interaction_required|consent_required)?\]/.exec(message);
    if (match && errorCodes.has(match[1])) {
        throw new MicrosoftOAuthRefreshError(
            match[1] as AuthErrorCode,
            match[2] ? Number(match[2]) : undefined,
            match[3] as MicrosoftOAuthRefreshRejection | undefined,
        );
    }
    return decodeAuthError(error);
}

/** One bounded exchange, without identity verification or storage. JS token strings cannot be zeroized. */
export async function exchangeMicrosoftRefreshToken(
    options: MicrosoftOAuthRefreshOptions,
    refreshToken: string,
    signal?: AbortSignal,
): Promise<MicrosoftOAuthRefreshResponse> {
    if (signal?.aborted) throw new AuthError('Cancelled');
    let request: Bindings.NativeMicrosoftOAuthRefreshRequest | undefined;
    let abort: (() => void) | undefined;
    try {
        if (!options || typeof refreshToken !== 'string') throw new AuthError('InvalidConfiguration');
        numberOption(options.timeoutMs, 100, 900_000);
        request = new (loadNativeMicrosoftOAuthRefresh().NativeMicrosoftOAuthRefreshRequest)(options, options.timeoutMs);
        abort = () => { request?.cancel(); };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        const response = await request.exchange(refreshToken);
        if (signal?.aborted) throw new AuthError('Cancelled');
        return Object.freeze(response);
    } catch (error) {
        return decodeRefreshError(error);
    } finally {
        if (abort) signal?.removeEventListener('abort', abort);
        request?.cancel();
    }
}
