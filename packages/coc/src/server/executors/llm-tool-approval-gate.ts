/**
 * Opt-in approval gate for CoC's own LLM tools.
 *
 * A user can mark individual tools "Require approval" per repo
 * (`approvalRequiredLlmTools`). This module wraps those tools' handlers so a
 * call is held until the user answers through the turn's `ask_user` approval
 * prompt. It sits at the CoC tool-handler layer, not on any provider's
 * permission hooks, so Copilot, Claude, and Codex chats behave the same.
 *
 * An empty list returns the tools untouched — no wrapper, no extra latency.
 */

import type { Tool, ToolInvocation, ToolResultObject } from '@plusplusoneplusplus/coc-agent-sdk';
import type { ToolCallApprovalOutcome } from '@plusplusoneplusplus/forge';
import type { AskUserApprovalDecision, AskUserLlmToolApproval } from '../llm-tools/ask-user-tool';
import { LLM_TOOL_REGISTRY, isLlmToolApprovalGateable } from '../llm-tools/llm-tool-registry';
import { DangerousCommandSessionApprovals } from './dangerous-command-session-approvals';

/** Max size of the pretty-printed args sent to the SPA. */
export const LLM_TOOL_APPROVAL_ARGS_CAP = 16 * 1024;

/** What the model gets back when the call is not allowed. */
export const LLM_TOOL_DENIED_MESSAGE = 'User denied this tool call.';

/**
 * How a gated call was settled. `approve-session` covers both a fresh
 * "Approve for this session" answer and a later call it let through.
 */
export type LlmToolApprovalOutcome = ToolCallApprovalOutcome;

export interface LlmToolApprovalRecord {
    toolName: string;
    toolCallId?: string;
    outcome: LlmToolApprovalOutcome;
}

export type LlmToolAskApprovalFn = (request: AskUserLlmToolApproval) => Promise<AskUserApprovalDecision>;

export interface LlmToolApprovalGateInput {
    /** Chat process the turn belongs to — the scope of a session approval. */
    processId?: string;
    /** The repo's `approvalRequiredLlmTools` list. */
    approvalRequired: readonly string[];
    /**
     * Whether a human can answer this turn. Checked at call time; a
     * non-interactive turn (cron, wakeup, Ralph, workflows) auto-allows.
     */
    isInteractive: () => boolean;
    /** The turn's approval prompt. Absent → nobody to ask → auto-allow. */
    getAskApproval: () => LlmToolAskApprovalFn | undefined;
    /** Overridable for tests. Defaults to the process-wide store. */
    approvals?: DangerousCommandSessionApprovals;
    /** Called once per gated call with how it was settled. */
    onDecision?: (record: LlmToolApprovalRecord) => void;
}

/**
 * "Approve for this session" memory for gated LLM tools, keyed by
 * `(processId, toolName)`. Same lifetime rules as the dangerous-command store:
 * in memory, per chat process, outliving the turn and the executor.
 */
export const llmToolSessionApprovals = new DangerousCommandSessionApprovals();

/** Pretty-print and cap a tool call's args for the approval card. */
export function formatLlmToolApprovalArgs(args: unknown): { argsJson: string; argsTruncated: boolean } {
    let json: string;
    try {
        json = JSON.stringify(args ?? {}, null, 2) ?? String(args);
    } catch {
        json = String(args);
    }
    if (json.length <= LLM_TOOL_APPROVAL_ARGS_CAP) {
        return { argsJson: json, argsTruncated: false };
    }
    return { argsJson: json.slice(0, LLM_TOOL_APPROVAL_ARGS_CAP), argsTruncated: true };
}

function llmToolLabel(toolName: string): string {
    return LLM_TOOL_REGISTRY.find(t => t.name === toolName)?.label ?? toolName;
}

function deniedResult(): ToolResultObject {
    return { textResultForLlm: LLM_TOOL_DENIED_MESSAGE, resultType: 'denied', error: LLM_TOOL_DENIED_MESSAGE };
}

/**
 * Wrap the handlers of tools listed in `approvalRequired`. Tools not listed,
 * not gateable (`ask_user`, `suggest_follow_ups`), or without a handler are
 * returned as-is.
 */
export function applyLlmToolApprovalGate(tools: Tool<any>[], input: LlmToolApprovalGateInput): Tool<any>[] {
    const gated = new Set(input.approvalRequired.filter(isLlmToolApprovalGateable));
    if (gated.size === 0) return tools;

    const approvals = input.approvals ?? llmToolSessionApprovals;

    return tools.map((tool) => {
        const handler = tool.handler;
        if (!handler || !gated.has(tool.name)) return tool;

        const gatedHandler = async (args: unknown, invocation: ToolInvocation): Promise<unknown> => {
            const report = (outcome: LlmToolApprovalOutcome) => input.onDecision?.({
                toolName: tool.name,
                ...(invocation?.toolCallId ? { toolCallId: invocation.toolCallId } : {}),
                outcome,
            });

            const askApproval = input.isInteractive() ? input.getAskApproval() : undefined;
            if (!askApproval) {
                report('auto-allowed');
                return handler(args, invocation);
            }

            if (input.processId && approvals.has(input.processId, tool.name)) {
                report('approve-session');
                return handler(args, invocation);
            }

            const decision = await askApproval({
                kind: 'llm-tool',
                toolName: tool.name,
                label: llmToolLabel(tool.name),
                ...formatLlmToolApprovalArgs(args),
            });
            report(decision);

            if (decision === 'deny') return deniedResult();
            if (decision === 'approve-session' && input.processId) {
                approvals.add(input.processId, tool.name);
            }
            return handler(args, invocation);
        };

        return { ...tool, handler: gatedHandler };
    });
}
