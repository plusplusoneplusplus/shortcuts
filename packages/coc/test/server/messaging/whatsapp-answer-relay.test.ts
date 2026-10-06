import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppBindings, type WhatsAppBinding } from '../../../src/server/messaging/whatsapp-bindings';
import { WhatsAppAnswerRelay, type WhatsAppRelayDeps } from '../../../src/server/messaging/whatsapp-answer-relay';
import { WhatsAppNotConnectedError } from '../../../src/server/messaging/whatsapp-messaging-manager';

describe('WhatsApp final-answer relay', () => {
    let dir: string;
    let bindings: WhatsAppBindings;
    let queue: EventEmitter;
    let send: ReturnType<typeof vi.fn>;
    let connected: boolean;
    let turns: Array<Record<string, unknown>>;
    let task: Record<string, unknown> | undefined;
    let relay: WhatsAppAnswerRelay;
    let deps: WhatsAppRelayDeps;

    const receipt = (patch: Partial<WhatsAppBinding> = {}): WhatsAppBinding => ({
        groupJid: 'group@g.us',
        workspaceId: 'ws-a', processId: 'proc-a', taskId: 'task-a',
        inboundId: 'inbound', outboundIds: [], nextPart: 0, status: 'queued', ...patch,
    });

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-relay-'));
        bindings = new WhatsAppBindings(dir);
        await bindings.restore({ getWorkspaces: async () => [{ id: 'ws-a' }, { id: 'ws-b' }] } as WhatsAppRelayDeps['store']);
        queue = new EventEmitter();
        send = vi.fn().mockResolvedValueOnce('answer-id').mockResolvedValue('another-id');
        connected = true;
        turns = [
            { role: 'user', content: 'question', relayRequestId: 'task-a' },
            { role: 'assistant', content: 'partial', streaming: true },
            { role: 'assistant', content: 'final answer' },
        ];
        task = { id: 'task-a', repoId: 'ws-a', processId: 'proc-a', status: 'completed',
            payload: { relayRequestId: 'task-a' } };
        deps = {
            bindings,
            store: {
                getProcess: vi.fn().mockImplementation(async (id: string, ws: string) =>
                    id === 'proc-a' && ws === 'ws-a'
                        ? { id, status: 'completed', metadata: { workspaceId: ws, queueTaskId: 'task-a' },
                            title: 'Topic', conversationTurns: turns } : undefined),
                getWorkspaces: vi.fn().mockResolvedValue([{ id: 'ws-a', name: 'Alpha' }, { id: 'ws-b', name: 'Beta' }]),
            } as unknown as WhatsAppRelayDeps['store'],
            queue: Object.assign(queue, { getTask: () => task }) as WhatsAppRelayDeps['queue'],
            connected: () => connected,
            groupJid: () => 'group@g.us',
            send,
        };
        relay = new WhatsAppAnswerRelay(deps);
    });
    afterEach(() => {
        relay.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('relays only the final assistant answer, quoted to the inbound message', async () => {
        bindings.add(receipt());
        await relay.reconcileTask('task-a');
        expect(send).toHaveBeenCalledExactlyOnceWith('Alpha · Topic\n\nfinal answer', 'inbound');
        expect(bindings.findMessage('answer-id')?.status).toBe('delivered');
        await relay.reconcileTask('task-a');
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('never mirrors unrelated SPA chats or messages from another workspace', async () => {
        await relay.reconcileTask('task-a');
        expect(send).not.toHaveBeenCalled();
        bindings.add(receipt());
        task = { id: 'task-a', repoId: 'ws-b', processId: 'proc-a', status: 'completed' };
        await relay.reconcileTask('task-a');
        expect(send).not.toHaveBeenCalled();
    });

    it('does not redirect pending answers to a different bound group', async () => {
        bindings.add(receipt({ groupJid: 'former@g.us' }));
        await relay.reconnected();
        expect(send).not.toHaveBeenCalled();
    });

    it('waits while disconnected and sends once on reconnect, including after restart', async () => {
        bindings.add(receipt());
        connected = false;
        await relay.reconcileTask('task-a');
        expect(send).not.toHaveBeenCalled();
        relay.dispose();
        const restored = new WhatsAppBindings(dir);
        await restored.restore({ getWorkspaces: async () => [{ id: 'ws-a' }, { id: 'ws-b' }] } as WhatsAppRelayDeps['store']);
        relay = new WhatsAppAnswerRelay({ ...deps, bindings: restored });
        connected = true;
        await relay.reconnected();
        expect(send).toHaveBeenCalledTimes(1);
        relay.dispose();
        const again = new WhatsAppBindings(dir);
        await again.restore({ getWorkspaces: async () => [{ id: 'ws-a' }, { id: 'ws-b' }] } as WhatsAppRelayDeps['store']);
        relay = new WhatsAppAnswerRelay({ ...deps, bindings: again });
        await relay.reconnected();
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('chunks long answers and persists a watermark after each send', async () => {
        turns[2].content = 'word '.repeat(2000);
        send.mockReset().mockResolvedValueOnce('part-one').mockResolvedValueOnce('part-two').mockResolvedValueOnce('part-three');
        bindings.add(receipt());
        await relay.reconcileTask('task-a');
        expect(send.mock.calls.length).toBeGreaterThan(1);
        expect(send.mock.calls.every(call => call[0].length <= 4096 && call[1] === 'inbound')).toBe(true);
        expect(bindings.findMessage('part-two')?.nextPart).toBe(send.mock.calls.length);
        expect(bindings.findMessage('part-two')?.status).toBe('delivered');
    });

    it('renders final-answer tables before chunking without changing stored Markdown', async () => {
        const rows = Array.from({ length: 180 }, (_, i) => `| Item ${i} | Ready | Ada |`);
        const markdown = `Name | Status | Owner\n--- | --- | ---\n${rows.join('\n')}`;
        turns[2].content = markdown;
        bindings.add(receipt());
        await relay.reconcileTask('task-a');
        expect(send.mock.calls.length).toBeGreaterThan(1);
        expect(send.mock.calls.every(call => call[0].length <= 4096 && call[1] === 'inbound')).toBe(true);
        expect(send.mock.calls.map(call => call[0]).join('')).toBe('Alpha · Topic\n\n'
            + rows.map((_, i) => `Name: Item ${i}\nStatus: Ready\nOwner: Ada`).join('\n\n'));
        expect(turns[2].content).toBe(markdown);
        expect(bindings.findMessage('answer-id')?.status).toBe('delivered');
    });

    it('keeps the original header and resumes at the confirmed part after restart', async () => {
        turns[2].content = 'answer '.repeat(1400);
        bindings.add(receipt());
        send.mockReset().mockImplementationOnce(async () => {
            connected = false;
            return 'first-part';
        }).mockResolvedValue('next-part');
        await relay.reconcileTask('task-a');
        expect(bindings.findMessage('first-part')?.nextPart).toBe(1);
        const restored = new WhatsAppBindings(dir);
        await restored.restore({ getWorkspaces: async () => [{ id: 'ws-a' }, { id: 'ws-b' }] } as WhatsAppRelayDeps['store']);
        const workspaces = await deps.store.getWorkspaces();
        const process = await deps.store.getProcess('proc-a', 'ws-a');
        vi.mocked(deps.store.getWorkspaces).mockResolvedValue(
            workspaces.map(ws => ws.id === 'ws-a' ? { ...ws, name: 'Renamed' } : ws));
        vi.mocked(deps.store.getProcess).mockResolvedValue({ ...process!, title: 'Renamed topic' });
        relay.dispose();
        relay = new WhatsAppAnswerRelay({ ...deps, bindings: restored });
        connected = true;
        await relay.reconnected();
        expect(send.mock.calls[0][0]).toContain('Alpha · Topic');
        expect(send.mock.calls).toHaveLength(3);
        expect(restored.findMessage('first-part')?.status).toBe('delivered');
    });

    it('sends a short quoted error on failed turns', async () => {
        bindings.add(receipt());
        task = { id: 'task-a', repoId: 'ws-a', status: 'failed' };
        await relay.reconcileTask('task-a');
        expect(send).toHaveBeenCalledWith(expect.stringContaining('could not be completed'), 'inbound');
    });

    it('quotes the session-limit reset notice for the matching failed request only', async () => {
        bindings.add(receipt());
        task!.status = 'failed';
        turns[2] = { role: 'assistant', content: 'private partial output', interrupted: true,
            interruptionReason: "You've hit your session limit · resets 7:10pm (UTC)" };
        turns.push({ role: 'user', content: 'later request', relayRequestId: 'task-b' },
            { role: 'assistant', content: 'later answer' });
        await relay.reconcileTask('task-a');
        expect(send).toHaveBeenCalledExactlyOnceWith(
            'Alpha · Topic\n\nProvider session limit reached. Resets at 7:10pm (UTC). Send a follow-up after the reset to retry.', 'inbound',
        );
        await relay.reconcileTask('task-a');
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('keeps unrecognized failure details and partial output private', async () => {
        bindings.add(receipt());
        task!.status = 'failed';
        turns[2] = { role: 'assistant', content: 'private partial output', interrupted: true,
            interruptionReason: 'private provider exception' };
        await relay.reconcileTask('task-a');
        expect(send).toHaveBeenCalledExactlyOnceWith('Alpha · Topic\n\nThis request could not be completed.', 'inbound');
    });

    it('does not resend an uncertain part after a send failure or restart', async () => {
        bindings.add(receipt());
        send.mockReset().mockRejectedValueOnce(new Error('connection lost'));
        await expect(relay.reconcileTask('task-a')).rejects.toThrow('connection lost');
        expect(bindings.findMessage('inbound')?.status).toBe('sending');
        await relay.reconnected();
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('retries a definite pre-send disconnect when the bot reconnects', async () => {
        bindings.add(receipt());
        send.mockReset().mockRejectedValueOnce(new WhatsAppNotConnectedError()).mockResolvedValueOnce('after-reconnect');
        await relay.reconcileTask('task-a');
        expect(bindings.findMessage('inbound')?.status).toBe('queued');
        await relay.reconnected();
        expect(bindings.findMessage('after-reconnect')?.status).toBe('delivered');
    });
});
