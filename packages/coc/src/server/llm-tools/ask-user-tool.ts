/**
 * Factory that creates an `ask_user` custom tool for the Copilot SDK.
 * The model calls this tool to pose a structured question to the user and
 * await their response. The tool handler blocks (returns a Promise) until
 * the user submits an answer via the SPA, at which point the answer is
 * returned to the AI so it can continue reasoning.
 *
 * Architecture:
 *   AI calls ask_user → tool handler emits SSE event → returns Promise
 *   → SPA renders question UI → user answers → POST /api/processes/:id/ask-user-response
 *   → server resolves Promise → tool handler returns answer to AI
 */

import { randomUUID } from 'crypto';
import { ASK_USER_TEXTAREA_MAX_BYTES, textareaAnswerError, isDraftEdited } from '../shared/ask-user-textarea';
import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';

// ============================================================================
// Types
// ============================================================================

export type AskUserQuestionType = 'select' | 'multi-select' | 'yes-no' | 'confirm' | 'text' | 'textarea' | 'sensitive-input';

/**
 * Where a `sensitive-input` value goes. The dashboard hands the pasted value
 * straight to the sink, and only a redacted receipt comes back, so the value
 * never reaches the model or the server. Add a sink here and in the SPA's sink
 * table to support another kind of secret.
 */
export const SENSITIVE_INPUT_SINKS = ['browser.cookies'] as const;
export type SensitiveInputSink = typeof SENSITIVE_INPUT_SINKS[number];

/** Non-secret parameters for the sink, chosen by the model. */
export interface SensitiveInputSinkArgs {
    /** Cookie domain, e.g. `example.com` (`browser.cookies`). */
    domain: string;
    /** Browser view to import into; the sink picks one when omitted. */
    viewId?: string;
}

/**
 * Why a sink did not take the value. A fixed code, never parser text, so a
 * fragment of the pasted secret cannot ride back to the model.
 */
export const SENSITIVE_INPUT_FAILURE_REASONS = ['invalid-input', 'import-failed'] as const;
export type SensitiveInputFailureReason = typeof SENSITIVE_INPUT_FAILURE_REASONS[number];

/** What the dashboard reports after running the sink. Never carries the value. */
export type SensitiveInputReceiptInput =
    | { ok: true; count: number }
    | { ok: false; reason: SensitiveInputFailureReason };

/** The redacted receipt the model gets back as the question's answer. */
export type SensitiveInputReceipt =
    | { ok: true; sink: SensitiveInputSink; domain: string; count: number }
    | { ok: false; sink: SensitiveInputSink; domain: string; reason: SensitiveInputFailureReason };

/**
 * Accept only the exact receipt shape: `{ ok: true, count }` or
 * `{ ok: false, reason }`, with no other keys. Anything else is rejected so a
 * client cannot smuggle a value (or cookie names) through the receipt.
 */
export function parseSensitiveInputReceipt(value: unknown): SensitiveInputReceiptInput | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (record.ok === true) {
        if (keys.length !== 2 || !keys.includes('count')) return null;
        const count = record.count;
        if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return null;
        return { ok: true, count };
    }
    if (record.ok === false) {
        if (keys.length !== 2 || !keys.includes('reason')) return null;
        const reason = record.reason;
        if (!(SENSITIVE_INPUT_FAILURE_REASONS as readonly unknown[]).includes(reason)) return null;
        return { ok: false, reason: reason as SensitiveInputFailureReason };
    }
    return null;
}

/** Build the model-facing receipt from the question's non-secret sink args. */
export function buildSensitiveInputReceipt(
    sink: SensitiveInputSink,
    domain: string,
    input: SensitiveInputReceiptInput,
): SensitiveInputReceipt {
    return input.ok
        ? { ok: true, sink, domain, count: input.count }
        : { ok: false, sink, domain, reason: input.reason };
}

export interface AskUserOption {
    value: string;
    label: string;
    description?: string;
}

export interface AskUserArgs {
    questions: AskUserQuestion[];
}

export interface AskUserQuestion {
    question: string;
    type: AskUserQuestionType;
    options?: AskUserOption[];
    defaultValue?: string | string[];
    /** Required when type is `sensitive-input`. */
    sink?: SensitiveInputSink;
    /** Required when type is `sensitive-input`. */
    sinkArgs?: SensitiveInputSinkArgs;
}

export type AskUserAnswerValue = string | string[] | boolean;
export type AskUserResponseReason = 'user-skipped' | 'cancelled' | 'needs-context' | 'unavailable';

export interface AskUserRalphGrillSource {
    role: string;
    roleLabel: string;
    provider?: string;
    model?: string;
    effortTier?: string;
    provenanceLabel: string;
}

export interface AskUserRalphGrillPlanningSummary {
    depth: string;
    round: number;
    maxRounds: number;
    agentOutcomes: Array<{
        role: string;
        roleLabel: string;
        provenanceLabel: string;
        status: 'completed' | 'empty' | 'failed';
        candidateCount: number;
    }>;
    consolidation: {
        rawCandidateCount: number;
        selectedQuestionCount: number;
        exactDuplicatesMerged: number;
        semanticDuplicatesMerged: number;
        conflictsConverted: number;
        duplicateOnlyAgents: string[];
    };
    warnings: string[];
}

export interface AskUserRalphGrillMetadata {
    sources?: AskUserRalphGrillSource[];
    consolidation?: {
        kind: string;
        mergedCandidateCount: number;
    };
    planning?: AskUserRalphGrillPlanningSummary;
}

export interface AskUserResponse {
    questionId: string;
    /** A `sensitive-input` question answers with its redacted receipt. */
    answer: AskUserAnswerValue | SensitiveInputReceipt | null;
    skipped: boolean;
    edited?: boolean;
    reason?: AskUserResponseReason;
    deferred?: boolean;
    note?: string;
    guidance?: string;
}

/**
 * The dangerous-command guard's approval prompt, carried on an otherwise
 * ordinary `ask_user` question. Its presence is what tells the SPA to render
 * the approval variant (full command text + the rule that fired) instead of a
 * plain select; a client that does not know the field still renders a usable
 * three-option question.
 */
export interface AskUserDangerousCommandApproval {
    kind: 'dangerous-command';
    /** The full command the model asked to run, verbatim. */
    command: string;
    /** Id of the built-in rule that fired, e.g. `pipe-to-shell`. */
    ruleId: string;
    /** What that rule guards against, in prose. */
    description: string;
    /** The `;`/`&&`/`||`/`|`-delimited segment the rule actually matched. */
    matchedSegment: string;
}

/**
 * The LLM-tool approval gate's prompt: a CoC tool the user marked "Require
 * approval" for this repo is being called. The args are pretty-printed JSON,
 * already capped by the gate so a huge payload never reaches the SPA.
 */
export interface AskUserLlmToolApproval {
    kind: 'llm-tool';
    /** Registered tool name, e.g. `send_to_conversation`. */
    toolName: string;
    /** Human-readable label from the LLM tool registry. */
    label: string;
    /** Pretty-printed JSON arguments, truncated at the gate's cap. */
    argsJson: string;
    /** True when `argsJson` was cut at the cap. */
    argsTruncated: boolean;
}

/** Any approval prompt carried on the `ask-user` channel. */
export type AskUserApprovalRequest = AskUserDangerousCommandApproval | AskUserLlmToolApproval;

/** How the user answered an approval prompt. */
export type AskUserApprovalDecision = 'approve-once' | 'approve-session' | 'deny';

/** The option values the approval prompt offers. Order is the display order. */
export const ASK_USER_APPROVAL_OPTIONS: AskUserOption[] = [
    { value: 'approve-once', label: 'Approve once', description: 'Run this command now. Ask again next time.' },
    { value: 'approve-session', label: 'Approve for this session', description: 'Run it, and stop asking about this rule for the rest of this chat.' },
    { value: 'deny', label: 'Deny', description: 'Block the command and tell the model why.' },
];

/** Same three values as {@link ASK_USER_APPROVAL_OPTIONS}, worded for a tool call. */
export const ASK_USER_LLM_TOOL_APPROVAL_OPTIONS: AskUserOption[] = [
    { value: 'approve-once', label: 'Approve once', description: 'Run this tool call now. Ask again next time.' },
    { value: 'approve-session', label: 'Approve for this session', description: 'Run it, and stop asking about this tool for the rest of this chat.' },
    { value: 'deny', label: 'Deny', description: 'Skip the tool call and tell the model you denied it.' },
];

export interface AskUserSSEPayload {
    batchId: string;
    questionId: string;
    question: string;
    type: AskUserQuestionType;
    options?: AskUserOption[];
    defaultValue?: string | string[];
    turnIndex: number;
    index: number;
    batchSize: number;
    /** Set only on `sensitive-input` questions. */
    sink?: SensitiveInputSink;
    sinkArgs?: SensitiveInputSinkArgs;
    ralphGrill?: AskUserRalphGrillMetadata;
    /**
     * Set only on an approval prompt (dangerous command or gated LLM tool).
     * Nothing else on the `ask-user` channel carries it, so a client can
     * branch on its presence, then on `kind`.
     */
    approval?: AskUserApprovalRequest;
}

export interface AskUserAnswerInput {
    questionId: string;
    answer?: AskUserAnswerValue;
    skipped?: boolean;
    deferred?: boolean;
    /**
     * `needs-context` marks a deferred answer. `unavailable` (with
     * `skipped: true`) is only for `sensitive-input`: the dashboard has no
     * desktop bridge to run the sink.
     */
    reason?: 'needs-context' | 'unavailable';
    note?: string;
    /** The only accepted answer for a `sensitive-input` question; never with `answer`. */
    receipt?: SensitiveInputReceiptInput;
}

/**
 * Per-question control handed to `emitQuestions`, so a host can answer
 * questions one at a time from outside the dashboard (the WhatsApp/Teams
 * question relay) through the same pending map the dashboard resolves.
 */
export interface AskUserEmitControl {
    isPending: (questionId: string) => boolean;
    /** Resolves when the question settles by any path; immediately if it already has. */
    waitFor: (questionId: string) => Promise<void>;
    answer: (questionId: string, answer: AskUserAnswerValue) => boolean;
    skip: (questionId: string) => boolean;
    /** Resolve as `unavailable`, the same response a non-interactive turn gets. */
    resolveUnavailable: (questionId: string) => boolean;
    /** Runs once when `cancelAll` clears the turn's questions; returns an unsubscribe. */
    onCancelAll: (listener: () => void) => () => void;
}

export interface AskUserToolDeps {
    emitQuestions: (payloads: AskUserSSEPayload[], control: AskUserEmitControl) => void | Promise<void>;
    computeTurnIndex: () => number;
    /**
     * Whether a human can answer this turn. Evaluated at call time, not at
     * registration time, so the tool schema stays constant while the behavior
     * follows the turn. Defaults to true when omitted (existing call sites).
     *
     * When it returns false the handler resolves immediately with an
     * `unavailable` response per question instead of blocking forever — a
     * cron/wakeup tick has nobody to answer, and under Codex the MCP tool
     * timeout is 365 days, so there is no timer to save it.
     */
    isInteractive?: () => boolean;
    /** Optional debug sink for the non-interactive short-circuit. */
    onUnavailable?: (questionCount: number) => void;
    /**
     * `features.sensitiveInput`. Read when the tool is built (the schema only
     * lists `sensitive-input` when on) and again at call time, so a question
     * of that type is refused once the flag is turned off. Defaults to off.
     */
    isSensitiveInputEnabled?: () => boolean;
}

const NEEDS_CONTEXT_GUIDANCE =
    'The user marked this question as needing more context. Provide the missing context and ask a revised version of this question again if the answer is still needed. If the question is no longer needed after processing the other answers, explain why instead of ignoring it.';

function isDeferredResponse(response: AskUserAnswerInput): boolean {
    return response.deferred === true || response.reason === 'needs-context';
}

const UNAVAILABLE_GUIDANCE =
    'No user is available to answer in this run. Proceed using your best judgment, state the assumption you made explicitly in your output, and do not call ask_user again this turn.';

const SENSITIVE_INPUT_UNAVAILABLE_GUIDANCE =
    'Sensitive input can only be answered in the CoC desktop app dashboard, and nobody can answer it in this run. Do not ask the user to paste the secret into chat or any other channel. Tell the user to open CoC desktop and ask again from there, or continue without it.';

function unavailableResponse(questionId: string, type?: AskUserQuestionType): AskUserResponse {
    return {
        questionId,
        answer: null,
        skipped: true,
        reason: 'unavailable',
        guidance: type === 'sensitive-input' ? SENSITIVE_INPUT_UNAVAILABLE_GUIDANCE : UNAVAILABLE_GUIDANCE,
    };
}

const BASE_QUESTION_TYPES: AskUserQuestionType[] = ['select', 'multi-select', 'yes-no', 'confirm', 'text', 'textarea'];

/**
 * Reject a `sensitive-input` question the host cannot take: flag off, unknown
 * sink, or missing domain. Throwing turns into a tool error the model can read.
 */
function validateSensitiveInputQuestion(question: AskUserQuestion, enabled: boolean): void {
    if (!enabled) {
        throw new Error('ask_user question type "sensitive-input" is not enabled on this server');
    }
    if (!question.sink || !(SENSITIVE_INPUT_SINKS as readonly string[]).includes(question.sink)) {
        throw new Error(`ask_user sensitive-input requires sink to be one of: ${SENSITIVE_INPUT_SINKS.join(', ')}`);
    }
    const args = question.sinkArgs;
    if (!args || typeof args.domain !== 'string' || args.domain.trim() === '') {
        throw new Error('ask_user sensitive-input requires sinkArgs.domain');
    }
    if (args.viewId !== undefined && typeof args.viewId !== 'string') {
        throw new Error('ask_user sensitive-input sinkArgs.viewId must be a string');
    }
}

function deferredResponse(questionId: string, note?: string): AskUserResponse {
    const trimmedNote = typeof note === 'string' ? note.trim() : '';
    return {
        questionId,
        answer: null,
        skipped: false,
        deferred: true,
        reason: 'needs-context',
        ...(trimmedNote ? { note: trimmedNote } : {}),
        guidance: NEEDS_CONTEXT_GUIDANCE,
    };
}

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create an `ask_user` tool and its companion resolution functions.
 *
 * Returns:
 * - `tool`: The tool definition to inject into the AI session.
 * - `answerQuestion(questionId, answer)`: Resolve a pending question with the user's answer.
 * - `cancelAll()`: Reject all pending questions (called on process cancellation / session cleanup).
 */
export function createAskUserTool(deps: AskUserToolDeps) {
    const pending = new Map<string, {
        resolve: (response: AskUserResponse) => void;
        type: AskUserQuestionType;
        defaultValue?: string | string[];
        /** Set on `sensitive-input` questions; the receipt is built from it. */
        sensitive?: { sink: SensitiveInputSink; domain: string };
    }>();
    const isSensitiveInputEnabled = () => deps.isSensitiveInputEnabled?.() === true;
    const sensitiveInputInSchema = isSensitiveInputEnabled();
    const settleListeners = new Map<string, Array<() => void>>();
    const cancelListeners = new Set<() => void>();

    function settle(questionId: string, response: AskUserResponse): boolean {
        const entry = pending.get(questionId);
        if (!entry) return false;
        pending.delete(questionId);
        if (entry.type === 'textarea' && !response.skipped && !response.deferred && typeof response.answer === 'string') {
            response.edited = isDraftEdited(response.answer, entry.defaultValue);
        }
        entry.resolve(response);
        const listeners = settleListeners.get(questionId) ?? [];
        settleListeners.delete(questionId);
        for (const listener of listeners) listener();
        return true;
    }

    const control: AskUserEmitControl = {
        isPending: questionId => pending.has(questionId),
        waitFor: questionId => pending.has(questionId)
            ? new Promise<void>(resolve => {
                settleListeners.set(questionId, [...(settleListeners.get(questionId) ?? []), resolve]);
            })
            : Promise.resolve(),
        answer: (questionId, answer) => answerQuestion(questionId, answer),
        skip: questionId => skipQuestion(questionId),
        resolveUnavailable: questionId => settle(questionId, unavailableResponse(questionId, pending.get(questionId)?.type)),
        onCancelAll: listener => {
            cancelListeners.add(listener);
            return () => { cancelListeners.delete(listener); };
        },
    };

    const tool = defineTool<AskUserArgs>('ask_user', {
        overridesBuiltInTool: true,
        description:
            'Ask the user one or more questions and wait for their answers. Use when you need ' +
            'clarification, confirmation, or choices before proceeding. ' +
            'Use textarea for multi-line drafts the user may edit; use the returned answer as the final text, not the original draft. Drafts and answers are limited to 32 KiB UTF-8. ' +
            'Do NOT use it for a simple yes/no that can be inferred from context. ' +
            'If a response has deferred=true and reason="needs-context", the user needs more context; explain and re-ask the question if still needed instead of treating it as skipped. ' +
            'Only use when a human is present to answer; never in unattended or automated runs (cron ticks, headless queue runs, background loops).' +
            (sensitiveInputInSchema
                ? ' For a secret the user must provide (sink "browser.cookies": browser login cookies for sinkArgs.domain), use type "sensitive-input" — never ask for secrets with a text question. ' +
                  'The user pastes the value in the CoC desktop dashboard and it goes straight to the sink; you only get a receipt: { ok: true, sink, domain, count } or { ok: false, sink, domain, reason }.'
                : ''),
        parameters: {
            type: 'object' as const,
            properties: {
                questions: {
                    type: 'array',
                    minItems: 1,
                    items: {
                        type: 'object',
                        properties: {
                            question: {
                                type: 'string',
                                description: 'Question text shown to the user.',
                            },
                            type: {
                                type: 'string',
                                enum: sensitiveInputInSchema ? [...BASE_QUESTION_TYPES, 'sensitive-input'] : BASE_QUESTION_TYPES,
                                description: 'Question type: select (single choice), multi-select (multiple choices), yes-no, confirm (Confirm/Cancel), text (one-line input), textarea (editable multi-line draft)' +
                                    (sensitiveInputInSchema ? ', sensitive-input (masked secret delivered to `sink`; requires sink and sinkArgs).' : '.'),
                            },
                            options: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        value: { type: 'string', description: 'The option value returned when selected.' },
                                        label: { type: 'string', description: 'Display label for the option.' },
                                        description: { type: 'string', description: 'Optional help text shown below the label.' },
                                    },
                                    required: ['value', 'label'],
                                },
                                description: 'Options for select/multi-select. Required when type is select or multi-select.',
                            },
                            defaultValue: {
                                description: 'Pre-selected default value(s); textarea defaults must be strings of at most 32 KiB UTF-8.',
                            },
                            ...(sensitiveInputInSchema ? {
                                sink: {
                                    type: 'string',
                                    enum: [...SENSITIVE_INPUT_SINKS],
                                    description: 'sensitive-input only: where the secret goes. browser.cookies imports pasted cookies into the desktop browser.',
                                },
                                sinkArgs: {
                                    type: 'object',
                                    properties: {
                                        domain: { type: 'string', description: 'Cookie domain, e.g. example.com.' },
                                        viewId: { type: 'string', description: 'Optional browser view id to import into.' },
                                    },
                                    required: ['domain'],
                                    description: 'sensitive-input only: non-secret sink parameters.',
                                },
                            } : {}),
                        },
                        required: ['question', 'type'],
                    },
                    description: 'Questions to ask together — batch related ones in one call.',
                },
            },
            required: ['questions'],
        },
        handler: async (args: AskUserArgs): Promise<AskUserResponse[]> => {
            if (!Array.isArray(args.questions) || args.questions.length === 0) {
                throw new Error('ask_user requires at least one question');
            }
            for (const question of args.questions) {
                if (question?.type === 'textarea') {
                    if (question.options !== undefined) throw new Error('ask_user textarea does not accept options');
                    if (question.defaultValue !== undefined) {
                        if (typeof question.defaultValue !== 'string') throw new Error('ask_user textarea defaultValue must be a string');
                        if (Buffer.byteLength(question.defaultValue, 'utf8') > ASK_USER_TEXTAREA_MAX_BYTES) {
                            throw new Error('ask_user textarea defaultValue must be at most 32 KiB UTF-8');
                        }
                    }
                }
                if (question?.type === 'sensitive-input') {
                    validateSensitiveInputQuestion(question, isSensitiveInputEnabled());
                }
            }
            // Non-interactive turns (cron / wakeup / trigger ticks) have nobody
            // to answer. Resolve on the same tick rather than emitting a question
            // that can never be resolved — the turn-cleanup cancelAll only runs
            // after the turn ends, so a blocked handler would deadlock the turn.
            if (deps.isInteractive?.() === false) {
                deps.onUnavailable?.(args.questions.length);
                return args.questions.map(question => unavailableResponse(randomUUID(), question.type));
            }

            const batchId = randomUUID();
            const turnIndex = deps.computeTurnIndex();
            const payloads = args.questions.map((question, index): AskUserSSEPayload => ({
                batchId,
                questionId: randomUUID(),
                question: question.question,
                type: question.type,
                ...(question.type === 'sensitive-input'
                    ? {
                        sink: question.sink,
                        sinkArgs: {
                            domain: question.sinkArgs!.domain.trim(),
                            ...(question.sinkArgs!.viewId ? { viewId: question.sinkArgs!.viewId } : {}),
                        },
                    }
                    : { options: question.options, defaultValue: question.defaultValue }),
                turnIndex,
                index,
                batchSize: args.questions.length,
            }));
            const responsePromises = payloads.map(payload => new Promise<AskUserResponse>((resolve) => {
                pending.set(payload.questionId, {
                    resolve,
                    type: payload.type,
                    defaultValue: payload.defaultValue,
                    ...(payload.sink && payload.sinkArgs
                        ? { sensitive: { sink: payload.sink, domain: payload.sinkArgs.domain } }
                        : {}),
                });
            }));

            try {
                await deps.emitQuestions(payloads, control);
            } catch (err) {
                for (const payload of payloads) {
                    pending.delete(payload.questionId);
                }
                throw err;
            }

            return Promise.all(responsePromises);
        },
    });

    /**
     * Pose an approval prompt (dangerous command or gated LLM tool) and wait
     * for the answer.
     *
     * Deliberately shares this factory's `pending` map with the `ask_user`
     * tool: the answer arrives through the same
     * `POST /api/processes/:id/ask-user-response` endpoint and the same
     * `answerQuestion` handle, so nothing new has to be routed. It is *not* a
     * tool call — the model never asks for it; the guard does, on the model's
     * behalf, while a `Bash` call or a gated CoC tool call is held.
     *
     * Every non-approval outcome maps to `deny`: a skipped, cancelled (the turn
     * was aborted), or unrecognized answer must not let the call through.
     */
    async function askApproval(request: AskUserApprovalRequest): Promise<AskUserApprovalDecision> {
        // Belt-and-braces: the host omits the approval callback entirely on a
        // non-interactive turn, so this branch should not be reachable. If it
        // is, deny rather than block a turn nobody is watching.
        if (deps.isInteractive?.() === false) {
            deps.onUnavailable?.(1);
            return 'deny';
        }

        const payload: AskUserSSEPayload = {
            batchId: randomUUID(),
            questionId: randomUUID(),
            question: request.kind === 'llm-tool'
                ? `Allow the ${request.label} tool to run?\n\n${request.argsJson}`
                : `Allow this command to run?\n\n${request.command}`,
            type: 'select',
            options: request.kind === 'llm-tool' ? ASK_USER_LLM_TOOL_APPROVAL_OPTIONS : ASK_USER_APPROVAL_OPTIONS,
            defaultValue: 'deny',
            turnIndex: deps.computeTurnIndex(),
            index: 0,
            batchSize: 1,
            approval: request,
        };

        const responsePromise = new Promise<AskUserResponse>((resolve) => {
            pending.set(payload.questionId, { resolve, type: payload.type });
        });

        try {
            await deps.emitQuestions([payload], control);
        } catch (err) {
            pending.delete(payload.questionId);
            throw err;
        }

        const response = await responsePromise;
        if (response.skipped || response.deferred) return 'deny';
        return response.answer === 'approve-once' || response.answer === 'approve-session'
            ? response.answer
            : 'deny';
    }

    function answerQuestion(questionId: string, answer: AskUserAnswerValue): boolean {
        // A sensitive question only takes a receipt through `answerQuestions`;
        // a plain answer (e.g. from the messaging relay) would be the secret.
        if (pending.get(questionId)?.sensitive) return false;
        if (pending.get(questionId)?.type === 'textarea' && textareaAnswerError(answer)) return false;
        return settle(questionId, { questionId, answer, skipped: false });
    }

    function skipQuestion(questionId: string): boolean {
        return settle(questionId, { questionId, answer: null, skipped: true, reason: 'user-skipped' });
    }

    function answerQuestions(responses: AskUserAnswerInput[]): boolean {
        if (responses.length === 0) return false;
        if (responses.length !== pending.size) return false;
        const seenQuestionIds = new Set<string>();
        for (const response of responses) {
            if (seenQuestionIds.has(response.questionId)) return false;
            seenQuestionIds.add(response.questionId);
            if (!pending.has(response.questionId)) return false;
            if (response.skipped === true && isDeferredResponse(response)) return false;
            if (response.note !== undefined && typeof response.note !== 'string') return false;
            const answered = response.skipped !== true && !isDeferredResponse(response);
            if (response.reason === 'unavailable' && (response.skipped !== true || !pending.get(response.questionId)!.sensitive)) return false;
            if (pending.get(response.questionId)!.sensitive) {
                if (response.answer !== undefined) return false;
                if (answered ? !parseSensitiveInputReceipt(response.receipt) : response.receipt !== undefined) return false;
            } else {
                if (response.receipt !== undefined) return false;
                if (answered && response.answer === undefined) return false;
                if (answered && pending.get(response.questionId)!.type === 'textarea' && textareaAnswerError(response.answer)) return false;
            }
        }
        for (const response of responses) {
            if (response.reason === 'unavailable') {
                settle(response.questionId, unavailableResponse(response.questionId, 'sensitive-input'));
            } else if (response.skipped === true) {
                settle(response.questionId, { questionId: response.questionId, answer: null, skipped: true, reason: 'user-skipped' });
            } else if (isDeferredResponse(response)) {
                settle(response.questionId, deferredResponse(response.questionId, response.note));
            } else if (pending.get(response.questionId)!.sensitive) {
                const { sink, domain } = pending.get(response.questionId)!.sensitive!;
                const receipt = buildSensitiveInputReceipt(sink, domain, parseSensitiveInputReceipt(response.receipt)!);
                settle(response.questionId, { questionId: response.questionId, answer: receipt, skipped: false });
            } else {
                settle(response.questionId, { questionId: response.questionId, answer: response.answer as AskUserAnswerValue, skipped: false });
            }
        }
        return true;
    }

    function cancelAll(): void {
        for (const questionId of [...pending.keys()]) {
            settle(questionId, { questionId, answer: null, skipped: true, reason: 'cancelled' });
        }
        const listeners = [...cancelListeners];
        cancelListeners.clear();
        for (const listener of listeners) listener();
    }

    function hasPending(): boolean {
        return pending.size > 0;
    }

    return { tool, askApproval, answerQuestion, skipQuestion, answerQuestions, cancelAll, hasPending };
}
