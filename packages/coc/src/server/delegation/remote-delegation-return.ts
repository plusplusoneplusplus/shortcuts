import { z } from 'zod';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { MessagingJobOrigin } from '../messaging/job-notices';
import { buildDashboardChatReference, parseDashboardChatReference } from '../shared/chat-reference';
import type { RemoteServerSource } from '../servers/workspace-directory';
import { RemoteChatAdmissionError } from '../servers/workspace-directory';
import { captureRemoteDelegationIntent, type RemoteDelegationIntent } from './remote-delegation-admission';
import { remoteDelegationBindingSchema, sameRemoteDelegationBinding, type RemoteDelegationClaim } from './remote-delegation-auth';
import { delegatedJobResultSchema, type DelegatedJob, type DelegatedJobStore } from './delegated-job-store';
import { RemoteDelegationRequestStore, type RemoteDelegationRequest } from './remote-delegation-request-store';

const receiptSchema = remoteDelegationBindingSchema.extend({
    admission: z.discriminatedUnion('state', [
        z.object({ state: z.literal('accepted'), child: z.object({ processId: z.string().min(1).max(512), sessionId: z.string().min(1).max(512).optional() }).strict() }).strict(),
        z.object({ state: z.enum(['dispatching', 'uncertain', 'rejected']) }).strict(),
    ]),
    terminal: z.object({ result: delegatedJobResultSchema, recordedAt: z.iso.datetime() }).strict().optional(),
}).strict();

export interface RemoteResultOrigin {
    parent: { workspaceId: string; processId: string };
    title: string;
    requestId?: string;
    messagingOrigin?: MessagingJobOrigin;
}
export interface UnavailableRemoteResult {
    status: 'unavailable';
    code: 'unsupported' | 'unavailable';
    reason: string;
}
class RemoteResultHttpError extends Error {
    constructor(readonly status: number) { super('Remote receipt unavailable'); }
}

/** Origin polling transfers durable receipts only. It never replays execution. */
export class RemoteDelegationReturn {
    private timer?: ReturnType<typeof setInterval>;
    private pending: Promise<void> = Promise.resolve();
    private recovering = false;
    private readonly abort = new AbortController();

    constructor(private readonly deps: {
        requests: RemoteDelegationRequestStore;
        jobs: DelegatedJobStore;
        store: Pick<ProcessStore, 'getProcess' | 'getWorkspaces'>;
        remotes: RemoteServerSource;
        enabled: () => boolean;
        onResult: (job: DelegatedJob) => Promise<void>;
        onRegistered?: (job: DelegatedJob) => Promise<void>;
        onDeliveryChange?: (job: DelegatedJob) => void;
        fetchImpl?: typeof fetch;
        timeoutMs?: number;
    }) {}

    start(): void {
        this.timer ??= setInterval(() => {
            void this.recover().catch(() => console.error('[remote-delegation-return] Recovery is unavailable.'));
        }, 5_000);
        this.timer.unref();
    }

    dispose(): void {
        clearInterval(this.timer);
        this.abort.abort();
    }

    async dispatch(serverId: string, execution: RemoteDelegationIntent, origin: RemoteResultOrigin, expectedIdentity?: string) {
        try { return await this.dispatchRequest(serverId, execution, origin, expectedIdentity); }
        catch (error) {
            if (error instanceof RemoteChatAdmissionError) throw error;
            throw new RemoteChatAdmissionError('Remote tracking could not be reconciled. Inspect the recorded request before retrying; no automatic work retry will be made.', 'uncertain');
        }
    }

    private async dispatchRequest(serverId: string, execution: RemoteDelegationIntent, origin: RemoteResultOrigin, expectedIdentity?: string) {
        const existing = origin.requestId
            ? this.deps.requests.list(origin.parent.workspaceId).find(row => row.requestId === origin.requestId) : undefined;
        if (!existing && !this.deps.enabled()) return undefined;
        const parent = await this.deps.store.getProcess(origin.parent.processId, origin.parent.workspaceId);
        if (parent?.id !== origin.parent.processId || parent.type !== 'chat' || parent.archived
            || parent.metadata?.workspaceId !== origin.parent.workspaceId) {
            throw new RemoteChatAdmissionError('Originating conversation is unavailable. No remote work was sent.', 'not-started');
        }
        if (parent.metadata.mode !== 'sentinel') {
            if (existing) throw new RemoteChatAdmissionError('Originating Sentinel changed; existing work will not be repeated.', 'not-started');
            return undefined;
        }
        const remote = this.deps.remotes.list().find(row => row.id === serverId);
        if (existing) {
            const { digest } = captureRemoteDelegationIntent(execution);
            if (existing.parent.processId !== origin.parent.processId || existing.intentDigest !== digest
                || (expectedIdentity && existing.destination.serverIdentity !== expectedIdentity)) {
                throw new RemoteChatAdmissionError('Remote request identity cannot be reassigned. No work was sent.', 'not-started');
            }
            if (existing.admission.state === 'reserved' || existing.admission.state === 'rejected') {
                throw new RemoteChatAdmissionError(existing.admission.state === 'reserved'
                    ? 'Origin stopped before dispatch; no remote work was sent.'
                    : existing.admission.reason, existing.admission.state === 'reserved' ? 'not-started' : 'rejected');
            }
            try {
                const job = await this.receive(existing, await this.request(existing.destination.serverIdentity,
                    existing.destination.serverId, '/api/remote-delegations/receipt', this.claim(existing)));
                if (!job) throw new Error('Admission is uncertain');
                return this.tracked(existing, job.child);
            } catch {
                if (existing.admission.state === 'accepted') {
                    return this.tracked(existing, existing.admission.child, 'Execution was admitted; result delivery recovery is pending. Do not repeat the work.');
                }
                throw new RemoteChatAdmissionError('Remote receipt recovery is pending; existing work will not be repeated.', 'uncertain');
            }
        }
        if (expectedIdentity && remote?.serverIdentity !== expectedIdentity) {
            throw new RemoteChatAdmissionError('Remote owning server changed. No work was sent.', 'not-started');
        }
        if (!remote?.serverIdentity) return { unavailable: {
            status: 'unavailable' as const, code: 'unavailable' as const, reason: 'Authenticated destination identity is unavailable; automatic result return is unavailable.',
        } };
        let supported: unknown;
        try { supported = await this.request(remote.serverIdentity, serverId, '/api/remote-delegations/capabilities'); }
        catch (error) { return { unavailable: {
            status: 'unavailable' as const, code: error instanceof RemoteResultHttpError && error.status === 404 ? 'unsupported' as const : 'unavailable' as const,
            reason: error instanceof RemoteResultHttpError && error.status === 404
                ? 'Destination does not support authenticated remote result return. Inspect openLink for its outcome.'
                : 'Compatible authenticated remote result support could not be verified; automatic result return is unavailable.',
        } }; }
        if (!supported || typeof supported !== 'object' || !('version' in supported) || supported.version !== 1
            || !('results' in supported) || supported.results !== true
            || !('serverIdentity' in supported) || supported.serverIdentity !== remote.serverIdentity) return { unavailable: {
                status: 'unavailable' as const, code: 'unsupported' as const, reason: 'Destination does not support compatible authenticated remote result return. Inspect openLink for its outcome.',
            } };
        if (this.deps.remotes.list().find(row => row.id === serverId)?.serverIdentity !== remote.serverIdentity) {
            throw new RemoteChatAdmissionError('Remote owning server changed. No work was sent.', 'not-started');
        }
        const currentParent = await this.deps.store.getProcess(origin.parent.processId, origin.parent.workspaceId);
        if (currentParent?.id !== origin.parent.processId || currentParent.archived || currentParent.type !== 'chat'
            || currentParent.metadata?.workspaceId !== origin.parent.workspaceId || currentParent.metadata.mode !== 'sentinel') {
            throw new RemoteChatAdmissionError('Originating Sentinel changed before admission. No remote work was sent.', 'not-started');
        }
        const { intent, digest } = captureRemoteDelegationIntent(execution);
        const { request, execute: claimed } = this.deps.requests.reserveDispatch({
            ...origin, destination: { serverId, serverIdentity: remote.serverIdentity, workspaceId: intent.workspaceId },
            kind: intent.kind, intentDigest: digest,
            ...(intent.targetProcessId ? { targetProcessId: intent.targetProcessId } : {}),
        });
        try {
            const response = await this.request(request.destination.serverIdentity, serverId,
                claimed ? `/api/remote-delegations/${intent.kind === 'follow-up' ? 'follow-up' : 'launch'}` : '/api/remote-delegations/receipt',
                claimed ? { claim: this.claim(request), intent } : this.claim(request));
            const job = await this.receive(request, response);
            if (!job) throw new Error('Remote admission has not been confirmed');
            return this.tracked(request, job.child);
        } catch (error) {
            const current = this.deps.requests.list(request.parent.workspaceId).find(row => row.requestId === request.requestId)!;
            if (current.admission.state !== 'rejected') this.deps.requests.settleDispatch(request.parent.workspaceId, request.requestId,
                'uncertain', 'Remote admission is uncertain; receipt recovery will not repeat execution.');
            this.deps.requests.recordTransfer(request.parent.workspaceId, request.requestId, 'Remote receipt is unavailable; recovery is pending.');
            if (current.admission.state === 'accepted') {
                return this.tracked(current, current.admission.child, 'Execution was admitted; result delivery recovery is pending. Do not repeat the work.');
            }
            if (error instanceof RemoteChatAdmissionError) throw error;
            throw new RemoteChatAdmissionError('Remote admission is uncertain. Automatic receipt recovery is pending; do not send duplicate work.', 'uncertain');
        }

    }

    private tracked(request: RemoteDelegationRequest, child: { processId: string; sessionId?: string }, reason?: string) {
        return { serverIdentity: request.destination.serverIdentity, ...child, turnIndex: -1,
            resultDelivery: { status: 'tracked' as const, jobId: `remote:${request.requestId}`,
                remote: { serverIdentity: request.destination.serverIdentity, requestId: request.requestId },
                ...(reason ? { reason } : {}) } };
    }

    recover(force = false): Promise<void> {
        if (this.recovering) return this.pending;
        this.recovering = true;
        const work = this.pending.catch(() => {}).then(async () => {
            // Disposal can close the process store before queued recovery runs.
            if (this.abort.signal.aborted) return;
            for (const workspace of await this.deps.store.getWorkspaces()) {
                if (this.abort.signal.aborted) return;
                let requests: RemoteDelegationRequest[];
                try { requests = this.deps.requests.list(workspace.id); }
                catch {
                    console.error('[remote-delegation-return] Could not read workspace requests.');
                    continue;
                }
                for (const request of requests) {
                    if (request.admission.state === 'reserved') {
                        try { this.deps.requests.rejectReserved(workspace.id, request.requestId); }
                        catch { console.error('[remote-delegation-return] Could not settle interrupted reservation.'); }
                        continue;
                    }
                    if (!request.proofToken || request.admission.state === 'rejected') continue;
                    if (!force && (request.transfer?.nextAttemptAt ?? 0) > Date.now()) continue;
                    let job: DelegatedJob | undefined;
                    try {
                        job = request.admission.state === 'accepted'
                            ? this.deps.requests.accept(workspace.id, {
                                requestId: request.requestId, originServerIdentity: request.originServerIdentity,
                                serverIdentity: request.destination.serverIdentity, workspaceId: request.destination.workspaceId,
                                intentDigest: request.intentDigest, kind: request.kind, child: request.admission.child,
                            }) : undefined;
                        if (job) await this.registered(job);
                        if (job?.terminal && !['pending', 'queued'].includes(job.terminal.delivery.state)) continue;
                        if (!job?.terminal) {
                            job = await this.receive(request, await this.request(request.destination.serverIdentity,
                                request.destination.serverId, '/api/remote-delegations/receipt', this.claim(request)));
                        } else await this.deps.onResult(job);
                        this.deps.requests.recordTransfer(workspace.id, request.requestId);
                    } catch {
                        if (this.abort.signal.aborted) return;
                        const reason = 'Remote result delivery is unavailable; authenticated receipt recovery will retry.';
                        try {
                            this.deps.requests.recordTransfer(workspace.id, request.requestId, reason);
                            const current = job ?? this.deps.jobs.list(workspace.id).find(row => row.remote?.requestId === request.requestId);
                            if (current && !current.terminal) {
                                this.deps.jobs.updateRemoteDelivery(workspace.id, current.id, { state: 'failed', reason });
                                this.deps.onDeliveryChange?.(this.current(current));
                            }
                        } catch { console.error('[remote-delegation-return] Could not persist delivery failure.'); }
                    }
                }
            }
        });
        this.pending = work.finally(() => { this.recovering = false; });
        return this.pending;
    }

    private claim(request: RemoteDelegationRequest): RemoteDelegationClaim {
        if (!request.proofToken) throw new Error('Remote reservation has no proof credential');
        return { version: 1, requestId: request.requestId, originServerIdentity: request.originServerIdentity,
            parent: request.parent, destination: { serverIdentity: request.destination.serverIdentity, workspaceId: request.destination.workspaceId },
            kind: request.kind, targetProcessId: request.targetProcessId, intentDigest: request.intentDigest, proofToken: request.proofToken };
    }

    private current(job: DelegatedJob): DelegatedJob {
        return this.deps.jobs.list(job.parent.workspaceId).find(row => row.id === job.id)!;
    }

    private async registered(job: DelegatedJob): Promise<void> {
        try { await this.deps.onRegistered?.(job); }
        catch { console.error('[remote-delegation-return] Could not link remote request to its originating To-do.'); }
    }

    private async receive(request: RemoteDelegationRequest, input: unknown): Promise<DelegatedJob | undefined> {
        const receipt = receiptSchema.parse(input);
        if (!sameRemoteDelegationBinding(this.claim(request), receipt)) throw new Error('Remote receipt owner mismatch');
        if (receipt.admission.state === 'rejected') {
            this.deps.requests.settleDispatch(request.parent.workspaceId, request.requestId, 'rejected', 'Remote work was rejected before execution.');
            throw new RemoteChatAdmissionError('Remote work was rejected before execution.', 'rejected');
        }
        if (receipt.admission.state !== 'accepted') return undefined;
        const job = this.deps.requests.accept(request.parent.workspaceId, {
            ...receipt, serverIdentity: receipt.destination.serverIdentity, workspaceId: receipt.destination.workspaceId,
            child: receipt.admission.child,
        });
        await this.registered(job);
        if (receipt.terminal) {
            const result = receipt.terminal.result;
            const expected = `remote:${JSON.stringify([request.originServerIdentity, request.parent.workspaceId, request.requestId])}:terminal`;
            if (result.terminalEventId !== expected || (result.outcome === 'capped' && request.kind !== 'ralph')) {
                throw new Error('Remote terminal identity mismatch');
            }
            const chat = buildDashboardChatReference(request.destination.serverIdentity, request.destination.workspaceId, job.child.processId);
            // Links are data, not callback destinations. Only exact owner-qualified references cross servers.
            if (result.links.some(link => {
                const reference = parseDashboardChatReference(link);
                return !reference || reference.serverIdentity !== request.destination.serverIdentity
                    || (request.kind !== 'ralph' && (reference.workspaceId !== request.destination.workspaceId
                        || reference.processId !== job.child.processId));
            })) {
                throw new Error('Remote result contains an unqualified link');
            }
            this.deps.jobs.recordResult(job.parent.workspaceId, job.id, { ...result, links: [...new Set([chat, ...result.links])].slice(0, 20) });
            this.deps.jobs.updateRemoteDelivery(job.parent.workspaceId, job.id, { state: 'received' });
            try { await this.deps.onResult(this.current(job)); }
            catch { console.error('[remote-delegation-return] Result persisted; assessment admission will retry.'); }
        } else {
            this.deps.jobs.updateRemoteDelivery(job.parent.workspaceId, job.id, { state: 'pending' });
            this.deps.onDeliveryChange?.(this.current(job));
        }
        return this.current(job);
    }

    private async request(identity: string, hint: string, path: string, body?: unknown): Promise<unknown> {
        const source = this.deps.remotes.list().find(row => row.id === hint && row.serverIdentity === identity && row.effectiveUrl)
            ?? this.deps.remotes.list().find(row => row.serverIdentity === identity && row.effectiveUrl);
        if (!source) throw new Error('Registered remote owner unavailable');
        const target = { ...source };
        const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(this.deps.timeoutMs ?? 15_000)]);
        const current = () => {
            signal.throwIfAborted();
            const row = this.deps.remotes.list().find(row => row.id === target.id);
            if (!row || row.effectiveUrl !== target.effectiveUrl || row.serverIdentity !== identity
                || row.updatedAt !== target.updatedAt || row.kind !== target.kind) throw new Error('Remote connection changed');
        };
        const read = async (route: string, payload?: unknown) => {
            current();
            const response = await (this.deps.fetchImpl ?? fetch)(`${target.effectiveUrl}${route}`, {
                method: payload === undefined ? 'GET' : 'POST', signal, redirect: 'error', credentials: 'omit',
                ...(payload === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
            });
            current();
            const reader = response.body?.getReader();
            if (!reader) throw new Error('Remote response unavailable');
            const chunks: Uint8Array[] = [];
            let size = 0;
            const cancel = () => { void reader.cancel().catch(() => {}); };
            signal.addEventListener('abort', cancel, { once: true });
            try {
                if (!response.ok) throw new RemoteResultHttpError(response.status);
                for (;;) {
                    const { done, value } = await reader.read();
                    current();
                    if (done) break;
                    size += value.byteLength;
                    if (size > 262_144) throw new Error('Remote receipt exceeds limit');
                    chunks.push(value);
                }
                return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
            } finally {
                signal.removeEventListener('abort', cancel);
                void reader.cancel().catch(() => {});
                reader.releaseLock();
            }
        };
        const health = (value: unknown) => z.object({ serverIdentity: z.literal(identity) }).parse(value);
        let cancel!: () => void;
        const cancelled = new Promise<never>((_, reject) => {
            cancel = () => reject(signal.reason);
            signal.addEventListener('abort', cancel, { once: true });
        });
        try {
            return await Promise.race([cancelled, (async () => {
                health(await read('/api/health'));
                const result = await read(path, body);
                health(await read('/api/health'));
                current();
                return result;
            })()]);
        } finally { signal.removeEventListener('abort', cancel); }
    }
}
