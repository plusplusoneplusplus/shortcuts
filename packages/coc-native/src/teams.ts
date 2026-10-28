import { loadNativeAddon, NativeAddonLoadError } from './loader';
import type * as Bindings from './native-bindings';

export type TeamsIc3SessionOptions = Omit<Bindings.TeamsIc3SessionOptions, 'region'> & {
    region: 'amer' | 'emea' | 'apac';
};
export type TeamsIc3Account = Readonly<Bindings.TeamsIc3Account>;
export type TeamsIc3Cursor = Bindings.NativeTeamsIc3Cursor;
export type TeamsIc3Chat = Readonly<Bindings.TeamsIc3Chat>;
export type TeamsIc3Message = Readonly<Omit<Bindings.TeamsIc3Message, 'mentionedUserIds'> & {
    mentionedUserIds?: readonly string[];
}>;
export interface TeamsIc3ReadOptions {
    cursor?: TeamsIc3Cursor;
    signal?: AbortSignal;
}
export interface TeamsIc3Page<T> {
    readonly items: readonly T[];
    readonly next?: TeamsIc3Cursor;
    /** Includes skipped system records; a single page is not a complete scan. */
    readonly rawCount: number;
}
export type NativeTeamsDelivery = 'NotAttempted' | 'Rejected' | 'Unknown';

const errorCodes = [
    'Configuration', 'Unsupported', 'InvalidTarget', 'Authentication', 'Permission',
    'NotFound', 'RateLimited', 'Rejected', 'Protocol', 'UnsafeCursor', 'Limit',
    'Cancelled', 'Closed', 'Timeout', 'Network',
] as const;
export type NativeTeamsErrorCode = typeof errorCodes[number];

export class NativeTeamsError extends Error {
    override readonly name = 'NativeTeamsError';
    constructor(
        readonly code: NativeTeamsErrorCode,
        readonly delivery: NativeTeamsDelivery = 'NotAttempted',
        readonly status?: number,
        readonly retryAfterMs?: number,
    ) {
        super(`Teams operation failed: ${code} (${delivery}).`);
    }
}

export function decodeNativeTeamsError(error: unknown): never {
    if (error instanceof NativeAddonLoadError || error instanceof NativeTeamsError) throw error;
    const match = /^\[teams-sdk:([A-Za-z]+):(NotAttempted|Rejected|Unknown):(\d{3})?:(\d+)?\]/
        .exec(error instanceof Error ? error.message : '');
    if (match && errorCodes.includes(match[1] as NativeTeamsErrorCode)) {
        throw new NativeTeamsError(
            match[1] as NativeTeamsErrorCode,
            match[2] as NativeTeamsDelivery,
            match[3] ? Number(match[3]) : undefined,
            match[4] ? Number(match[4]) : undefined,
        );
    }
    // An unclassified failure cannot establish that a write was not dispatched.
    throw new NativeTeamsError('Protocol', 'Unknown');
}

type TeamsAddon = Pick<typeof Bindings, 'NativeTeamsIc3Session' | 'NativeTeamsIc3Read'>;

export function loadNativeTeams(): TeamsAddon {
    const addon = loadNativeAddon() as Partial<TeamsAddon>;
    const session = addon.NativeTeamsIc3Session;
    const read = addon.NativeTeamsIc3Read;
    if (typeof session !== 'function'
        || !['connect', 'dispose', 'beginRead'].every(method => typeof Reflect.get(session.prototype, method) === 'function')
        || typeof read !== 'function'
        || !['readChats', 'readHistory', 'readThread', 'cancel'].every(method => typeof Reflect.get(read.prototype, method) === 'function')) {
        throw new NativeAddonLoadError(
            '@plusplusoneplusplus/coc-native: missing IC3 Teams session capability. ' +
            'Rebuild with `npm run build:native -w packages/coc-native`.',
        );
    }
    return { NativeTeamsIc3Session: session, NativeTeamsIc3Read: read };
}

function freezePage<T>(value: {
    items: T[]; next?: TeamsIc3Cursor | null; rawCount: number;
}): TeamsIc3Page<Readonly<T>> {
    return Object.freeze({
        items: Object.freeze(value.items.map(item => Object.freeze(item))),
        next: value.next ?? undefined,
        rawCount: value.rawCount,
    });
}

/** Account-pinned IC3 reads. Connection alone is not a read/write access preflight. */
export class TeamsIc3Session {
    private readonly native: Bindings.NativeTeamsIc3Session;

    constructor(options: TeamsIc3SessionOptions) {
        try {
            if (!options || !['amer', 'emea', 'apac'].includes(options.region)
                || (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs)
                    || options.timeoutMs < 100 || options.timeoutMs > 30_000))) {
                throw new NativeTeamsError('Configuration');
            }
            this.native = new (loadNativeTeams().NativeTeamsIc3Session)(options);
        } catch (error) { decodeNativeTeamsError(error); }
    }

    /** One attempt per handle; disposal revokes both initialization and the pinned session. */
    async connect(signal?: AbortSignal): Promise<TeamsIc3Account> {
        const abort = () => this.native.dispose();
        if (signal?.aborted) {
            abort();
            throw new NativeTeamsError('Cancelled');
        }
        signal?.addEventListener('abort', abort, { once: true });
        try {
            const account = await this.native.connect();
            if (signal?.aborted) throw new NativeTeamsError('Cancelled');
            return Object.freeze(account);
        } catch (error) {
            this.native.dispose();
            if (signal?.aborted) throw new NativeTeamsError('Cancelled');
            return decodeNativeTeamsError(error);
        } finally {
            signal?.removeEventListener('abort', abort);
        }
    }

    async readChats(options: TeamsIc3ReadOptions = {}): Promise<TeamsIc3Page<TeamsIc3Chat>> {
        return freezePage(await this.read(request => request.readChats(options.cursor), options.signal));
    }

    /** Exact `48:notes` reads the account's self stream; discovery does not prove its availability. */
    async readHistory(chatId: string, options: TeamsIc3ReadOptions = {}): Promise<TeamsIc3Page<TeamsIc3Message>> {
        const page = await this.read(request => request.readHistory(chatId, options.cursor), options.signal);
        for (const message of page.items) {
            if (message.mentionedUserIds) Object.freeze(message.mentionedUserIds);
        }
        return freezePage(page);
    }

    /** Exact thread scope; the first page includes the root independently of reply pagination. */
    async readThread(chatId: string, rootMessageId: string,
        options: TeamsIc3ReadOptions = {}): Promise<TeamsIc3Page<TeamsIc3Message>> {
        const page = await this.read(request => request.readThread(chatId, rootMessageId, options.cursor), options.signal);
        for (const message of page.items) {
            if (message.mentionedUserIds) Object.freeze(message.mentionedUserIds);
        }
        return freezePage(page);
    }

    private async read<T>(
        action: (request: Bindings.NativeTeamsIc3Read) => Promise<T>,
        signal?: AbortSignal,
    ): Promise<T> {
        if (signal?.aborted) throw new NativeTeamsError('Cancelled');
        let request: Bindings.NativeTeamsIc3Read | undefined;
        const abort = () => request?.cancel();
        try {
            request = this.native.beginRead();
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) abort();
            const value = await action(request);
            if (signal?.aborted) throw new NativeTeamsError('Cancelled');
            return value;
        } catch (error) { return decodeNativeTeamsError(error); }
        finally {
            signal?.removeEventListener('abort', abort);
            request?.cancel();
        }
    }

    dispose(): void { this.native.dispose(); }
}
