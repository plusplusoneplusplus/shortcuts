import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppBindings } from '../../../src/server/messaging/whatsapp-bindings';
import { WhatsAppCommandRouter, type WhatsAppRouterDeps } from '../../../src/server/messaging/whatsapp-command-router';
import type { InboundWAMessage } from '@plusplusoneplusplus/coc-connector/whatsapp';

describe('WhatsApp workspace command routing', () => {
    let dir: string;
    let bindings: WhatsAppBindings;
    let enqueue: ReturnType<typeof vi.fn>;
    let send: ReturnType<typeof vi.fn>;
    let react: ReturnType<typeof vi.fn>;
    let router: WhatsAppCommandRouter;
    let getAllProcesses: ReturnType<typeof vi.fn>;
    const workspaces = [{ id: 'ws-a', name: 'Alpha' }, { id: 'ws-b', name: 'Beta' }];
    const processes = [
        { id: 'topic-a', metadata: { workspaceId: 'ws-a' }, startTime: new Date(), title: 'Topic A' },
        { id: 'topic-b', metadata: { workspaceId: 'ws-b' }, startTime: new Date(), title: 'Topic B' },
    ];
    const inbound = (text: string, id = 'msg-1', patch: Partial<InboundWAMessage> = {}): InboundWAMessage => ({
        chatJid: 'group@g.us', senderJid: 'group@g.us', participantJid: 'self@s.whatsapp.net',
        fromMe: true, messageId: id, text, ...patch,
    });

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-router-'));
        bindings = new WhatsAppBindings(dir);
        getAllProcesses = vi.fn().mockImplementation(async ({ workspaceId }: { workspaceId: string }) =>
            processes.filter(proc => proc.metadata.workspaceId === workspaceId));
        const store = {
            getWorkspaces: vi.fn().mockResolvedValue(workspaces),
            getAllProcesses,
            getProcess: vi.fn().mockImplementation(async (id: string, workspaceId: string) =>
                processes.find(proc => proc.id === id && proc.metadata.workspaceId === workspaceId)),
        } as unknown as WhatsAppRouterDeps['store'];
        await bindings.restore(store);
        enqueue = vi.fn().mockResolvedValue('queued');
        send = vi.fn().mockResolvedValue('outbound');
        react = vi.fn().mockResolvedValue(undefined);
        router = new WhatsAppCommandRouter({
            store, bindings, groupJid: () => 'group@g.us', enqueue, send, react,
        });
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('lists and selects across two workspaces, and requires explicit selection for chat', async () => {
        await router.handle(inbound('what files?', 'unselected'));
        expect(enqueue).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledWith(expect.stringContaining('list repos'), 'unselected');
        await router.handle(inbound('list repos', 'list'));
        expect(send).toHaveBeenCalledWith(expect.stringContaining('Beta'), 'list');
        await router.handle(inbound('select repo 2', 'select'));
        expect(bindings.selectedRepo).toBe('ws-b');
        await router.handle(inbound('what files?', 'chat'));
        expect(enqueue).toHaveBeenCalledWith('ws-b', 'what files?', 'ask', expect.any(String), expect.any(String));
        expect(react).toHaveBeenCalledWith('chat');
        expect(fs.existsSync(path.join(dir, 'repos', 'ws-b', 'whatsapp-bindings.json'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'messaging', 'whatsapp', 'bindings.json'))).toBe(false);
    });

    it('selects topics only in the chosen workspace and creates a fresh topic on demand', async () => {
        await router.handle(inbound('select repo Alpha', 'select'));
        await router.handle(inbound('list topics', 'list'));
        expect(send).toHaveBeenCalledWith(expect.stringContaining('topic-a'), 'list');
        expect(send).not.toHaveBeenCalledWith(expect.stringContaining('topic-b'), 'list');
        await router.handle(inbound('select topic topic-b', 'bad'));
        expect(send).toHaveBeenCalledWith(expect.stringContaining('Topic not found'), 'bad');
        await router.handle(inbound('select topic topic-a', 'good'));
        await router.handle(inbound('/autopilot fix this', 'autopilot'));
        expect(enqueue).toHaveBeenCalledWith('ws-a', 'fix this', 'autopilot', 'topic-a', expect.any(String));
        await router.handle(inbound('create topic', 'new'));
        await router.handle(inbound('new question', 'new-chat'));
        expect(enqueue.mock.calls.at(-1)?.[3]).not.toBe('topic-a');
    });

    it('reads topics with a bounded, conversation-free query so large stores cannot stall replies', async () => {
        await router.handle(inbound('select repo Alpha', 'select'));
        await router.handle(inbound('list topics', 'list'));
        await router.handle(inbound('select topic 1', 'pick'));
        expect(getAllProcesses).toHaveBeenCalledTimes(2);
        for (const [filter] of getAllProcesses.mock.calls) {
            expect(filter).toEqual({ workspaceId: 'ws-a', limit: 10, exclude: ['conversation', 'toolCalls'] });
        }
        expect(send).toHaveBeenCalledWith('Selected topic: Topic A', 'pick');
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
        expect(enqueue.mock.calls.at(-1)?.slice(0, 4)).toEqual(['ws-a', 'follow-up', 'ask', alpha.processId]);
        expect(bindings.selectedRepo).toBe('ws-b');
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
