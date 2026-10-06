/** Cross-workspace local topic browsing and chat-scoped selection snapshots. */
import type { AIProcess, ProcessStore } from '@plusplusoneplusplus/forge';
import { parseListIndex, topicActivityMs } from './chat-target';
import { formatTopicList, localTopicListFooter, type RemoteBrowseFormat } from './remote-browse';

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 100;
export const LOCAL_TOPIC_LIMIT = 5;
export const LOCAL_TOPICS_HEADER = 'Topics · all repos · last24hours · top5';
export const LOCAL_TOPICS_EMPTY = `${LOCAL_TOPICS_HEADER}\nNo chat topics created in the last24hours.`;

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
function rank(a: AIProcess, b: AIProcess): number {
    return Number(!!b.pinnedAt) - Number(!!a.pinnedAt)
        || Number(b.status === 'running') - Number(a.status === 'running')
        || (topicActivityMs(b) ?? 0) - (topicActivityMs(a) ?? 0)
        || compareId(String(a.metadata?.workspaceId), String(b.metadata?.workspaceId))
        || compareId(a.id, b.id);
}

/** Scan bounded, conversation-free pages: the store's first page cannot determine pin priority. */
export async function listLocalTopics(
    store: Pick<ProcessStore, 'getAllProcesses'>, workspaces: readonly Workspace[], now: number,
): Promise<AIProcess[]> {
    if (!workspaces.length) return [];
    const visible = new Set(workspaces.map(ws => ws.id));
    let best: AIProcess[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = await store.getAllProcesses({
            since: new Date(now - DAY_MS), limit: PAGE_SIZE, offset,
            exclude: ['conversation', 'toolCalls'],
        });
        const eligible = page.filter(topic => {
            const created = new Date(topic.startTime).getTime();
            return visible.has(String(topic.metadata?.workspaceId)) && created >= now - DAY_MS && created <= now;
        });
        best = [...best, ...eligible].sort(rank).slice(0, LOCAL_TOPIC_LIMIT);
        if (page.length < PAGE_SIZE) return best;
    }
}

export async function localTopicsReply(
    store: Pick<ProcessStore, 'getAllProcesses'>, workspaces: readonly Workspace[], slot: LocalTopicSlot | undefined,
    format: RemoteBrowseFormat, current: (workspaceId: string) => string | null | undefined,
    now: number, verbose?: boolean, prefix = '',
): Promise<string> {
    const topics = await listLocalTopics(store, workspaces, now);
    slot?.set(topics.map(topic => ({ workspaceId: String(topic.metadata?.workspaceId), processId: topic.id })));
    if (!topics.length) return LOCAL_TOPICS_EMPTY;
    return formatTopicList(topics, {
        ...format, header: format.strong(LOCAL_TOPICS_HEADER),
        footer: localTopicListFooter(format.code, verbose, prefix), now, verbose,
        isCurrent: topic => current(String((topic as AIProcess).metadata?.workspaceId)) === topic.id,
        repoName: topic => {
            const id = String((topic as AIProcess).metadata?.workspaceId);
            return workspaces.find(ws => ws.id === id)?.name ?? id;
        },
        // Qualifying ids avoids collisions between workspace-scoped process stores.
        selectionId: topic => `${(topic as AIProcess).metadata?.workspaceId}/${topic.id}`,
    });
}

/** Numbers refer to the last displayed list; ids may also target older accessible chats. */
export async function resolveLocalTopic(
    store: Pick<ProcessStore, 'getAllProcesses' | 'getProcess'>, workspaces: readonly Workspace[],
    slot: LocalTopicSlot | undefined, arg: string, now: number,
): Promise<AIProcess | undefined> {
    const index = parseListIndex(arg);
    let refs: readonly LocalTopicRef[];
    if (index) {
        refs = slot?.get() ?? (await listLocalTopics(store, workspaces, now))
            .map(topic => ({ workspaceId: String(topic.metadata?.workspaceId), processId: topic.id }));
        refs = refs.slice(index - 1, index);
    } else {
        const qualified = workspaces.find(ws => arg.startsWith(`${ws.id}/`));
        refs = qualified ? [{ workspaceId: qualified.id, processId: arg.slice(qualified.id.length + 1) }]
            : workspaces.map(ws => ({ workspaceId: ws.id, processId: arg }));
    }
    const matches: AIProcess[] = [];
    for (const ref of refs) {
        if (!workspaces.some(ws => ws.id === ref.workspaceId)) continue;
        const topic = await store.getProcess(ref.processId, ref.workspaceId);
        if (topic?.metadata?.workspaceId === ref.workspaceId) matches.push(topic);
    }
    return matches.length === 1 ? matches[0] : undefined;
}
