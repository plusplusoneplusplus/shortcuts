/**
 * Read-only remote browsing from messaging: `list remotes` and
 * `list topics <n.m|name@server>` through the shared `handleMessagingCommand`,
 * backed by a real `WorkspaceDirectory` whose remote HTTP is mocked via
 * `fetchImpl` (no network).
 */

import { describe, expect, it, vi } from 'vitest';
import { parseMessagingCommand, type MessagingControlCommand } from '@plusplusoneplusplus/coc-connector';
import { createCache } from '../../../src/server/cache';
import { handleMessagingCommand, type MessagingCommandContext } from '../../../src/server/messaging/messaging-commands';
import { RemoteRefMemory } from '../../../src/server/messaging/remote-browse';
import {
    createWorkspaceDirectory, RemoteServerOfflineError,
    type WorkspaceDirectoryEntry, type WorkspaceDirectoryOptions,
} from '../../../src/server/servers/workspace-directory';

function remoteServer(id: string, label: string, kind: string, effectiveUrl?: string) {
    return { id, label, kind, url: effectiveUrl, effectiveUrl, status: 'online', addedAt: 0, updatedAt: 0 } as any;
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Routes mocked fetch calls by URL; unknown URLs reject like a refused connection. */
function routedFetch(routes: Record<string, () => Response | Promise<Response>>) {
    return vi.fn(async (url: string | URL) => {
        const handler = routes[String(url)];
        if (!handler) throw new TypeError('fetch failed');
        return handler();
    }) as unknown as typeof fetch;
}

const processesUrl = (base: string, workspaceId: string) =>
    `${base}/api/processes?workspace=${workspaceId}&limit=10&exclude=conversation%2CtoolCalls`;

function chats(workspaceId: string, count: number) {
    return Array.from({ length: count }, (_, i) => ({
        id: `chat-${i + 1}`, status: 'completed', title: `Chat ${i + 1}`, metadata: { workspaceId },
    }));
}

const DEVBOX = 'http://user:secret@devbox.internal:4000';

function makeDirectory(opts: Partial<WorkspaceDirectoryOptions> = {}) {
    return createWorkspaceDirectory({
        store: { getWorkspaces: vi.fn().mockResolvedValue([{ id: 'local-ws', name: 'local-repo' }]) } as any,
        lastKnownCache: createCache<WorkspaceDirectoryEntry[]>({ namespace: 'test-remote-browse', immutable: true }),
        remoteServers: {
            list: () => [
                remoteServer('srv-dev', 'devbox', 'ssh', DEVBOX),
                remoteServer('srv-lap', 'laptop', 'devtunnel'),
            ],
        },
        fetchImpl: routedFetch({
            [`${DEVBOX}/api/workspaces`]: () => json({ workspaces: [{ id: 'w1', name: 'shortcuts' }, { id: 'w2', name: 'shortcuts-2' }] }),
            [processesUrl(DEVBOX, 'w2')]: () => json({ processes: chats('w2', 12) }),
        }),
        ...opts,
    });
}

function makeContext(directory = makeDirectory(), memory = new RemoteRefMemory(), chatKey = 'group-1'): MessagingCommandContext {
    const getAllProcesses = vi.fn().mockResolvedValue([
        { id: 'local-chat', status: 'running', title: 'Local chat', metadata: { workspaceId: 'local-ws' } },
    ]);
    return {
        store: {
            getWorkspaces: vi.fn().mockResolvedValue([{ id: 'local-ws', name: 'local-repo' }]),
            getAllProcesses,
            getProcess: vi.fn(),
        } as any,
        selection: { repoId: () => 'local-ws', selectRepo: vi.fn(), topicId: () => null, selectTopic: vi.fn() },
        requireRepoForTopics: true,
        remotes: directory,
        remoteRefs: memory.slot(chatKey),
    };
}

const run = (text: string, ctx: MessagingCommandContext) =>
    handleMessagingCommand(parseMessagingCommand(text) as MessagingControlCommand, ctx);

describe('list remotes', () => {
    it('groups remote repos by server, numbered, with offline servers listed bare', async () => {
        const reply = await run('list remotes', makeContext());
        expect(reply).toBe([
            'Remote servers',
            '1. devbox (ssh) — online',
            '   1.1 shortcuts',
            '   1.2 shortcuts-2',
            '2. laptop (devtunnel) — offline',
        ].join('\n'));
        expect(reply).not.toContain('local-repo');
        expect(reply).not.toMatch(/secret|devbox\.internal|http/);
    });

    it('hides last-known repos of a server that went offline', async () => {
        let up = true;
        const directory = makeDirectory({
            remoteServers: { list: () => [remoteServer('srv-dev', 'devbox', 'ssh', DEVBOX)] },
            fetchImpl: vi.fn(async () => {
                if (!up) throw new TypeError('fetch failed');
                return json({ workspaces: [{ id: 'w1', name: 'shortcuts' }] });
            }) as unknown as typeof fetch,
        });
        const ctx = makeContext(directory);
        expect(await run('list remotes', ctx)).toContain('1.1 shortcuts');
        up = false;
        expect(await run('list remotes', ctx)).toBe('Remote servers\n1. devbox (ssh) — offline');
    });

    it('never lets one slow server fail the reply', async () => {
        const directory = makeDirectory({
            listTimeoutMs: 30,
            remoteServers: {
                list: () => [
                    remoteServer('srv-slow', 'slowbox', 'url', 'http://slow'),
                    remoteServer('srv-dev', 'devbox', 'ssh', DEVBOX),
                ],
            },
            fetchImpl: routedFetch({
                'http://slow/api/workspaces': () => new Promise<Response>(() => { /* never resolves */ }),
                [`${DEVBOX}/api/workspaces`]: () => json({ workspaces: [{ id: 'w1', name: 'shortcuts' }] }),
            }),
        });
        const started = Date.now();
        const reply = await run('/LIST REMOTES', makeContext(directory));
        expect(Date.now() - started).toBeLessThan(2_000);
        expect(reply).toBe('Remote servers\n1. slowbox (url) — offline\n2. devbox (ssh) — online\n   2.1 shortcuts');
    });

    it('says when no remotes are configured', async () => {
        const reply = await run('list remotes', makeContext(makeDirectory({ remoteServers: { list: () => [] } })));
        expect(reply).toBe('No remote servers configured.');
    });

    it('applies the transport styling', async () => {
        const ctx = { ...makeContext(), strong: (t: string) => `*${t}*` };
        expect((await run('list remotes', ctx)).split('\n')[0]).toBe('*Remote servers*');
    });
});

describe('list topics <remote ref>', () => {
    it('resolves n.m from the last listing and shows the 10 most recent chats read-only', async () => {
        const ctx = makeContext();
        await run('list remotes', ctx);
        const reply = await run('list topics 1.2', ctx);
        const lines = reply.split('\n');
        expect(lines[0]).toBe('Topics in shortcuts-2 @ devbox (read-only):');
        expect(lines[1]).toBe('1. chat-1 [completed] Chat 1');
        expect(lines).toHaveLength(11);
        expect(reply).not.toContain('chat-11');
        expect(reply).not.toContain('⬅️');
        expect(ctx.selection.selectRepo).not.toHaveBeenCalled();
        expect(ctx.selection.selectTopic).not.toHaveBeenCalled();
    });

    it('resolves name@server case-insensitively without a prior listing', async () => {
        const reply = await run('/list topics SHORTCUTS-2@DevBox', makeContext());
        expect(reply.split('\n')[0]).toBe('Topics in shortcuts-2 @ devbox (read-only):');
    });

    it('asks for list remotes when n.m arrives before any listing', async () => {
        expect(await run('list topics 1.2', makeContext())).toBe('No remote listing yet — run "list remotes" first.');
    });

    it('keeps the numbering per chat', async () => {
        const memory = new RemoteRefMemory();
        await run('list remotes', makeContext(undefined, memory, 'chat-a'));
        expect(await run('list topics 1.2', makeContext(undefined, memory, 'chat-a'))).toContain('Topics in shortcuts-2');
        expect(await run('list topics 1.2', makeContext(undefined, memory, 'chat-b'))).toContain('run "list remotes" first');
    });

    it('rejects unknown refs', async () => {
        const ctx = makeContext();
        await run('list remotes', ctx);
        expect(await run('list topics 1.9', ctx)).toBe('Remote repo not found — run "list remotes".');
        expect(await run('list topics nope@devbox', ctx)).toBe('Remote repo not found — run "list remotes".');
        expect(await run('list topics shortcuts@nowhere', ctx)).toBe('Remote repo not found — run "list remotes".');
        expect(await run('list topics local-repo@local', ctx)).toBe('Remote repo not found — run "list remotes".');
    });

    it('reports an offline server by name', async () => {
        expect(await run('list topics shortcuts@laptop', makeContext())).toBe('laptop is offline.');
    });

    it('reports a server that went offline after the listing', async () => {
        const ctx = makeContext();
        await run('list remotes', ctx);
        ctx.remotes = makeDirectory({
            fetchImpl: routedFetch({ [`${DEVBOX}/api/workspaces`]: () => json({ workspaces: [] }) }),
        });
        expect(await run('list topics 1.2', ctx)).toBe('devbox is offline.');
    });

    it('keeps fetch errors short and logs details server-side only', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const ctx = makeContext(makeDirectory({
            fetchImpl: routedFetch({
                [`${DEVBOX}/api/workspaces`]: () => json({ workspaces: [{ id: 'w1', name: 'shortcuts' }] }),
                [processesUrl(DEVBOX, 'w1')]: () => json({ error: 'db exploded at /secret/path' }, 500),
            }),
        }));
        const reply = await run('list topics shortcuts@devbox', ctx);
        expect(reply).toBe('Could not load topics from devbox. Please try again later.');
        expect(reply).not.toContain('secret');
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });

    it('shows an empty remote repo', async () => {
        const ctx = makeContext(makeDirectory({
            fetchImpl: routedFetch({
                [`${DEVBOX}/api/workspaces`]: () => json({ workspaces: [{ id: 'w1', name: 'shortcuts' }] }),
                [processesUrl(DEVBOX, 'w1')]: () => json({ processes: [] }),
            }),
        }));
        expect(await run('list topics shortcuts@devbox', ctx)).toBe('Topics in shortcuts @ devbox (read-only):\nNo chat topics found.');
    });

    it('leaves bare list topics on the local selected repo', async () => {
        const ctx = makeContext();
        const reply = await run('list topics', ctx);
        expect(reply).toBe('Chat topics (repo: local-repo):\n1. local-chat [running] Local chat');
    });
});

describe('WorkspaceDirectory.listRemoteChats', () => {
    it('keeps only the asked repo, caps the count, and maps to summaries', async () => {
        const directory = makeDirectory({
            fetchImpl: routedFetch({
                [processesUrl(DEVBOX, 'w2')]: () => json({ processes: [
                    { id: 'a', status: 'running', customTitle: 'A', fullPrompt: 'x', metadata: { workspaceId: 'w2' } },
                    { id: 'other', metadata: { workspaceId: 'w9' } },
                ] }),
            }),
        });
        expect(await directory.listRemoteChats('srv-dev', 'w2', 10)).toEqual([{ id: 'a', status: 'running', customTitle: 'A' }]);
    });

    it('throws RemoteServerOfflineError for unknown, endpoint-less and unreachable servers', async () => {
        const directory = makeDirectory({ fetchImpl: routedFetch({}) });
        await expect(directory.listRemoteChats('missing', 'w', 10)).rejects.toBeInstanceOf(RemoteServerOfflineError);
        await expect(directory.listRemoteChats('srv-lap', 'w', 10)).rejects.toBeInstanceOf(RemoteServerOfflineError);
        await expect(directory.listRemoteChats('srv-dev', 'w', 10)).rejects.toBeInstanceOf(RemoteServerOfflineError);
    });
});
