import * as fs from 'node:fs';
import * as path from 'node:path';
import { toQueueProcessId, type ProcessStore, type TaskQueueManager, type QueuedTask } from '@plusplusoneplusplus/forge';
import { getRepoDataPath } from '../paths';
import { atomicWriteJsonUnique } from '../shared/fs-utils';
import { ProcessOperationAdmission } from '../processes/process-operation-admission';
import { releaseBotControlledConversation } from './bot-control-admission';
import { ImageDownloadError } from '@plusplusoneplusplus/coc-connector';
import { IncomingImagesError } from './incoming-images';
import { PendingImagesError } from './pending-images';

export interface WhatsAppBinding {
    groupJid: string;
    workspaceId: string;
    processId: string;
    taskId: string;
    inboundId: string;
    outboundIds: string[];
    nextPart: number;
    status: 'queued' | 'sending' | 'delivered';
    admissionPending?: true;
    answerHash?: string;
    header?: string;
    /** Relayed ask_user question message ids, so late quote-replies are recognized. */
    questionIds?: string[];
    /** Captionless media and instruction-request IDs that quote this turn. */
    sourceMessageIds?: string[];
    releaseState?: 'releasing' | 'released';
    /**
     * A completion notice for a handed-off job (`inboundId` is the notice's own
     * message id). A quote-reply continues the job without changing the
     * selected repo/topic.
     */
    notice?: boolean;
}

interface BindingLifecycle {
    store: Pick<ProcessStore, 'getProcess' | 'updateProcess'>;
    queue: Pick<TaskQueueManager, 'getTask' | 'replaceBotControl'>;
}

export class WhatsAppBindingReleaseError extends Error {
    constructor(readonly errors: unknown[]) {
        super('WhatsApp binding release reconciliation failed');
        this.name = 'WhatsAppBindingReleaseError';
    }
}

export class WhatsAppBindingAdmissionError extends Error {
    constructor(readonly uncertain = false) {
        super(uncertain ? 'WhatsApp request admission is unconfirmed; check the conversation before retrying.'
            : 'WhatsApp request was not admitted.');
        this.name = 'WhatsAppBindingAdmissionError';
    }
}

/** Account selection is global; per-conversation receipts remain workspace-scoped. */
export class WhatsAppBindings {
    private readonly receipts = new Map<string, WhatsAppBinding[]>();
    private readonly removalAdmission = new ProcessOperationAdmission();
    private readonly activeAdmissions = new Set<WhatsAppBinding>();
    private admissionStore?: Pick<ProcessStore, 'getProcess'>;
    private readonly stateFile: string;
    private state: { selectedRepo: string | null; topics: Record<string, string | null>; outboundIds: string[] };

    constructor(private readonly dataDir: string, private readonly lifecycle?: BindingLifecycle) {
        this.stateFile = path.join(dataDir, 'messaging', 'whatsapp', 'state.json');
        try {
            this.state = fs.existsSync(this.stateFile)
                ? JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as typeof this.state
                : { selectedRepo: null, topics: {}, outboundIds: [] };
        } catch {
            throw new Error('Invalid WhatsApp selection state');
        }
        if (!this.state || typeof this.state !== 'object' || typeof this.state.topics !== 'object'
            || this.state.topics === null || Array.isArray(this.state.topics)
            || !Array.isArray(this.state.outboundIds)
            || this.state.outboundIds.some(id => typeof id !== 'string')
            || (this.state.selectedRepo !== null && typeof this.state.selectedRepo !== 'string')) {
            throw new Error('Invalid WhatsApp selection state');
        }
    }

    async restore(store: Pick<ProcessStore, 'getWorkspaces'> & Partial<Pick<ProcessStore, 'getProcess'>>): Promise<void> {
        if (store.getProcess) this.admissionStore = store as Pick<ProcessStore, 'getProcess'>;
        for (const workspace of await store.getWorkspaces()) this.load(workspace.id);
        const errors: unknown[] = [];
        let admissionFailed = false;
        for (const binding of this.entries()) {
            if (binding.admissionPending && binding.releaseState === undefined && !this.activeAdmissions.has(binding)) {
                try {
                    if (!await this.reconcileAdmission(binding) && this.lifecycle?.queue && this.admissionStore) {
                        this.discardRejected(binding);
                    }
                } catch {
                    admissionFailed = true;
                }
            }
            if (binding.releaseState !== 'releasing') continue;
            try {
                await this.remove(binding);
            } catch (error) {
                errors.push(error);
            }
        }
        if (errors.length) throw new WhatsAppBindingReleaseError(errors);
        if (admissionFailed) throw new WhatsAppBindingAdmissionError(true);
    }

    get selectedRepo(): string | null { return this.state.selectedRepo; }

    topic(workspaceId: string): string | null { return this.state.topics[workspaceId] ?? null; }

    selectRepo(workspaceId: string): void {
        this.state.selectedRepo = workspaceId;
        atomicWriteJsonUnique(this.stateFile, this.state);
    }

    selectTopic(workspaceId: string, processId: string | null): void {
        this.state.topics[workspaceId] = processId;
        atomicWriteJsonUnique(this.stateFile, this.state);
    }

    entries(): WhatsAppBinding[] { return [...this.receipts.values()].flat(); }

    /** Conversation ownership comes from request receipts, never mutable topic selection or job notices. */
    sentinelMirrorBindings(workspaceId: string, processId: string): WhatsAppBinding[] {
        this.load(workspaceId);
        const destinations = new Map<string, WhatsAppBinding>();
        for (const row of this.entries()) {
            if (row.workspaceId !== workspaceId || row.processId !== processId || row.notice || row.admissionPending
                || row.releaseState !== undefined || destinations.has(row.groupJid)) continue;
            destinations.set(row.groupJid, row);
        }
        return [...destinations.values()];
    }

    findMessage(messageId: string): WhatsAppBinding | undefined {
        return this.entries().find(binding => binding.inboundId === messageId || binding.outboundIds.includes(messageId)
            || binding.sourceMessageIds?.includes(messageId));
    }

    /** Persist a relayed question id on its request receipt and the own-message guard. */
    recordQuestion(binding: WhatsAppBinding, messageId: string): void {
        this.recordOutbound(messageId);
        binding.questionIds = [...(binding.questionIds ?? []), messageId].slice(-50);
        this.save(binding.workspaceId);
    }

    /** Bind a posted job notice so a quote-reply to it targets that job. */
    recordNotice(job: { groupJid: string; workspaceId: string; processId: string }, messageId: string): void {
        if (!messageId) throw new Error('WhatsApp send did not return a message ID');
        this.load(job.workspaceId).push({
            ...job, taskId: `notice:${messageId}`, inboundId: messageId,
            outboundIds: [], nextPart: 0, status: 'delivered', notice: true,
        });
        this.save(job.workspaceId);
    }

    isQuestionMessage(messageId: string): boolean {
        return this.entries().some(binding => binding.questionIds?.includes(messageId));
    }

    isKnownMessage(messageId: string): boolean {
        return this.state.outboundIds.includes(messageId) || !!this.findMessage(messageId);
    }

    recordOutbound(messageId: string): void {
        if (!messageId) throw new Error('WhatsApp send did not return a message ID');
        this.state.outboundIds.push(messageId);
        if (this.state.outboundIds.length > 2_000) this.state.outboundIds.shift();
        atomicWriteJsonUnique(this.stateFile, this.state);
    }

    add(binding: WhatsAppBinding): boolean {
        const rows = this.load(binding.workspaceId);
        if (this.isKnownMessage(binding.inboundId)) return false;
        if (rows.some(row => row.processId === binding.processId && row.releaseState === 'releasing')) {
            throw new Error('WhatsApp conversation binding release is pending');
        }
        if (binding.releaseState !== undefined) throw new Error('Cannot admit a released WhatsApp binding');
        rows.push(binding);
        try {
            this.save(binding.workspaceId);
        } catch (error) {
            rows.pop();
            throw error;
        }
        return true;
    }

    update(binding: WhatsAppBinding): void { this.save(binding.workspaceId); }

    async admit(binding: WhatsAppBinding, enqueue: () => Promise<void>, getTask?: (id: string) => QueuedTask | undefined): Promise<boolean> {
        return this.removalAdmission.runExclusive(binding.processId, async () => {
            if (this.isKnownMessage(binding.inboundId)) return false;
            binding.admissionPending = true;
            try {
                if (!this.add(binding)) return false;
            } catch {
                throw new WhatsAppBindingAdmissionError();
            }
            this.activeAdmissions.add(binding);
            try {
                try {
                    await enqueue();
                } catch (error) {
                    let accepted: boolean;
                    try { accepted = await this.hasAdmissionProof(binding, getTask); }
                    catch { throw new WhatsAppBindingAdmissionError(true); }
                    if (!accepted) {
                        try { this.discardRejected(binding); }
                        catch { throw new WhatsAppBindingAdmissionError(true); }
                        if (error instanceof ImageDownloadError) throw new ImageDownloadError(error.code);
                        if (error instanceof IncomingImagesError) throw new IncomingImagesError(error.code);
                        if (error instanceof PendingImagesError) throw new PendingImagesError(error.code);
                        throw new WhatsAppBindingAdmissionError();
                    }
                    console.error('[whatsapp-bindings] Request admitted; notification reconciliation is pending');
                }
                try {
                    if (await this.hasAdmissionProof(binding, getTask)) this.promoteAdmission(binding);
                    else console.error('[whatsapp-bindings] Admission proof unavailable; receipt remains pending');
                } catch {
                    console.error('[whatsapp-bindings] Admission receipt promotion is pending; accepted work retained');
                }
                return true;
            } finally {
                this.activeAdmissions.delete(binding);
            }
        });
    }

    async reconcileAdmission(
        binding: WhatsAppBinding, getTask?: (id: string) => QueuedTask | undefined,
        store?: Pick<ProcessStore, 'getProcess'>,
    ): Promise<boolean> {
        if (!binding.admissionPending) return true;
        if (this.activeAdmissions.has(binding)) return false;
        try {
            if (!await this.hasAdmissionProof(binding, getTask, store)) return false;
            this.promoteAdmission(binding);
            return true;
        } catch {
            throw new WhatsAppBindingAdmissionError(true);
        }
    }

    private async hasAdmissionProof(
        binding: WhatsAppBinding, getTask?: (id: string) => QueuedTask | undefined,
        store = this.lifecycle?.store ?? this.admissionStore,
    ): Promise<boolean> {
        const task = getTask ? getTask(binding.taskId) : this.lifecycle?.queue.getTask(binding.taskId);
        if (task?.id === binding.taskId && (task.type === 'chat' || binding.notice)
            && (binding.notice || task.payload.kind === 'chat')
            && task.repoId === binding.workspaceId && task.processId === binding.processId
            && task.payload.workspaceId === binding.workspaceId
            && (task.payload.processId === undefined || task.payload.processId === binding.processId)
            && (task.payload.relayRequestId === binding.taskId
                || (task.payload.relayRequestId === undefined && task.payload.processId === undefined
                    && toQueueProcessId(task.id) === binding.processId))) return true;
        const proc = await store?.getProcess(binding.processId, binding.workspaceId);
        return proc?.id === binding.processId && proc.metadata?.workspaceId === binding.workspaceId
            && (!!proc.pendingMessages?.some(message => message.relayRequestId === binding.taskId)
                || !!proc.conversationTurns?.some(turn => turn.role === 'user' && turn.relayRequestId === binding.taskId));
    }

    private promoteAdmission(binding: WhatsAppBinding): void {
        delete binding.admissionPending;
        try { this.save(binding.workspaceId); }
        catch (error) {
            binding.admissionPending = true;
            throw error;
        }
    }

    discardRejected(binding: WhatsAppBinding): void {
        if (binding.releaseState !== undefined) throw new Error('Cannot discard a releasing WhatsApp binding');
        const rows = this.load(binding.workspaceId);
        const index = rows.indexOf(binding);
        if (index >= 0) {
            rows.splice(index, 1);
            try {
                this.save(binding.workspaceId);
            } catch (error) {
                rows.splice(index, 0, binding);
                throw error;
            }
        }
    }

    /** Tombstones preserve delivery deduplication and recover cross-store release after a crash. */
    async remove(binding: WhatsAppBinding): Promise<void> {
        const lifecycle = this.lifecycle;
        if (!lifecycle) throw new Error('WhatsApp binding release lifecycle is unavailable');
        await this.removalAdmission.runExclusive(binding.processId, async () => {
            const rows = this.load(binding.workspaceId);
            if (!rows.includes(binding)) throw new Error('WhatsApp binding release target is unavailable');
            if (binding.releaseState === 'released') return;
            const remaining = rows.some(row => row !== binding && row.processId === binding.processId
                && row.releaseState === undefined);
            if (remaining) {
                this.setReleaseState(binding, 'released');
                return;
            }
            const origin = rows.find(row => row.processId === binding.processId
                && toQueueProcessId(row.taskId) === binding.processId);
            await releaseBotControlledConversation(lifecycle.store, lifecycle.queue, binding.workspaceId,
                binding.processId, 'whatsapp', origin?.taskId, async () => {
                    this.setReleaseState(binding, 'released');
                }, () => this.setReleaseState(binding, 'releasing'));
        });
    }

    private setReleaseState(binding: WhatsAppBinding, state: 'releasing' | 'released'): void {
        const prior = binding.releaseState;
        binding.releaseState = state;
        try {
            this.save(binding.workspaceId);
        } catch (error) {
            if (prior === undefined) delete binding.releaseState;
            else binding.releaseState = prior;
            throw error;
        }
    }

    private load(workspaceId: string): WhatsAppBinding[] {
        const existing = this.receipts.get(workspaceId);
        if (existing) return existing;
        const file = getRepoDataPath(this.dataDir, workspaceId, 'whatsapp-bindings.json');
        let rows: WhatsAppBinding[];
        try { rows = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as WhatsAppBinding[] : []; }
        catch { throw new Error('Invalid WhatsApp binding receipts'); }
        if (!Array.isArray(rows) || rows.some(row => row.workspaceId !== workspaceId
            || typeof row.groupJid !== 'string' || !row.groupJid
            || typeof row.processId !== 'string' || typeof row.taskId !== 'string'
            || typeof row.inboundId !== 'string' || !Array.isArray(row.outboundIds)
            || row.outboundIds.some((id: unknown) => typeof id !== 'string')
            || (row.questionIds !== undefined && (!Array.isArray(row.questionIds)
                || row.questionIds.some((id: unknown) => typeof id !== 'string')))
            || (row.sourceMessageIds !== undefined && (!Array.isArray(row.sourceMessageIds)
                || row.sourceMessageIds.some((id: unknown) => typeof id !== 'string')))
            || (row.notice !== undefined && row.notice !== true)
            || (row.admissionPending !== undefined && row.admissionPending !== true)
            || !Number.isSafeInteger(row.nextPart) || row.nextPart < 0
            || !['queued', 'sending', 'delivered'].includes(row.status)
            || (row.releaseState !== undefined && !['releasing', 'released'].includes(row.releaseState)))) {
            throw new Error('Invalid WhatsApp binding receipts');
        }
        this.receipts.set(workspaceId, rows);
        return rows;
    }

    private save(workspaceId: string): void {
        atomicWriteJsonUnique(getRepoDataPath(this.dataDir, workspaceId, 'whatsapp-bindings.json'), this.load(workspaceId));
    }
}
