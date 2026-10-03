import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboundWAMessage } from '@plusplusoneplusplus/coc-connector/whatsapp';
import { WhatsAppBindings } from '../../../src/server/messaging/whatsapp-bindings';
import { WhatsAppCommandRouter, type WhatsAppRouterDeps } from '../../../src/server/messaging/whatsapp-command-router';
import { createWhatsAppQuestionTransport } from '../../../src/server/messaging/whatsapp-answer-relay';
import { WhatsAppNotConnectedError } from '../../../src/server/messaging/whatsapp-messaging-manager';
import { AskUserQuestionRelayHub, QUESTION_RELAY_TEXT } from '../../../src/server/messaging/ask-user-relay';
import { createAskUserTool, type AskUserQuestion, type AskUserResponse } from '../../../src/server/llm-tools/ask-user-tool';
import { getRepoDataPath } from '../../../src/server/paths';
import { TaskQueueManager } from '@plusplusoneplusplus/forge';

describe('WhatsApp ask_user question relay', () => {
    let dir: string;
    let bindings: WhatsAppBindings;
    let send: ReturnType<typeof vi.fn>;
    let react: ReturnType<typeof vi.fn>;
    let enqueue: ReturnType<typeof vi.fn>;
    let connected: boolean;
    let hub: AskUserQuestionRelayHub;
    let router: WhatsAppCommandRouter;
    let sent = 0;
    const store = {
        getWorkspaces: vi.fn().mockResolvedValue([{ id: 'ws-a', name: 'Alpha' }]),
        getAllProcesses: vi.fn().mockResolvedValue([]),
        getProcess: vi.fn().mockResolvedValue(undefined),
        updateProcess: vi.fn().mockResolvedValue(undefined),
    };
    const inbound = (text: string, messageId: string, quotedMessageId?: string): InboundWAMessage => ({
        chatJid: 'group@g.us', senderJid: 'group@g.us', fromMe: true, messageId, text,
        ...(quotedMessageId ? { quotedMessageId } : {}),
    });

    function makeHub() {
        const next = new AskUserQuestionRelayHub({ store: store as any });
        next.register(createWhatsAppQuestionTransport({
            bindings, connected: () => connected, groupJid: () => 'group@g.us', send,
        }));
        return next;
    }

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-question-relay-'));
        bindings = new WhatsAppBindings(dir);
        await bindings.restore(store);
        bindings.selectRepo('ws-a');
        connected = true;
        sent = 0;
        send = vi.fn(async () => `sent-${++sent}`);
        react = vi.fn().mockResolvedValue(undefined);
        const queue = new TaskQueueManager();
        enqueue = vi.fn(async (workspaceId, prompt, mode, processId, id) => queue.enqueue({
            id, repoId: workspaceId, processId, type: 'chat', priority: 'normal', config: {},
            payload: { kind: 'chat', workspaceId, prompt, mode: mode ?? 'ask', relayRequestId: id },
        }).id);
        hub = makeHub();
        router = new WhatsAppCommandRouter({
            store: store as unknown as WhatsAppRouterDeps['store'], bindings, groupJid: () => 'group@g.us',
            enqueue, getTask: id => queue.getTask(id), send, react, questions: hub,
        });
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    /** Start a WhatsApp request, then have its turn call ask_user. */
    async function askFromRequest(questions: AskUserQuestion[], mode: 'ask' | 'autopilot' = 'ask') {
        await router.handle(inbound('please help', 'request'));
        const [, , , processId, taskId] = enqueue.mock.calls.at(-1)!;
        const emitted: string[] = [];
        const tool = createAskUserTool({
            computeTurnIndex: () => 1,
            emitQuestions: (payloads, control) => {
                emitted.push(...payloads.map(p => p.questionId));
                // Mirrors the executor: only Ask turns carry a relay request id.
                if (mode === 'ask') hub.relay({ processId, requestId: taskId, questions: payloads.filter(p => !p.approval), control });
            },
        });
        const result = (tool.tool.handler as (a: { questions: AskUserQuestion[] }) => Promise<AskUserResponse[]>)({ questions });
        return { tool, result, processId, emitted };
    }

    it('posts the question quoted under the original request and takes a quote-reply as the answer', async () => {
        const { result } = await askFromRequest([{
            question: 'Which database?', type: 'select',
            options: [{ value: 'pg', label: 'Postgres' }, { value: 'lite', label: 'SQLite' }],
        }]);
        await vi.waitFor(() => expect(send).toHaveBeenCalledWith(
            '*Which database?*\n1. Postgres\n2. SQLite\n\nReply: 1-2 or "skip"', 'request'));
        await vi.waitFor(() => expect(hub.pendingCount()).toBe(1));
        expect(bindings.isKnownMessage('sent-1')).toBe(true);
        const receipts = JSON.parse(fs.readFileSync(getRepoDataPath(dir, 'ws-a', 'whatsapp-bindings.json'), 'utf8'));
        expect(receipts[0].questionIds).toEqual(['sent-1']);

        await router.handle(inbound('sqlite', 'answer', 'sent-1'));
        expect((await result)[0].answer).toBe('lite');
        expect(react).toHaveBeenCalledWith('answer');
        expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it.each(['releasing', 'released'] as const)('does not answer a pending question after its binding is %s', async releaseState => {
        const { result } = await askFromRequest([{ question: 'Proceed?', type: 'yes-no' }]);
        await vi.waitFor(() => expect(hub.pendingCount()).toBe(1));
        const binding = bindings.entries()[0];
        binding.releaseState = releaseState;
        bindings.update(binding);
        await router.handle(inbound('yes', 'after-release', 'sent-1'));
        expect((await result)[0]).toMatchObject({ skipped: true, reason: 'unavailable' });
        expect(react).not.toHaveBeenCalledWith('after-release');
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenLastCalledWith(QUESTION_RELAY_TEXT.inactive, 'after-release');
    });

    it('sends a batch sequentially and accepts a plain message while exactly one question is pending', async () => {
        const { result } = await askFromRequest([
            { question: 'Proceed?', type: 'yes-no' },
            { question: 'Name?', type: 'text' },
        ]);
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(hub.pendingCount()).toBe(1));
        expect(send.mock.calls[0][0]).toBe('(Question 1 of 2)\n*Proceed?*\n\nReply: yes / no or "skip"');
        await router.handle(inbound('y', 'a1'));
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
        await vi.waitFor(() => expect(hub.pendingCount()).toBe(1));
        expect(send.mock.calls[1]).toEqual(['(Question 2 of 2)\n*Name?*\n\nReply: your answer or "skip"', 'request']);
        await router.handle(inbound('widget', 'a2'));
        expect((await result).map(r => r.answer)).toEqual([true, 'widget']);
        expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it('routes a plain message as a new request when no question is pending', async () => {
        await router.handle(inbound('first', 'request'));
        await router.handle(inbound('second', 'next'));
        expect(enqueue).toHaveBeenCalledTimes(2);
    });

    it('rejects invalid input with the hint and keeps the question pending', async () => {
        const { tool } = await askFromRequest([{ question: 'Proceed?', type: 'confirm' }]);
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(hub.pendingCount()).toBe(1));
        await router.handle(inbound('later', 'bad', 'sent-1'));
        expect(send).toHaveBeenLastCalledWith('Please reply yes or no.\nReply: yes / no or "skip"', 'bad');
        expect(tool.hasPending()).toBe(true);
        tool.cancelAll();
    });

    it('replies "already answered" when the dashboard answered first', async () => {
        const { tool, result, emitted } = await askFromRequest([{ question: 'Proceed?', type: 'yes-no' }]);
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(hub.pendingCount()).toBe(1));
        expect(tool.answerQuestions([{ questionId: emitted[0], answer: false }])).toBe(true);
        expect((await result)[0].answer).toBe(false);
        await router.handle(inbound('yes', 'late', 'sent-1'));
        expect(send).toHaveBeenLastCalledWith(QUESTION_RELAY_TEXT.alreadyAnswered, 'late');
        expect(react).not.toHaveBeenCalledWith('late');
        expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it('resolves as unavailable when the connector is disconnected', async () => {
        connected = false;
        const { result } = await askFromRequest([{ question: 'Proceed?', type: 'yes-no' }]);
        expect((await result)[0]).toMatchObject({ skipped: true, reason: 'unavailable' });
        expect(send).toHaveBeenCalledTimes(0);
    });

    it('resolves as unavailable when the send throws', async () => {
        await router.handle(inbound('please help', 'request'));
        send.mockRejectedValueOnce(new WhatsAppNotConnectedError());
        const [, , , processId, taskId] = enqueue.mock.calls[0];
        const tool = createAskUserTool({
            computeTurnIndex: () => 1,
            emitQuestions: (payloads, control) => { hub.relay({ processId, requestId: taskId, questions: payloads, control }); },
        });
        const [response] = await (tool.tool.handler as any)({ questions: [{ question: 'Q?', type: 'text' }] });
        expect(response).toMatchObject({ reason: 'unavailable' });
    });

    it('does not relay an autopilot turn', async () => {
        const { tool } = await askFromRequest([{ question: 'Proceed?', type: 'yes-no' }], 'autopilot');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(send).toHaveBeenCalledTimes(0);
        expect(tool.hasPending()).toBe(true);
        tool.cancelAll();
    });

    it('does not relay approval prompts', async () => {
        await router.handle(inbound('please help', 'request'));
        const [, , , processId, taskId] = enqueue.mock.calls[0];
        const tool = createAskUserTool({
            computeTurnIndex: () => 1,
            emitQuestions: (payloads, control) => {
                const questions = payloads.filter(p => !p.approval);
                if (questions.length) hub.relay({ processId, requestId: taskId, questions, control });
            },
        });
        const decision = tool.askApproval({ kind: 'dangerous-command', command: 'rm -rf /', ruleId: 'r', description: 'd', matchedSegment: 'rm' });
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(send).not.toHaveBeenCalled();
        tool.cancelAll();
        expect(await decision).toBe('deny');
    });

    it('clears pending questions on cancel; a late quote-reply gets "no longer active", even after restart', async () => {
        const { tool, result } = await askFromRequest([{ question: 'Name?', type: 'text' }]);
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(hub.pendingCount()).toBe(1));
        tool.cancelAll();
        expect((await result)[0].reason).toBe('cancelled');
        await router.handle(inbound('too late', 'late', 'sent-1'));
        expect(send).toHaveBeenLastCalledWith(QUESTION_RELAY_TEXT.inactive, 'late');
        expect(enqueue).toHaveBeenCalledTimes(1);

        const restoredBindings = new WhatsAppBindings(dir);
        await restoredBindings.restore(store);
        bindings = restoredBindings;
        const restartedHub = makeHub();
        const restarted = new WhatsAppCommandRouter({
            store: store as unknown as WhatsAppRouterDeps['store'], bindings: restoredBindings,
            groupJid: () => 'group@g.us', enqueue, send, react, questions: restartedHub,
        });
        await restarted.handle(inbound('too late again', 'late-2', 'sent-1'));
        expect(send).toHaveBeenLastCalledWith(QUESTION_RELAY_TEXT.inactive, 'late-2');
        expect(enqueue).toHaveBeenCalledTimes(1);
    });
});
