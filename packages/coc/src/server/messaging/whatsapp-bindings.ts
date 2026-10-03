import * as fs from 'node:fs';
import * as path from 'node:path';
import { toQueueProcessId, type ProcessStore, type TaskQueueManager } from '@plusplusoneplusplus/forge';
import { getRepoDataPath } from '../paths';
import { atomicWriteJsonUnique } from '../shared/fs-utils';
import { ProcessOperationAdmission } from '../processes/process-operation-admission';
import { releaseBotControlledConversation } from './bot-control-admission';

export interface WhatsAppBinding {
    groupJid: string;
    workspaceId: string;
    processId: string;
    taskId: string;
    inboundId: string;
    outboundIds: string[];
    nextPart: number;
    status: 'queued' | 'sending' | 'delivered';
    answerHash?: string;
    header?: string;
    /** Relayed ask_user question message ids, so late quote-replies are recognized. */
    questionIds?: string[];
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

/** Account selection is global; per-conversation receipts remain workspace-scoped. */
export class WhatsAppBindings {
    private readonly receipts = new Map<string, WhatsAppBinding[]>();
    private readonly removalAdmission = new ProcessOperationAdmission();
    private readonly stateFile: string;
    private state: { selectedRepo: string | null; topics: Record<string, string | null>; outboundIds: string[] };

    constructor(private readonly dataDir: string, private readonly lifecycle?: BindingLifecycle) {
        this.stateFile = path.join(dataDir, 'messaging', 'whatsapp', 'state.json');
        this.state = fs.existsSync(this.stateFile)
            ? JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as typeof this.state
            : { selectedRepo: null, topics: {}, outboundIds: [] };
        if (!this.state || typeof this.state !== 'object' || typeof this.state.topics !== 'object'
            || this.state.topics === null || Array.isArray(this.state.topics)
            || !Array.isArray(this.state.outboundIds)
            || this.state.outboundIds.some(id => typeof id !== 'string')
            || (this.state.selectedRepo !== null && typeof this.state.selectedRepo !== 'string')) {
            throw new Error('Invalid WhatsApp selection state');
        }
    }

    async restore(store: Pick<ProcessStore, 'getWorkspaces'>): Promise<void> {
        for (const workspace of await store.getWorkspaces()) this.load(workspace.id);
        const errors: unknown[] = [];
        for (const binding of this.entries()) {
            if (binding.releaseState !== 'releasing') continue;
            try {
                await this.remove(binding);
            } catch (error) {
                errors.push(error);
            }
        }
        if (errors.length) throw new WhatsAppBindingReleaseError(errors);
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

    findMessage(messageId: string): WhatsAppBinding | undefined {
        return this.entries().find(binding => binding.inboundId === messageId || binding.outboundIds.includes(messageId));
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

    async admit(binding: WhatsAppBinding, enqueue: () => Promise<void>): Promise<boolean> {
        return this.removalAdmission.runExclusive(binding.processId, async () => {
            if (!this.add(binding)) return false;
            try {
                await enqueue();
            } catch (error) {
                try {
                    this.discardRejected(binding);
                } catch (rollbackError) {
                    throw Object.assign(new Error('WhatsApp admission receipt rollback failed'), {
                        errors: [error, rollbackError],
                    });
                }
                throw error;
            }
            return true;
        });
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
        const rows: WhatsAppBinding[] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as WhatsAppBinding[] : [];
        if (!Array.isArray(rows) || rows.some(row => row.workspaceId !== workspaceId
            || typeof row.groupJid !== 'string' || !row.groupJid
            || typeof row.processId !== 'string' || typeof row.taskId !== 'string'
            || typeof row.inboundId !== 'string' || !Array.isArray(row.outboundIds)
            || row.outboundIds.some((id: unknown) => typeof id !== 'string')
            || (row.questionIds !== undefined && (!Array.isArray(row.questionIds)
                || row.questionIds.some((id: unknown) => typeof id !== 'string')))
            || (row.notice !== undefined && row.notice !== true)
            || !Number.isSafeInteger(row.nextPart) || row.nextPart < 0
            || !['queued', 'sending', 'delivered'].includes(row.status)
            || (row.releaseState !== undefined && !['releasing', 'released'].includes(row.releaseState)))) {
            throw new Error(`Invalid WhatsApp bindings for workspace ${workspaceId}`);
        }
        this.receipts.set(workspaceId, rows);
        return rows;
    }

    private save(workspaceId: string): void {
        atomicWriteJsonUnique(getRepoDataPath(this.dataDir, workspaceId, 'whatsapp-bindings.json'), this.load(workspaceId));
    }
}
