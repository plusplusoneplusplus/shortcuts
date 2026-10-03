/**
 * Read-only browsing of remote CoC servers from the messaging connectors:
 * `list remotes` and `list topics <n.m|name@server>`. Remote repos are never
 * selectable for chatting; this module only lists.
 *
 * Lookups go through the route-layer {@link WorkspaceDirectory} (each remote's
 * own `/api/workspaces` and `/api/processes`, short per-server timeouts).
 * Replies carry server display names and repo names only — never URLs, hosts
 * or credentials; failure details are logged server-side.
 */

import {
    parseRemoteCloneKey, RemoteServerOfflineError,
    type RemoteChatSummary, type WorkspaceDirectory,
} from '../servers/workspace-directory';
import { TOPIC_LIST_LIMIT } from './chat-target';

export type MessagingRemoteDirectory = Pick<WorkspaceDirectory, 'list' | 'listRemoteChats'>;

/** One remote repo from the last `list remotes` reply. */
export interface RemoteRepoRef {
    /** `n.m` as numbered in the reply. */
    ref: string;
    serverId: string;
    server: string;
    workspaceId: string;
    name: string;
}

/** Last `list remotes` numbering for one chat (WhatsApp group / Teams thread). */
export interface RemoteRefSlot {
    get(): readonly RemoteRepoRef[] | undefined;
    set(refs: RemoteRepoRef[]): void;
}

const MAX_REMEMBERED_CHATS = 200;

/** In-memory `list remotes` numbering keyed by chat; oldest chats are evicted first. */
export class RemoteRefMemory {
    private readonly byChat = new Map<string, RemoteRepoRef[]>();

    slot(chatKey: string): RemoteRefSlot {
        return {
            get: () => this.byChat.get(chatKey),
            set: refs => {
                this.byChat.delete(chatKey);
                this.byChat.set(chatKey, refs);
                if (this.byChat.size > MAX_REMEMBERED_CHATS) {
                    this.byChat.delete(this.byChat.keys().next().value!);
                }
            },
        };
    }
}

export interface RemoteBrowseFormat {
    strong: (text: string) => string;
    code: (text: string) => string;
    escape: (text: string) => string;
}

export const REMOTE_REPO_NOT_FOUND_REPLY = 'Remote repo not found — run "list remotes".';
export const REMOTE_LISTING_MISSING_REPLY = 'No remote listing yet — run "list remotes" first.';
const REMOTES_UNAVAILABLE_REPLY = 'Remote servers are unavailable.';

/** One numbered topic line, shared by local and remote `list topics`. */
export function formatTopicLine(
    topic: Pick<RemoteChatSummary, 'id' | 'status' | 'title' | 'customTitle' | 'promptPreview'>,
    index: number,
    code: (text: string) => string,
    escape: (text: string) => string = text => text,
): string {
    return `${index + 1}. ${code(topic.id)} [${topic.status ?? 'unknown'}] ${escape(topic.title ?? topic.customTitle ?? topic.promptPreview?.slice(0, 60) ?? '')}`.trimEnd();
}

export async function listRemotesReply(
    directory: MessagingRemoteDirectory | undefined,
    slot: RemoteRefSlot | undefined,
    { strong, escape }: RemoteBrowseFormat,
): Promise<string> {
    if (!directory) return REMOTES_UNAVAILABLE_REPLY;
    let listing;
    try {
        listing = await directory.list();
    } catch (error) {
        console.error('[messaging] Listing remote servers failed:', error);
        return 'Could not list remote servers. Please try again later.';
    }
    const servers = listing.servers.filter(server => server.serverId);
    if (!servers.length) return 'No remote servers configured.';
    const refs: RemoteRepoRef[] = [];
    const lines = [strong('Remote servers')];
    servers.forEach((server, i) => {
        lines.push(`${i + 1}. ${escape(server.server)} (${server.serverKind}) — ${server.online ? 'online' : 'offline'}`);
        if (!server.online) return;
        const repos = listing.entries.filter(entry =>
            entry.type === 'repo' && entry.online && parseRemoteCloneKey(entry.id)?.serverId === server.serverId);
        if (!repos.length) lines.push('   (no repos)');
        repos.forEach((entry, j) => {
            const ref = `${i + 1}.${j + 1}`;
            refs.push({ ref, serverId: server.serverId!, server: server.server, workspaceId: parseRemoteCloneKey(entry.id)!.workspaceId, name: entry.name });
            lines.push(`   ${ref} ${escape(entry.name)}`);
        });
    });
    slot?.set(refs);
    return lines.join('\n');
}

async function resolveRemoteRef(
    directory: MessagingRemoteDirectory,
    slot: RemoteRefSlot | undefined,
    arg: string,
): Promise<RemoteRepoRef | string> {
    if (/^\d+\.\d+$/.test(arg)) {
        const refs = slot?.get();
        if (!refs) return REMOTE_LISTING_MISSING_REPLY;
        return refs.find(ref => ref.ref === arg) ?? REMOTE_REPO_NOT_FOUND_REPLY;
    }
    const at = arg.lastIndexOf('@');
    const name = arg.slice(0, at).toLowerCase();
    const serverName = arg.slice(at + 1).toLowerCase();
    const listing = await directory.list();
    const server = listing.servers.find(s => s.serverId && s.server.toLowerCase() === serverName);
    if (!server) return REMOTE_REPO_NOT_FOUND_REPLY;
    if (!server.online) return `${server.server} is offline.`;
    for (const entry of listing.entries) {
        const key = parseRemoteCloneKey(entry.id);
        if (key && entry.type === 'repo' && key.serverId === server.serverId && entry.name.toLowerCase() === name) {
            return { ref: arg, serverId: key.serverId, server: server.server, workspaceId: key.workspaceId, name: entry.name };
        }
    }
    return REMOTE_REPO_NOT_FOUND_REPLY;
}

/** `list topics <n.m|name@server>`: the remote repo's most recent chats, read-only. */
export async function listRemoteTopicsReply(
    directory: MessagingRemoteDirectory | undefined,
    slot: RemoteRefSlot | undefined,
    arg: string,
    { strong, code, escape }: RemoteBrowseFormat,
): Promise<string> {
    if (!directory) return REMOTES_UNAVAILABLE_REPLY;
    let target: RemoteRepoRef | string | undefined;
    try {
        target = await resolveRemoteRef(directory, slot, arg);
        if (typeof target === 'string') return target;
        const topics = await directory.listRemoteChats(target.serverId, target.workspaceId, TOPIC_LIST_LIMIT);
        const header = `Topics in ${strong(target.name)} @ ${strong(target.server)} (read-only)`;
        if (!topics.length) return `${header}:\nNo chat topics found.`;
        return `${header}:\n${topics.slice(0, TOPIC_LIST_LIMIT).map((topic, i) => formatTopicLine(topic, i, code, escape)).join('\n')}`;
    } catch (error) {
        console.error('[messaging] Listing remote topics failed:', error);
        const server = typeof target === 'object' ? target.server : undefined;
        if (error instanceof RemoteServerOfflineError) return `${server ?? error.server} is offline.`;
        return server ? `Could not load topics from ${server}. Please try again later.` : 'Could not list remote servers. Please try again later.';
    }
}
