import { randomUUID } from 'node:crypto';
import type { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import {
    toQueueProcessId, type AIProcess, type CreateTaskInput, type ProcessOwnerProjection, type ProcessStore, type QueuedTask,
} from '@plusplusoneplusplus/forge';
import { normalizeChatMode } from '../tasks/task-types';
import { onTaskTerminal } from './chat-target';
import type { ScheduleQueueEventBus } from '../schedule/schedule-queue-await';
import { isTerminalStatus, RELAY_ANSWER_TEXT, relayFailureText } from './relay-answer';
import { mirrorAttachmentPartIndex, mirrorDestinationKey, SentinelMirrorOutbox, type SentinelMirrorEntry, type SentinelMirrorHeader } from './sentinel-mirror-outbox';
import { mirrorChunkEchoMatches, mirrorEchoText, mirrorRetryAfterMs, mirrorSendOutcome, sameMirrorDestination, type SentinelMirrorAdapter } from './sentinel-mirror-adapters';
import type { QuestionRelayLocation } from './ask-user-relay';
import type { MessagingJobOrigin, MessagingOriginAuthority } from './job-notices';
import { captureMirrorUploads, MirrorAttachmentError, type MirrorUploadSource } from './sentinel-mirror-attachments';

/**
 * Narrow store capabilities the mirror may use. Full `getProcess` and
 * `getConversationTurns` are deliberately absent: routine mirror work reads
 * owner/status projections and bounded request evidence only.
 */
export type SentinelMirrorProcessStore = Pick<ProcessStore, 'getWorkspaces' | 'appendConversationTurn'>
    & Required<Pick<ProcessStore,
        'getProcessOwnerProjection' | 'hasRelayRequestAdmission' | 'hasRelayReceiptTurn' | 'getRelayRequestProjection'>>;

/** True when a store answers mirror questions without full process hydration. */
export function hasSentinelMirrorProjections(store: ProcessStore): store is ProcessStore & SentinelMirrorProcessStore {
    return !!store.getProcessOwnerProjection && !!store.hasRelayRequestAdmission
        && !!store.hasRelayReceiptTurn && !!store.getRelayRequestProjection;
}

export interface SentinelMirrorDeps {
    dataDir: string;
    store: SentinelMirrorProcessStore;
    queue: Pick<ScheduleQueueEventBus, 'on' | 'off' | 'getTask'> & { getAll(): QueuedTask[] };
    enabled: () => boolean;
    adapters: SentinelMirrorAdapter[];
    /** Shared `processes.db` handle; the outbox opens `<dataDir>/processes.db` when omitted. */
    db?: NativeDatabase;
    outbox?: SentinelMirrorOutbox;
    onSourceSettled?: () => Promise<void>;
}

export interface SentinelMirrorEcho {
    connector: SentinelMirrorAdapter['connector'];
    chatKey: string;
    threadId?: string;
    text: string;
    accountKey?: string;
    isSelf?: boolean;
    workspaceId?: string;
    processId?: string;
}

/** Internal bounds; verified by profiling and structural tests. */
export const SENTINEL_MIRROR_LIMITS = {
    /** Active request reconciliations per batch before yielding the event loop. */
    requestBatch: 32,
    /** Physical destinations delivering concurrently; parts within one destination stay serialized. */
    destinations: 4,
    /** Status notices recorded per drain; remaining ones schedule another drain. */
    notices: 32,
    /** Receipts restored per page when re-arming connector echo guards. */
    receiptPage: 256,
} as const;

const yieldToEventLoop = () => new Promise<void>(resolve => setImmediate(resolve));

/**
 * Event-driven mirror worker. Only trusted HTTP admission paths call capture;
 * execution/connector/review events never create user intents. Wakeups come
 * from admission, queue terminal events, cancellation, connector readiness,
 * runtime setting changes and the earliest durable retry deadline. There is
 * no polling timer, and disabled workers perform no mirror reads or sends.
 */
export class SentinelMirrorService {
    readonly outbox: SentinelMirrorOutbox;
    private readonly ownsOutbox: boolean;
    private readonly unsubscribe: () => void;
    private retryTimer?: NodeJS.Timeout;
    private retryAt?: number;
    private nextActionableRetryAt?: number;
    private generation = 0;
    private disposed = false;
    private draining?: Promise<void>;
    private dirty = false;
    private ready?: Promise<void>;
    private readonly recoveredOwners = new Set<string>();
    private readonly importFailures = new Set<string>();
    private readonly activeAdmissions = new Set<string>();
    /** Connectors whose echo guard missed a confirmed receipt; re-armed from the index next drain. */
    private readonly echoRestoreNeeded = new Set<SentinelMirrorAdapter['connector']>();

    constructor(private readonly deps: SentinelMirrorDeps) {
        this.ownsOutbox = !deps.outbox;
        this.outbox = deps.outbox ?? new SentinelMirrorOutbox(deps.dataDir, deps.db);
        // Subscribe before recovery so terminal events during startup are not lost.
        this.unsubscribe = onTaskTerminal(deps.queue, () => this.wake());
    }

    start(): void {
        this.wake();
    }

    /** Synchronous final dispatch gate for captured-origin notice transports. */
    canSendCapturedOrigin(): boolean {
        return !this.disposed && this.deps.enabled();
    }

    private ensureReady(): Promise<void> {
        return this.ready ??= Promise.all(this.deps.enabled() ? this.deps.adapters.map(adapter => adapter.ready?.()) : [])
            .then(() => this.restore()).finally(() => {
            this.ready = undefined;
        });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.generation++;
        this.clearRetryTimer();
        this.unsubscribe();
        // In-flight acknowledgements persist before the owned connection closes.
        if (this.ownsOutbox) void (this.draining ?? Promise.resolve()).finally(() => this.outbox.close());
    }

    /** The receipt is staged before the queue/pending/turn write, not after an observer fires. */
    async capture(
        workspaceId: string, processId: string, content: string, attachmentCount: number | MirrorUploadSource = 0,
        requestId = randomUUID(),
    ): Promise<SentinelMirrorEntry | undefined> {
        try {
            return await this.captureBound(workspaceId, processId, content, attachmentCount, requestId);
        } catch (error) {
            if (error instanceof MirrorAttachmentError) throw error;
            this.logFailure();
            throw new Error('Sentinel mirror durable admission is unavailable. The submission was not accepted.');
        }
    }

    private async captureBound(
        workspaceId: string, processId: string, content: string, attachmentCount: number | MirrorUploadSource, requestId: string,
    ): Promise<SentinelMirrorEntry | undefined> {
        const generation = this.generation;
        const active = () => this.canSendCapturedOrigin() && this.generation === generation;
        if (!active()) return;
        await this.ensureReady();
        if (!active()) return;
        if (!workspaceId || !processId || !(await this.deps.store.getWorkspaces()).some(ws => ws.id === workspaceId)) return;
        if (!active()) return;
        if (!this.recoveredOwners.has(workspaceId)) {
            await this.ensureReady();
            if (!active()) return;
            if (!this.recoveredOwners.has(workspaceId)) throw new Error('Mirror owner hydration is unavailable');
        }
        const owner = await this.deps.store.getProcessOwnerProjection(processId, workspaceId);
        if (!active()) return;
        const task = owner ? undefined : this.queuedOriginalOwner(workspaceId, processId);
        if (owner ? owner.id !== processId || owner.workspaceId !== workspaceId
            || normalizeChatMode(owner.mode) !== 'sentinel'
            : !task) return;
        if (owner?.status === 'cancelling') return;
        const candidates = this.deps.adapters.flatMap(adapter => adapter.destinations({ workspaceId, processId }));
        // Multiple physical owners are ambiguous even if they happen to share a display name.
        const destinations = [...new Map(candidates.map(dest => [JSON.stringify(dest), dest])).values()];
        if (destinations.length !== 1) return;
        const uploads = typeof attachmentCount !== 'number' && destinations[0].connector === 'whatsapp'
            ? captureMirrorUploads(attachmentCount) : [];
        const count = typeof attachmentCount === 'number' ? attachmentCount
            : uploads.length || (Array.isArray(attachmentCount.attachments) ? attachmentCount.attachments.length
                : Array.isArray(attachmentCount.images) ? attachmentCount.images.length : 0);
        const adapter = this.deps.adapters.find(candidate => candidate.connector === destinations[0].connector)!;
        if (uploads.length && destinations[0].connector === 'whatsapp') {
            if (!adapter.validateAttachments || !adapter.sendAttachment) {
                throw new MirrorAttachmentError('Attachment delivery is unavailable.');
            }
            adapter.validateAttachments(uploads);
        }
        const entry = this.outbox.stage({
            workspaceId, processId, requestId, role: 'user', destination: destinations[0],
            content: content + (count && (destinations[0].connector !== 'whatsapp' || !uploads.length)
                ? `\n\n[${count} attachment(s) cannot be mirrored; view them in the desktop chat.]` : ''),
            ...(uploads.length && destinations[0].connector === 'whatsapp' ? { attachments: uploads } : {}),
        });
        this.activeAdmissions.add(entry.eventId);
        return entry;
    }

    /** Called at the canonical successful write, including buffered admission. Failure cannot undo admitted work. */
    accepted(entry: SentinelMirrorEntry): void {
        this.activeAdmissions.delete(entry.eventId);
        try { this.outbox.accept(entry.workspaceId, entry.eventId); }
        catch {
            this.logFailure();
            void this.storageNotice(entry).catch(() => this.logFailure());
        }
        this.wake();
    }

    async rejected(entry: SentinelMirrorEntry): Promise<boolean> {
        try {
            this.activeAdmissions.delete(entry.eventId);
            if (await this.isAdmitted(entry)) {
                this.accepted(entry);
                return false;
            }
            this.outbox.reject(entry.workspaceId, entry.eventId);
            return true;
        } catch {
            this.logFailure();
            throw new Error('Sentinel mirror admission status is unconfirmed. Check the chat before retrying.');
        }
    }

    /** New queue submissions can address an existing, already-bound process or a bound queued initial task. */
    async captureTask(input: CreateTaskInput, content?: string, uploads?: MirrorUploadSource): Promise<SentinelMirrorEntry | undefined> {
        if (!this.deps.enabled() || input.type !== 'chat') return;
        const payload = input.payload as Record<string, unknown>;
        const workspaceId = typeof payload.workspaceId === 'string' ? payload.workspaceId : input.repoId;
        const processId = typeof payload.processId === 'string' ? payload.processId : input.processId
            ?? (input.id ? toQueueProcessId(input.id) : undefined);
        if (!workspaceId || !processId
            || (input.repoId && input.repoId !== workspaceId) || typeof payload.prompt !== 'string') return;
        // Client-supplied relay identifiers do not grant mirror origin or deduplication authority.
        const entry = await this.capture(workspaceId, processId, content ?? payload.prompt,
            uploads ?? { attachments: payload.attachments, images: payload.images });
        if (entry) {
            payload.workspaceId = entry.workspaceId;
            payload.relayRequestId = entry.requestId;
            payload.processId = processId;
            input.processId = processId;
            input.repoId = workspaceId;
            input.id = entry.requestId;
        }
        return entry;
    }

    /** Binding removal: suppress unanswered requests and cancel unsent parts on that connector. */
    async cancelConnector(connector: SentinelMirrorAdapter['connector']): Promise<void> {
        const workspaces = new Set((await this.deps.store.getWorkspaces()).map(ws => ws.id));
        for (const row of [...this.activeUserRows(), ...this.outbox.unfinished(connector)]) {
            if (row.destination.connector === connector && workspaces.has(row.workspaceId)) this.cancelCapture(row, 'unbound');
        }
        this.wake();
    }

    /** Workspace removal: targeted terminal transitions; other workspaces sharing a destination are unaffected. */
    workspaceRemoved(workspaceId: string): void {
        try { this.outbox.cancelWorkspace(workspaceId); }
        catch { this.logFailure(); }
        this.recoveredOwners.delete(workspaceId);
        this.wake();
    }

    async cancelRequest(
        workspaceId: string, processId: string, requestId: string, shouldCancel?: () => boolean,
    ): Promise<boolean> {
        try {
            const rows = this.outbox.request(workspaceId, processId, requestId);
            if (!rows.length) return false;
            await this.ensureReady();
            if (shouldCancel && !shouldCancel()) return false;
            for (const row of rows) this.cancelCapture(row, 'cancelled');
            this.wake();
            return true;
        } catch {
            this.logFailure();
            throw new Error('Sentinel mirror cancellation could not be recorded. Retry removing the pending message.');
        }
    }

    locateCapturedOrigin(request: QuestionRelayLocation): MessagingJobOrigin | undefined {
        if (!this.canSendCapturedOrigin() || !request.workspaceId) return;
        try {
            const receipts = this.outbox.request(request.workspaceId, request.processId, request.requestId);
            if (receipts.some(row => row.cancelRequested || row.state === 'cancelled')) return;
            const rows = receipts.filter(row => row.role === 'user'
                && (row.state !== 'admitting' || !!this.requestTask(row)));
            if (rows.length !== 1 || this.requestTask(rows[0])?.status === 'cancelled') return;
            if (!this.recoveredOwners.has(request.workspaceId)) throw new Error('Captured receipt hydration is pending');
            const row = rows[0];
            const destinations = this.deps.adapters.flatMap(adapter => adapter.destinations(row));
            if (!destinations.length || !destinations.every(dest => sameMirrorDestination(dest, row.destination))) return;
            return {
                connector: row.destination.connector, chatKey: row.destination.chatKey,
                ...(row.destination.threadId ? { threadId: row.destination.threadId } : {}),
                desktopMirror: {
                    workspaceId: row.workspaceId, processId: row.processId, requestId: row.requestId,
                    bindingId: row.destination.bindingId,
                },
            };
        } catch {
            this.logFailure();
            throw new Error('Sentinel captured messaging origin is unavailable. Delegation admission is paused.');
        }
    }

    async authorizeCapturedOrigin(
        origin: MessagingJobOrigin, parent?: { workspaceId: string; processId: string },
    ): Promise<MessagingOriginAuthority> {
        const pin = origin.desktopMirror;
        if (!pin) return 'ready';
        // A paused mirror also pauses delegated results bound to its captured origin.
        const generation = this.generation;
        const authorized = () => !this.disposed && this.deps.enabled() && this.generation === generation;
        if (!authorized()) return 'wait';
        let row: SentinelMirrorEntry | undefined;
        try {
            if (parent && (parent.workspaceId !== pin.workspaceId || parent.processId !== pin.processId)) return 'suppress';
            await Promise.all(this.deps.adapters.map(adapter => adapter.ready?.()));
            if (!authorized()) return 'wait';
            await this.ensureReady();
            if (!authorized()) return 'wait';
            const workspaces = await this.deps.store.getWorkspaces();
            if (!authorized()) return 'wait';
            if (!workspaces.some(ws => ws.id === pin.workspaceId)) return 'suppress';
            const receipts = this.outbox.request(pin.workspaceId, pin.processId, pin.requestId);
            const users = receipts.filter(receipt => receipt.role === 'user');
            if (users.length !== 1) return 'suppress';
            row = users[0];
            const owner = await this.deps.store.getProcessOwnerProjection(pin.processId, pin.workspaceId);
            if (!authorized()) return 'wait';
            const destinations = this.deps.adapters.flatMap(adapter => adapter.destinations(row!));
            if (owner?.id !== pin.processId || owner.workspaceId !== pin.workspaceId
                || normalizeChatMode(owner.mode) !== 'sentinel'
                || owner.status === 'cancelled' || owner.status === 'cancelling'
                || receipts.some(receipt => receipt.cancelRequested || receipt.state === 'cancelled')
                || (row.state === 'admitting' && !this.requestTask(row)) || this.requestTask(row)?.status === 'cancelled'
                || row.destination.bindingId !== pin.bindingId
                || row.destination.connector !== origin.connector || row.destination.chatKey !== origin.chatKey
                || row.destination.threadId !== origin.threadId
                || !destinations.length || !destinations.every(dest => sameMirrorDestination(dest, row!.destination))) {
                await this.report({ ...row, failure: 'unbound' });
                return 'suppress';
            }
            if (parent && (row.state !== 'delivered'
                || receipts.filter(receipt => receipt.role === 'assistant'
                    && receipt.state === 'delivered' && sameMirrorDestination(receipt.destination, row!.destination)).length !== 1)) {
                return 'wait';
            }
            const adapter = this.deps.adapters.find(adapter => adapter.connector === origin.connector);
            const available = adapter?.availability(row) === 'ready';
            return available && authorized() ? 'ready' : 'wait';
        } catch {
            if (row) await this.reportStorageFailure(row);
            else this.logFailure();
            return 'wait';
        }
    }

    async isOwnMirrorMessage(message: SentinelMirrorEcho): Promise<boolean> {
        if (message.isSelf === false) return false;
        const text = mirrorEchoText(message.connector === 'teams' ? message.text.replace(/<[^>]*>/g, ' ') : message.text);
        const marker = message.connector === 'whatsapp'
            ? /^CoC · Desktop (user|assistant) · Request ([A-Za-z0-9_-]{1,64}) · Part ([1-9]\d*)\/([1-9]\d*)(?: |$)/.exec(text)
            : /^CoC · Request ([A-Za-z0-9_-]{1,64}) · Part ([1-9]\d*)\/([1-9]\d*) ?Desktop (user|assistant)/.exec(text);
        if (!marker) return false;
        const requestId = marker[message.connector === 'whatsapp' ? 2 : 1];
        const role = marker[message.connector === 'whatsapp' ? 1 : 4] as SentinelMirrorEntry['role'];
        const part = Number(marker[message.connector === 'whatsapp' ? 3 : 2]);
        const total = Number(marker[message.connector === 'whatsapp' ? 4 : 3]);
        if (!Number.isSafeInteger(part) || !Number.isSafeInteger(total) || part > total) return false;
        try {
            await this.ensureReady();
            const workspaces = new Set((await this.deps.store.getWorkspaces()).map(ws => ws.id));
            for (const row of this.outbox.echoCandidates(requestId, role, message.connector, message.chatKey)) {
                if (!workspaces.has(row.workspaceId) || (message.workspaceId && row.workspaceId !== message.workspaceId)
                    || (message.processId && row.processId !== message.processId)
                    || row.destination.threadId !== message.threadId
                    || (message.accountKey && !row.destination.bindingId.startsWith(`${message.accountKey}:`))) continue;
                const recordedAttempts = Math.min(row.attemptedPartCount ?? 0, row.nextPart + 1);
                const attempted = Math.max(recordedAttempts, row.nextPart
                    + (row.attemptId || row.failure === 'unknown' || row.state === 'ambiguous' ? 1 : 0));
                if (part > attempted || total !== row.chunks.length) continue;
                const matched = mirrorChunkEchoMatches(message.connector, row.chunks[part - 1], message.text);
                if (!matched) continue;
                if (!message.accountKey || message.isSelf !== true) throw new Error('Mirror sender is unavailable');
                return true;
            }
            return false;
        } catch {
            this.logFailure();
            throw new Error('Sentinel mirror echo verification is unavailable. Message admission is paused.');
        }
    }

    /** Re-arm one connector's echo guards from the receipt index after it (re)connects. */
    connectorReady(connector: SentinelMirrorAdapter['connector']): void {
        if (this.disposed) return;
        this.echoRestoreNeeded.add(connector);
        this.wake();
    }

    /**
     * Coalesced, single-flight drain. A wake during a drain marks the worker
     * dirty so the work is picked up by one more pass instead of being lost.
     * Disabled or disposed workers do nothing at all.
     */
    wake(): void {
        if (this.disposed) return;
        if (!this.deps.enabled()) {
            this.generation++;
            this.clearRetryTimer();
            return;
        }
        if (this.draining) {
            this.dirty = true;
            return;
        }
        this.draining = (async () => {
            do {
                this.dirty = false;
                try {
                    await this.ensureReady();
                    await this.drain();
                } catch { this.logFailure(); }
            } while (this.dirty && !this.disposed && this.deps.enabled());
        })().finally(() => {
            this.draining = undefined;
            this.armRetryTimer();
        });
    }

    /** Deterministic test/control seam; never starts or reconnects a connector. */
    async flush(): Promise<void> {
        this.wake();
        await this.draining;
    }

    private logFailure(): void { console.error('[sentinel-mirror] Durable mirror reconciliation failed; no unsafe replay attempted'); }

    private clearRetryTimer(): void {
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
        this.retryAt = undefined;
    }

    /** Offline/quarantined heads wait for a wake; overdue runnable heads use a safe delay. */
    private armRetryTimer(): void {
        if (this.disposed || !this.deps.enabled()) return this.clearRetryTimer();
        const at = this.nextActionableRetryAt;
        if (at === undefined) return this.clearRetryTimer();
        if (this.retryTimer && this.retryAt === at) return;
        this.clearRetryTimer();
        this.retryAt = at;
        const delay = at - Date.now();
        this.retryTimer = setTimeout(() => {
            this.retryTimer = undefined;
            this.retryAt = undefined;
            this.wake();
        }, Math.min(delay > 0 ? delay : 1_000, 2_147_483_647));
        this.retryTimer.unref();
    }

    private async reportStorageFailure(row: SentinelMirrorHeader): Promise<void> {
        this.logFailure();
        await this.storageNotice(row).catch(() => this.logFailure());
    }

    private async ownedProjection(row: Pick<SentinelMirrorEntry, 'workspaceId' | 'processId'>): Promise<ProcessOwnerProjection | undefined> {
        const owner = await this.deps.store.getProcessOwnerProjection(row.processId, row.workspaceId);
        return owner && owner.id === row.processId && owner.workspaceId === row.workspaceId ? owner : undefined;
    }

    private async storageNotice(row: SentinelMirrorHeader): Promise<void> {
        const id = `sentinel-mirror-storage:${row.eventId}`;
        if (!await this.ownedProjection(row) || await this.deps.store.hasRelayReceiptTurn(row.processId, id, row.workspaceId)) return;
        await this.deps.store.appendConversationTurn(row.processId, turnIndex => ({
            role: 'assistant', content: 'Sentinel mirror: durable receipt storage is unavailable. Accepted work is retained for reconciliation; delivery is paused.',
            timestamp: new Date(), turnIndex, timeline: [], displayOnly: true, relayRequestId: id,
        }), { additionalUpdates: current => this.noticeOwnerGuard(row, current) });
    }

    private noticeOwnerGuard(row: SentinelMirrorHeader, current: AIProcess): Partial<AIProcess> {
        if (current.id !== row.processId || current.metadata?.workspaceId !== row.workspaceId) {
            throw new Error('Mirror notice owner is unavailable');
        }
        return {};
    }

    private async isAdmitted(row: SentinelMirrorHeader): Promise<boolean> {
        if (this.requestTask(row)) return true;
        return !!await this.ownedProjection(row)
            && await this.deps.store.hasRelayRequestAdmission(row.processId, row.requestId, row.workspaceId);
    }

    private requestTask(row: SentinelMirrorHeader): QueuedTask | undefined {
        return this.deps.queue.getAll().find(task => task.repoId === row.workspaceId
            && task.processId === row.processId && task.type === 'chat'
            && task.payload.workspaceId === row.workspaceId && task.payload.relayRequestId === row.requestId);
    }

    private queuedOriginalOwner(workspaceId: string, processId: string): QueuedTask | undefined {
        return this.deps.queue.getAll().find(task => task.repoId === workspaceId && task.processId === processId
            && task.type === 'chat' && task.status === 'queued' && !task.payload.processId
            && task.payload.workspaceId === workspaceId && normalizeChatMode(task.payload.mode) === 'sentinel'
            && toQueueProcessId(task.id) === processId);
    }

    private awaitsQueuedOwner(row: SentinelMirrorHeader): boolean {
        const task = this.requestTask(row);
        return row.role === 'user' && (task?.status === 'queued' || task?.status === 'running')
            && !!this.queuedOriginalOwner(row.workspaceId, row.processId);
    }

    /** Queued resume evidence is separate from the parent's possibly stale terminal status. */
    private async awaitsResumeActivation(row: SentinelMirrorHeader, owner: ProcessOwnerProjection): Promise<boolean> {
        const task = this.requestTask(row);
        if (!(row.role === 'user' && row.state !== 'cancelled' && !row.cancelRequested
            && owner.status === 'cancelled' && (task?.status === 'queued' || task?.status === 'running')
            && typeof task.payload.resumeSessionId === 'string' && !!task.payload.resumeSessionId.trim())) return false;
        return !(await this.deps.store.getRelayRequestProjection(row.processId, row.requestId, row.workspaceId)).found;
    }

    private activeUserRows(): SentinelMirrorHeader[] {
        const rows: SentinelMirrorHeader[] = [];
        for (let after = 0; ;) {
            const page = this.outbox.activeRequests(after, SENTINEL_MIRROR_LIMITS.requestBatch);
            rows.push(...page);
            if (page.length < SENTINEL_MIRROR_LIMITS.requestBatch) return rows;
            after = page[page.length - 1].seq;
        }
    }

    private async restore(): Promise<void> {
        if (!this.deps.enabled()) return;
        const workspaces = (await this.deps.store.getWorkspaces()).filter(ws => !this.recoveredOwners.has(ws.id));
        if (!workspaces.length) return;
        for (const ws of workspaces) {
            try {
                // Import before scheduling: nothing sends during import and JSON is never read again.
                this.outbox.importLegacy(ws.id);
                this.importFailures.delete(ws.id);
            } catch {
                if (!this.importFailures.has(ws.id)) {
                    this.importFailures.add(ws.id);
                    console.error(`[sentinel-mirror] Legacy ledger import failed for workspace ${ws.id}; the original file was preserved and mirroring for this workspace is paused`);
                }
                continue;
            }
            try { this.outbox.recover(ws.id); }
            catch {
                for (const row of this.safeSending(ws.id)) await this.reportStorageFailure(row);
                throw new Error('Sentinel mirror recovery is unavailable');
            }
        }
        const recovered = workspaces.filter(ws => !this.importFailures.has(ws.id)).map(ws => ws.id);
        const scope = new Set(recovered);
        for (const row of this.activeUserRows()) {
            if (!scope.has(row.workspaceId) || row.state !== 'admitting' || this.activeAdmissions.has(row.eventId)) continue;
            try {
                if (await this.isAdmitted(row)) this.outbox.accept(row.workspaceId, row.eventId);
                else this.outbox.reject(row.workspaceId, row.eventId);
            } catch {
                await this.reportStorageFailure(row);
                throw new Error('Sentinel mirror admission reconciliation is unavailable');
            }
        }
        for (const id of recovered) {
            for (let afterRowId = 0; !this.disposed && this.deps.enabled();) {
                const page = this.outbox.recoverStagedAnswers(id, afterRowId, SENTINEL_MIRROR_LIMITS.requestBatch);
                if (page.count < SENTINEL_MIRROR_LIMITS.requestBatch) break;
                afterRowId = page.afterRowId;
                await yieldToEventLoop();
            }
        }
        if (this.disposed || !this.deps.enabled()) return;
        if (!this.recoveredOwners.size) await this.restoreEchoGuards();
        for (const id of recovered) this.recoveredOwners.add(id);
    }

    private safeSending(workspaceId: string): SentinelMirrorHeader[] {
        try { return this.outbox.sending().filter(row => row.workspaceId === workspaceId); }
        catch { this.logFailure(); return []; }
    }

    /**
     * Page confirmed receipts into connector own-message guards; nothing is
     * kept in this service. A failing guard reports a fixed storage notice for
     * the affected delivery and keeps the connector marked for another pass.
     */
    private async restoreEchoGuards(connector?: SentinelMirrorAdapter['connector']): Promise<void> {
        for (let after = 0; ;) {
            const page = this.outbox.receipts(after, SENTINEL_MIRROR_LIMITS.receiptPage);
            for (const receipt of page) {
                if (connector && receipt.destination.connector !== connector) continue;
                try {
                    this.deps.adapters.find(adapter => adapter.connector === receipt.destination.connector)
                        ?.record(receipt.destination, receipt.outboundId);
                } catch {
                    this.echoRestoreNeeded.add(receipt.destination.connector);
                    await this.reportStorageFailure(this.outbox.get(receipt.workspaceId, receipt.eventId));
                    throw new Error('Sentinel mirror receipt reconciliation is unavailable');
                }
            }
            if (page.length < SENTINEL_MIRROR_LIMITS.receiptPage) return;
            after = page[page.length - 1].rowId;
            await yieldToEventLoop();
        }
    }

    private async finalAnswer(row: SentinelMirrorHeader, owner: ProcessOwnerProjection): Promise<void> {
        const evidence = await this.deps.store.getRelayRequestProjection(row.processId, row.requestId, row.workspaceId);
        if (evidence.pending || !evidence.found) return;
        const task = this.requestTask(row);
        if (task && !isTerminalStatus(task.status)) return;
        const status = task?.status ?? (evidence.failure ? 'failed'
            : !evidence.closed && owner.status === 'completed' ? 'completed' : undefined);
        const answered = evidence.answer !== undefined;
        if (!(answered && evidence.closed) && !isTerminalStatus(status)) return;
        if (status === 'cancelled') return;
        if (status !== 'failed' && status !== 'completed' && !answered) return;
        // Pending drain can append the next user before its task exists, while the parent still looks completed.
        if (!answered && status === 'completed' && !task) return;
        const content = status === 'failed' ? relayFailureText(evidence.failure, evidence.closed, task?.error)
            : evidence.answer?.trim() || RELAY_ANSWER_TEXT.empty;
        this.outbox.materializeAnswer(row, content);
    }

    /** A delivered user receipt still owns a future reply; cancellation must survive reconnect/resume. */
    private cancelCapture(row: SentinelMirrorHeader, reason: 'cancelled' | 'unbound'): void {
        if (row.role === 'user' && row.state === 'delivered'
            && !this.outbox.find(row.workspaceId, row.processId, row.requestId, 'assistant')) {
            this.outbox.stage({
                workspaceId: row.workspaceId, processId: row.processId, requestId: row.requestId,
                role: 'assistant', destination: row.destination, content: RELAY_ANSWER_TEXT.cancelled,
            });
        }
        this.outbox.cancel(row.workspaceId, row.processId, reason, row.destination.bindingId, row.requestId);
    }

    private async report(row: SentinelMirrorHeader): Promise<void> {
        if (!row.failure || row.failure === 'admission-rejected') return;
        const id = `sentinel-mirror-status:${row.eventId}:${row.failure}`;
        if (!await this.ownedProjection(row) || await this.deps.store.hasRelayReceiptTurn(row.processId, id, row.workspaceId)) return;
        const detail = row.failure === 'unknown'
            ? 'Delivery is uncertain. Automatic replay is paused to avoid duplicates; reconcile the messaging conversation manually.'
            : row.failure === 'attachment-invalid' ? 'Stored attachment bytes are unavailable or invalid. Delivery stopped; already confirmed parts were not resent.'
            : row.failure === 'unbound' ? 'Delivery stopped because the captured messaging binding is unavailable.'
                : row.failure === 'cancelled' ? 'Pending delivery cancelled.'
                    : 'Delivery was not confirmed. The unsent part will retry with bounded backoff while the captured binding remains active.';
        await this.deps.store.appendConversationTurn(row.processId, turnIndex => ({
            role: 'assistant', content: `Sentinel mirror: ${detail}`, timestamp: new Date(), turnIndex,
            timeline: [], displayOnly: true, relayRequestId: id,
        }), { additionalUpdates: current => this.noticeOwnerGuard(row, current) });
    }

    /** Reconcile one unfinished request: admission, ownership, cancellation, then answer materialization. */
    private async reconcileRequest(row: SentinelMirrorHeader): Promise<void> {
        if (this.activeAdmissions.has(row.eventId)) return;
        if (row.state === 'admitting') {
            if (await this.isAdmitted(row)) this.outbox.accept(row.workspaceId, row.eventId);
            return;
        }
        if (this.requestTask(row)?.status === 'cancelled') return this.cancelCapture(row, 'cancelled');
        const owner = await this.ownedProjection(row);
        if (!owner) {
            const exists = await this.deps.store.getProcessOwnerProjection(row.processId, row.workspaceId);
            if (exists || !this.awaitsQueuedOwner(row)) this.cancelCapture(row, 'unbound');
            return;
        }
        const adapter = this.deps.adapters.find(adapter => adapter.connector === row.destination.connector);
        if (await this.awaitsResumeActivation(row, owner)) {
            if (adapter?.availability(row) === 'unbound') this.cancelCapture(row, 'unbound');
            return;
        }
        if (owner.status === 'cancelled' || owner.status === 'cancelling') this.cancelCapture(row, 'cancelled');
        else if (adapter?.availability(row) === 'unbound') this.cancelCapture(row, 'unbound');
        else if (!row.cancelRequested && row.state !== 'cancelled') await this.finalAnswer(row, owner);
    }

    private async drain(): Promise<void> {
        this.nextActionableRetryAt = undefined;
        if (this.disposed || !this.deps.enabled()) return;
        const workspaceIds = (await this.deps.store.getWorkspaces()).map(ws => ws.id)
            .filter(id => this.recoveredOwners.has(id));
        const scope = new Set(workspaceIds);
        const blocked = new Set<string>();
        for (const connector of [...this.echoRestoreNeeded]) {
            this.echoRestoreNeeded.delete(connector);
            await this.restoreEchoGuards(connector);
        }
        // Drains are single-flight; a sending row at entry belongs to an already finished, unrecorded attempt.
        for (const row of this.outbox.sending()) {
            if (!scope.has(row.workspaceId) || !row.attemptId) continue;
            try {
                this.outbox.failPart(row.workspaceId, row.eventId, row.attemptId, 'unknown', 0);
                if (row.cancelRequested) this.cancelCapture(row, row.failure === 'unbound' ? 'unbound' : 'cancelled');
            } catch {
                blocked.add(mirrorDestinationKey(row.destination));
                await this.reportStorageFailure(row);
            }
        }
        // Active requests only, in bounded batches; finished history is never read.
        for (let after = 0; !this.disposed && this.deps.enabled();) {
            const page = this.outbox.activeRequests(after, SENTINEL_MIRROR_LIMITS.requestBatch);
            for (const row of page) {
                if (!scope.has(row.workspaceId)) continue;
                try { await this.reconcileRequest(row); }
                catch {
                    blocked.add(mirrorDestinationKey(row.destination));
                    await this.reportStorageFailure(row);
                }
            }
            if (page.length < SENTINEL_MIRROR_LIMITS.requestBatch) break;
            after = page[page.length - 1].seq;
            await yieldToEventLoop();
        }
        if (this.disposed || !this.deps.enabled()) return;
        // One shared worker orders physical destinations across workspaces; a few destinations run concurrently.
        let sourceSettled = false;
        for (let afterKey = ''; !this.disposed && this.deps.enabled();) {
            const page = this.outbox.headPage(workspaceIds, afterKey, SENTINEL_MIRROR_LIMITS.requestBatch);
            const heads = page.filter(row => !blocked.has(mirrorDestinationKey(row.destination)));
            const workers = Array.from({ length: Math.min(SENTINEL_MIRROR_LIMITS.destinations, heads.length) }, async () => {
                for (let head = heads.shift(); head; head = heads.shift()) {
                    // The worker owning a destination continues with its next head once the current one settles.
                    for (let row: SentinelMirrorHeader | undefined = head; row && !this.disposed && this.deps.enabled();) {
                        try {
                            if (await this.deliverHead(row, workspaceIds, blocked)) sourceSettled = true;
                        } catch {
                            blocked.add(mirrorDestinationKey(row.destination));
                            await this.reportStorageFailure(row);
                            break;
                        }
                        const next = this.outbox.destinationHead(mirrorDestinationKey(row.destination), workspaceIds);
                        row = next && next.eventId !== row.eventId ? next : undefined;
                    }
                }
            });
            await Promise.all(workers);
            for (const head of page) {
                const key = mirrorDestinationKey(head.destination);
                if (blocked.has(key)) continue;
                const row = this.outbox.destinationHead(key, workspaceIds);
                if (row?.state !== 'retryable' || !row.nextAttemptAt || this.activeAdmissions.has(row.eventId)) continue;
                const adapter = this.deps.adapters.find(adapter => adapter.connector === row.destination.connector);
                if (adapter?.availability(row) !== 'ready') continue;
                const at = Date.parse(row.nextAttemptAt);
                this.nextActionableRetryAt = Math.min(this.nextActionableRetryAt ?? at, at);
            }
            if (page.length < SENTINEL_MIRROR_LIMITS.requestBatch) break;
            afterKey = mirrorDestinationKey(page[page.length - 1].destination);
            await yieldToEventLoop();
        }
        const notices = this.outbox.unreported(SENTINEL_MIRROR_LIMITS.notices);
        let reported = 0;
        for (const row of notices) {
            if (!scope.has(row.workspaceId)) continue;
            try {
                await this.report(row);
                this.outbox.markReported(row.workspaceId, row.eventId, row.failure!);
                reported++;
            } catch { await this.reportStorageFailure(row); }
        }
        // More notices remain only if this page made progress; failing ones wait for the next wake.
        if (notices.length === SENTINEL_MIRROR_LIMITS.notices && reported) this.dirty = true;
        if (sourceSettled) {
            try { await this.deps.onSourceSettled?.(); }
            catch { this.logFailure(); }
        }
    }

    /** Sends one destination head's remaining parts, serialized; returns true when a source delivery settled. */
    private async deliverHead(head: SentinelMirrorHeader, workspaceIds: readonly string[], blocked: Set<string>): Promise<boolean> {
        if (this.activeAdmissions.has(head.eventId) || head.state === 'admitting') return false;
        const adapter = this.deps.adapters.find(adapter => adapter.connector === head.destination.connector);
        if (!adapter) return false;
        const availability = adapter.availability(head);
        if (availability === 'unbound') {
            this.cancelCapture(head, 'unbound');
            return false;
        }
        if (availability !== 'ready' || (head.state !== 'pending' && head.state !== 'retryable')) return false;
        if (head.nextAttemptAt && Date.parse(head.nextAttemptAt) > Date.now()) return false;
        // Payload bytes are read only for the row about to send.
        let current = this.outbox.get(head.workspaceId, head.eventId);
        const remainingMedia = (current.attachments ?? []).slice(current.chunks.length
            ? Math.max(0, mirrorAttachmentPartIndex(current, current.nextPart)) : 0);
        try {
            if (remainingMedia.length) {
                if (!adapter.validateAttachments || !adapter.sendAttachment) {
                    throw new MirrorAttachmentError('Attachment delivery is unavailable.');
                }
                adapter.validateAttachments(remainingMedia);
            }
        } catch (error) {
            if (!(error instanceof MirrorAttachmentError)) throw error;
            this.outbox.invalidateAttachments(current.workspaceId, current.eventId);
            return false;
        }
        if (!current.chunks.length) {
            this.outbox.prepare(current.workspaceId, current.eventId, adapter.format(current));
            current = this.outbox.get(current.workspaceId, current.eventId);
        }
        let settled = false;
        while (!this.disposed && this.deps.enabled() && adapter.availability(current) === 'ready') {
            const owner = await this.ownedProjection(current);
            if (owner && await this.awaitsResumeActivation(current, owner)) {
                blocked.add(mirrorDestinationKey(current.destination));
                break;
            }
            const raw = owner ? undefined : await this.deps.store.getProcessOwnerProjection(current.processId, current.workspaceId);
            if (this.requestTask(current)?.status === 'cancelled'
                || owner?.status === 'cancelled' || owner?.status === 'cancelling') {
                this.cancelCapture(current, 'cancelled');
                break;
            }
            if (!owner && (raw || !this.awaitsQueuedOwner(current))) {
                this.cancelCapture(current, 'unbound');
                break;
            }
            if (this.disposed || !this.deps.enabled() || adapter.availability(current) !== 'ready') break;
            const attempt = this.outbox.beginPart(current.workspaceId, current.eventId, workspaceIds);
            if (!attempt) break;
            let id: string;
            try {
                const mediaIndex = mirrorAttachmentPartIndex(current, current.nextPart);
                const attachment = mediaIndex >= 0 ? current.attachments?.[mediaIndex] : undefined;
                id = attachment
                    ? await adapter.sendAttachment!(current.destination, attachment, current.chunks[current.nextPart])
                    : await adapter.send(current.destination, current.chunks[current.nextPart]);
                if (!id?.trim()) throw new Error('Missing send receipt');
            } catch (error) {
                this.outbox.failPart(current.workspaceId, current.eventId, attempt, mirrorSendOutcome(error), mirrorRetryAfterMs(error));
                break;
            }
            // A send already issued finishes durably even if the worker was paused or disposed meanwhile.
            try {
                this.outbox.acknowledgePart(current.workspaceId, current.eventId, attempt, id);
            } catch (error) {
                try { this.outbox.failPart(current.workspaceId, current.eventId, attempt, 'unknown', 0); }
                catch { /* The persisted sending attempt already prevents replay. */ }
                throw error;
            }
            try { adapter.record(current.destination, id); }
            catch (error) {
                // The durable receipt prevents replay; the guard is re-armed from the index next drain.
                this.echoRestoreNeeded.add(adapter.connector);
                this.dirty = true;
                throw error;
            }
            current = this.outbox.get(current.workspaceId, current.eventId);
            if (current.state === 'delivered') settled = true;
            if (current.state === 'delivered' || current.state === 'cancelled') break;
        }
        return settled;
    }
}
