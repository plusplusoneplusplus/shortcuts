import { randomUUID } from 'node:crypto';
import { boundedIc3, Ic3CredentialStore } from './ic3/ic3-credential';
import type { Ic3TokenProvider } from './ic3/ic3-direct-message-config';

const ENDPOINT = 'wss://go-msit.trouter.teams.microsoft.com/v4/c/';
const REGISTRAR = 'https://teams.cloud.microsoft/registrar/prod/V2/registrations';
const VERSION = '1415/26043019216';
const MAX_FRAME = 256 * 1024;

export interface TrouterWake {
    cause: 'message' | 'message-loss' | 'disconnect' | 'overflow';
    conversationId?: string;
    rootMessageId?: string;
}

export interface TeamsTrouterOptions {
    acquireToken?: Ic3TokenProvider;
    onState?: (state: 'connecting' | 'registered' | 'retrying' | 'stopped') => void;
    onError?: (error: TrouterNotificationError) => void;
}

export type TrouterFailure = 'credentials' | 'authentication' | 'socket' | 'disconnected'
    | 'protocol' | 'heartbeat-timeout' | 'registration-timeout' | 'registration-rejected' | 'registration-unavailable' | 'rate-limited';

export interface TrouterNotificationError {
    code: TrouterFailure;
    message: string;
}

export interface TrouterStatus {
    state: 'disabled' | 'connecting' | 'registered' | 'retrying' | 'stopped';
    error: TrouterNotificationError | null;
}

const FAILURE_MESSAGES: Record<TrouterFailure, string> = {
    credentials: 'IC3 credential unavailable or invalid; verify Azure CLI sign-in and reader account identity',
    authentication: 'Trouter authentication rejected; verify IC3 account permissions',
    socket: 'Trouter socket unavailable; fallback reads remain active',
    disconnected: 'Trouter disconnected; fallback reads remain active',
    protocol: 'Trouter protocol failure; fallback reads remain active',
    'heartbeat-timeout': 'Trouter heartbeat timed out; fallback reads remain active',
    'registration-timeout': 'Trouter registration timed out; fallback reads remain active',
    'registration-rejected': 'Trouter registration rejected; verify account permissions',
    'registration-unavailable': 'Trouter registrar unavailable; fallback reads remain active',
    'rate-limited': 'Trouter registration throttled; reconnect respects Retry-After',
};

export interface TrouterSocket {
    readonly readyState: number;
    readonly bufferedAmount: number;
    send(data: string): void;
    close(): void;
    addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
}

function object(value: unknown): Record<string, unknown> {
    if (typeof value === 'string') value = JSON.parse(value);
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function text(...values: unknown[]): string | undefined {
    return values.find((value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096);
}

function conversation(value: string): string {
    const decoded = decodeURIComponent(value);
    return (decoded.split('/conversations/')[1] ?? decoded).split(/\/messages\/|;messageid=|[?#]/)[0];
}

export function trouterAccount(token: string): { tenantId: string; objectId: string } {
    try {
        const claims = object(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
        const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (typeof claims.tid === 'string' && typeof claims.oid === 'string'
            && guid.test(claims.tid) && guid.test(claims.oid)) {
            return { tenantId: claims.tid.toLowerCase(), objectId: claims.oid.toLowerCase() };
        }
    } catch { /* Only JWT identity can pin the separate IC3 account. */ }
    throw new Error('Trouter requires a reader credential with tenant and object identity');
}

export interface TrouterEffects {
    send: string[];
    registrationPath?: string;
    wake?: TrouterWake;
}

/** Notifications carry no admission authority, even when source identity is missing. */
export function parseTrouterFrame(raw: string, target: string): TrouterEffects {
    if (Buffer.byteLength(raw) > MAX_FRAME) throw new Error('Trouter frame exceeds limit');
    const match = /^([0-8]):([^:]*):([^:]*)(?::([\s\S]*))?$/.exec(raw);
    if (!match) throw new Error('Invalid Trouter frame');
    const [, kind, ack, , payload] = match;
    const result: TrouterEffects = { send: [] };
    if (kind === '0' || kind === '7') throw new Error('Trouter disconnected');
    if (kind === '2') result.send.push('2::');
    if (kind === '5') {
        const event = object(JSON.parse(payload ?? ''));
        if (/^\d+\+$/.test(ack)) result.send.push(`6:::${ack.slice(0, -1)}+[]`);
        if (event.name === 'trouter.connected') {
            const connection = object(Array.isArray(event.args) ? event.args[0] : undefined);
            const path = text(connection.surl, connection.url);
            if (!path || /[\u0000-\u001f]/.test(path)) throw new Error('Invalid Trouter registration path');
            const url = new URL(path);
            // This opaque forwarding path is registrar data, never a credential-bearing fetch target.
            if (!['https:', 'wss:'].includes(url.protocol) || url.username || url.password) {
                throw new Error('Invalid Trouter registration path');
            }
            result.registrationPath = path;
        } else if (event.name === 'trouter.message_loss') result.wake = { cause: 'message-loss' };
    }
    if (kind === '3') {
        const request = object(JSON.parse(payload ?? ''));
        if (!(typeof request.id === 'string' || typeof request.id === 'number')) throw new Error('Invalid Trouter request');
        result.send.push(`3:::${JSON.stringify({ id: request.id, status: 200, headers: {} })}`);
        const body = object(request.body);
        if (text(body.type)?.toLowerCase() !== 'eventmessage' || text(body.resourceType)?.toLowerCase() !== 'newmessage') return result;
        const resource = object(body.resource);
        const activity = object(object(resource.properties).activity);
        const source = text(activity.sourceThreadId);
        const stream = text(resource.to, body.to, resource.conversationLink, body.conversationLink, body.resourceLink);
        const candidate = source ? conversation(source) : stream ? conversation(stream) : undefined;
        const id = candidate && !candidate.toLowerCase().startsWith('48:') ? candidate : undefined;
        // Unknown/synthetic streams cannot activate a conversation.
        if (id === target) result.wake = {
            cause: 'message', conversationId: id,
            rootMessageId: text(activity.sourceReplyChainId, body.parentmessageid, body.parentMessageId,
                resource.parentmessageid, resource.parentMessageId, resource.replyToId),
        };
    }
    return result;
}

/** Instance-scoped, cancellable private-protocol ingress. No message writes. */
export class TrouterClient {
    private readonly credentials: Ic3CredentialStore;
    private readonly lifetime = new AbortController();
    private readonly registrationId = randomUUID();
    private socket?: TrouterSocket;
    private task?: Promise<void>;
    private generation = 0;
    private status: TrouterStatus = { state: 'stopped', error: null };

    constructor(private readonly options: TeamsTrouterOptions & {
        expectedAccount: { tenantId: string; objectId: string };
        target: () => string | null;
        onWake: (wake: TrouterWake) => void;
        socketFactory?: (url: string) => TrouterSocket;
        fetch?: typeof fetch;
    }) {
        this.credentials = new Ic3CredentialStore({ acquireToken: options.acquireToken, expectedAccount: options.expectedAccount });
    }

    start(): void {
        this.task ??= this.run();
    }

    async stop(): Promise<void> {
        this.generation++;
        this.lifetime.abort();
        this.socket?.close();
        this.credentials.dispose();
        await this.task;
        this.status.error = null;
        this.state('stopped');
    }

    getStatus(): TrouterStatus {
        return { state: this.status.state, error: this.status.error ? { ...this.status.error } : null };
    }

    private state(value: Parameters<NonNullable<TeamsTrouterOptions['onState']>>[0]): void {
        this.status.state = value;
        if (value === 'registered') this.status.error = null;
        try { this.options.onState?.(value); } catch { /* Observers do not control ingress. */ }
    }

    private failed(code: TrouterFailure): void {
        const error = { code, message: FAILURE_MESSAGES[code] };
        this.status.error = error;
        try { this.options.onError?.({ ...error }); } catch { /* Error observers do not control recovery. */ }
    }

    private wake(wake: TrouterWake): void {
        if (this.lifetime.signal.aborted) return;
        try {
            if (this.options.target()) this.options.onWake(wake);
        } catch { /* Wake observers cannot interrupt the protocol. */ }
    }

    private async run(): Promise<void> {
        let failures = 0;
        let gapSignaled = false;
        while (!this.lifetime.signal.aborted) {
            let retryAfter = 0;
            let failure: TrouterFailure = 'credentials';
            try {
                this.state('connecting');
                const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(30_000)]);
                const credential = await this.credentials.getForNotifications(signal);
                if (credential.expiresAt <= Date.now() + 120_000) throw new Error('Trouter credential lease too short');
                failure = 'socket';
                await this.session(credential.value, credential.expiresAt, () => {
                    failures = 0;
                    gapSignaled = false;
                    this.wake({ cause: 'disconnect' });
                });
            } catch (error) {
                if (error instanceof RegistrarError) retryAfter = error.retryAfterMs;
                if (!this.lifetime.signal.aborted) this.failed(error instanceof TrouterFailureError ? error.code : failure);
            }
            if (this.lifetime.signal.aborted) break;
            this.credentials.clear();
            if (!gapSignaled) {
                gapSignaled = true;
                this.wake({ cause: 'disconnect' });
            }
            this.state('retrying');
            const cap = Math.min(30_000, 500 * 2 ** Math.min(failures++, 8));
            const delay = Math.max(retryAfter, Math.round(cap * (0.5 + Math.random() * 0.5)));
            await this.wait(delay);
        }
    }

    private async wait(delay: number): Promise<void> {
        const deadline = Date.now() + delay;
        while (!this.lifetime.signal.aborted && Date.now() < deadline) {
            await new Promise<void>(resolve => {
                const done = () => { clearTimeout(timer); this.lifetime.signal.removeEventListener('abort', done); resolve(); };
                const timer = setTimeout(done, Math.min(2_147_483_647, deadline - Date.now()));
                this.lifetime.signal.addEventListener('abort', done, { once: true });
                if (this.lifetime.signal.aborted) done();
            });
        }
    }

    private async session(token: string, expiresAt: number, registered: () => void): Promise<void> {
        const generation = ++this.generation;
        const url = new URL(ENDPOINT);
        for (const [key, value] of Object.entries({
            tc: JSON.stringify({ cv: '2026.16.01.1', ua: 'TeamsCDL', hr: '', v: VERSION }),
            timeout: '40', epid: randomUUID(), ccid: '', cor_id: randomUUID(), con_num: `${Date.now()}_0`,
        })) url.searchParams.set(key, value);
        const nativeSocket = (globalThis as unknown as { WebSocket: new (url: string) => TrouterSocket }).WebSocket;
        const socket = this.options.socketFactory?.(url.toString()) ?? new nativeSocket(url.toString());
        this.socket = socket;
        const session = new AbortController();
        const signal = AbortSignal.any([this.lifetime.signal, session.signal]);
        const active = () => !signal.aborted && generation === this.generation;
        let idleTimer: ReturnType<typeof setTimeout>;
        let renewTimer: ReturnType<typeof setTimeout> | undefined;
        let registrationTimer: ReturnType<typeof setTimeout> | undefined;
        let registering = false;
        try {
            await new Promise<void>((resolve, reject) => {
                const finish = (error?: unknown) => {
                    if (!active()) return;
                    error ? reject(error) : resolve();
                    session.abort();
                };
                const idle = () => {
                    clearTimeout(idleTimer);
                    idleTimer = setTimeout(() => finish(new TrouterFailureError('heartbeat-timeout')), 60_000);
                };
                const send = (frame: string) => {
                    if (!active()) return;
                    if (socket.bufferedAmount + Buffer.byteLength(frame) > MAX_FRAME) throw new Error('Trouter write overflow');
                    socket.send(frame);
                };
                signal.addEventListener('abort', () => resolve(), { once: true });
                idle();
                registrationTimer = setTimeout(() => finish(new TrouterFailureError('registration-timeout')), 30_000);
                socket.addEventListener('open', () => {
                    if (!active()) return;
                    try {
                        send(`5:::${JSON.stringify({ name: 'user.authenticate', args: [{
                            headers: { Authorization: `Bearer ${token}`, 'X-Ms-Test-User': 'False' },
                        }] })}`);
                    } catch { finish(new TrouterFailureError('socket')); }
                });
                socket.addEventListener('error', () => finish(new TrouterFailureError('socket')));
                socket.addEventListener('close', () => finish(new TrouterFailureError('disconnected')));
                socket.addEventListener('message', event => {
                    if (!active()) return;
                    try {
                        if (typeof event.data !== 'string') throw new Error('Invalid Trouter data');
                        const effects = parseTrouterFrame(event.data, this.options.target() ?? '');
                        idle();
                        effects.send.forEach(send);
                        if (effects.wake) this.wake(effects.wake);
                        if (effects.registrationPath && !registering) {
                            registering = true;
                            void this.register(effects.registrationPath, token, signal).then(() => {
                                if (!active()) return;
                                registered();
                                clearTimeout(registrationTimer);
                                this.state('registered');
                                clearTimeout(renewTimer);
                                renewTimer = setTimeout(() => finish(), Math.max(1,
                                    Math.min(55 * 60_000, expiresAt - Date.now() - 120_000)));
                            }, error => finish(error instanceof TrouterFailureError
                                ? error : new TrouterFailureError('registration-unavailable')));
                        }
                    } catch { finish(new TrouterFailureError('protocol')); }
                });
                if (signal.aborted) resolve();
            });
        } finally {
            session.abort();
            clearTimeout(idleTimer!);
            clearTimeout(renewTimer);
            clearTimeout(registrationTimer);
            socket.close();
            if (this.socket === socket) this.socket = undefined;
        }
    }

    private async register(path: string, token: string, parent: AbortSignal): Promise<void> {
        const signal = AbortSignal.any([parent, AbortSignal.timeout(10_000)]);
        signal.throwIfAborted();
        const response = await boundedIc3((this.options.fetch ?? fetch)(REGISTRAR, {
            method: 'POST', redirect: 'error', signal,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
                'x-ms-test-user': 'False', 'X-MS-Migration': 'True' },
            body: JSON.stringify({
                clientDescription: { appId: 'TeamsCDLWebWorker', aesKey: '', languageId: 'en-US',
                    platform: 'edge', templateKey: 'TeamsCDLWebWorker_2.6', platformUIVersion: VERSION },
                registrationId: this.registrationId, nodeId: '',
                transports: { TROUTER: [{ context: '', path, ttl: 3600 }] },
            }),
        }), signal);
        await response.body?.cancel();
        if (!response.ok) {
            const value = response.headers.get('retry-after');
            const delay = value === null ? 0 : /^\d+(\.\d+)?$/.test(value)
                ? Number(value) * 1000 : Date.parse(value) - Date.now();
            const code = response.status === 401 || response.status === 403 ? 'authentication'
                : response.status === 429 ? 'rate-limited' : 'registration-rejected';
            throw new RegistrarError(code, response.status === 429 && Number.isFinite(delay) ? Math.max(0, delay) : 0);
        }
    }
}

class TrouterFailureError extends Error {
    constructor(readonly code: TrouterFailure) { super(FAILURE_MESSAGES[code]); }
}

class RegistrarError extends TrouterFailureError {
    constructor(code: TrouterFailure, readonly retryAfterMs: number) { super(code); }
}
