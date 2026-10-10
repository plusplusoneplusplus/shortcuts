import { randomUUID } from 'node:crypto';
import { toQueueProcessId, type AIProcess, type CreateTaskInput, type ProcessStore, type QueuedTask } from '@plusplusoneplusplus/forge';
import { normalizeChatMode } from '../tasks/task-types';
import { onTaskTerminal } from './chat-target';
import type { ScheduleQueueEventBus } from '../schedule/schedule-queue-await';
import { findRequestAnswer, findRequestFailureEvidence, findRequestFailureText, findRequestTurn, isTerminalStatus, RELAY_ANSWER_TEXT } from './relay-answer';
import { mirrorAttachmentPartIndex, SentinelMirrorOutbox, type SentinelMirrorEntry } from './sentinel-mirror-outbox';
import { mirrorChunkEchoMatches, mirrorEchoText, mirrorRetryAfterMs, mirrorSendOutcome, sameMirrorDestination, type SentinelMirrorAdapter } from './sentinel-mirror-adapters';
import type { QuestionRelayLocation } from './ask-user-relay';
import type { MessagingJobOrigin, MessagingOriginAuthority } from './job-notices';
import { captureMirrorUploads, MirrorAttachmentError, type MirrorUploadSource } from './sentinel-mirror-attachments';

export interface SentinelMirrorDeps {
    dataDir: string;
    store: Pick<ProcessStore, 'getProcess' | 'getWorkspaces' | 'appendConversationTurn'>;
    queue: Pick<ScheduleQueueEventBus, 'on' | 'off' | 'getTask'> & { getAll(): QueuedTask[] };
    enabled: () => boolean;
    adapters: SentinelMirrorAdapter[];
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

/** Only trusted HTTP admission paths call capture; execution/connector/review events never create user intents. */
export class SentinelMirrorService {
    readonly outbox: SentinelMirrorOutbox;
    private readonly unsubscribe: () => void;
    private timer?: NodeJS.Timeout;
    private disposed = false;
    private draining?: Promise<void>;
    private ready?: Promise<void>;
    private readonly recoveredOwners = new Set<string>();
    private readonly activeAdmissions = new Set<string>();
    private readonly recordedOutbound = new Set<string>();

    constructor(private readonly deps: SentinelMirrorDeps) {
        this.outbox = deps.outbox ?? new SentinelMirrorOutbox(deps.dataDir);
        this.unsubscribe = onTaskTerminal(deps.queue, () => this.wake());
    }

    start(): void {
        this.timer = setInterval(() => this.wake(), 1000);
        this.timer.unref();
        this.wake();
    }

    private ensureReady(): Promise<void> {
        return this.ready ??= Promise.all(this.deps.enabled() ? this.deps.adapters.map(adapter => adapter.ready?.()) : [])
            .then(() => this.restore()).finally(() => {
            this.ready = undefined;
        });
    }

    dispose(): void {
        this.disposed = true;
        if (this.timer) clearInterval(this.timer);
        this.unsubscribe();
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
        if (!this.deps.enabled()) return;
        await this.ensureReady();
        if (!this.deps.enabled()) return;
        if (!workspaceId || !processId || !(await this.deps.store.getWorkspaces()).some(ws => ws.id === workspaceId)) return;
        if (!this.recoveredOwners.has(workspaceId)) {
            await this.ensureReady();
            if (!this.recoveredOwners.has(workspaceId)) throw new Error('Mirror owner hydration is unavailable');
        }
        const process = await this.deps.store.getProcess(processId, workspaceId);
        const task = process ? undefined : this.queuedOriginalOwner(workspaceId, processId);
        if (process ? process.id !== processId || process.metadata?.workspaceId !== workspaceId
            || normalizeChatMode(process.metadata?.mode) !== 'sentinel'
            : !task) return;
        if (process?.status === 'cancelling') return;
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

    async cancelConnector(connector: SentinelMirrorAdapter['connector']): Promise<void> {
        for (const ws of await this.deps.store.getWorkspaces()) {
            for (const row of this.outbox.list(ws.id)) {
                if (row.destination.connector === connector) this.cancelCapture(row, 'unbound');
            }
        }
        this.wake();
    }

    async cancelRequest(
        workspaceId: string, processId: string, requestId: string, shouldCancel?: () => boolean,
    ): Promise<boolean> {
        try {
            const rows = this.outbox.list(workspaceId).filter(row => row.processId === processId && row.requestId === requestId);
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
        if (!this.deps.enabled() || !request.workspaceId) return;
        try {
            const receipts = this.outbox.list(request.workspaceId).filter(row =>
                row.workspaceId === request.workspaceId && row.processId === request.processId
                && row.requestId === request.requestId);
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
        let row: SentinelMirrorEntry | undefined;
        try {
            if (parent && (parent.workspaceId !== pin.workspaceId || parent.processId !== pin.processId)) return 'suppress';
            await Promise.all(this.deps.adapters.map(adapter => adapter.ready?.()));
            await this.ensureReady();
            if (!(await this.deps.store.getWorkspaces()).some(ws => ws.id === pin.workspaceId)) return 'suppress';
            const receipts = this.outbox.list(pin.workspaceId).filter(receipt =>
                receipt.workspaceId === pin.workspaceId && receipt.processId === pin.processId
                && receipt.requestId === pin.requestId);
            const users = receipts.filter(receipt => receipt.role === 'user');
            if (users.length !== 1) return 'suppress';
            row = users[0];
            const proc = await this.deps.store.getProcess(pin.processId, pin.workspaceId);
            const destinations = this.deps.adapters.flatMap(adapter => adapter.destinations(row!));
            if (proc?.id !== pin.processId || proc.metadata?.workspaceId !== pin.workspaceId
                || normalizeChatMode(proc.metadata?.mode) !== 'sentinel'
                || proc.status === 'cancelled' || proc.status === 'cancelling'
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
            return adapter?.availability(row) === 'ready' ? 'ready' : 'wait';
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
        const role = marker[message.connector === 'whatsapp' ? 1 : 4];
        const part = Number(marker[message.connector === 'whatsapp' ? 3 : 2]);
        const total = Number(marker[message.connector === 'whatsapp' ? 4 : 3]);
        if (!Number.isSafeInteger(part) || !Number.isSafeInteger(total) || part > total) return false;
        try {
            await this.ensureReady();
            for (const workspace of await this.deps.store.getWorkspaces()) {
                if (message.workspaceId && workspace.id !== message.workspaceId) continue;
                for (const row of this.outbox.list(workspace.id)) {
                    if (row.requestId !== requestId || row.role !== role
                        || (message.processId && row.processId !== message.processId)
                        || row.destination.connector !== message.connector || row.destination.chatKey !== message.chatKey
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
            }
            return false;
        } catch {
            this.logFailure();
            throw new Error('Sentinel mirror echo verification is unavailable. Message admission is paused.');
        }
    }

    wake(): void {
        if (this.disposed || this.draining) return;
        this.draining = this.ensureReady().then(() => this.drain()).catch(() => this.logFailure())
            .finally(() => { this.draining = undefined; });
    }

    /** Deterministic test/control seam; never starts or reconnects a connector. */
    async flush(): Promise<void> {
        this.wake();
        await this.draining;
    }

    private logFailure(): void { console.error('[sentinel-mirror] Durable mirror reconciliation failed; no unsafe replay attempted'); }

    private async reportStorageFailure(row: SentinelMirrorEntry): Promise<void> {
        this.logFailure();
        await this.storageNotice(row).catch(() => this.logFailure());
    }

    private deliveryKey(row: SentinelMirrorEntry): string {
        return JSON.stringify([row.destination.connector, row.destination.chatKey,
            row.destination.connector === 'teams' ? row.destination.threadId : null]);
    }

    private outboundKey(row: SentinelMirrorEntry, id: string): string {
        return JSON.stringify([row.destination.connector, row.destination.chatKey, row.destination.threadId, id]);
    }

    private async storageNotice(row: SentinelMirrorEntry): Promise<void> {
        const id = `sentinel-mirror-storage:${row.eventId}`;
        const proc = await this.deps.store.getProcess(row.processId, row.workspaceId);
        if (!proc || proc.id !== row.processId || proc.metadata?.workspaceId !== row.workspaceId
            || proc.conversationTurns?.some(turn => turn.relayRequestId === id)) return;
        await this.deps.store.appendConversationTurn(row.processId, turnIndex => ({
            role: 'assistant', content: 'Sentinel mirror: durable receipt storage is unavailable. Accepted work is retained for reconciliation; delivery is paused.',
            timestamp: new Date(), turnIndex, timeline: [], displayOnly: true, relayRequestId: id,
        }), { additionalUpdates: current => this.noticeOwnerGuard(row, current) });
    }

    private noticeOwnerGuard(row: SentinelMirrorEntry, current: AIProcess): Partial<AIProcess> {
        if (current.id !== row.processId || current.metadata?.workspaceId !== row.workspaceId) {
            throw new Error('Mirror notice owner is unavailable');
        }
        return {};
    }

    private async isAdmitted(row: SentinelMirrorEntry): Promise<boolean> {
        const task = this.requestTask(row);
        if (task) return true;
        const proc = await this.deps.store.getProcess(row.processId, row.workspaceId);
        if (proc?.id !== row.processId || proc.metadata?.workspaceId !== row.workspaceId) return false;
        return !!proc.pendingMessages?.some(message => message.relayRequestId === row.requestId)
            || findRequestTurn(proc.conversationTurns ?? [], row.requestId) >= 0;
    }

    private requestTask(row: SentinelMirrorEntry): QueuedTask | undefined {
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

    private awaitsQueuedOwner(row: SentinelMirrorEntry): boolean {
        const task = this.requestTask(row);
        return row.role === 'user' && (task?.status === 'queued' || task?.status === 'running')
            && !!this.queuedOriginalOwner(row.workspaceId, row.processId);
    }

    private awaitsResumeActivation(row: SentinelMirrorEntry, proc: AIProcess): boolean {
        const task = this.requestTask(row);
        return row.role === 'user' && row.state !== 'cancelled' && !row.cancelRequested
            && proc.status === 'cancelled' && (task?.status === 'queued' || task?.status === 'running')
            && typeof task.payload.resumeSessionId === 'string' && !!task.payload.resumeSessionId.trim()
            && findRequestTurn(proc.conversationTurns ?? [], row.requestId) < 0;
    }

    private async restore(): Promise<void> {
        const workspaces = (await this.deps.store.getWorkspaces()).filter(ws => !this.recoveredOwners.has(ws.id));
        for (const ws of workspaces) {
            try { this.outbox.recover(ws.id); }
            catch {
                try {
                    for (const row of this.outbox.list(ws.id)) {
                        if (row.state === 'sending') await this.reportStorageFailure(row);
                    }
                } catch { this.logFailure(); }
                throw new Error('Sentinel mirror recovery is unavailable');
            }
        }
        for (const ws of workspaces) {
            for (const row of this.outbox.list(ws.id)) {
                try {
                    if (row.state !== 'admitting' || this.activeAdmissions.has(row.eventId)) continue;
                    if (await this.isAdmitted(row)) this.outbox.accept(ws.id, row.eventId);
                    else this.outbox.reject(ws.id, row.eventId);
                } catch {
                    await this.reportStorageFailure(row);
                    throw new Error('Sentinel mirror admission reconciliation is unavailable');
                }
            }
            // Restore own-ID guards even if the process died after receipt persistence.
            for (const row of this.outbox.list(ws.id)) {
                try {
                    const adapter = this.deps.adapters.find(adapter => adapter.connector === row.destination.connector);
                    for (const id of row.outboundIds) {
                        adapter?.record(row.destination, id);
                        if (adapter) this.recordedOutbound.add(this.outboundKey(row, id));
                    }
                } catch {
                    await this.reportStorageFailure(row);
                    throw new Error('Sentinel mirror receipt reconciliation is unavailable');
                }
            }
            this.recoveredOwners.add(ws.id);
        }
    }

    private async finalAnswer(row: SentinelMirrorEntry, proc: AIProcess): Promise<void> {
        if (proc.pendingMessages?.some(message => message.relayRequestId === row.requestId)) return;
        const turns = proc.conversationTurns ?? [];
        const start = findRequestTurn(turns, row.requestId);
        if (start < 0) return;
        const { answer, closed } = findRequestAnswer(turns, start);
        const task = this.requestTask(row);
        if (task && !isTerminalStatus(task.status)) return;
        const failure = findRequestFailureEvidence(turns, start);
        const status = task?.status ?? (failure ? 'failed' : !closed && proc.status === 'completed' ? 'completed' : undefined);
        if (!(answer && closed) && !isTerminalStatus(status)) return;
        if (status === 'cancelled') return;
        if (status !== 'failed' && status !== 'completed' && !answer) return;
        // Pending drain can append the next user before its task exists, while the parent still looks completed.
        if (!answer && status === 'completed' && !task) return;
        const content = status === 'failed' ? findRequestFailureText(turns, start, task?.error)
            : answer?.content?.trim() || RELAY_ANSWER_TEXT.empty;
        const entry = this.outbox.stage({ workspaceId: row.workspaceId, processId: row.processId,
            requestId: row.requestId, role: 'assistant', destination: row.destination, content });
        this.outbox.accept(row.workspaceId, entry.eventId);
    }

    /** A delivered user receipt still owns a future reply; cancellation must survive reconnect/resume. */
    private cancelCapture(row: SentinelMirrorEntry, reason: 'cancelled' | 'unbound'): void {
        if (row.role === 'user' && row.state === 'delivered'
            && !this.outbox.list(row.workspaceId).some(entry => entry.role === 'assistant'
                && entry.processId === row.processId && entry.requestId === row.requestId)) {
            this.outbox.stage({
                workspaceId: row.workspaceId, processId: row.processId, requestId: row.requestId,
                role: 'assistant', destination: row.destination, content: RELAY_ANSWER_TEXT.cancelled,
            });
        }
        this.outbox.cancel(row.workspaceId, row.processId, reason, row.destination.bindingId, row.requestId);
    }

    private async report(row: SentinelMirrorEntry): Promise<void> {
        if (!row.failure || row.failure === 'admission-rejected') return;
        const id = `sentinel-mirror-status:${row.eventId}:${row.failure}`;
        const proc = await this.deps.store.getProcess(row.processId, row.workspaceId);
        if (!proc || proc.id !== row.processId || proc.metadata?.workspaceId !== row.workspaceId
            || proc.conversationTurns?.some(turn => turn.relayRequestId === id)) return;
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

    private async drain(): Promise<void> {
        if (this.disposed) return;
        const workspaces = await this.deps.store.getWorkspaces();
        const blocked = new Set<string>();
        let sourceSettled = false;
        for (const ws of workspaces) {
            for (const row of this.outbox.list(ws.id)) {
                try {
                    if (this.activeAdmissions.has(row.eventId)) continue;
                    // Drains are single-flight; a sending row at entry belongs to an already finished, unrecorded attempt.
                    if (row.state === 'sending' && row.attemptId) {
                        this.outbox.failPart(row.workspaceId, row.eventId, row.attemptId, 'unknown', 0);
                        if (row.cancelRequested) this.cancelCapture(row, row.failure === 'unbound' ? 'unbound' : 'cancelled');
                    }
                    const adapter = this.deps.adapters.find(adapter => adapter.connector === row.destination.connector);
                    for (const id of row.outboundIds) {
                        const key = this.outboundKey(row, id);
                        if (adapter && !this.recordedOutbound.has(key)) {
                            adapter.record(row.destination, id);
                            this.recordedOutbound.add(key);
                        }
                    }
                    if (row.state === 'admitting') {
                        if (await this.isAdmitted(row)) this.outbox.accept(ws.id, row.eventId);
                        continue;
                    }
                    if (this.requestTask(row)?.status === 'cancelled') {
                        this.cancelCapture(row, 'cancelled');
                        continue;
                    }
                    const proc = await this.deps.store.getProcess(row.processId, ws.id);
                    if (proc?.id !== row.processId || proc.metadata?.workspaceId !== ws.id) {
                        if (proc || !this.awaitsQueuedOwner(row)) this.cancelCapture(row, 'unbound');
                        continue;
                    }
                    if (this.awaitsResumeActivation(row, proc)) {
                        if (adapter?.availability(row) === 'unbound') this.cancelCapture(row, 'unbound');
                        continue;
                    }
                    if (proc.status === 'cancelled' || proc.status === 'cancelling') {
                        this.cancelCapture(row, 'cancelled');
                    } else if (adapter?.availability(row) === 'unbound') {
                        this.cancelCapture(row, 'unbound');
                    } else if (this.deps.enabled() && row.role === 'user' && !row.cancelRequested
                        && row.state !== 'cancelled') {
                        const exists = this.outbox.list(ws.id).some(answer => answer.role === 'assistant'
                            && answer.processId === row.processId && answer.requestId === row.requestId);
                        if (!exists) await this.finalAnswer(row, proc);
                    }
                } catch {
                    blocked.add(this.deliveryKey(row));
                    await this.reportStorageFailure(row);
                }
            }
        }
        if (!this.deps.enabled()) return;
        // A single shared worker orders physical destinations across workspace ledgers.
        const unresolved = this.outbox.headsAcrossWorkspaces(workspaces.map(ws => ws.id));
        const seen = new Set<string>();
        for (const row of unresolved) {
            const key = this.deliveryKey(row);
            if (seen.has(key) || blocked.has(key)) continue;
            seen.add(key);
            try {
                if (this.activeAdmissions.has(row.eventId) || row.state === 'admitting') continue;
                const adapter = this.deps.adapters.find(adapter => adapter.connector === row.destination.connector);
                if (!adapter) continue;
                const availability = adapter.availability(row);
                if (availability === 'unbound') {
                    this.cancelCapture(row, 'unbound');
                } else if (availability === 'ready' && (row.state === 'pending' || row.state === 'retryable')) {
                    const remainingMedia = (row.attachments ?? []).slice(row.chunks.length
                        ? Math.max(0, mirrorAttachmentPartIndex(row, row.nextPart)) : 0);
                    try {
                        if (remainingMedia.length) {
                            if (!adapter.validateAttachments || !adapter.sendAttachment) {
                                throw new MirrorAttachmentError('Attachment delivery is unavailable.');
                            }
                            adapter.validateAttachments(remainingMedia);
                        }
                    } catch (error) {
                        if (!(error instanceof MirrorAttachmentError)) throw error;
                        this.outbox.invalidateAttachments(row.workspaceId, row.eventId);
                        continue;
                    }
                    if (!row.chunks.length) this.outbox.prepare(row.workspaceId, row.eventId, adapter.format(row));
                    let current = this.outbox.list(row.workspaceId).find(entry => entry.eventId === row.eventId)!;
                    while (!this.disposed && this.deps.enabled() && adapter.availability(current) === 'ready') {
                        const proc = await this.deps.store.getProcess(row.processId, row.workspaceId);
                        if (proc?.id === row.processId && proc.metadata?.workspaceId === row.workspaceId
                            && this.awaitsResumeActivation(row, proc)) break;
                        if (this.requestTask(row)?.status === 'cancelled'
                            || proc?.status === 'cancelled' || proc?.status === 'cancelling') {
                            this.cancelCapture(row, 'cancelled');
                            break;
                        }
                        if (proc ? proc.id !== row.processId || proc.metadata?.workspaceId !== row.workspaceId
                            : !this.awaitsQueuedOwner(row)) {
                            this.cancelCapture(row, 'unbound');
                            break;
                        }
                        if (this.disposed || !this.deps.enabled() || adapter.availability(current) !== 'ready') break;
                        const attempt = this.outbox.beginPart(row.workspaceId, row.eventId, workspaces.map(ws => ws.id));
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
                            this.outbox.failPart(row.workspaceId, row.eventId, attempt, mirrorSendOutcome(error), mirrorRetryAfterMs(error));
                            break;
                        }
                        try {
                            this.outbox.acknowledgePart(row.workspaceId, row.eventId, attempt, id);
                            if (this.outbox.list(row.workspaceId).find(entry => entry.eventId === row.eventId)?.state === 'delivered') {
                                sourceSettled = true;
                            }
                        } catch (error) {
                            try { this.outbox.failPart(row.workspaceId, row.eventId, attempt, 'unknown', 0); }
                            catch { /* The persisted sending attempt already prevents replay. */ }
                            throw error;
                        }
                        adapter.record(current.destination, id);
                        this.recordedOutbound.add(this.outboundKey(current, id));
                        current = this.outbox.list(row.workspaceId).find(entry => entry.eventId === row.eventId)!;
                        if (current.state === 'delivered' || current.state === 'cancelled') break;
                    }
                }
            } catch {
                blocked.add(key);
                await this.reportStorageFailure(row);
            }
        }
        for (const ws of workspaces) for (const row of this.outbox.list(ws.id)) {
            try { await this.report(row); }
            catch { await this.reportStorageFailure(row); }
        }
        if (sourceSettled) {
            try { await this.deps.onSourceSettled?.(); }
            catch { this.logFailure(); }
        }
    }
}
