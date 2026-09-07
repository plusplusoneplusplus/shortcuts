/**
 * The dangerous-command guard, provider side.
 *
 * Ask mode auto-approves bare `Bash`, so nothing today stands between the model
 * and `rm -rf /`. This module is the piece that sits in the middle: it screens a
 * shell tool call against the hardcoded Rust rule set in `coc-native` and, when
 * a rule fires, asks the host for a human decision before the command runs.
 *
 * It is deliberately small and free of provider types so both gates use it —
 * Claude's `canUseTool` and Copilot's `onPermissionRequest`.
 *
 * ## Two fail directions, on purpose
 *
 * - **Missing matcher → allow.** `tryMatchDangerousCommand` returns `null` when
 *   the native addon is absent or too old. The guard ships dark and defaults
 *   off, so it must never be the reason a turn breaks on a platform where the
 *   binary did not build. `null` means "not screened, run it as before".
 * - **Missing answer → deny.** Once a rule *has* fired, the command only runs
 *   on an explicit human approval. No approval channel (a cron turn, a Ralph
 *   loop, no attached client) and a channel that throws both deny.
 *
 * ## Session approvals live in the host, not here
 *
 * "Approve for this session" has to outlive a single turn, and a turn is the
 * lifetime of everything in this file. The host owns the chat process, so it
 * owns the set of session-approved rule ids and simply answers
 * `approve-session` again — without re-prompting — the next time the same rule
 * fires. That keeps this module stateless and testable.
 */

import { tryMatchDangerousCommand } from '@plusplusoneplusplus/coc-native';

/** What the user (or the host, on their behalf) decided about one command. */
export type DangerousCommandDecision = 'approve-once' | 'approve-session' | 'deny';

/** The rule that fired, as reported by the native matcher. */
export interface DangerousCommandMatch {
    /** Stable id of the built-in rule, e.g. `rm-recursive-dangerous-target`. */
    ruleId: string;
    /** Human-readable description of what the rule guards against. */
    description: string;
    /** The `;`/`&&`/`||`/`|`-delimited segment the rule actually matched. */
    matchedSegment: string;
}

/** Everything the approval prompt needs to render. */
export interface DangerousCommandApprovalRequest extends DangerousCommandMatch {
    /** The tool whose call was screened (`Bash`). */
    toolName: string;
    /** The full command text as the model asked to run it, not just the segment. */
    command: string;
}

/** Asks a human. Rejecting, or resolving `deny`, blocks the command. */
export type DangerousCommandApprovalHandler = (
    request: DangerousCommandApprovalRequest,
    signal?: AbortSignal,
) => Promise<DangerousCommandDecision>;

/** The guard wiring a caller hands to a provider service via `SendMessageOptions`. */
export interface DangerousCommandGuardOptions {
    /** Mirror of the `dangerousCommandGuard.enabled` admin flag. Off → no screening at all. */
    enabled?: boolean;
    /**
     * Host approval prompt. Absent means there is no one to ask, which denies
     * on a match — that is the non-interactive path (cron, schedule, Ralph).
     */
    requestApproval?: DangerousCommandApprovalHandler;
}

/** The verdict on one screened tool call. */
export interface DangerousCommandGuardResult {
    /** Whether the command may run. */
    allowed: boolean;
    /** The rule that fired. Absent when nothing was screened or nothing matched. */
    match?: DangerousCommandMatch;
    /** How the decision was reached. Absent when no rule fired. */
    decision?: DangerousCommandDecision;
    /** Text handed back to the model on a block. Present iff `allowed` is false. */
    denialMessage?: string;
}

/** Tools this guard screens. Shell only — not MCP shell wrappers, not file tools. */
const SCREENED_TOOL_NAMES = new Set(['Bash']);

/** Whether a tool call is one the guard has an opinion about. */
export function isScreenedShellTool(toolName: string): boolean {
    return SCREENED_TOOL_NAMES.has(toolName);
}

/**
 * The command string out of a tool input, or `null` when there is nothing to
 * screen. A `Bash` call always carries `command`; anything else is a shape the
 * guard does not understand and therefore does not gate.
 */
export function extractShellCommand(
    toolName: string,
    input: Record<string, unknown> | undefined,
): string | null {
    if (!isScreenedShellTool(toolName)) return null;
    const command = input?.command;
    if (typeof command !== 'string' || command.trim() === '') return null;
    return command;
}

/**
 * The command text out of a Copilot SDK permission request, or `null` when the
 * request is not a shell ask.
 *
 * Copilot does not hand its permission handler a tool name and an input object
 * the way Claude's `canUseTool` does — it hands over a discriminated request
 * whose `shell` variant carries `fullCommandText`. This narrows that shape
 * structurally rather than by importing the SDK's types, so the guard stays
 * provider-free and testable without `@github/copilot-sdk`.
 */
export function extractPermissionRequestShellCommand(
    request: { kind?: unknown; fullCommandText?: unknown } | undefined,
): string | null {
    if (request?.kind !== 'shell') return null;
    const command = request.fullCommandText;
    if (typeof command !== 'string' || command.trim() === '') return null;
    return command;
}

/** What the model is told when a command is blocked. */
export function buildDangerousCommandDenialMessage(
    match: DangerousCommandMatch,
    reason: 'denied' | 'no-approver' | 'error',
): string {
    const why =
        reason === 'denied'
            ? 'The user denied it.'
            : reason === 'no-approver'
              ? 'This turn is not interactive, so there was no one to approve it.'
              : 'The approval prompt failed, so it was denied.';
    return (
        `Blocked by the CoC dangerous-command guard: ${match.description} ` +
        `(rule ${match.ruleId}, matched \`${match.matchedSegment}\`). ${why} ` +
        'Do not retry this command — tell the user what you wanted to run and why, and let them decide.'
    );
}

/** The matcher seam, so tests do not need the native addon. */
export type DangerousCommandMatcher = (command: string) => {
    matched: boolean;
    ruleId?: string | null;
    description?: string | null;
    matchedSegment?: string | null;
} | null;

/**
 * Screen one tool call and, on a match, resolve it into an allow or a block.
 *
 * Returns `{ allowed: true }` without touching the approval channel whenever
 * the guard is off, the tool is not a shell tool, the matcher is unavailable,
 * or no rule fired — those are all "behaves exactly like today" paths.
 */
export async function screenDangerousCommand(
    toolName: string,
    input: Record<string, unknown> | undefined,
    guard: DangerousCommandGuardOptions | undefined,
    options: { signal?: AbortSignal; matcher?: DangerousCommandMatcher } = {},
): Promise<DangerousCommandGuardResult> {
    if (!guard?.enabled) return { allowed: true };

    const command = extractShellCommand(toolName, input);
    if (command === null) return { allowed: true };

    const matcher = options.matcher ?? tryMatchDangerousCommand;
    // Fail open: `null` is an unavailable native addon, not a clean command.
    let verdict: ReturnType<DangerousCommandMatcher>;
    try {
        verdict = matcher(command);
    } catch {
        verdict = null;
    }
    if (!verdict?.matched) return { allowed: true };

    const match: DangerousCommandMatch = {
        ruleId: verdict.ruleId ?? 'unknown',
        description: verdict.description ?? 'matched a dangerous-command rule',
        matchedSegment: verdict.matchedSegment ?? command,
    };

    if (!guard.requestApproval) {
        return {
            allowed: false,
            match,
            decision: 'deny',
            denialMessage: buildDangerousCommandDenialMessage(match, 'no-approver'),
        };
    }

    let decision: DangerousCommandDecision;
    try {
        decision = await guard.requestApproval({ ...match, toolName, command }, options.signal);
    } catch {
        return {
            allowed: false,
            match,
            decision: 'deny',
            denialMessage: buildDangerousCommandDenialMessage(match, 'error'),
        };
    }

    if (decision === 'deny') {
        return {
            allowed: false,
            match,
            decision,
            denialMessage: buildDangerousCommandDenialMessage(match, 'denied'),
        };
    }
    return { allowed: true, match, decision };
}
