/** Cross-workspace local topic browsing and chat-scoped selection snapshots. */
import { toQueueProcessId, type AIProcess, type ProcessStore, type QueuedTask } from '@plusplusoneplusplus/forge';
import { readAutomationTurnSource } from '../processes/automation-turn-source';
import { parseListIndex, topicActivityMs } from './chat-target';
import { formatTopicList, localTopicListFooter, type RemoteBrowseFormat } from './remote-browse';

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 100;
export const LOCAL_TOPIC_LIMIT = 5;
export const LOCAL_TOPICS_HEADER = 'Topics · all repos · last24hours · top5';
export const LOCAL_TOPICS_EMPTY = `${LOCAL_TOPICS_HEADER}\nNo chat topics created in the last24hours.`;

export type LocalTopic = Pick<AIProcess, 'id' | 'title' | 'customTitle' | 'promptPreview' | 'startTime' | 'lastEventAt' | 'pinnedAt' | 'metadata'> & { status: string };
export interface LocalTopicQueue { getAll(): QueuedTask[] }

/** Only real first-turn chats have a new conversation identity. */
export function queuedChatTask(task: QueuedTask | undefined, workspaceId?: string): QueuedTask | undefined {
    if (!task || task.type !== 'chat' || task.payload?.kind !== 'chat'
        || !['queued', 'running'].includes(task.status) || task.payload.processId !== undefined
        || typeof task.repoId !== 'string' || task.payload.workspaceId !== task.repoId
        || (workspaceId !== undefined && task.repoId !== workspaceId)
        || (task.processId !== undefined && task.processId !== toQueueProcessId(task.id))
        || typeof task.payload.prompt !== 'string' || !task.payload.prompt.trim()) return undefined;
    const context = task.payload.context as Record<string, unknown> | undefined;
    if (readAutomationTurnSource(context)) return undefined;
    return task;
}

export function queuedChatTopic(task: QueuedTask): LocalTopic {
    return { id: toQueueProcessId(task.id), status: task.status,
        title: typeof task.payload.customTitle === 'string' ? task.payload.customTitle : task.displayName ?? String(task.payload.prompt),
        promptPreview: String(task.payload.prompt), startTime: new Date(task.createdAt),
        metadata: { type: 'chat', workspaceId: task.repoId } };
}

type Workspace = { id: string; name?: string };
export interface LocalTopicRef { workspaceId: string; processId: string }
export interface LocalTopicSlot {
    get(): readonly LocalTopicRef[] | undefined;
    set(refs: LocalTopicRef[]): void;
}

/** Separate instances per connector; keys retain the connector's chat/thread boundary. */
export class LocalTopicMemory {
    private readonly chats = new Map<string, LocalTopicRef[]>();
    slot(key: string): LocalTopicSlot {
        return {
            get: () => this.chats.get(key),
            set: refs => {
                this.chats.delete(key);
                this.chats.set(key, refs);
            },
        };
    }
}

const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function rank(a: LocalTopic, b: LocalTopic): number {
    return Number(!!b.pinnedAt) - Number(!!a.pinnedAt)
        || Number(b.status === 'running') - Number(a.status === 'running')
        || Number(b.status === 'queued') - Number(a.status === 'queued')
        || (topicActivityMs(b) ?? 0) - (topicActivityMs(a) ?? 0)
        || compareId(String(a.metadata?.workspaceId), String(b.metadata?.workspaceId))
        || compareId(a.id, b.id);
}

/** Scan bounded, conversation-free pages: the store's first page cannot determine pin priority. */
export async function listLocalTopics(
    store: Pick<ProcessStore, 'getAllProcesses'>, workspaces: readonly Workspace[], now: number, queue?: LocalTopicQueue,
): Promise<LocalTopic[]> {
    if (!workspaces.length) return [];
    const visible = new Set(workspaces.map(ws => ws.id));
    const queued = new Map((queue?.getAll() ?? []).filter(task => queuedChatTask(task)
        && visible.has(task.repoId!) && task.createdAt >= now - DAY_MS && task.createdAt <= now)
        .map(task => { const topic = queuedChatTopic(task); return [JSON.stringify([task.repoId, topic.id]), topic] as const; }));
    let best: LocalTopic[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = await store.getAllProcesses({
            since: new Date(now - DAY_MS), limit: PAGE_SIZE, offset,
            exclude: ['conversation', 'toolCalls'],
        });
        for (const topic of page) queued.delete(JSON.stringify([topic.metadata?.workspaceId, topic.id]));
        const eligible = page.filter(topic => {
            const created = new Date(topic.startTime).getTime();
            return visible.has(String(topic.metadata?.workspaceId)) && created >= now - DAY_MS && created <= now;
        });
        best = [...best, ...eligible].sort(rank).slice(0, LOCAL_TOPIC_LIMIT);
        if (page.length < PAGE_SIZE) return [...best, ...queued.values()].sort(rank).slice(0, LOCAL_TOPIC_LIMIT);
    }
}

export async function localTopicsReply(
    store: Pick<ProcessStore, 'getAllProcesses'>, workspaces: readonly Workspace[], slot: LocalTopicSlot | undefined,
    format: RemoteBrowseFormat, current: (workspaceId: string) => string | null | undefined,
    now: number, verbose?: boolean, prefix = '', queue?: LocalTopicQueue,
): Promise<string> {
    const topics = await listLocalTopics(store, workspaces, now, queue);
    slot?.set(topics.map(topic => ({ workspaceId: String(topic.metadata?.workspaceId), processId: topic.id })));
    if (!topics.length) return LOCAL_TOPICS_EMPTY;
    return formatTopicList(topics, {
        ...format, header: format.strong(LOCAL_TOPICS_HEADER),
        footer: localTopicListFooter(format.code, verbose, prefix), now, verbose, labelQueued: true,
        isCurrent: topic => current(String((topic as LocalTopic).metadata?.workspaceId)) === topic.id,
        repoName: topic => {
            const id = String((topic as LocalTopic).metadata?.workspaceId);
            return workspaces.find(ws => ws.id === id)?.name ?? id;
        },
        // Qualifying ids avoids collisions between workspace-scoped process stores.
        selectionId: topic => `${(topic as LocalTopic).metadata?.workspaceId}/${topic.id}`,
    });
}

/** Numbers refer to the last displayed list; ids may also target older accessible chats. */
export async function resolveLocalTopic(
    store: Pick<ProcessStore, 'getAllProcesses' | 'getProcess'>, workspaces: readonly Workspace[],
    slot: LocalTopicSlot | undefined, arg: string, now: number, queue?: LocalTopicQueue,
): Promise<LocalTopic | undefined> {
    const index = parseListIndex(arg);
    let refs: readonly LocalTopicRef[];
    if (index) {
        refs = slot?.get() ?? (await listLocalTopics(store, workspaces, now, queue))
            .map(topic => ({ workspaceId: String(topic.metadata?.workspaceId), processId: topic.id }));
        refs = refs.slice(index - 1, index);
    } else {
        const qualified = workspaces.find(ws => arg.startsWith(`${ws.id}/`));
        refs = qualified ? [{ workspaceId: qualified.id, processId: arg.slice(qualified.id.length + 1) }]
            : workspaces.map(ws => ({ workspaceId: ws.id, processId: arg }));
    }
    const matches: LocalTopic[] = [];
    for (const ref of refs) {
        if (!workspaces.some(ws => ws.id === ref.workspaceId)) continue;
        const topic = await store.getProcess(ref.processId, ref.workspaceId);
        if (topic?.metadata?.workspaceId === ref.workspaceId) matches.push(topic);
        else if (!topic) {
            const task = queue?.getAll().find(task => toQueueProcessId(task.id) === ref.processId
                && queuedChatTask(task, ref.workspaceId));
            if (task) matches.push(queuedChatTopic(task));
            else {
                // The task may have started during the saved-process read.
                const started = await store.getProcess(ref.processId, ref.workspaceId);
                if (started?.metadata?.workspaceId === ref.workspaceId) matches.push(started);
            }
        }
    }
    return matches.length === 1 ? matches[0] : undefined;
}
