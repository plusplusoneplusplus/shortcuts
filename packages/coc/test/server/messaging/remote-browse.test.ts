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
import { formatRelativeAge, formatTopicList, RemoteRefMemory } from '../../../src/server/messaging/remote-browse';
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

const NOW = Date.parse('2026-10-03T12:00:00Z');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
/** Non-current topic indent (two en spaces, so Teams does not render a Markdown list). */
const IN = '\u2002\u2002';

/** Chat n was last active n hours ago. */
function chats(workspaceId: string, count: number) {
    return Array.from({ length: count }, (_, i) => ({
        id: `chat-${i + 1}`, status: 'completed', title: `Chat ${i + 1}`, metadata: { workspaceId },
        startTime: iso(NOW - 48 * HOUR), lastEventAt: iso(NOW - (i + 1) * HOUR),
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
        { id: 'local-chat', status: 'running', title: 'Local chat', metadata: { workspaceId: 'local-ws' }, startTime: new Date(NOW) },
    ]);
    return {
        store: {
            getWorkspaces: vi.fn().mockResolvedValue([{ id: 'local-ws', name: 'local-repo' }]),
            getAllProcesses,
            getProcess: vi.fn(),
        } as any,
        selection: { repoId: () => 'local-ws', selectRepo: vi.fn(), topicId: () => null, selectTopic: vi.fn() },
        remotes: directory,
        remoteRefs: memory.slot(chatKey),
        now: () => NOW,
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
        expect(lines[0]).toBe('Topics · shortcuts-2 @ devbox');
        expect(lines[1]).toBe(`${IN}1. ✅ Chat 1 · 1h`);
        expect(lines[10]).toBe(`${IN}10. ✅ Chat 10 · 10h`);
        expect(lines[11]).toBe('Read-only · list topics 1.2 -v for ids');
        expect(lines).toHaveLength(12);
        expect(reply).not.toContain('Chat 11');
        expect(reply).not.toContain('chat-1');
        expect(reply).not.toContain('▶');
        expect(reply).not.toContain('⬅️');
        expect(ctx.selection.selectRepo).not.toHaveBeenCalled();
        expect(ctx.selection.selectTopic).not.toHaveBeenCalled();
    });

    it('resolves name@server case-insensitively without a prior listing', async () => {
        const reply = await run('/list topics SHORTCUTS-2@DevBox', makeContext());
        expect(reply.split('\n')[0]).toBe('Topics · shortcuts-2 @ devbox');
    });

    it('asks for list remotes when n.m arrives before any listing', async () => {
        expect(await run('list topics 1.2', makeContext())).toBe('No remote listing yet — run "list remotes" first.');
    });

    it('keeps the numbering per chat', async () => {
        const memory = new RemoteRefMemory();
        await run('list remotes', makeContext(undefined, memory, 'chat-a'));
        expect(await run('list topics 1.2', makeContext(undefined, memory, 'chat-a'))).toContain('Topics · shortcuts-2');
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
        expect(await run('list topics shortcuts@devbox', ctx)).toBe('Topics · shortcuts @ devbox\nNo chat topics found.');
    });

    it('leaves bare list topics on the local selected repo', async () => {
        const ctx = makeContext();
        const reply = await run('list topics', ctx);
        expect(reply).toBe(`Topics · local-repo\n${IN}1. ⏳ Local chat · now\nReply select topic <n> · list topics -v for ids`);
    });

    it('appends ids with -v on the remote form', async () => {
        const ctx = makeContext();
        await run('list remotes', ctx);
        const lines = (await run('list topics 1.2 -v', ctx)).split('\n');
        expect(lines[1]).toBe(`${IN}1. ✅ Chat 1 · 1h · chat-1`);
        expect(lines.at(-1)).toBe('Read-only');
    });

    it('sorts the remote page by last activity, not remote store order', async () => {
        const ctx = makeContext(makeDirectory({
            fetchImpl: routedFetch({
                [`${DEVBOX}/api/workspaces`]: () => json({ workspaces: [{ id: 'w1', name: 'shortcuts' }] }),
                [processesUrl(DEVBOX, 'w1')]: () => json({ processes: [
                    { id: 'a', status: 'failed', title: 'Old', startTime: iso(NOW - 3 * 24 * HOUR), metadata: { workspaceId: 'w1' } },
                    { id: 'b', status: 'queued', title: 'Fresh', startTime: iso(NOW - 5 * 24 * HOUR), lastEventAt: iso(NOW - 5 * 60_000), metadata: { workspaceId: 'w1' } },
                ] }),
            }),
        }));
        expect((await run('list topics shortcuts@devbox', ctx)).split('\n').slice(1, 3))
            .toEqual([`${IN}1. 🕒 Fresh · 5m`, `${IN}2. ❌ Old · 3d`]);
    });

    it('escapes remote titles and applies transport styling', async () => {
        const ctx = makeContext(makeDirectory({
            fetchImpl: routedFetch({
                [`${DEVBOX}/api/workspaces`]: () => json({ workspaces: [{ id: 'w1', name: 'shortcuts' }] }),
                [processesUrl(DEVBOX, 'w1')]: () => json({ processes: [{ id: 'a', status: 'completed', title: 'fix *bold*', metadata: { workspaceId: 'w1' } }] }),
            }),
        }));
        Object.assign(ctx, { strong: (t: string) => `*${t}*`, code: (t: string) => `\`${t}\``, escape: (t: string) => t.replace(/\*/g, '\\*') });
        expect(await run('list topics shortcuts@devbox', ctx)).toBe(
            `*Topics* · shortcuts @ devbox\n${IN}1. ✅ fix \\*bold\\*\nRead-only · \`list topics shortcuts@devbox -v\` for ids`);
    });
});

describe('local list topics', () => {
    function localContext(processes: object[], current: string | null = null): MessagingCommandContext {
        return {
            ...makeContext(),
            store: {
                getWorkspaces: vi.fn().mockResolvedValue([{ id: 'local-ws', name: 'local *repo*' }]),
                getAllProcesses: vi.fn().mockResolvedValue(processes.map(p => ({ metadata: { workspaceId: 'local-ws' }, ...p }))),
                getProcess: vi.fn(),
            } as any,
            selection: { repoId: () => 'local-ws', selectRepo: vi.fn(), topicId: () => current, selectTopic: vi.fn() },
            strong: (t: string) => `*${t}*`,
            code: (t: string) => `\`${t}\``,
            escape: (t: string) => t.replace(/\*/g, '\\*'),
        };
    }

    const processes = [
        { id: 'queue_1790998775041-9c24qu7', status: 'completed', title: 'Late-bound executor capabilities and a very long tail', startTime: new Date(NOW - 2 * HOUR) },
        { id: 'p-current', status: 'running', title: 'Fix *autopilot* follow up mode', startTime: new Date(NOW - 5 * 24 * HOUR), lastEventAt: new Date(NOW - 10_000) },
        { id: 'p-failed', status: 'failed', title: 'WhatsApp remote browsing', startTime: new Date(NOW - 26 * HOUR) },
    ];

    it('renders the phone-friendly list: current marker, emoji, escaped truncated title, age, footer, no ids', async () => {
        const reply = await run('list topics', localContext(processes, 'p-current'));
        expect(reply).toBe([
            '*Topics* · local \\*repo\\*',
            '▶ 1. ⏳ Fix \\*autopilot\\* follow up mode · now',
            `${IN}2. ✅ Late-bound executor capabilities and a… · 2h`,
            `${IN}3. ❌ WhatsApp remote browsing · 1d`,
            'Reply `select topic <n>` · `list topics -v` for ids',
        ].join('\n'));
        expect(reply).not.toContain('queue_');
        expect(reply).not.toContain('⬅️');
    });

    it('appends ids with -v and drops the -v hint', async () => {
        const lines = (await run('/list topics -v', localContext(processes))).split('\n');
        expect(lines[1]).toBe(`${IN}1. ⏳ Fix \\*autopilot\\* follow up mode · now · \`p-current\``);
        expect(lines[2]).toContain('· `queue_1790998775041-9c24qu7`');
        expect(lines.at(-1)).toBe('Reply `select topic <n>`');
    });

    it('select topic <n> picks the topic shown at that position', async () => {
        const ctx = localContext(processes);
        await run('select topic 1', ctx);
        expect(ctx.selection.selectTopic).toHaveBeenCalledWith('local-ws', 'p-current');
    });

    it('keeps malformed -v input an unknown command', () => {
        expect(parseMessagingCommand('list topics -x').type).toBe('invalid');
    });
});

describe('formatTopicList', () => {
    const plainFormat = { strong: (t: string) => t, code: (t: string) => t, escape: (t: string) => t };
    const line = (topic: object) =>
        formatTopicList([{ id: 'x', ...topic }], { ...plainFormat, header: 'H', footer: 'F', now: NOW }).split('\n')[1];

    it('maps every status to an emoji, unknown to ❔', () => {
        const statuses: Array<[string | undefined, string]> = [
            ['running', '⏳'], ['queued', '🕒'], ['completed', '✅'], ['failed', '❌'], ['cancelled', '⏹'],
            ['paused', '❔'], [undefined, '❔'], ['constructor', '❔'],
        ];
        for (const [status, emoji] of statuses) expect(line({ status, title: 't' })).toBe(`${IN}1. ${emoji} t`);
    });

    it('falls back from title to customTitle to promptPreview, collapses whitespace, and labels untitled topics', () => {
        expect(line({ customTitle: 'Custom' })).toBe(`${IN}1. ❔ Custom`);
        expect(line({ promptPreview: 'do\n  the   thing' })).toBe(`${IN}1. ❔ do the thing`);
        expect(line({})).toBe(`${IN}1. ❔ (untitled)`);
    });

    it('truncates to 40 characters without splitting surrogate pairs', () => {
        expect(line({ title: 'a'.repeat(40) })).toBe(`${IN}1. ❔ ${'a'.repeat(40)}`);
        expect(line({ title: 'a'.repeat(41) })).toBe(`${IN}1. ❔ ${'a'.repeat(39)}…`);
        expect(line({ title: '😀'.repeat(45) })).toBe(`${IN}1. ❔ ${'😀'.repeat(39)}…`);
    });
});

describe('formatRelativeAge', () => {
    it('buckets into now / Nm / Nh / Nd and clamps future times', () => {
        expect(formatRelativeAge(undefined, NOW)).toBeUndefined();
        expect(formatRelativeAge(NOW - 59_999, NOW)).toBe('now');
        expect(formatRelativeAge(NOW + HOUR, NOW)).toBe('now');
        expect(formatRelativeAge(NOW - 60_000, NOW)).toBe('1m');
        expect(formatRelativeAge(NOW - 59 * 60_000, NOW)).toBe('59m');
        expect(formatRelativeAge(NOW - HOUR, NOW)).toBe('1h');
        expect(formatRelativeAge(NOW - 23.9 * HOUR, NOW)).toBe('23h');
        expect(formatRelativeAge(NOW - 24 * HOUR, NOW)).toBe('1d');
        expect(formatRelativeAge(NOW - 30 * 24 * HOUR, NOW)).toBe('30d');
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

    it('keeps string activity timestamps for relative ages', async () => {
        const directory = makeDirectory({
            fetchImpl: routedFetch({
                [processesUrl(DEVBOX, 'w2')]: () => json({ processes: [
                    { id: 'a', startTime: iso(NOW - HOUR), lastEventAt: iso(NOW), metadata: { workspaceId: 'w2' } },
                    { id: 'b', startTime: 123, lastEventAt: null, metadata: { workspaceId: 'w2' } },
                ] }),
            }),
        });
        expect(await directory.listRemoteChats('srv-dev', 'w2', 10)).toEqual([
            { id: 'a', startTime: iso(NOW - HOUR), lastEventAt: iso(NOW) },
            { id: 'b' },
        ]);
    });

    it('throws RemoteServerOfflineError for unknown, endpoint-less and unreachable servers', async () => {
        const directory = makeDirectory({ fetchImpl: routedFetch({}) });
        await expect(directory.listRemoteChats('missing', 'w', 10)).rejects.toBeInstanceOf(RemoteServerOfflineError);
        await expect(directory.listRemoteChats('srv-lap', 'w', 10)).rejects.toBeInstanceOf(RemoteServerOfflineError);
        await expect(directory.listRemoteChats('srv-dev', 'w', 10)).rejects.toBeInstanceOf(RemoteServerOfflineError);
    });
});
