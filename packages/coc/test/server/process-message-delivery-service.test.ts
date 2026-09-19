/**
 * Unit coverage for the extracted follow-up delivery state machine:
 *  - normalizeFollowUpInput: mode / deliveryMode / skills / model / effort behavior.
 *  - deliver: every branch (steered, steering-failed buffer, running/queued buffer,
 *    non-terminal buffer, terminal enqueue, cancelled strict resume, direct execute),
 *    plus enqueue-failure rollback and injected time/ID providers.
 *
 * These run against in-memory fakes — no HTTP stack — so the decision tree can be
 * asserted directly. End-to-end route coverage lives in follow-up-api.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import type { AIProcess, ConversationTurn, PendingMessage } from '@plusplusoneplusplus/forge';
import {
    ProcessMessageDeliveryService,
    normalizeFollowUpInput,
    isIdleForProviderSwitch,
    FollowUpDeliveryError,
    type FollowUpMessageInput,
} from '../../src/server/processes/process-message-delivery-service';
import type { QueueExecutorBridge } from '../../src/server/queue/queue-executor-bridge';

// ============================================================================
// Test doubles
// ============================================================================

interface FakeStore {
    turns: ConversationTurn[];
    pending: PendingMessage[];
    updates: Array<Record<string, unknown>>;
    appendConversationTurn: ReturnType<typeof vi.fn>;
    appendPendingMessage: ReturnType<typeof vi.fn>;
    updateProcess: ReturnType<typeof vi.fn>;
}

function makeStore(initialTurns: ConversationTurn[] = []): FakeStore {
    const store: FakeStore = {
        turns: [...initialTurns],
        pending: [],
        updates: [],
        appendConversationTurn: vi.fn(),
        appendPendingMessage: vi.fn(),
        updateProcess: vi.fn(),
    };
    store.appendConversationTurn.mockImplementation(async (_id: string, makeTurn: (i: number) => ConversationTurn) => {
        const turn = makeTurn(store.turns.length);
        store.turns.push(turn);
        return { turn, allTurns: [...store.turns] };
    });
    store.appendPendingMessage.mockImplementation(async (_id: string, message: PendingMessage) => {
        store.pending.push(message);
        return [...store.pending];
    });
    store.updateProcess.mockImplementation(async (_id: string, updates: Record<string, unknown>) => {
        store.updates.push(updates);
    });
    return store;
}

function makeProc(overrides: Partial<AIProcess> = {}): AIProcess {
    return {
        id: 'proc-1',
        type: 'clarification',
        promptPreview: 'p',
        fullPrompt: 'p',
        status: 'completed',
        startTime: new Date(),
        conversationTurns: [],
        ...overrides,
    } as AIProcess;
}

function makeInput(overrides: Partial<FollowUpMessageInput> = {}): FollowUpMessageInput {
    return {
        content: 'hello',
        displayContent: 'hello',
        deliveryMode: 'enqueue',
        pasteExternalized: false,
        ...overrides,
    };
}

function makeService(store: FakeStore, bridge: Partial<QueueExecutorBridge>, opts: { now?: () => Date; newId?: () => string } = {}) {
    return new ProcessMessageDeliveryService({
        store: store as never,
        bridge: bridge as QueueExecutorBridge,
        ...opts,
    });
}

// ============================================================================
// normalizeFollowUpInput
// ============================================================================

describe('normalizeFollowUpInput', () => {
    describe('mode', () => {
        it('normalizes legacy plan to ask', () => {
            const r = normalizeFollowUpInput({ mode: 'plan' }, 'copilot');
            expect(r.ok && r.value.mode).toBe('ask');
        });
        it('drops ralph as a per-turn mode override', () => {
            const r = normalizeFollowUpInput({ mode: 'ralph' }, 'copilot');
            expect(r.ok && r.value.mode).toBeUndefined();
        });
        it('passes through autopilot', () => {
            const r = normalizeFollowUpInput({ mode: 'autopilot' }, 'copilot');
            expect(r.ok && r.value.mode).toBe('autopilot');
        });
        it('drops unknown mode values', () => {
            const r = normalizeFollowUpInput({ mode: 'nonsense' }, 'copilot');
            expect(r.ok && r.value.mode).toBeUndefined();
        });
    });

    describe('deliveryMode', () => {
        it('defaults to enqueue when absent', () => {
            const r = normalizeFollowUpInput({}, 'copilot');
            expect(r.ok && r.value.deliveryMode).toBe('enqueue');
        });
        it('accepts immediate', () => {
            const r = normalizeFollowUpInput({ deliveryMode: 'immediate' }, 'copilot');
            expect(r.ok && r.value.deliveryMode).toBe('immediate');
        });
        it('rejects an invalid deliveryMode', () => {
            const r = normalizeFollowUpInput({ deliveryMode: 'whenever' }, 'copilot');
            expect(r.ok).toBe(false);
            expect(!r.ok && r.error).toMatch(/Invalid deliveryMode/);
        });
        it('rejects a non-string deliveryMode', () => {
            const r = normalizeFollowUpInput({ deliveryMode: 5 }, 'copilot');
            expect(r.ok).toBe(false);
        });
    });

    describe('selectedSkillNames', () => {
        it('dedupes and drops empty entries', () => {
            const r = normalizeFollowUpInput({ skillNames: ['impl', 'impl', '  ', 'review'] }, 'copilot');
            expect(r.ok && r.value.selectedSkillNames).toEqual(['impl', 'review']);
        });
        it('is undefined when not provided', () => {
            const r = normalizeFollowUpInput({}, 'copilot');
            expect(r.ok && r.value.selectedSkillNames).toBeUndefined();
        });
        it('is an empty array when given an empty array', () => {
            const r = normalizeFollowUpInput({ skillNames: [] }, 'copilot');
            expect(r.ok && r.value.selectedSkillNames).toEqual([]);
        });
    });

    describe('model override', () => {
        it('keeps a valid model for the provider', () => {
            const r = normalizeFollowUpInput({ model: 'claude-sonnet-4-6' }, 'claude');
            expect(r.ok && r.value.model).toBe('claude-sonnet-4-6');
            expect(r.ok && r.value.modelCoerced).toBe(false);
        });
        it('coerces an invalid model and reports the requested value', () => {
            const r = normalizeFollowUpInput({ model: 'claude-opus' }, 'codex');
            expect(r.ok && r.value.model).toBeUndefined();
            expect(r.ok && r.value.modelCoerced).toBe(true);
            expect(r.ok && r.value.requestedModel).toBe('claude-opus');
        });
        it('ignores blank model strings', () => {
            const r = normalizeFollowUpInput({ model: '   ' }, 'copilot');
            expect(r.ok && r.value.model).toBeUndefined();
            expect(r.ok && r.value.modelCoerced).toBe(false);
        });
    });

    describe('reasoningEffort', () => {
        it('accepts a valid effort', () => {
            const r = normalizeFollowUpInput({ reasoningEffort: 'high' }, 'copilot');
            expect(r.ok && r.value.effort).toBe('high');
        });
        it('drops an unknown effort', () => {
            const r = normalizeFollowUpInput({ reasoningEffort: 'ultra' }, 'copilot');
            expect(r.ok && r.value.effort).toBeUndefined();
        });
    });

    describe('chatStyle', () => {
        it('treats an omitted style as default', () => {
            const r = normalizeFollowUpInput({}, 'copilot');
            expect(r.ok && r.value.chatStyle).toBe('default');
        });
        it('treats an explicit null as default', () => {
            const r = normalizeFollowUpInput({ chatStyle: null }, 'copilot');
            expect(r.ok && r.value.chatStyle).toBe('default');
        });
        it('keeps every stable value', () => {
            for (const style of ['default', 'human', 'direct', 'terse', 'structured']) {
                const r = normalizeFollowUpInput({ chatStyle: style }, 'copilot');
                expect(r.ok && r.value.chatStyle).toBe(style);
            }
        });
        it('rejects an unknown style instead of dropping it', () => {
            const r = normalizeFollowUpInput({ chatStyle: 'concise' }, 'copilot');
            expect(r.ok).toBe(false);
            expect(!r.ok && r.error).toContain('Invalid chatStyle');
        });
        it('rejects a non-string style', () => {
            const r = normalizeFollowUpInput({ chatStyle: 7 }, 'copilot');
            expect(r.ok).toBe(false);
        });
        it('falls back to the caller-supplied server default when the style is omitted', () => {
            const r = normalizeFollowUpInput({}, 'copilot', 'direct');
            expect(r.ok && r.value.chatStyle).toBe('direct');
        });
        it('falls back to the server default for an explicit null too', () => {
            const r = normalizeFollowUpInput({ chatStyle: null }, 'copilot', 'structured');
            expect(r.ok && r.value.chatStyle).toBe('structured');
        });
        it("lets an explicit 'default' beat the server default", () => {
            const r = normalizeFollowUpInput({ chatStyle: 'default' }, 'copilot', 'direct');
            expect(r.ok && r.value.chatStyle).toBe('default');
        });
        it('still rejects an unknown style when a server default is configured', () => {
            const r = normalizeFollowUpInput({ chatStyle: 'concise' }, 'copilot', 'direct');
            expect(r.ok).toBe(false);
        });
    });

    describe('requested provider', () => {
        it('leaves the provider unset when the body omits it (pre-switching clients)', () => {
            const r = normalizeFollowUpInput({}, 'copilot');
            expect(r.ok && r.value.requestedProvider).toBeUndefined();
            expect(r.ok && r.value.isProviderSwitch).toBe(false);
        });
        it('treats an explicit null like an omitted provider', () => {
            const r = normalizeFollowUpInput({ provider: null }, 'copilot');
            expect(r.ok && r.value.requestedProvider).toBeUndefined();
            expect(r.ok && r.value.isProviderSwitch).toBe(false);
        });
        it('accepts every concrete provider', () => {
            for (const provider of ['copilot', 'codex', 'claude', 'opencode'] as const) {
                const r = normalizeFollowUpInput({ provider }, 'copilot');
                expect(r.ok && r.value.requestedProvider).toBe(provider);
            }
        });
        it('does not flag a switch when the requested provider is the active one', () => {
            const r = normalizeFollowUpInput({ provider: 'codex' }, 'codex');
            expect(r.ok && r.value.requestedProvider).toBe('codex');
            expect(r.ok && r.value.isProviderSwitch).toBe(false);
        });
        it('flags a switch when the requested provider differs', () => {
            const r = normalizeFollowUpInput({ provider: 'codex' }, 'copilot');
            expect(r.ok && r.value.isProviderSwitch).toBe(true);
        });
        it('rejects auto with INVALID_PROVIDER rather than resolving it', () => {
            const r = normalizeFollowUpInput({ provider: 'auto' }, 'copilot');
            expect(r.ok).toBe(false);
            expect(!r.ok && r.code).toBe('INVALID_PROVIDER');
        });
        it('rejects an unknown provider', () => {
            const r = normalizeFollowUpInput({ provider: 'gemini' }, 'copilot');
            expect(r.ok).toBe(false);
            expect(!r.ok && r.code).toBe('INVALID_PROVIDER');
        });
        it('rejects a non-string provider', () => {
            const r = normalizeFollowUpInput({ provider: 3 }, 'copilot');
            expect(r.ok).toBe(false);
            expect(!r.ok && r.code).toBe('INVALID_PROVIDER');
        });
        it('validates the model against the requested provider, not the active one', () => {
            // Valid for the active provider, meaningless to the target: it must
            // be dropped rather than sent to the wrong provider.
            const r = normalizeFollowUpInput({ provider: 'codex', model: 'claude-sonnet-4-6' }, 'claude');
            expect(r.ok && r.value.model).toBeUndefined();
            expect(r.ok && r.value.modelCoerced).toBe(true);
            expect(r.ok && r.value.requestedModel).toBe('claude-sonnet-4-6');
        });
        it('keeps a model that is valid for the requested provider', () => {
            const r = normalizeFollowUpInput({ provider: 'claude', model: 'claude-sonnet-4-6' }, 'copilot');
            expect(r.ok && r.value.model).toBe('claude-sonnet-4-6');
            expect(r.ok && r.value.modelCoerced).toBe(false);
        });
    });

    describe('optimisticId', () => {
        it('keeps a string optimisticId', () => {
            const r = normalizeFollowUpInput({ optimisticId: 'opt-1' }, 'copilot');
            expect(r.ok && r.value.optimisticId).toBe('opt-1');
        });
        it('drops a non-string optimisticId', () => {
            const r = normalizeFollowUpInput({ optimisticId: 99 }, 'copilot');
            expect(r.ok && r.value.optimisticId).toBeUndefined();
        });
    });
});

// ============================================================================
// ProcessMessageDeliveryService.deliver
// ============================================================================

describe('ProcessMessageDeliveryService.deliver', () => {
    it('steers immediately when a running parent task accepts steering', async () => {
        const store = makeStore();
        const steerProcess = vi.fn().mockResolvedValue(true);
        const bridge = {
            enqueue: vi.fn(),
            findTaskByProcessId: vi.fn().mockReturnValue({ id: 't1', type: 'chat', status: 'running' }),
            steerProcess,
        };
        const service = makeService(store, bridge);

        const result = await service.deliver(makeProc({ status: 'running' }), makeInput({ deliveryMode: 'immediate', optimisticId: 'opt-1' }));

        expect(result.path).toBe('steered');
        expect(steerProcess).toHaveBeenCalledWith('proc-1', 'hello');
        expect(bridge.enqueue).not.toHaveBeenCalled();
        expect(store.appendPendingMessage).not.toHaveBeenCalled();
        // A user turn is appended (not buffered), and both queued + steering events fire.
        expect(store.appendConversationTurn).toHaveBeenCalledOnce();
        expect(result.turnIndex).toBe(0);
        expect(result.events.map(e => e.kind)).toEqual(['message-queued', 'message-steering']);
    });

    it('buffers when steering fails for an immediate delivery', async () => {
        const store = makeStore();
        const bridge = {
            enqueue: vi.fn(),
            findTaskByProcessId: vi.fn().mockReturnValue({ id: 't1', type: 'chat', status: 'running' }),
            steerProcess: vi.fn().mockResolvedValue(false),
        };
        const service = makeService(store, bridge);

        const result = await service.deliver(makeProc({ status: 'running' }), makeInput({ deliveryMode: 'immediate' }));

        expect(result.path).toBe('buffered');
        expect(store.appendPendingMessage).toHaveBeenCalledOnce();
        expect(bridge.enqueue).not.toHaveBeenCalled();
        expect(store.appendConversationTurn).not.toHaveBeenCalled();
        expect(result.turnIndex).toBe(-1);
        expect(result.events.map(e => e.kind)).toEqual(['pending-message-added', 'message-queued']);
    });

    it('buffers when the parent task is running with enqueue delivery', async () => {
        const store = makeStore();
        const bridge = {
            enqueue: vi.fn(),
            findTaskByProcessId: vi.fn().mockReturnValue({ id: 't1', type: 'chat', status: 'running' }),
            steerProcess: vi.fn(),
        };
        const service = makeService(store, bridge);

        const result = await service.deliver(makeProc({ status: 'running' }), makeInput({ deliveryMode: 'enqueue' }));

        expect(result.path).toBe('buffered');
        expect(store.appendPendingMessage).toHaveBeenCalledOnce();
        expect(bridge.enqueue).not.toHaveBeenCalled();
    });

    it('buffers when the parent task is queued', async () => {
        const store = makeStore();
        const bridge = {
            enqueue: vi.fn(),
            findTaskByProcessId: vi.fn().mockReturnValue({ id: 't1', type: 'chat', status: 'queued' }),
        };
        const service = makeService(store, bridge);

        const result = await service.deliver(makeProc({ status: 'queued' }), makeInput());
        expect(result.path).toBe('buffered');
        expect(store.appendPendingMessage).toHaveBeenCalledOnce();
    });

    it('buffers when no parent task is found but the process is non-terminal', async () => {
        const store = makeStore();
        const bridge = { enqueue: vi.fn() }; // no findTaskByProcessId
        const service = makeService(store, bridge);

        const result = await service.deliver(makeProc({ status: 'running' }), makeInput());
        expect(result.path).toBe('buffered');
        expect(bridge.enqueue).not.toHaveBeenCalled();
    });

    it('enqueues a fresh task when terminal and no parent task exists', async () => {
        const store = makeStore();
        const bridge = { enqueue: vi.fn().mockResolvedValue('task-id') };
        const service = makeService(store, bridge);

        const proc = makeProc({ status: 'failed', workingDirectory: '/repo', metadata: { workspaceId: 'ws-9' } });
        const result = await service.deliver(proc, makeInput({
            content: 'retry',
            contentWithContext: 'retry [ctx]',
            selectedSkillNames: ['impl'],
            mode: 'ask',
            model: 'gpt-5',
            effort: 'high',
        }));

        expect(result.path).toBe('enqueued');
        expect(bridge.enqueue).toHaveBeenCalledOnce();
        const call = bridge.enqueue.mock.calls[0][0];
        expect(call.type).toBe('chat');
        expect(call.payload.prompt).toBe('retry [ctx]'); // contentWithContext preferred
        expect(call.payload.processId).toBe('proc-1');
        expect(call.payload.workspaceId).toBe('ws-9');
        expect(call.payload.workingDirectory).toBe('/repo');
        expect(call.payload.context).toEqual({ skills: ['impl'] });
        expect(call.payload.mode).toBe('ask');
        expect(call.payload.model).toBe('gpt-5');
        expect(call.payload.reasoningEffort).toBe('high');
        expect(call.config).toEqual({ reasoningEffort: 'high' });
        // A user turn is appended and status flips to running.
        expect(store.appendConversationTurn).toHaveBeenCalledOnce();
        expect(result.turnIndex).toBe(0);
        expect(result.events.map(e => e.kind)).toEqual(['message-queued']);
    });

    it('carries the accepted provider into the enqueue payload', async () => {
        const store = makeStore();
        const bridge = { enqueue: vi.fn().mockResolvedValue('task-id') };
        const service = makeService(store, bridge);

        await service.deliver(
            makeProc({ status: 'completed', metadata: { provider: 'copilot' } }),
            makeInput({ provider: 'codex' }),
        );

        expect(bridge.enqueue.mock.calls[0][0].payload.provider).toBe('codex');
    });

    it('omits provider from the enqueue payload when the input carries none', async () => {
        const store = makeStore();
        const bridge = { enqueue: vi.fn().mockResolvedValue('task-id') };
        const service = makeService(store, bridge);

        await service.deliver(makeProc({ status: 'completed' }), makeInput({}));

        expect(bridge.enqueue.mock.calls[0][0].payload.provider).toBeUndefined();
    });

    it('records the accepted provider on the persisted user turn', async () => {
        const store = makeStore();
        const bridge = { enqueue: vi.fn().mockResolvedValue('task-id') };
        const service = makeService(store, bridge);

        await service.deliver(
            makeProc({ status: 'completed', metadata: { provider: 'copilot' } }),
            makeInput({ provider: 'codex' }),
        );

        const turn = store.appendConversationTurn.mock.calls[0][1](0);
        expect(turn.provider).toBe('codex');
    });

    it('leaves the user turn unattributed when the input carries no provider', async () => {
        const store = makeStore();
        const bridge = { enqueue: vi.fn().mockResolvedValue('task-id') };
        const service = makeService(store, bridge);

        await service.deliver(makeProc({ status: 'completed' }), makeInput({}));

        const turn = store.appendConversationTurn.mock.calls[0][1](0);
        expect(turn.provider).toBeUndefined();
    });

    it('records the active segment on a same-provider user turn', async () => {
        const store = makeStore();
        const bridge = { enqueue: vi.fn().mockResolvedValue('task-id') };
        const service = makeService(store, bridge);

        await service.deliver(
            makeProc({
                status: 'completed',
                activeProviderSession: {
                    provider: 'copilot',
                    sessionId: 'copilot-1',
                    segmentId: 'seg-copilot-1',
                    firstTurnIndex: 0,
                },
            }),
            makeInput({ provider: 'copilot' }),
        );

        const turn = store.appendConversationTurn.mock.calls[0][1](0);
        expect(turn.segmentId).toBe('seg-copilot-1');
    });

    it('leaves a cross-provider user turn without a segment until the target binds one', async () => {
        const store = makeStore();
        const bridge = { enqueue: vi.fn().mockResolvedValue('task-id') };
        const service = makeService(store, bridge);

        await service.deliver(
            makeProc({
                status: 'completed',
                activeProviderSession: {
                    provider: 'copilot',
                    sessionId: 'copilot-1',
                    segmentId: 'seg-copilot-1',
                    firstTurnIndex: 0,
                },
            }),
            makeInput({ provider: 'codex' }),
        );

        const turn = store.appendConversationTurn.mock.calls[0][1](0);
        expect(turn.provider).toBe('codex');
        expect(turn.segmentId).toBeUndefined();
    });

    it('records the accepted provider on a buffered pending message', async () => {
        const store = makeStore();
        const bridge = {
            enqueue: vi.fn(),
            findTaskByProcessId: vi.fn().mockReturnValue({ id: 't1', type: 'chat', status: 'running' }),
            steerProcess: vi.fn(),
        };
        const service = makeService(store, bridge);

        await service.deliver(
            makeProc({ status: 'running' }),
            makeInput({ deliveryMode: 'enqueue', provider: 'claude' }),
        );

        expect(store.appendPendingMessage.mock.calls[0][1].provider).toBe('claude');
    });

    it('carries resumeSessionId into the enqueue payload for a cancelled strict resume', async () => {
        const store = makeStore();
        const bridge = { enqueue: vi.fn().mockResolvedValue('task-id') };
        const service = makeService(store, bridge);

        const proc = makeProc({ status: 'cancelled', sdkSessionId: 'sess-x' });
        await service.deliver(proc, makeInput({ resumeSessionId: 'sess-x' }));

        const call = bridge.enqueue.mock.calls[0][0];
        expect(call.payload.resumeSessionId).toBe('sess-x');
    });

    it('falls back to executeFollowUp when the bridge has no enqueue', async () => {
        const store = makeStore();
        const executeFollowUp = vi.fn().mockResolvedValue(undefined);
        const bridge = { executeFollowUp };
        const service = makeService(store, bridge);

        const result = await service.deliver(makeProc({ status: 'completed' }), makeInput({ content: 'go' }));

        expect(result.path).toBe('direct-executed');
        expect(executeFollowUp).toHaveBeenCalledOnce();
        expect(executeFollowUp.mock.calls[0][0]).toBe('proc-1');
        expect(executeFollowUp.mock.calls[0][1]).toBe('go');
        expect(store.appendConversationTurn).toHaveBeenCalledOnce();
        expect(result.turnIndex).toBe(0);
    });

    it('rolls back status and throws FollowUpDeliveryError when enqueue fails', async () => {
        const store = makeStore();
        const bridge = { enqueue: vi.fn().mockRejectedValue(new Error('queue full')) };
        const service = makeService(store, bridge);

        await expect(
            service.deliver(makeProc({ status: 'failed' }), makeInput()),
        ).rejects.toBeInstanceOf(FollowUpDeliveryError);

        // Status rolled back to the prior status; no turn appended.
        expect(store.updateProcess).toHaveBeenCalledWith('proc-1', { status: 'failed' });
        expect(store.appendConversationTurn).not.toHaveBeenCalled();
    });

    it('uses injected time and ID providers for the buffered pending message', async () => {
        const store = makeStore();
        const bridge = {
            enqueue: vi.fn(),
            findTaskByProcessId: vi.fn().mockReturnValue({ id: 't1', type: 'chat', status: 'running' }),
        };
        const fixedDate = new Date('2026-01-02T03:04:05.000Z');
        const service = makeService(store, bridge, { now: () => fixedDate, newId: () => 'fixed-id' });

        await service.deliver(makeProc({ status: 'running' }), makeInput({
            content: 'buffered',
            displayContent: 'buffered',
            model: 'gpt-5',
            effort: 'low',
            mode: 'autopilot',
        }));

        const pending = store.pending[0] as PendingMessage & { reasoningEffort?: string };
        expect(pending.id).toBe('fixed-id');
        expect(pending.createdAt).toBe('2026-01-02T03:04:05.000Z');
        expect(pending.content).toBe('buffered');
        expect(pending.model).toBe('gpt-5');
        expect(pending.reasoningEffort).toBe('low');
        expect(pending.mode).toBe('autopilot');
    });
});

// ============================================================================
// isIdleForProviderSwitch
// ============================================================================

describe('isIdleForProviderSwitch', () => {
    it('is idle for a completed process with no owning task', () => {
        expect(isIdleForProviderSwitch({ status: 'completed' })).toBe(true);
    });
    it('is idle for a cancelled (stopped) process so it can continue elsewhere', () => {
        expect(isIdleForProviderSwitch({ status: 'cancelled' })).toBe(true);
    });
    it('is idle for a failed process so a retry can switch providers', () => {
        expect(isIdleForProviderSwitch({ status: 'failed' })).toBe(true);
    });
    it('is busy while the owning task runs', () => {
        expect(isIdleForProviderSwitch({ status: 'completed' }, 'running')).toBe(false);
    });
    it('is busy while the owning task is queued', () => {
        expect(isIdleForProviderSwitch({ status: 'completed' }, 'queued')).toBe(false);
    });
    it('is idle once the owning task reached a terminal status', () => {
        expect(isIdleForProviderSwitch({ status: 'completed' }, 'completed')).toBe(true);
    });
    it('falls back to a non-terminal process status when the task is gone', () => {
        for (const status of ['queued', 'running', 'cancelling', 'created']) {
            expect(isIdleForProviderSwitch({ status })).toBe(false);
        }
    });
    it('is busy while an ask_user batch is waiting for an answer', () => {
        expect(isIdleForProviderSwitch({
            status: 'completed',
            pendingAskUser: [{ question: 'which one?' }],
        })).toBe(false);
    });
    it('ignores an empty pendingAskUser list', () => {
        expect(isIdleForProviderSwitch({ status: 'completed', pendingAskUser: [] })).toBe(true);
    });
});
