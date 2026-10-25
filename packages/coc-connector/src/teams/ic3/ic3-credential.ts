import { TeamsAzureCliCredential } from '../azure-cli-credential';
import { AuthError, NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';
import {
    IC3_CREDENTIAL_EXPIRY_MARGIN_MS, IC3_DIRECT_MESSAGE_TIMEOUT_MS, IC3_RESOURCE,
    isIc3DirectMessageRegion,
    type Ic3DirectMessageOptions, type Ic3DirectMessageRegion, type Ic3TokenProvider,
} from './ic3-direct-message-config';
import { TeamsOperationError } from '../operations';

interface Credential {
    value: string;
    expiresAt: number;
    objectId?: string;
    tenantId?: string;
    displayName?: string;
}

interface Attempt {
    signal: AbortSignal;
    writeStarted: boolean;
    startWrite(): void;
}

const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bounds providers and response readers even when they ignore AbortSignal. */
export function boundedIc3<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
        const abort = () => reject(new Error('IC3 operation aborted'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

export function ic3HttpError(response: Response): TeamsOperationError {
    const code = response.status === 401 || response.status === 403 ? 'authentication'
        : response.status === 429 ? 'rate-limited' : 'rejected';
    const retryAfter = response.headers.get('retry-after');
    const delay = retryAfter === null ? NaN : /^\d+(?:\.\d+)?$/.test(retryAfter)
        ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
    // A server error does not prove the write was rolled back.
    return new TeamsOperationError(`rejected (HTTP ${response.status}); not retried; check IC3 region configuration and account access`, 'ic3', code,
        response.status >= 500 || response.status === 408 ? 'unknown' : 'rejected',
        Number.isFinite(delay) ? Math.max(0, delay) : undefined,
        response.status === 401 || response.status === 429);
}

/** Instance-scoped IC3 credentials, never MCP or Graph credentials. */
export class Ic3CredentialStore {
    readonly region?: Ic3DirectMessageRegion;
    private credential: Credential | null = null;
    private readonly acquireToken: Ic3TokenProvider;
    private readonly expectedAccount: Ic3DirectMessageOptions['expectedAccount'];
    private readonly lifetime = new AbortController();
    private readonly nativeCredential?: TeamsAzureCliCredential;

    constructor(options: Ic3DirectMessageOptions = {}) {
        const region = options.region;
        if (region !== undefined && !isIc3DirectMessageRegion(region)) {
            throw new TeamsOperationError('unavailable: region must be amer, emea, or apac',
                'ic3', 'unsupported', 'not-attempted');
        }
        this.region = region;
        if (!options.acquireToken) this.nativeCredential = new TeamsAzureCliCredential(IC3_RESOURCE);
        this.acquireToken = options.acquireToken ?? (signal => this.nativeCredential!.get(signal));
        this.expectedAccount = options.expectedAccount ? { ...options.expectedAccount } : undefined;
        if (this.expectedAccount
            && (typeof this.expectedAccount.tenantId !== 'string' || !guid.test(this.expectedAccount.tenantId)
                || typeof this.expectedAccount.objectId !== 'string' || !guid.test(this.expectedAccount.objectId))) {
            throw new TeamsOperationError('unavailable: invalid IC3 account identity',
                'ic3', 'authentication', 'not-attempted');
        }
    }

    requireRegion(): void {
        if (this.region === undefined) {
            throw new TeamsOperationError('unavailable: configure IC3 region (amer, emea, or apac) in Teams connection settings and reconnect',
                'ic3', 'configuration', 'not-attempted');
        }
    }

    clear(): void {
        this.nativeCredential?.clear();
        this.credential = null;
    }

    dispose(): void {
        this.lifetime.abort();
        this.nativeCredential?.dispose();
        this.clear();
    }

    async run<T>(operation: (attempt: Attempt) => Promise<T>, caller?: AbortSignal,
        timeoutMs = IC3_DIRECT_MESSAGE_TIMEOUT_MS): Promise<T> {
        this.requireRegion();
        if (this.lifetime.signal.aborted) {
            throw new TeamsOperationError('unavailable: disposed', 'ic3', 'unavailable', 'not-attempted');
        }
        const deadline = new AbortController();
        const timer = setTimeout(() => deadline.abort(), timeoutMs).unref();
        let writeTimer: ReturnType<typeof setTimeout> | undefined;
        const signal = AbortSignal.any([deadline.signal, this.lifetime.signal, ...(caller ? [caller] : [])]);
        const attempt: Attempt = { signal, writeStarted: false, startWrite: () => {
            signal.throwIfAborted();
            attempt.writeStarted = true;
            writeTimer = setTimeout(() => deadline.abort(), IC3_DIRECT_MESSAGE_TIMEOUT_MS).unref();
        } };
        try {
            signal.throwIfAborted();
            return await operation(attempt);
        } catch (error) {
            this.clear();
            if (signal.aborted) {
                const timedOut = deadline.signal.aborted;
                throw new TeamsOperationError(timedOut ? 'timed out' : 'cancelled',
                    'ic3', timedOut ? 'timeout' : 'unavailable', attempt.writeStarted ? 'unknown' : 'not-attempted',
                    undefined, timedOut && !attempt.writeStarted);
            }
            if (error instanceof TeamsOperationError) throw error;
            throw new TeamsOperationError('failed; delivery may be unknown', 'ic3', 'network',
                attempt.writeStarted ? 'unknown' : 'not-attempted');
        } finally {
            clearTimeout(timer);
            clearTimeout(writeTimer);
        }
    }

    async get(signal: AbortSignal, requireSender = false): Promise<Credential> {
        this.requireRegion();
        return this.read(signal, requireSender);
    }

    /** Trouter is region-independent; writes still require an explicit region. */
    async getForNotifications(signal: AbortSignal): Promise<Credential> {
        if (!this.expectedAccount) throw this.invalidCredential();
        return this.read(signal, false);
    }

    private async read(signal: AbortSignal, requireSender: boolean): Promise<Credential> {
        signal.throwIfAborted();
        let credential = this.credential;
        if (this.nativeCredential || !credential || credential.expiresAt <= Date.now() + IC3_CREDENTIAL_EXPIRY_MARGIN_MS) {
            this.credential = null;
            let value: string;
            try {
                value = await boundedIc3(this.acquireToken(signal), signal);
            } catch (error) {
                if (error instanceof NativeAddonLoadError) {
                    throw new TeamsOperationError('IC3 native authentication unavailable; rebuild with npm run build:native -w packages/coc-native',
                        'ic3', 'unavailable', 'not-attempted');
                }
                const reason = error instanceof AuthError ? ` (${error.code})` : '';
                throw new TeamsOperationError(`unavailable: IC3 credential could not be acquired${reason}`,
                    'ic3', 'authentication', 'not-attempted', undefined,
                    error instanceof AuthError && ['TimedOut', 'TokenExpired', 'LoginRequired', 'StorageLocked'].includes(error.code));
            }
            let claims: { aud?: unknown; exp?: unknown; oid?: unknown; tid?: unknown; name?: unknown };
            try {
                claims = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8'));
            } catch {
                throw this.invalidCredential();
            }
            if (!claims || claims.aud !== IC3_RESOURCE || typeof claims.exp !== 'number'
                || !Number.isFinite(claims.exp)
                || claims.exp * 1000 <= Date.now() + IC3_CREDENTIAL_EXPIRY_MARGIN_MS) {
                throw this.invalidCredential();
            }
            credential = {
                value, expiresAt: claims.exp * 1000,
                objectId: typeof claims.oid === 'string' && guid.test(claims.oid) ? claims.oid : undefined,
                tenantId: typeof claims.tid === 'string' && guid.test(claims.tid) ? claims.tid : undefined,
                displayName: typeof claims.name === 'string' && claims.name.trim() ? claims.name : undefined,
            };
        }
        if (requireSender && (!credential.objectId || !credential.displayName)) throw this.invalidCredential();
        if (this.expectedAccount && (!credential.tenantId || !credential.objectId
            || credential.tenantId.toLowerCase() !== this.expectedAccount.tenantId.toLowerCase()
            || credential.objectId.toLowerCase() !== this.expectedAccount.objectId.toLowerCase())) {
            throw new TeamsOperationError('unavailable: IC3 account identity mismatch',
                'ic3', 'authentication', 'not-attempted');
        }
        signal.throwIfAborted();
        this.lifetime.signal.throwIfAborted();
        if (!this.nativeCredential) this.credential = credential;
        return credential;
    }

    private invalidCredential(): TeamsOperationError {
        return new TeamsOperationError('unavailable: invalid IC3 credential or missing sender claims',
            'ic3', 'authentication', 'not-attempted');
    }
}
