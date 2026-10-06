import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppBindings } from '../../../src/server/messaging/whatsapp-bindings';
import { WhatsAppCommandRouter, type WhatsAppRouterDeps } from '../../../src/server/messaging/whatsapp-command-router';
import type { InboundWAMessage } from '@plusplusoneplusplus/coc-connector/whatsapp';
import { TaskQueueManager } from '@plusplusoneplusplus/forge';

const GLOBAL = 'global-workspace-00';
const NO_GLOBAL = '❌ The Global workspace is unavailable. Use `list repos`, then `select repo <n|name>`.';

describe('WhatsApp workspace command routing', () => {
    let dir: string;
    let bindings: WhatsAppBindings;
    let enqueue: ReturnType<typeof vi.fn>;
    let send: ReturnType<typeof vi.fn>;
    let react: ReturnType<typeof vi.fn>;
    let router: WhatsAppCommandRouter;
    let getAllProcesses: ReturnType<typeof vi.fn>;
    let store: WhatsAppRouterDeps['store'];
    const workspaces = [{ id: 'ws-a', name: 'Alpha' }, { id: 'ws-b', name: 'Beta' }, { id: GLOBAL, name: 'Global' }];
    const createdAt = new Date(Date.now() - 1000);
    const processes = [
        { id: 'topic-g', metadata: { workspaceId: GLOBAL }, startTime: createdAt, title: 'Topic G' },
        { id: 'topic-a', metadata: { workspaceId: 'ws-a' }, startTime: createdAt, title: 'Topic A' },
        { id: 'topic-b', metadata: { workspaceId: 'ws-b' }, startTime: createdAt, title: 'Topic B' },
    ];
    const inbound = (text: string, id = 'msg-1', patch: Partial<InboundWAMessage> = {}): InboundWAMessage => ({
        chatJid: 'group@g.us', senderJid: 'group@g.us', participantJid: 'self@s.whatsapp.net',
        fromMe: true, messageId: id, text, ...patch,
    });

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-router-'));
        bindings = new WhatsAppBindings(dir);
        getAllProcesses = vi.fn().mockImplementation(async ({ workspaceId }: { workspaceId: string }) =>
            processes.filter(proc => !workspaceId || proc.metadata.workspaceId === workspaceId));
        store = {
            getWorkspaces: vi.fn().mockResolvedValue(workspaces),
            getAllProcesses,
            getProcess: vi.fn().mockImplementation(async (id: string, workspaceId: string) =>
                processes.find(proc => proc.id === id && (!workspaceId || proc.metadata.workspaceId === workspaceId))),
        } as unknown as WhatsAppRouterDeps['store'];
        await bindings.restore(store);
        const queue = new TaskQueueManager();
        enqueue = vi.fn(async (workspaceId, prompt, mode, processId, id) => queue.enqueue({
            id, repoId: workspaceId, processId, type: 'chat', priority: 'normal', config: {},
            payload: { kind: 'chat', workspaceId, prompt, mode, relayRequestId: id },
        }).id);
        send = vi.fn().mockResolvedValue('outbound');
        react = vi.fn().mockResolvedValue(undefined);
        router = new WhatsAppCommandRouter({
            store, bindings, groupJid: () => 'group@g.us', enqueue, send, react,
            getTask: id => queue.getTask(id),
        });
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('lists and selects across workspaces, defaulting chat to Global until a repo is selected', async () => {
        await router.handle(inbound('what files?', 'unselected'));
        expect(enqueue).toHaveBeenCalledWith(GLOBAL, 'what files?', undefined, expect.any(String), expect.any(String), undefined);
        expect(bindings.selectedRepo).toBeNull();
        await router.handle(inbound('list repos', 'list'));
        expect(send).toHaveBeenCalledWith(expect.stringMatching(/^Repos \(3\):\n1\. Alpha.*\n2\. Beta.*\n3\. Global/), 'list');
        await router.handle(inbound('select repo 2', 'select'));
        expect(send).toHaveBeenCalledWith('✅ Selected repo: Beta. Your next message starts a new chat.', 'select');
        expect(bindings.selectedRepo).toBe('ws-b');
        await router.handle(inbound('what files?', 'chat'));
        expect(enqueue).toHaveBeenCalledWith('ws-b', 'what files?', undefined, expect.any(String), expect.any(String), undefined);
        expect(react).toHaveBeenCalledWith('chat');
        expect(fs.existsSync(path.join(dir, 'repos', 'ws-b', 'whatsapp-bindings.json'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'messaging', 'whatsapp', 'bindings.json'))).toBe(false);
    });

    it('browses remote servers read-only and records the replies as its own', async () => {
        const remotes = {
            list: vi.fn().mockResolvedValue({
                entries: [{ id: 'remote:srv-1:w1', name: 'shortcuts', type: 'repo', server: 'devbox', serverKind: 'ssh', online: true }],
                servers: [
                    { server: 'local', serverKind: 'local', online: true },
                    { serverId: 'srv-1', server: 'devbox', serverKind: 'ssh', online: true },
                ],
            }),
            listRemoteChats: vi.fn().mockResolvedValue([{ id: 'r-chat', status: 'completed', title: 'Remote chat' }]),
        };
        send.mockImplementation(async (_text: string, quoted: string) => `out-${quoted}`);
        router = new WhatsAppCommandRouter({ store, bindings, groupJid: () => 'group@g.us', enqueue, send, react, remotes });
        await router.handle(inbound('list topics 1.1', 'early'));
        expect(send).toHaveBeenLastCalledWith('No remote listing yet — run "list remotes" first.', 'early');
        await router.handle(inbound('/list remotes', 'remotes'));
        expect(send).toHaveBeenLastCalledWith('Remote servers\n1. devbox (ssh) — online\n   1.1 shortcuts', 'remotes');
        await router.handle(inbound('list topics 1.1', 'topics'));
        expect(remotes.listRemoteChats).toHaveBeenCalledWith('srv-1', 'w1', 10);
        expect(send).toHaveBeenLastCalledWith(
            'Topics · shortcuts @ devbox\n\u2002\u20021. ✅ Remote chat\nRead-only · list topics 1.1 -v for ids', 'topics');
        expect(bindings.isKnownMessage('out-remotes')).toBe(true);
        expect(bindings.isKnownMessage('out-topics')).toBe(true);
        expect(bindings.selectedRepo).toBeFalsy();
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('selects topics across accessible workspaces and creates a fresh topic on demand', async () => {
        await router.handle(inbound('select repo Alpha', 'select'));
        await router.handle(inbound('list topics', 'list'));
        expect(send).toHaveBeenCalledWith(
            'Topics · all repos · last24hours · top5\n\u2002\u20021. ❔ Topic G · Global · now\n\u2002\u20022. ❔ Topic A · Alpha · now\n\u2002\u20023. ❔ Topic B · Beta · now\nReply select topic <n> · list topics -v for ids', 'list');
        await router.handle(inbound('list topics -v', 'list-v'));
        expect(send).toHaveBeenCalledWith(expect.stringContaining('Topic A · Alpha · now · ws-a/topic-a'), 'list-v');
        expect(send).toHaveBeenCalledWith(expect.stringContaining('ws-b/topic-b'), 'list-v');
        await router.handle(inbound('select topic topic-b', 'beta'));
        expect(bindings.selectedRepo).toBe('ws-b');
        expect(bindings.topic('ws-b')).toBe('topic-b');
        await router.handle(inbound('select topic topic-a', 'good'));
        await router.handle(inbound('list topics', 'marked'));
        expect(send).toHaveBeenCalledWith(expect.stringMatching(/▶ 2\. ❔ Topic A · Alpha · now/), 'marked');
        await router.handle(inbound('list topics -q', 'malformed'));
        expect(send).toHaveBeenLastCalledWith(expect.stringContaining('Unknown command'), 'malformed');
        await router.handle(inbound('/autopilot fix this', 'autopilot'));
        expect(enqueue).toHaveBeenCalledWith('ws-a', 'fix this', 'autopilot', 'topic-a', expect.any(String), undefined);
        await router.handle(inbound('create topic', 'new'));
        await router.handle(inbound('new question', 'new-chat'));
        expect(enqueue.mock.calls.at(-1)?.[3]).not.toBe('topic-a');
    });

    it('reads topics with a bounded, conversation-free query so large stores cannot stall replies', async () => {
        await router.handle(inbound('select repo Alpha', 'select'));
        await router.handle(inbound('list topics', 'list'));
        await router.handle(inbound('select topic 2', 'pick'));
        expect(getAllProcesses).toHaveBeenCalledTimes(1);
        for (const [filter] of getAllProcesses.mock.calls) {
            expect(filter).toEqual({ since: expect.any(Date), offset: 0, limit: 100, exclude: ['conversation', 'toolCalls'] });
        }
        expect(send).toHaveBeenCalledWith('✅ Selected topic: Topic A', 'pick');
    });

    it('keeps cross-repo numbered selection stable and routes the following message to its owner', async () => {
        await router.handle(inbound('select repo Alpha', 'repo'));
        const beta = { ...processes[2], status: 'running', pinnedAt: new Date().toISOString() };
        getAllProcesses.mockResolvedValue([processes[1], beta]);
        await router.handle(inbound('list topics -v', 'list'));
        expect(send).toHaveBeenLastCalledWith(expect.stringContaining('1. ⏳ Topic B · Beta · now · ws-b/topic-b'), 'list');
        // Changes to store order/rank after display must not change the selected target.
        getAllProcesses.mockResolvedValue([processes[1]]);
        await router.handle(inbound('select topic 1', 'pick'));
        expect(bindings.selectedRepo).toBe('ws-b');
        expect(bindings.topic('ws-b')).toBe('topic-b');
        await router.handle(inbound('continue beta', 'follow'));
        expect(enqueue.mock.calls.at(-1)?.slice(0, 4)).toEqual(['ws-b', 'continue beta', undefined, 'topic-b']);
    });

    it('routes quoted answers to their original workspace regardless of selected repo', async () => {
        await router.handle(inbound('select repo 1', 'select-a'));
        await router.handle(inbound('alpha question', 'alpha'));
        const alpha = bindings.findMessage('alpha')!;
        alpha.outboundIds.push('answer-a');
        bindings.update(alpha);
        await router.handle(inbound('select repo 2', 'select-b'));
        await router.handle(inbound('beta question', 'beta'));
        await router.handle(inbound('follow-up', 'follow', { quotedMessageId: 'answer-a' }));
        expect(enqueue.mock.calls.at(-1)?.slice(0, 4)).toEqual(['ws-a', 'follow-up', undefined, alpha.processId]);
        expect(bindings.selectedRepo).toBe('ws-b');
    });

    it('passes the follow-up mode through as typed for quote-replies and selected topics', async () => {
        await router.handle(inbound('select repo 1', 'select-a'));
        await router.handle(inbound('/autopilot build it', 'first'));
        expect(enqueue.mock.calls.at(-1)?.[2]).toBe('autopilot');
        const first = bindings.findMessage('first')!;
        first.outboundIds.push('answer-first');
        bindings.update(first);
        const modes: Array<[string, string | undefined]> = [
            ['keep going', undefined], ['/ask just look', 'ask'], ['/autopilot fix it', 'autopilot'],
        ];
        for (const [text, mode] of modes) {
            await router.handle(inbound(text, `quote-${text}`, { quotedMessageId: 'answer-first' }));
            expect(enqueue.mock.calls.at(-1)?.slice(2, 4)).toEqual([mode, first.processId]);
            await router.handle(inbound(text, `topic-${text}`));
            expect(enqueue.mock.calls.at(-1)?.slice(2, 4)).toEqual([mode, first.processId]);
        }
    });

    it('silently drops other authors, groups and bot echoes', async () => {
        await router.handle(inbound('select repo 1', 'one', { fromMe: false }));
        await router.handle(inbound('select repo 1', 'two', { chatJid: 'other@g.us' }));
        expect(send).not.toHaveBeenCalled();
        await router.handle(inbound('select repo 1', 'three'));
        await router.handle(inbound('bot output', 'outbound'));
        await router.handle(inbound('hello', 'four'));
        await router.handle(inbound('echo', 'four'));
        expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it('replies on invalid commands, failed enqueue, and ignores failed reactions', async () => {
        await router.handle(inbound('/unknown', 'bad-command'));
        expect(send).toHaveBeenCalledWith(expect.stringContaining('Unknown command'), 'bad-command');
        await router.handle(inbound('select repo 1', 'select'));
        enqueue.mockRejectedValueOnce(new Error('queue down'));
        await router.handle(inbound('first', 'failed'));
        expect(send).toHaveBeenCalledWith(expect.stringContaining('Could not queue'), 'failed');
        expect(bindings.findMessage('failed')).toBeUndefined();
        react.mockRejectedValueOnce(new Error('reaction down'));
        await router.handle(inbound('next', 'accepted'));
        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(bindings.findMessage('accepted')).toBeDefined();
    });

    it('sends phone-friendly native WhatsApp help without changing workspace or topic', async () => {
        bindings.selectRepo('ws-b');
        bindings.selectTopic('ws-b', 'topic-b');
        await router.handle(inbound('/help', 'styled-help'));
        const help = send.mock.lastCall![0];
        expect(help).toMatch(/^\*CoC help\*\n/);
        for (const group of ['Repos', 'Topics', 'Tools', 'Chat', 'Modes (/ required)']) {
            expect(help).toContain(`\n\n*${group}*\n`);
        }
        expect(help).toContain('select repo <n|name|id>\n');
        expect(help).toContain('Example: list topics 1.2 -v');
        expect(help).not.toMatch(/\*\*|`|<\/?(?:p|strong|code|br|table)\b/);
        expect(help.length).toBeLessThan(4096);
        await router.handle(inbound('/unknown', 'styled-invalid'));
        expect(send.mock.lastCall).toEqual([`Unknown command or invalid argument.\n\n${help}`, 'styled-invalid']);
        expect(bindings.selectedRepo).toBe('ws-b');
        expect(bindings.topic('ws-b')).toBe('topic-b');
        expect(enqueue).not.toHaveBeenCalled();
        expect(react.mock.calls).toEqual([['styled-help']]);
    });

    it.each(['help', '/help', 'quota', 'list repos', 'select repo Beta', 'create topic', 'compact'])(
        'acknowledges %s once without invoking the LLM, including redelivery after reload', async text => {
            await router.handle(inbound(text, 'command'));
            await router.handle(inbound(text, 'command'));
            const restored = new WhatsAppBindings(dir);
            await restored.restore(store);
            const restarted = new WhatsAppCommandRouter({
                store, bindings: restored, groupJid: () => 'group@g.us', enqueue, send, react,
                getTask: () => undefined,
            });
            await restarted.handle(inbound(text, 'command'));
            expect(react.mock.calls).toEqual([['command']]);
            expect(send).toHaveBeenCalledOnce();
            expect(send.mock.calls[0][1]).toBe('command');
            expect(react.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
            expect(enqueue).not.toHaveBeenCalled();
        },
    );

    it('reserves concurrent commands before reacting and preserves sender and group guards', async () => {
        bindings.selectRepo('ws-b');
        bindings.selectTopic('ws-b', 'topic-b');
        let finishReaction!: () => void;
        react.mockImplementationOnce(() => new Promise<void>(resolve => { finishReaction = resolve; }));
        const first = router.handle(inbound('help', 'concurrent'));
        try {
            await router.handle(inbound('help', 'concurrent'));
            await router.handle(inbound('help', 'other-author', { fromMe: false }));
            await router.handle(inbound('help', 'other-group', { chatJid: 'other@g.us' }));
            expect(react.mock.calls).toEqual([['concurrent']]);
            expect(send).not.toHaveBeenCalled();
        } finally {
            finishReaction();
            await first;
        }
        expect(send).toHaveBeenCalledOnce();
        expect(bindings.selectedRepo).toBe('ws-b');
        expect(bindings.topic('ws-b')).toBe('topic-b');
    });

    it('still answers commands when reactions fail, without a text acknowledgement or duplicate retry', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        react.mockRejectedValueOnce(new Error('reaction down'));
        try {
            await router.handle(inbound('help', 'failed-like'));
            await router.handle(inbound('help', 'failed-like'));
            await router.handle(inbound('quota', 'next-command'));
            expect(react.mock.calls).toEqual([['failed-like'], ['next-command']]);
            expect(send.mock.calls).toEqual([
                [expect.stringContaining('*CoC help*'), 'failed-like'],
                ['Quota data is unavailable.', 'next-command'],
            ]);
            expect(enqueue).not.toHaveBeenCalled();
            expect(errors).toHaveBeenCalledWith('[whatsapp-messaging] Reaction failed:', expect.any(Error));
        } finally {
            errors.mockRestore();
        }
    });

    it('answers help, list agents and quota without enqueueing, and records the replies as own messages', async () => {
        await router.handle(inbound('HELP', 'help'));
        expect(send).toHaveBeenLastCalledWith(expect.stringContaining('select topic <n|id>'), 'help');
        expect(send.mock.lastCall?.[0]).toContain('[chatid] <message>');
        await router.handle(inbound('/list agents', 'agents'));
        expect(send).toHaveBeenLastCalledWith(expect.stringContaining('Alpha'), 'agents');
        await router.handle(inbound('quota', 'quota'));
        expect(send).toHaveBeenLastCalledWith('Quota data is unavailable.', 'quota');
        const getQuota = vi.fn().mockResolvedValue({ lastUpdated: null, providers: [
            { id: 'copilot', quotaTypes: [{ type: 'chat', isUnlimitedEntitlement: true, usedRequests: 0,
                entitlementRequests: 0, remainingPercentage: 1, usageAllowedWithExhaustedQuota: false, overage: 0 }] },
            { id: 'claude', quotaTypes: [{ type: 'weekly', isUnlimitedEntitlement: false, usedRequests: 0,
                entitlementRequests: 0, remainingPercentage: 0.05, usageAllowedWithExhaustedQuota: false, overage: 0 }] },
        ] });
        router = new WhatsAppCommandRouter({
            store, bindings, groupJid: () => 'group@g.us', enqueue, send, react, getQuota,
        });
        await router.handle(inbound('/Quota', 'quota-2'));
        expect(send).toHaveBeenLastCalledWith('copilot: unlimited\nclaude: 5% left (weekly)', 'quota-2');
        expect(enqueue).not.toHaveBeenCalled();
        expect(bindings.isKnownMessage('outbound')).toBe(true);
    });

    it('replies with both quota windows without changing the selected workspace or topic', async () => {
        bindings.selectRepo('ws-b');
        bindings.selectTopic('ws-b', 'topic-b');
        const getQuota = vi.fn().mockResolvedValue({ lastUpdated: null, providers: [{
            id: 'claude', quotaTypes: [
                { type: 'five_hour', isUnlimitedEntitlement: false, usedRequests: 28,
                    entitlementRequests: 100, remainingPercentage: 0.72, usageAllowedWithExhaustedQuota: false, overage: 0 },
                { type: 'seven_day', isUnlimitedEntitlement: false, usedRequests: 81,
                    entitlementRequests: 100, remainingPercentage: 0.19, usageAllowedWithExhaustedQuota: false, overage: 0 },
            ],
        }] });
        router = new WhatsAppCommandRouter({ store, bindings, groupJid: () => 'group@g.us', enqueue, send, react, getQuota });
        await router.handle(inbound('/quota', 'quota-windows'));
        expect(send).toHaveBeenLastCalledWith('claude: 72% left (5h); 19% left (7d)', 'quota-windows');
        expect(bindings.selectedRepo).toBe('ws-b');
        expect(bindings.topic('ws-b')).toBe('topic-b');
        expect(bindings.isKnownMessage('outbound')).toBe(true);
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('sends [chatid] messages to that chat in its own workspace, with or without autopilot', async () => {
        await router.handle(inbound('select repo Alpha', 'select'));
        await router.handle(inbound('[topic-b] continue there', 'explicit'));
        expect(enqueue).toHaveBeenLastCalledWith('ws-b', 'continue there', undefined, 'topic-b', expect.any(String), undefined);
        await router.handle(inbound('/autopilot [topic-a] go', 'explicit-auto'));
        expect(enqueue).toHaveBeenLastCalledWith('ws-a', 'go', 'autopilot', 'topic-a', expect.any(String), undefined);
        await router.handle(inbound('[missing] hello', 'missing'));
        expect(send).toHaveBeenLastCalledWith('Chat "missing" not found.', 'missing');
        expect(bindings.selectedRepo).toBe('ws-a');
    });

    it('replies "Unknown command" with help for unknown /words and malformed commands', async () => {
        await router.handle(inbound('/whatever', 'unknown'));
        await router.handle(inbound('select topic', 'malformed'));
        for (const id of ['unknown', 'malformed']) {
            expect(send).toHaveBeenCalledWith(expect.stringMatching(/Unknown command[\s\S]*list repos/), id);
        }
        expect(enqueue).not.toHaveBeenCalled();
    });

    describe('compact', () => {
        let compact: ReturnType<typeof vi.fn>;
        beforeEach(() => {
            compact = vi.fn().mockResolvedValue({ result: { success: true }, tokensBefore: 82_000, tokensAfter: 14_000 });
            router = new WhatsAppCommandRouter({
                store, bindings, groupJid: () => 'group@g.us', enqueue, send, react, compact,
            });
        });

        it('asks for a topic when no topic is selected', async () => {
            await router.handle(inbound('compact', 'none'));
            expect(send).toHaveBeenLastCalledWith('❌ No topic selected. Use `list topics`, then `select topic <n>`.', 'none');
            await router.handle(inbound('select repo Alpha', 'select'));
            await router.handle(inbound('/compact', 'repo-only'));
            expect(send).toHaveBeenLastCalledWith(expect.stringContaining('No topic selected'), 'repo-only');
            expect(compact).not.toHaveBeenCalled();
        });

        it('compacts the selected topic with custom instructions, without enqueueing or reselecting', async () => {
            await router.handle(inbound('select repo Alpha', 'select'));
            await router.handle(inbound('select topic topic-a', 'pick'));
            send.mockResolvedValueOnce('compact-reply');
            await router.handle(inbound('Compact focus on the WhatsApp relay work', 'compact'));
            expect(compact).toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-a' }), 'focus on the WhatsApp relay work', { connector: 'whatsapp', chatKey: 'group@g.us' });
            expect(send).toHaveBeenLastCalledWith('🗜️ Compacted "Topic A" — context 82k → 14k tokens', 'compact');
            expect(enqueue).not.toHaveBeenCalled();
            expect(react.mock.calls).toEqual([['select'], ['pick'], ['compact']]);
            expect(bindings.topic('ws-a')).toBe('topic-a');
            // The reply is guarded as an own message, never a new request.
            expect(bindings.isKnownMessage('compact-reply')).toBe(true);
            await router.handle(inbound('🗜️ Compacted "Topic A"', 'compact-reply'));
            expect(enqueue).not.toHaveBeenCalled();
        });

        it('compacts the quoted answer\'s chat instead of the selected topic', async () => {
            await router.handle(inbound('select repo 2', 'select-b'));
            await router.handle(inbound('select topic topic-b', 'pick-b'));
            const binding = { groupJid: 'group@g.us', workspaceId: 'ws-a', processId: 'topic-a', taskId: 't-a',
                inboundId: 'q-a', outboundIds: ['answer-a'], nextPart: 1, status: 'completed' as const };
            bindings.add(binding);
            await router.handle(inbound('compact', 'quoted', { quotedMessageId: 'answer-a' }));
            expect(compact).toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-a' }), undefined, { connector: 'whatsapp', chatKey: 'group@g.us' });
            expect(bindings.selectedRepo).toBe('ws-b');
            expect(bindings.topic('ws-b')).toBe('topic-b');
        });

        it('maps service guard errors to short replies and hides other errors', async () => {
            const { APIError } = await import('../../../src/server/errors');
            await router.handle(inbound('select repo Alpha', 'select'));
            await router.handle(inbound('select topic topic-a', 'pick'));
            const cases: Array<[unknown, string]> = [
                [new APIError(409, 'x', 'CONVERSATION_NOT_IDLE'), 'Chat is busy — try compact again when the current turn finishes.'],
                [new APIError(422, 'x', 'COMPACT_UNSUPPORTED'), "This chat's provider doesn't support compaction."],
                [new APIError(400, 'x', 'BAD_REQUEST'), 'This chat has no active session to compact yet.'],
                [new Error('secret provider detail'), 'Could not compact this chat. Please try again later.'],
            ];
            const error = vi.spyOn(console, 'error').mockImplementation(() => {});
            for (const [i, [failure, text]] of cases.entries()) {
                compact.mockRejectedValueOnce(failure);
                await router.handle(inbound('compact', `c-${i}`));
                expect(send).toHaveBeenLastCalledWith(text, `c-${i}`);
            }
            error.mockRestore();
            compact.mockResolvedValueOnce({ result: {} });
            await router.handle(inbound('compact', 'plain'));
            expect(send).toHaveBeenLastCalledWith('🗜️ Compacted "Topic A"', 'plain');
            expect(enqueue).not.toHaveBeenCalled();
        });

        it('replies not found when the selected topic is gone', async () => {
            await router.handle(inbound('select repo Alpha', 'select'));
            bindings.selectTopic('ws-a', 'gone');
            await router.handle(inbound('compact', 'gone'));
            expect(send).toHaveBeenLastCalledWith('Chat not found. Use `list topics` to pick one.', 'gone');
            expect(compact).not.toHaveBeenCalled();
        });
    });

    it('lists all repos without a selection and routes cross-repo ids correctly', async () => {
        await router.handle(inbound('list topics', 'list'));
        expect(send).toHaveBeenLastCalledWith(expect.stringContaining('Topic G · Global'), 'list');
        await router.handle(inbound('select topic topic-a', 'other-repo'));
        expect(bindings.selectedRepo).toBe('ws-a');
        await router.handle(inbound('select topic 1', 'pick'));
        expect(bindings.topic(GLOBAL)).toBe('topic-g');
        await router.handle(inbound('continue', 'continue'));
        expect(enqueue.mock.calls.at(-1)?.slice(0, 4)).toEqual([GLOBAL, 'continue', undefined, 'topic-g']);
        await router.handle(inbound('create topic', 'create'));
        expect(send).toHaveBeenLastCalledWith('✅ Ready for a new topic. Send a message to start.', 'create');
        expect(bindings.topic(GLOBAL)).toBeNull();
    });

    it('selects Global by name or position', async () => {
        await router.handle(inbound('select repo Beta', 'beta'));
        await router.handle(inbound('select repo global', 'by-name'));
        expect(bindings.selectedRepo).toBe(GLOBAL);
        await router.handle(inbound('select repo Beta', 'beta-again'));
        await router.handle(inbound('select repo 3', 'by-index'));
        expect(bindings.selectedRepo).toBe(GLOBAL);
        expect(send).toHaveBeenLastCalledWith('✅ Selected repo: Global. Your next message starts a new chat.', 'by-index');
    });

    it('select repo starts a fresh chat instead of resuming that repo\'s previous topic', async () => {
        await router.handle(inbound('select repo Alpha', 'select-a'));
        await router.handle(inbound('alpha question', 'alpha'));
        const alpha = bindings.findMessage('alpha')!;
        await router.handle(inbound('select repo Beta', 'select-b'));
        await router.handle(inbound('select repo Alpha', 'back-to-a'));
        await router.handle(inbound('another question', 'fresh'));
        expect(enqueue.mock.calls.at(-1)?.[0]).toBe('ws-a');
        expect(enqueue.mock.calls.at(-1)?.[3]).not.toBe(alpha.processId);
        // Re-selecting the current repo also starts fresh.
        const second = bindings.findMessage('fresh')!.processId;
        await router.handle(inbound('select repo Alpha', 'reselect'));
        await router.handle(inbound('third question', 'third'));
        expect(enqueue.mock.calls.at(-1)?.[3]).not.toBe(second);
        // A quote-reply to an earlier answer still continues that chat.
        alpha.outboundIds.push('answer-alpha');
        bindings.update(alpha);
        await router.handle(inbound('select repo Alpha', 'reselect-again'));
        await router.handle(inbound('about that', 'quoted', { quotedMessageId: 'answer-alpha' }));
        expect(enqueue.mock.calls.at(-1)?.slice(0, 4)).toEqual(['ws-a', 'about that', undefined, alpha.processId]);
    });

    it('falls back to Global when the persisted repo was removed, keeping old per-repo topic state', async () => {
        fs.mkdirSync(path.join(dir, 'messaging', 'whatsapp'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'messaging', 'whatsapp', 'state.json'), JSON.stringify({
            selectedRepo: 'ws-removed', topics: { 'ws-removed': 'old-topic', [GLOBAL]: 'topic-g' }, outboundIds: [],
        }));
        bindings = new WhatsAppBindings(dir);
        await bindings.restore(store);
        expect(bindings.topic('ws-removed')).toBe('old-topic');
        router = new WhatsAppCommandRouter({ store, bindings, groupJid: () => 'group@g.us', enqueue, send, react });
        await router.handle(inbound('hello', 'stale'));
        expect(enqueue.mock.calls.at(-1)?.slice(0, 4)).toEqual([GLOBAL, 'hello', undefined, 'topic-g']);
        await router.handle(inbound('list topics', 'list'));
        expect(send).toHaveBeenLastCalledWith(expect.stringMatching(/^Topics · all repos · last24hours · top5\n/), 'list');
    });

    it('replies with a fixed error, never crashing, when Global is missing', async () => {
        vi.mocked(store.getWorkspaces).mockResolvedValue(workspaces.slice(0, 2));
        for (const text of ['hello', 'create topic']) {
            await router.handle(inbound(text, `missing-${text}`));
            expect(send).toHaveBeenLastCalledWith(NO_GLOBAL, `missing-${text}`);
        }
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('restores workspace receipts and sticky account selection after restart', async () => {
        await router.handle(inbound('select repo Beta', 'select'));
        await router.handle(inbound('question', 'original'));
        const restored = new WhatsAppBindings(dir);
        await restored.restore({ getWorkspaces: async () => workspaces } as WhatsAppRouterDeps['store']);
        expect(restored.selectedRepo).toBe('ws-b');
        expect(restored.findMessage('original')?.workspaceId).toBe('ws-b');
        expect(restored.isKnownMessage('outbound')).toBe(true);
    });
});
