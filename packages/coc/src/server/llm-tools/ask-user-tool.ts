/**
 * Ask User Tool
 *
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
import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';

// ============================================================================
// Types
// ============================================================================

export type AskUserQuestionType = 'select' | 'multi-select' | 'yes-no' | 'confirm' | 'text';

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
}

export type AskUserAnswerValue = string | string[] | boolean;
export type AskUserResponseReason = 'user-skipped' | 'cancelled' | 'needs-context';

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
    answer: AskUserAnswerValue | null;
    skipped: boolean;
    reason?: AskUserResponseReason;
    deferred?: boolean;
    note?: string;
    guidance?: string;
}

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
    ralphGrill?: AskUserRalphGrillMetadata;
}

export interface AskUserAnswerInput {
    questionId: string;
    answer?: AskUserAnswerValue;
    skipped?: boolean;
    deferred?: boolean;
    reason?: 'needs-context';
    note?: string;
}

export interface AskUserToolDeps {
    emitQuestions: (payloads: AskUserSSEPayload[]) => void | Promise<void>;
    computeTurnIndex: () => number;
}

const NEEDS_CONTEXT_GUIDANCE =
    'The user marked this question as needing more context. Provide the missing context and ask a revised version of this question again if the answer is still needed. If the question is no longer needed after processing the other answers, explain why instead of ignoring it.';

function isDeferredResponse(response: AskUserAnswerInput): boolean {
    return response.deferred === true || response.reason === 'needs-context';
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
    }>();

    const tool = defineTool<AskUserArgs>('ask_user', {
        overridesBuiltInTool: true,
        description:
            'Ask the user one or more questions and wait for their answers. Use when you need ' +
            'clarification, confirmation, or choices before proceeding. ' +
            'If a response has deferred=true and reason="needs-context", the user needs more context; explain and re-ask the question if still needed instead of treating it as skipped. ' +
            'Only use in interactive Ask or Ralph contexts, never in autopilot.',
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
                                enum: ['select', 'multi-select', 'yes-no', 'confirm', 'text'],
                                description: 'Question type: select (single choice), multi-select (multiple choices), yes-no, confirm (Confirm/Cancel), text (free-text input).',
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
                                description: 'Pre-selected default value(s).',
                            },
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
            const batchId = randomUUID();
            const turnIndex = deps.computeTurnIndex();
            const payloads = args.questions.map((question, index): AskUserSSEPayload => ({
                batchId,
                questionId: randomUUID(),
                question: question.question,
                type: question.type,
                options: question.options,
                defaultValue: question.defaultValue,
                turnIndex,
                index,
                batchSize: args.questions.length,
            }));
            const responsePromises = payloads.map(payload => new Promise<AskUserResponse>((resolve) => {
                pending.set(payload.questionId, { resolve });
            }));

            try {
                await deps.emitQuestions(payloads);
            } catch (err) {
                for (const payload of payloads) {
                    pending.delete(payload.questionId);
                }
                throw err;
            }

            return Promise.all(responsePromises);
        },
    });

    function answerQuestion(questionId: string, answer: AskUserAnswerValue): boolean {
        const entry = pending.get(questionId);
        if (!entry) return false;
        pending.delete(questionId);
        entry.resolve({ questionId, answer, skipped: false });
        return true;
    }

    function skipQuestion(questionId: string): boolean {
        const entry = pending.get(questionId);
        if (!entry) return false;
        pending.delete(questionId);
        entry.resolve({ questionId, answer: null, skipped: true, reason: 'user-skipped' });
        return true;
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
            if (response.skipped !== true && !isDeferredResponse(response) && response.answer === undefined) return false;
        }
        for (const response of responses) {
            const entry = pending.get(response.questionId)!;
            pending.delete(response.questionId);
            if (response.skipped === true) {
                entry.resolve({ questionId: response.questionId, answer: null, skipped: true, reason: 'user-skipped' });
            } else if (isDeferredResponse(response)) {
                entry.resolve(deferredResponse(response.questionId, response.note));
            } else {
                entry.resolve({ questionId: response.questionId, answer: response.answer as AskUserAnswerValue, skipped: false });
            }
        }
        return true;
    }

    function cancelAll(): void {
        for (const [questionId, entry] of pending) {
            entry.resolve({ questionId, answer: null, skipped: true, reason: 'cancelled' });
        }
        pending.clear();
    }

    function hasPending(): boolean {
        return pending.size > 0;
    }

    return { tool, answerQuestion, skipQuestion, answerQuestions, cancelAll, hasPending };
}
