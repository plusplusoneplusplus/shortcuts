import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AIProcess, ProcessStore } from '@plusplusoneplusplus/forge';
import { atomicWriteJsonUnique } from '../shared/fs-utils';
import { isRepoGroupWorkspaceId } from '../workspaces/repo-group-workspace';

export const TEAMS_CHANNEL_BINDINGS_FILE = 'teams-channel-bindings.json';

export interface TeamsChannelIdentity {
    accountKey: string;
    teamId: string;
    channelId: string;
}

export interface TeamsChannelBinding extends TeamsChannelIdentity {
    workspaceId: string;
    processId: string;
}

export class TeamsChannelBindingError extends Error {
    constructor() {
        super('Teams channel binding is unavailable. Configure an available workspace and Sentinel.');
        this.name = 'TeamsChannelBindingError';
    }
}

export class TeamsChannelBindings {
    private readonly file: string;
    private tail: Promise<void> = Promise.resolve();

    constructor(dataDir: string, private readonly store: Pick<ProcessStore, 'getWorkspaces' | 'getProcess'>) {
        this.file = path.join(dataDir, TEAMS_CHANNEL_BINDINGS_FILE);
    }

    async exclusive<T>(operation: () => Promise<T>): Promise<T> {
        const previous = this.tail;
        let release!: () => void;
        this.tail = new Promise<void>(resolve => { release = resolve; });
        await previous;
        try {
            return await operation();
        } finally {
            release();
        }
    }

    private read(): TeamsChannelBinding[] {
        if (!fs.existsSync(this.file)) return [];
        const raw = fs.readFileSync(this.file, 'utf8');
        let value: unknown;
        try {
            value = JSON.parse(raw);
        } catch (error) {
            if (error instanceof SyntaxError) throw new TeamsChannelBindingError();
            throw error;
        }
        if (!Array.isArray(value) || value.some(row => !row || typeof row !== 'object'
            || ['accountKey', 'teamId', 'channelId', 'workspaceId', 'processId']
                .some(key => typeof row[key] !== 'string' || !row[key]))) {
            throw new TeamsChannelBindingError();
        }
        return value as TeamsChannelBinding[];
    }

    private matches(binding: TeamsChannelBinding, identity: TeamsChannelIdentity): boolean {
        return binding.accountKey === identity.accountKey && binding.teamId === identity.teamId
            && binding.channelId === identity.channelId;
    }

    lookup(identity: TeamsChannelIdentity): TeamsChannelBinding | null {
        const rows = this.read().filter(row => this.matches(row, identity));
        if (rows.length > 1) throw new TeamsChannelBindingError();
        return rows[0] ?? null;
    }

    async resolve(identity: TeamsChannelIdentity): Promise<{ binding: TeamsChannelBinding; process: AIProcess } | null> {
        const binding = this.lookup(identity);
        if (!binding) return null;
        return { binding, process: await this.validate(binding.workspaceId, binding.processId) };
    }

    async bind(identity: TeamsChannelIdentity, workspaceId: string, processId: string, isCurrent?: () => boolean): Promise<TeamsChannelBinding> {
        if (!identity.accountKey || !identity.teamId || !identity.channelId) {
            throw new TeamsChannelBindingError();
        }
        await this.validate(workspaceId, processId);
        if (isCurrent && !isCurrent()) throw new TeamsChannelBindingError();
        const rows = this.read().filter(row => !this.matches(row, identity));
        const binding = { ...identity, workspaceId, processId };
        atomicWriteJsonUnique(this.file, [...rows, binding]);
        return binding;
    }

    private async validate(workspaceId: string, processId: string): Promise<AIProcess> {
        const workspace = (await this.store.getWorkspaces()).find(ws => ws.id === workspaceId);
        if (!workspaceId || !processId || !workspace || (workspace.virtual && !isRepoGroupWorkspaceId(workspaceId))
            || !path.isAbsolute(workspace.rootPath)) {
            throw new TeamsChannelBindingError();
        }
        try {
            if (!(await fs.promises.stat(workspace.rootPath)).isDirectory()) throw new Error('Not a directory');
        } catch {
            throw new TeamsChannelBindingError();
        }
        const process = await this.store.getProcess(processId, workspaceId);
        if (!process || process.id !== processId || process.type !== 'chat'
            || process.metadata?.workspaceId !== workspaceId || process.metadata?.mode !== 'sentinel'
            || ['failed', 'cancelled'].includes(process.status)) {
            throw new TeamsChannelBindingError();
        }
        return process;
    }
}
