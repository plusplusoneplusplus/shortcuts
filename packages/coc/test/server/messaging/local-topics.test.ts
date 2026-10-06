import { describe, expect, it, vi } from 'vitest';
import type { AIProcess } from '@plusplusoneplusplus/forge';
import { LocalTopicMemory, listLocalTopics, localTopicsReply, resolveLocalTopic, LOCAL_TOPICS_EMPTY } from '../../../src/server/messaging/local-topics';

const NOW = Date.parse('2026-10-06T12:00:00Z');
const DAY = 86_400_000;
const workspaces = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }];
const format = { strong: (s: string) => s, code: (s: string) => s, escape: (s: string) => s };
function topic(id: string, workspaceId = 'a', patch: Partial<AIProcess> = {}): AIProcess {
    return { id, status: 'completed', startTime: new Date(NOW - 1000), title: id,
        metadata: { workspaceId }, ...patch } as AIProcess;
}
function store(topics: AIProcess[]) {
    return {
        getAllProcesses: vi.fn(async ({ offset = 0, limit = 100 }) => topics.slice(offset, offset + limit)),
        getProcess: vi.fn(async (id: string, workspaceId?: string) => topics.find(t => t.id === id && t.metadata?.workspaceId === workspaceId)),
    };
}

describe('local messaging topics', () => {
    it('ranks pinned, then running, then activity across repos, with exactly five total', async () => {
        const topics = [topic('recent', 'b', { lastEventAt: new Date(NOW) }),
            topic('pin', 'b', { pinnedAt: new Date(NOW).toISOString(), lastEventAt: new Date(NOW - 10000) }),
            topic('run', 'a', { status: 'running', lastEventAt: new Date(NOW - 9000) }),
            topic('pin-run', 'a', { pinnedAt: new Date(NOW).toISOString(), status: 'running' }),
            topic('fifth', 'a', { lastEventAt: new Date(NOW - 500) }), topic('sixth')];
        expect((await listLocalTopics(store(topics), workspaces, NOW)).map(t => t.id))
            .toEqual(['pin-run', 'pin', 'run', 'recent', 'fifth']);
    });

    it('uses creation at the inclusive 24h boundary; excludes old active/pinned/running and future or invalid creations', async () => {
        const topics = [topic('boundary', 'b', { startTime: new Date(NOW - DAY) }),
            topic('now', 'a', { startTime: new Date(NOW) }),
            topic('old-active', 'a', { startTime: new Date(NOW - DAY - 1), lastEventAt: new Date(NOW), status: 'running', pinnedAt: new Date(NOW).toISOString() }),
            topic('future', 'a', { startTime: new Date(NOW + 1) }), topic('invalid', 'a', { startTime: new Date(NaN) }),
            topic('invisible', 'removed')];
        expect((await listLocalTopics(store(topics), workspaces, NOW)).map(t => t.id)).toEqual(['now', 'boundary']);
    });

    it('breaks equal ranks by workspace then topic id independently of input order', async () => {
        const topics = [topic('z', 'b'), topic('z', 'a'), topic('a', 'b'), topic('a', 'a')];
        const ids = async (rows: AIProcess[]) => (await listLocalTopics(store(rows), workspaces, NOW)).map(t => `${t.metadata?.workspaceId}/${t.id}`);
        expect(await ids(topics)).toEqual(['a/a', 'a/z', 'b/a', 'b/z']);
        expect(await ids([...topics].reverse())).toEqual(await ids(topics));
    });

    it('finds pinned topics beyond the first page using bounded conversation-free reads', async () => {
        const s = store([...Array.from({ length: 100 }, (_, i) => topic(String(i))), topic('late-pin', 'b', { pinnedAt: 'pin' })]);
        expect((await listLocalTopics(s, workspaces, NOW))[0].id).toBe('late-pin');
        expect(s.getAllProcesses.mock.calls.map(([filter]) => filter)).toEqual([0, 100].map(offset => ({
            since: new Date(NOW - DAY), offset, limit: 100, exclude: ['conversation', 'toolCalls'],
        })));
    });

    it('shows scope and repo names, keeps five total, and has no pagination prompt', async () => {
        const s = store(Array.from({ length: 12 }, (_, i) => topic(`p${i}`, i % 2 ? 'a' : 'b', { lastEventAt: new Date(NOW - i) })));
        const reply = await localTopicsReply(s, workspaces, undefined, format, () => null, NOW);
        expect(reply).toContain('all repos · last24hours · top5');
        expect(reply).toContain('Alpha');
        expect(reply).toContain('Beta');
        expect(reply.split('\n')).toHaveLength(7);
        expect(reply).not.toMatch(/Show more|next page/i);
    });

    it('clears the snapshot and gives a clear empty state when nothing is eligible', async () => {
        const slot = new LocalTopicMemory().slot('chat');
        slot.set([{ workspaceId: 'a', processId: 'stale' }]);
        expect(await localTopicsReply(store([topic('old', 'a', { startTime: new Date(NOW - DAY - 1) })]), workspaces, slot, format, () => null, NOW)).toBe(LOCAL_TOPICS_EMPTY);
        expect(slot.get()).toEqual([]);
    });

    it('keeps numbered selection stable after activity changes and revalidates visibility and ownership', async () => {
        const topics = [topic('first', 'b', { status: 'running' }), topic('second', 'a')];
        const s = store(topics);
        const slot = new LocalTopicMemory().slot('chat');
        await localTopicsReply(s, workspaces, slot, format, () => null, NOW);
        topics[0].status = 'completed';
        topics[1].status = 'running';
        expect((await resolveLocalTopic(s, workspaces, slot, '1', NOW))?.id).toBe('first');
        expect(s.getProcess).toHaveBeenLastCalledWith('first', 'b');
        expect(await resolveLocalTopic(s, [workspaces[0]], slot, '1', NOW)).toBeUndefined();
        s.getProcess.mockResolvedValueOnce(topic('first', 'a'));
        expect(await resolveLocalTopic(s, workspaces, slot, '1', NOW)).toBeUndefined();
        expect(await resolveLocalTopic(s, workspaces, slot, '9', NOW)).toBeUndefined();
    });

    it('resolves qualified duplicate ids correctly and rejects ambiguous bare ids', async () => {
        const s = store([topic('same', 'a'), topic('same', 'b')]);
        expect(await resolveLocalTopic(s, workspaces, undefined, 'same', NOW)).toBeUndefined();
        expect((await resolveLocalTopic(s, workspaces, undefined, 'b/same', NOW))?.metadata?.workspaceId).toBe('b');
        const reply = await localTopicsReply(s, workspaces, undefined, format, () => null, NOW, true);
        expect(reply).toContain('a/same');
        expect(reply).toContain('b/same');
    });

    it('isolates numbering between platforms, channels and threads and retains direct selection of older chats', async () => {
        const wa = new LocalTopicMemory();
        const teams = new LocalTopicMemory();
        wa.slot('group').set([{ workspaceId: 'b', processId: 'wa' }]);
        teams.slot('channel\0root-a').set([{ workspaceId: 'a', processId: 'teams' }]);
        expect(teams.slot('group').get()).toBeUndefined();
        expect(teams.slot('other-channel\0root-a').get()).toBeUndefined();
        expect(teams.slot('channel\0root-b').get()).toBeUndefined();
        const s = store([topic('old', 'b', { startTime: new Date(NOW - DAY * 10) })]);
        expect((await resolveLocalTopic(s, workspaces, undefined, 'old', NOW))?.id).toBe('old');
    });
});
