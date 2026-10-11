import { SqliteProcessStore, toQueueProcessId, type ProcessStore } from '@plusplusoneplusplus/forge';
import { isRalphTask, normalizeChatMode, type ChatMode } from '../tasks/task-types';

interface ModeJob {
    id: string;
    type?: string;
    repoId?: string;
    processId?: string;
    payload?: { processId?: string; workspaceId?: string; mode?: unknown; context?: unknown };
}

/** Compact owner-verified modes for an existing queue snapshot, without reading transcripts. */
export function projectQueueJobModes<T extends ModeJob>(store: ProcessStore | undefined, jobs: readonly T[]): Map<T, ChatMode | null> {
    const chats = jobs.filter(job => job.type === 'chat');
    const processId = (job: T) => job.payload?.processId ?? job.processId ?? toQueueProcessId(job.id);
    const ids = [...new Set(chats.map(processId))];
    const rows = store instanceof SqliteProcessStore && ids.length
        ? store.getDatabase().prepare(`SELECT id, type,
            CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.workspaceId') END AS workspaceId,
            CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.mode') END AS mode,
            CASE WHEN json_valid(metadata) THEN json_type(metadata, '$.ralph') = 'object' END AS ralph
            FROM processes WHERE id IN (SELECT value FROM json_each(?))`)
            .all<{ id: string; type: string; workspaceId: unknown; mode: unknown; ralph: number }>(JSON.stringify(ids))
        : [];
    const processes = new Map(rows.map(row => [row.id, row]));
    return new Map(chats.map(job => {
        const process = processes.get(processId(job));
        const owner = job.payload?.workspaceId ?? job.repoId;
        const mode = process
            ? process.type === 'chat' && typeof owner === 'string' && process.workspaceId === owner
                ? process.ralph || isRalphTask(job) ? 'ralph' : normalizeChatMode(process.mode)
                : undefined
            : isRalphTask(job) ? 'ralph' : normalizeChatMode(job.payload?.mode);
        return [job, mode ?? null];
    }));
}
