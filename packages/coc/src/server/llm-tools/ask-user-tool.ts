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

export interface AskUserResponse {
    questionId: string;
    answer: string | string[] | boolean | null;
    skipped: boolean;
    reason?: 'user-skipped' | 'cancelled';
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
}

export interface AskUserAnswerInput {
    questionId: string;
    answer?: string | string[] | boolean;
    skipped?: boolean;
}

export interface AskUserToolDeps {
    emitQuestions: (payloads: AskUserSSEPayload[]) => void | Promise<void>;
    computeTurnIndex: () => number;
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
            'Ask the user one or more questions and wait for their responses. Use this when you need ' +
            'clarification, confirmation, or choices from the user before proceeding. ' +
            'Questions render together as one interactive UI widget. ' +
            'IMPORTANT: Only use this in interactive (ask/plan) mode, never in autopilot.',
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
                                description: 'The question text to display to the user.',
                            },
                            type: {
                                type: 'string',
                                enum: ['select', 'multi-select', 'yes-no', 'confirm', 'text'],
                                description: 'The type of question: select (radio buttons), multi-select (checkboxes), yes-no (two buttons), confirm (Confirm/Cancel buttons), text (free-text input).',
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
                                description: 'Options for select/multi-select questions. Required when type is select or multi-select.',
                            },
                            defaultValue: {
                                description: 'Pre-selected default value(s).',
                            },
                        },
                        required: ['question', 'type'],
                    },
                    description: 'Questions to ask together. Ask related clarification questions in one call.',
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

    function answerQuestion(questionId: string, answer: string | string[] | boolean): boolean {
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
        for (const response of responses) {
            if (!pending.has(response.questionId)) return false;
            if (response.skipped !== true && response.answer === undefined) return false;
        }
        for (const response of responses) {
            const entry = pending.get(response.questionId)!;
            pending.delete(response.questionId);
            if (response.skipped === true) {
                entry.resolve({ questionId: response.questionId, answer: null, skipped: true, reason: 'user-skipped' });
            } else {
                entry.resolve({ questionId: response.questionId, answer: response.answer as string | string[] | boolean, skipped: false });
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
