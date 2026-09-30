import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { getRepoDataPath } from '../paths';

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
}

function writeJSON(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporary, JSON.stringify(value), { flag: 'wx' });
        fs.renameSync(temporary, file);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}

/** Account selection is global; per-conversation receipts remain workspace-scoped. */
export class WhatsAppBindings {
    private readonly receipts = new Map<string, WhatsAppBinding[]>();
    private readonly stateFile: string;
    private state: { selectedRepo: string | null; topics: Record<string, string | null> };

    constructor(private readonly dataDir: string) {
        this.stateFile = path.join(dataDir, 'messaging', 'whatsapp', 'state.json');
        this.state = fs.existsSync(this.stateFile)
            ? JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as typeof this.state
            : { selectedRepo: null, topics: {} };
        if (!this.state || typeof this.state !== 'object' || typeof this.state.topics !== 'object'
            || this.state.topics === null || (this.state.selectedRepo !== null && typeof this.state.selectedRepo !== 'string')) {
            throw new Error('Invalid WhatsApp selection state');
        }
    }

    async restore(store: Pick<ProcessStore, 'getWorkspaces'>): Promise<void> {
        for (const workspace of await store.getWorkspaces()) this.load(workspace.id);
    }

    get selectedRepo(): string | null { return this.state.selectedRepo; }

    topic(workspaceId: string): string | null { return this.state.topics[workspaceId] ?? null; }

    selectRepo(workspaceId: string): void {
        this.state.selectedRepo = workspaceId;
        writeJSON(this.stateFile, this.state);
    }

    selectTopic(workspaceId: string, processId: string | null): void {
        this.state.topics[workspaceId] = processId;
        writeJSON(this.stateFile, this.state);
    }

    entries(): WhatsAppBinding[] { return [...this.receipts.values()].flat(); }

    findMessage(messageId: string): WhatsAppBinding | undefined {
        return this.entries().find(binding => binding.inboundId === messageId || binding.outboundIds.includes(messageId));
    }

    add(binding: WhatsAppBinding): boolean {
        const rows = this.load(binding.workspaceId);
        if (this.findMessage(binding.inboundId)) return false;
        rows.push(binding);
        this.save(binding.workspaceId);
        return true;
    }

    update(binding: WhatsAppBinding): void { this.save(binding.workspaceId); }

    remove(binding: WhatsAppBinding): void {
        const rows = this.load(binding.workspaceId);
        const index = rows.indexOf(binding);
        if (index >= 0) {
            rows.splice(index, 1);
            this.save(binding.workspaceId);
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
            || !Number.isSafeInteger(row.nextPart) || row.nextPart < 0
            || !['queued', 'sending', 'delivered'].includes(row.status))) {
            throw new Error(`Invalid WhatsApp bindings for workspace ${workspaceId}`);
        }
        this.receipts.set(workspaceId, rows);
        return rows;
    }

    private save(workspaceId: string): void {
        writeJSON(getRepoDataPath(this.dataDir, workspaceId, 'whatsapp-bindings.json'), this.load(workspaceId));
    }
}
