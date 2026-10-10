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

function decode(error: unknown): never {
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
        } catch (error) { decode(error); }
    }

    async getToken(options: { forceRefresh?: boolean } = {}): Promise<MicrosoftToken> {
        try {
            if (options.forceRefresh !== undefined && typeof options.forceRefresh !== 'boolean') {
                throw new AuthError('InvalidConfiguration');
            }
            return token(await this.native.getToken(options.forceRefresh));
        } catch (error) { return decode(error); }
    }

    async invalidate(): Promise<void> {
        try { await this.native.invalidate(); } catch (error) { decode(error); }
    }

    /** Deletes only this SDK's refresh credential. Not server-side revocation. */
    async deleteCredentials(): Promise<void> {
        try { await this.native.deleteCredentials(); } catch (error) { decode(error); }
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
        } catch (error) { decode(error); }
    }

    async beginBrowser(): Promise<MicrosoftSignInInstructions> {
        try { return await this.native.beginBrowser(); } catch (error) { return decode(error); }
    }

    async beginDevice(): Promise<MicrosoftSignInInstructions> {
        try { return await this.native.beginDevice(); } catch (error) { return decode(error); }
    }

    async wait(): Promise<MicrosoftSignInResult> {
        try {
            const value = await this.native.wait();
            return { ...value, token: token(value.token) };
        } catch (error) { return decode(error); }
    }

    cancel(): void { this.native.cancel(); }
    dispose(): void { this.native.dispose(); }
}
