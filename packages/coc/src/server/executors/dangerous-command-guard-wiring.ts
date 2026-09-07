/**
 * Host side of the dangerous-command guard.
 *
 * `@plusplusoneplusplus/coc-agent-sdk` owns the matcher call and the
 * allow/deny decision; everything it cannot know — is anyone watching this
 * turn, how do we ask them, what did they already approve — lives here.
 *
 * The wiring is built once per turn, because interactivity is a property of
 * the turn: the same chat process can run an interactive turn now and a
 * cron-triggered one later. Session approvals, by contrast, outlive the turn
 * and live in {@link dangerousCommandSessionApprovals}.
 */

import type {
    DangerousCommandApprovalRequest,
    DangerousCommandAuditDecision,
    DangerousCommandDecision,
    DangerousCommandGuardOptions,
} from '@plusplusoneplusplus/coc-agent-sdk';
import type { AskUserApprovalDecision, AskUserDangerousCommandApproval } from '../llm-tools/ask-user-tool';
import type { DangerousCommandSessionApprovals } from './dangerous-command-session-approvals';
import { dangerousCommandSessionApprovals } from './dangerous-command-session-approvals';

/** Asks the user. Supplied by the turn's `ask_user` addon. */
export type AskApprovalFn = (
    request: AskUserDangerousCommandApproval,
) => Promise<AskUserApprovalDecision>;

/** One decision, for the audit trail. Never carries the command text. */
export interface DangerousCommandDecisionRecord {
    ruleId: string;
    decision: DangerousCommandAuditDecision;
    /** Whether a standing session approval answered it without a prompt. */
    fromSessionApproval: boolean;
    timestamp: string;
}

export interface DangerousCommandGuardWiringInput {
    /** Chat process the turn belongs to — the scope of a session approval. */
    processId: string;
    /** The resolved `dangerousCommandGuard.enabled` admin flag. */
    enabled: boolean;
    /**
     * Whether a human can answer this turn. Evaluated once, when the wiring is
     * built, because it decides whether an approval channel exists at all: on a
     * non-interactive turn the callback is omitted entirely, and the SDK guard
     * reads that absence as "deny, and tell the model nobody was there to ask".
     */
    isInteractive: () => boolean;
    /**
     * The turn's approval prompt, resolved lazily — the ask-user addon is built
     * after this wiring in some paths, and a turn whose handles were cleared
     * (a Ralph grill terminal round) must fall back to denying.
     */
    getAskApproval: () => AskApprovalFn | undefined;
    /** Overridable for tests. Defaults to the process-wide store. */
    approvals?: DangerousCommandSessionApprovals;
    /** Audit sink (AC-08). Called for every rule that fires. */
    onDecision?: (record: DangerousCommandDecisionRecord) => void;
}

/**
 * Build the `dangerousCommandGuard` block for `SendMessageOptions`.
 *
 * Flag off → `{ enabled: false }`, which the SDK guard treats as "never call
 * the matcher", so a turn is byte-identical to what it was before this feature.
 */
export function buildDangerousCommandGuardWiring(
    input: DangerousCommandGuardWiringInput,
): DangerousCommandGuardOptions {
    if (!input.enabled) return { enabled: false };

    const approvals = input.approvals ?? dangerousCommandSessionApprovals;

    /**
     * Rules this turn answered off a standing session approval. The SDK reports
     * the decision (it is the only place that sees every outcome, including the
     * non-interactive deny), but it cannot know whether an `approve-session`
     * came from a fresh prompt or from a rule approved earlier in the chat, so
     * the flag is stashed here on the way past.
     */
    const answeredFromSession = new Set<string>();

    const reportDecision = (record: {
        ruleId: string;
        decision: DangerousCommandAuditDecision;
        timestamp: string;
    }): void => {
        input.onDecision?.({
            ...record,
            fromSessionApproval: answeredFromSession.has(record.ruleId),
        });
    };

    // AC-06: nobody to ask. Omitting the callback is the signal, not a
    // callback that returns `deny` — the SDK distinguishes the two so the
    // model is told "this turn is not interactive" rather than "the user
    // said no". The audit sink still rides along, so a blocked command on a
    // cron or Ralph turn is visible after the fact.
    if (!input.isInteractive()) {
        return { enabled: true, reportDecision };
    }

    const requestApproval = async (
        request: DangerousCommandApprovalRequest,
    ): Promise<DangerousCommandDecision> => {
        // AC-05: a rule approved earlier in this chat process never prompts
        // again. Re-answering `approve-session` keeps the SDK's decision
        // reporting honest about *why* the command was allowed.
        if (approvals.has(input.processId, request.ruleId)) {
            answeredFromSession.add(request.ruleId);
            return 'approve-session';
        }

        const askApproval = input.getAskApproval();
        if (!askApproval) return 'deny';

        const decision = await askApproval({
            kind: 'dangerous-command',
            command: request.command,
            ruleId: request.ruleId,
            description: request.description,
            matchedSegment: request.matchedSegment,
        });

        if (decision === 'approve-session') {
            approvals.add(input.processId, request.ruleId);
        }
        return decision;
    };

    return { enabled: true, requestApproval, reportDecision };
}
