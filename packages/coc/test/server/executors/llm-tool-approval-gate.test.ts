import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Tool } from '@plusplusoneplusplus/coc-agent-sdk';
import {
    applyLlmToolApprovalGate,
    formatLlmToolApprovalArgs,
    LLM_TOOL_APPROVAL_ARGS_CAP,
    LLM_TOOL_DENIED_MESSAGE,
    type LlmToolApprovalRecord,
} from '../../../src/server/executors/llm-tool-approval-gate';
import { DangerousCommandSessionApprovals } from '../../../src/server/executors/dangerous-command-session-approvals';
import { buildChatToolBundle } from '../../../src/server/executors/chat-tool-builder';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import {
    ASK_USER_LLM_TOOL_APPROVAL_OPTIONS,
    createAskUserTool,
    type AskUserSSEPayload,
} from '../../../src/server/llm-tools/ask-user-tool';

const invocation = { sessionId: 's', toolCallId: 'call-1', toolName: 'send_to_conversation', arguments: {} };

function makeTool(name: string, result: unknown = 'ran'): Tool<any> & { handler: ReturnType<typeof vi.fn> } {
    return { name, description: name, handler: vi.fn(async () => result) } as any;
}

describe('applyLlmToolApprovalGate', () => {
    let approvals: DangerousCommandSessionApprovals;
    let records: LlmToolApprovalRecord[];

    beforeEach(() => {
        approvals = new DangerousCommandSessionApprovals();
        records = [];
    });

    function gate(tools: Tool<any>[], overrides: Partial<Parameters<typeof applyLlmToolApprovalGate>[1]> = {}) {
        return applyLlmToolApprovalGate(tools, {
            processId: 'proc-1',
            approvalRequired: ['send_to_conversation'],
            isInteractive: () => true,
            getAskApproval: () => undefined,
            approvals,
            onDecision: r => records.push(r),
            ...overrides,
        });
    }

    it('returns the same tools untouched when the list is empty', () => {
        const tools = [makeTool('send_to_conversation')];
        const out = gate(tools, { approvalRequired: [] });
        expect(out).toBe(tools);
        expect(out[0].handler).toBe(tools[0].handler);
    });

    it('never wraps ask_user or suggest_follow_ups, even when listed', () => {
        const tools = [makeTool('ask_user'), makeTool('suggest_follow_ups')];
        const out = gate(tools, { approvalRequired: ['ask_user', 'suggest_follow_ups'] });
        expect(out).toBe(tools);
    });

    it('leaves tools that are not listed alone', () => {
        const other = makeTool('search_conversations');
        const out = gate([other, makeTool('send_to_conversation')]);
        expect(out[0]).toBe(other);
        expect(out[1].handler).not.toBe(other.handler);
    });

    it('auto-allows on a non-interactive turn without prompting', async () => {
        const tool = makeTool('send_to_conversation');
        const askApproval = vi.fn();
        const [wrapped] = gate([tool], { isInteractive: () => false, getAskApproval: () => askApproval });
        await expect(wrapped.handler!({ a: 1 }, invocation)).resolves.toBe('ran');
        expect(askApproval).not.toHaveBeenCalled();
        expect(tool.handler).toHaveBeenCalledWith({ a: 1 }, invocation);
        expect(records).toEqual([{ toolName: 'send_to_conversation', toolCallId: 'call-1', outcome: 'auto-allowed' }]);
    });

    it('auto-allows when no approval channel exists', async () => {
        const tool = makeTool('send_to_conversation');
        const [wrapped] = gate([tool]);
        await expect(wrapped.handler!({}, invocation)).resolves.toBe('ran');
        expect(records[0].outcome).toBe('auto-allowed');
    });

    it('approve-once runs the tool and asks again next time', async () => {
        const tool = makeTool('send_to_conversation');
        const askApproval = vi.fn(async () => 'approve-once' as const);
        const [wrapped] = gate([tool], { getAskApproval: () => askApproval });
        await wrapped.handler!({ content: 'hi' }, invocation);
        await wrapped.handler!({ content: 'hi' }, invocation);
        expect(askApproval).toHaveBeenCalledTimes(2);
        expect(tool.handler).toHaveBeenCalledTimes(2);
        expect(askApproval.mock.calls[0][0]).toEqual({
            kind: 'llm-tool',
            toolName: 'send_to_conversation',
            label: 'Send to Conversation',
            argsJson: JSON.stringify({ content: 'hi' }, null, 2),
            argsTruncated: false,
        });
        expect(records.map(r => r.outcome)).toEqual(['approve-once', 'approve-once']);
    });

    it('approve-session runs the tool and skips the prompt for later calls in the same process', async () => {
        const tool = makeTool('send_to_conversation');
        const askApproval = vi.fn(async () => 'approve-session' as const);
        const [wrapped] = gate([tool], { getAskApproval: () => askApproval });
        await wrapped.handler!({}, invocation);
        await wrapped.handler!({}, invocation);
        expect(askApproval).toHaveBeenCalledTimes(1);
        expect(tool.handler).toHaveBeenCalledTimes(2);
        expect(approvals.list('proc-1')).toEqual(['send_to_conversation']);
        expect(records.map(r => r.outcome)).toEqual(['approve-session', 'approve-session']);

        // A different chat process still prompts.
        const [otherProc] = gate([tool], { processId: 'proc-2', getAskApproval: () => askApproval });
        await otherProc.handler!({}, invocation);
        expect(askApproval).toHaveBeenCalledTimes(2);
    });

    it('deny returns an error result and does not run the tool', async () => {
        const tool = makeTool('send_to_conversation');
        const [wrapped] = gate([tool], { getAskApproval: () => async () => 'deny' as const });
        await expect(wrapped.handler!({}, invocation)).resolves.toEqual({
            textResultForLlm: LLM_TOOL_DENIED_MESSAGE,
            resultType: 'denied',
            error: LLM_TOOL_DENIED_MESSAGE,
        });
        expect(tool.handler).not.toHaveBeenCalled();
        expect(records[0].outcome).toBe('deny');
    });

    describe('through the real ask_user approval prompt', () => {
        function setup() {
            const emitted: AskUserSSEPayload[] = [];
            const askUser = createAskUserTool({
                emitQuestions: async (payloads) => { emitted.push(...payloads); },
                computeTurnIndex: () => 3,
            });
            const tool = makeTool('send_to_conversation');
            const [wrapped] = gate([tool], { getAskApproval: () => askUser.askApproval });
            return { emitted, askUser, tool, wrapped };
        }

        it('emits an llm-tool approval question with the tool label and JSON args', async () => {
            const { emitted, askUser, tool, wrapped } = setup();
            const pending = wrapped.handler!({ content: 'hello' }, invocation);
            await vi.waitFor(() => expect(emitted).toHaveLength(1));
            const q = emitted[0];
            expect(q.approval).toMatchObject({ kind: 'llm-tool', toolName: 'send_to_conversation', label: 'Send to Conversation' });
            expect(q.question).toContain('Allow the Send to Conversation tool to run?');
            expect(q.question).toContain('"content": "hello"');
            expect(q.options).toEqual(ASK_USER_LLM_TOOL_APPROVAL_OPTIONS);
            expect(q.defaultValue).toBe('deny');
            askUser.answerQuestion(q.questionId, 'approve-once');
            await expect(pending).resolves.toBe('ran');
            expect(tool.handler).toHaveBeenCalledTimes(1);
        });

        it('skip is treated as deny', async () => {
            const { emitted, askUser, tool, wrapped } = setup();
            const pending = wrapped.handler!({}, invocation);
            await vi.waitFor(() => expect(emitted).toHaveLength(1));
            askUser.skipQuestion(emitted[0].questionId);
            await expect(pending).resolves.toMatchObject({ resultType: 'denied' });
            expect(tool.handler).not.toHaveBeenCalled();
        });

        it('cancel is treated as deny', async () => {
            const { emitted, askUser, tool, wrapped } = setup();
            const pending = wrapped.handler!({}, invocation);
            await vi.waitFor(() => expect(emitted).toHaveLength(1));
            askUser.cancelAll();
            await expect(pending).resolves.toMatchObject({ resultType: 'denied' });
            expect(tool.handler).not.toHaveBeenCalled();
        });
    });
});

describe('formatLlmToolApprovalArgs', () => {
    it('pretty-prints args', () => {
        expect(formatLlmToolApprovalArgs({ a: 1 })).toEqual({ argsJson: '{\n  "a": 1\n}', argsTruncated: false });
    });

    it('caps large args', () => {
        const out = formatLlmToolApprovalArgs({ big: 'x'.repeat(LLM_TOOL_APPROVAL_ARGS_CAP * 2) });
        expect(out.argsTruncated).toBe(true);
        expect(out.argsJson.length).toBe(LLM_TOOL_APPROVAL_ARGS_CAP);
    });
});

describe('buildChatToolBundle approval gate wiring', () => {
    let tmpDir: string;
    const WS = 'ws-gate';

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-tool-gate-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function build(
        isInteractive?: () => boolean,
        emitQuestions = vi.fn(async () => {}),
        onLlmToolApprovalDecision?: (record: LlmToolApprovalRecord) => void,
    ) {
        return buildChatToolBundle({
            onLlmToolApprovalDecision,
            dataDir: tmpDir,
            store: { searchConversations: vi.fn(async () => ({ results: [], total: 0 })), getProcess: vi.fn() } as any,
            workspaceId: WS,
            processId: `proc-${Math.random()}`,
            askUser: {
                enabled: true,
                deps: { emitQuestions, computeTurnIndex: () => 1, ...(isInteractive ? { isInteractive } : {}) },
            },
        });
    }

    it('prompts for a tool listed in the repo preference on an interactive turn', async () => {
        writeRepoPreferences(tmpDir, WS, { disabledLlmTools: [], approvalRequiredLlmTools: ['search_conversations'] });
        const emitQuestions = vi.fn(async () => {});
        const bundle = build(undefined, emitQuestions);
        const tool = bundle.tools.find(t => t.name === 'search_conversations')!;
        const pending = tool.handler!({ query: 'x' }, { ...invocation, toolName: 'search_conversations' });
        await vi.waitFor(() => expect(emitQuestions).toHaveBeenCalledTimes(1));
        const [payload] = emitQuestions.mock.calls[0][0] as AskUserSSEPayload[];
        expect(payload.approval).toMatchObject({ kind: 'llm-tool', toolName: 'search_conversations' });
        bundle.askUser!.answerQuestion(payload.questionId, 'deny');
        await expect(pending).resolves.toMatchObject({ textResultForLlm: LLM_TOOL_DENIED_MESSAGE });
    });

    it('does not prompt on a non-interactive turn', async () => {
        writeRepoPreferences(tmpDir, WS, { disabledLlmTools: [], approvalRequiredLlmTools: ['search_conversations'] });
        const emitQuestions = vi.fn(async () => {});
        const bundle = build(() => false, emitQuestions);
        const tool = bundle.tools.find(t => t.name === 'search_conversations')!;
        await tool.handler!({ query: 'x' }, { ...invocation, toolName: 'search_conversations' });
        expect(emitQuestions).not.toHaveBeenCalled();
    });

    it('reports each gated call to onLlmToolApprovalDecision', async () => {
        writeRepoPreferences(tmpDir, WS, { disabledLlmTools: [], approvalRequiredLlmTools: ['search_conversations'] });
        const records: LlmToolApprovalRecord[] = [];
        const bundle = build(() => false, undefined, r => records.push(r));
        const tool = bundle.tools.find(t => t.name === 'search_conversations')!;
        await tool.handler!({ query: 'x' }, { ...invocation, toolName: 'search_conversations' });
        expect(records).toEqual([{ toolName: 'search_conversations', toolCallId: 'call-1', outcome: 'auto-allowed' }]);
    });

    it('leaves handlers untouched when the repo list is empty', () => {
        writeRepoPreferences(tmpDir, WS, { disabledLlmTools: [] });
        const gated = build();
        writeRepoPreferences(tmpDir, WS, { disabledLlmTools: [], approvalRequiredLlmTools: ['search_conversations'] });
        const wrapped = build();
        const name = (b: typeof gated) => b.tools.find(t => t.name === 'search_conversations')!.handler!.name;
        expect(name(gated)).not.toBe('gatedHandler');
        expect(name(wrapped)).toBe('gatedHandler');
    });
});
