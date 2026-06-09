/**
 * AskUserInline
 *
 * Renders one batched interactive ask_user form from the AI.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AskUserResponseRequest } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../../api/cocClient';
import type { AskUserBatch, AskUserQuestion } from './hooks/useChatSSE';
import { AskUserMarkdown } from './AskUserMarkdown';
import {
    clearAskUserDraft,
    clearOtherAskUserDraftsForProcess,
    getAskUserDraft,
    pruneExpiredAskUserDrafts,
    setAskUserDraft,
    type AskUserQuestionDisposition,
    type AskUserDraftValue,
} from './hooks/useAskUserDraftStore';

export interface AskUserInlineProps {
    batch: AskUserBatch;
    processId: string;
    onAnswered: () => void;
}

type AnswerValue = AskUserDraftValue;

interface QuestionState {
    value: AnswerValue;
    customText: string;
    disposition: AskUserQuestionDisposition;
    note: string;
}

const CUSTOM_OPTION_VALUE = '__ask_user_custom__';

function initialValue(question: AskUserQuestion): AnswerValue {
    if (question.type === 'yes-no' || question.type === 'confirm') return null;
    if (question.type === 'multi-select') return (question.defaultValue as string[] | undefined) ?? [];
    if (question.type === 'text') return (question.defaultValue as string | undefined) ?? '';
    return (question.defaultValue as string | undefined) ?? null;
}

function defaultQuestionState(question: AskUserQuestion): QuestionState {
    return {
        value: initialValue(question),
        customText: '',
        disposition: 'answer',
        note: '',
    };
}

function normalizeDraftValue(question: AskUserQuestion, value: AnswerValue, fallback: AnswerValue): AnswerValue {
    if (question.type === 'multi-select') return Array.isArray(value) ? value : fallback;
    if (question.type === 'yes-no' || question.type === 'confirm') return typeof value === 'boolean' || value === null ? value : fallback;
    return typeof value === 'string' || value === null ? value : fallback;
}

function initialAnswers(batch: AskUserBatch, processId: string): Record<string, QuestionState> {
    const draft = getAskUserDraft(processId, batch.batchId);
    return Object.fromEntries(batch.questions.map(question => {
        const fallback = defaultQuestionState(question);
        const saved = draft?.answers[question.questionId];
        if (!saved) return [question.questionId, fallback];
        return [question.questionId, {
            value: normalizeDraftValue(question, saved.value, fallback.value),
            customText: saved.customText,
            disposition: saved.disposition,
            note: saved.note,
        }];
    }));
}

function isAnswerComplete(question: AskUserQuestion, state: QuestionState): boolean {
    if (state.disposition !== 'answer') return true;
    if (question.type === 'text') return typeof state.value === 'string' && state.value.trim().length > 0;
    if (question.type === 'select') {
        if (state.value === CUSTOM_OPTION_VALUE) return state.customText.trim().length > 0;
        return typeof state.value === 'string' && state.value.length > 0;
    }
    if (question.type === 'multi-select') return Array.isArray(state.value);
    return typeof state.value === 'boolean';
}

function answerFor(question: AskUserQuestion, state: QuestionState): string | string[] | boolean {
    if (question.type === 'select' && state.value === CUSTOM_OPTION_VALUE) {
        return state.customText.trim();
    }
    if (question.type === 'text' && typeof state.value === 'string') {
        return state.value.trim();
    }
    return state.value as string | string[] | boolean;
}

function responseFor(question: AskUserQuestion, state: QuestionState): AskUserResponseRequest['answers'][number] {
    if (state.disposition === 'skip') {
        return { questionId: question.questionId, skipped: true };
    }
    if (state.disposition === 'needs-context') {
        const note = state.note.trim();
        return {
            questionId: question.questionId,
            deferred: true,
            reason: 'needs-context',
            ...(note ? { note } : {}),
        };
    }
    return { questionId: question.questionId, answer: answerFor(question, state) };
}

export function AskUserInline({ batch, processId, onAnswered }: AskUserInlineProps) {
    const responseAcceptedRef = useRef(false);
    const [answers, setAnswers] = useState<Record<string, QuestionState>>(() => initialAnswers(batch, processId));
    const [submitting, setSubmitting] = useState(false);

    const updateQuestion = useCallback((questionId: string, patch: Partial<QuestionState>) => {
        setAnswers(prev => ({ ...prev, [questionId]: { ...prev[questionId], ...patch } }));
    }, []);

    useEffect(() => {
        pruneExpiredAskUserDrafts();
        clearOtherAskUserDraftsForProcess(processId, batch.batchId);
    }, [batch.batchId, processId]);

    useEffect(() => {
        if (!responseAcceptedRef.current) {
            setAskUserDraft(processId, batch.batchId, answers);
        }
    }, [answers, batch.batchId, processId]);

    const canSubmitAll = batch.questions.every(question => isAnswerComplete(question, answers[question.questionId]));

    const submitAll = useCallback(async (skipAll = false) => {
        setSubmitting(true);
        try {
            await getSpaCocClient().processes.askUserResponse(processId, {
                batchId: batch.batchId,
                answers: batch.questions.map(question => {
                    const state = answers[question.questionId];
                    if (skipAll) {
                        return { questionId: question.questionId, skipped: true };
                    }
                    return responseFor(question, state);
                }),
            });
            responseAcceptedRef.current = true;
            clearAskUserDraft(processId, batch.batchId);
            onAnswered();
        } catch {
            // The running AI session owns timeout/cleanup if the response cannot be delivered.
        } finally {
            setSubmitting(false);
        }
    }, [answers, batch.batchId, batch.questions, onAnswered, processId]);

    return (
        <div className="mx-2 my-3 rounded-lg border border-[#0078d4]/30 bg-[#f0f6ff] dark:bg-[#1a2332] p-4 shadow-sm" data-testid="ask-user-inline">
            <div className="flex items-start gap-2 mb-4">
                <span className="text-lg">🤖</span>
                <div>
                    <p className="text-sm text-[#1e1e1e] dark:text-[#e0e0e0] font-semibold">The AI needs your input</p>
                    <p className="text-xs text-[#848484] mt-0.5">
                        {batch.questions.length === 1 ? 'Answer or skip this question.' : `Answer or skip these ${batch.questions.length} questions.`}
                    </p>
                </div>
            </div>

            <div className="space-y-4">
                {batch.questions.map((question, questionIndex) => {
                    const state = answers[question.questionId];
                    const isCustomSelected = question.type === 'select' && state.value === CUSTOM_OPTION_VALUE;
                    const inputDisabled = submitting || state.disposition !== 'answer';
                    return (
                        <div key={question.questionId} className="rounded-md border border-[#d4d4d4]/70 dark:border-[#3e3e3e] bg-white/70 dark:bg-[#1e1e1e]/60 p-3" data-testid="ask-user-question">
                            <div className="flex items-start justify-between gap-3 mb-3">
                                <div className="text-sm text-[#1e1e1e] dark:text-[#e0e0e0] font-medium flex items-start gap-1 min-w-0">
                                    <span className="text-[#848484] shrink-0">{questionIndex + 1}.</span>
                                    <AskUserMarkdown
                                        markdown={question.question}
                                        className="markdown-body ask-user-markdown min-w-0 flex-1"
                                        data-testid="ask-user-question-markdown"
                                    />
                                </div>
                                <label className="shrink-0">
                                    <span className="sr-only">Response type for question {questionIndex + 1}</span>
                                    <select
                                        value={state.disposition}
                                        onChange={e => updateQuestion(question.questionId, { disposition: e.target.value as QuestionDisposition })}
                                        disabled={submitting}
                                        className="max-w-[11rem] rounded border border-[#d4d4d4] dark:border-[#3e3e3e] bg-white dark:bg-[#252526] px-2 py-1 text-xs text-[#4b5563] dark:text-[#cccccc] focus:outline-none focus:ring-2 focus:ring-[#0078d4]"
                                        data-testid="ask-user-question-disposition"
                                    >
                                        <option value="answer">Answer</option>
                                        <option value="skip">Skip / not applicable</option>
                                        <option value="needs-context">Need more context</option>
                                    </select>
                                </label>
                            </div>

                            {state.disposition === 'skip' ? (
                                <p className="text-xs text-[#848484]">This question will be skipped.</p>
                            ) : state.disposition === 'needs-context' ? (
                                <div className="space-y-2">
                                    <p className="text-xs text-[#848484]">
                                        The AI should explain the missing context and re-ask this question if it is still needed.
                                    </p>
                                    <input
                                        type="text"
                                        value={state.note}
                                        onChange={e => updateQuestion(question.questionId, { note: e.target.value })}
                                        disabled={submitting}
                                        maxLength={300}
                                        placeholder="Optional note about what context you need..."
                                        className="w-full px-3 py-1.5 text-sm rounded border border-[#d4d4d4] dark:border-[#3e3e3e] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-2 focus:ring-[#0078d4]"
                                        data-testid="ask-user-deferred-note-input"
                                    />
                                </div>
                            ) : (
                                <>
                                    {question.type === 'select' && question.options && (
                                        <div className="space-y-2 mb-3">
                                            {question.options.map(opt => (
                                                <label key={opt.value} className="flex items-start gap-2 cursor-pointer group">
                                                    <input
                                                        type="radio"
                                                        name={`ask-user-${question.questionId}`}
                                                        value={opt.value}
                                                        checked={state.value === opt.value}
                                                        onChange={() => updateQuestion(question.questionId, { value: opt.value })}
                                                        disabled={inputDisabled}
                                                        className="mt-0.5 accent-[#0078d4]"
                                                    />
                                                    <div>
                                                        <AskUserMarkdown
                                                            inline
                                                            markdown={opt.label}
                                                            className="text-sm text-[#1e1e1e] dark:text-[#cccccc] group-hover:text-[#0078d4]"
                                                            data-testid="ask-user-option-label"
                                                        />
                                                        {opt.description && (
                                                            <AskUserMarkdown
                                                                markdown={opt.description}
                                                                className="text-xs text-[#848484] mt-0.5 ask-user-markdown ask-user-markdown--description"
                                                                data-testid="ask-user-option-description"
                                                            />
                                                        )}
                                                    </div>
                                                </label>
                                            ))}
                                            <label className="flex items-start gap-2 cursor-pointer group">
                                                <input
                                                    type="radio"
                                                    name={`ask-user-${question.questionId}`}
                                                    value={CUSTOM_OPTION_VALUE}
                                                    checked={isCustomSelected}
                                                    onChange={() => updateQuestion(question.questionId, { value: CUSTOM_OPTION_VALUE })}
                                                    disabled={inputDisabled}
                                                    className="mt-0.5 accent-[#0078d4]"
                                                    data-testid="ask-user-custom-radio"
                                                />
                                                <div className="flex-1">
                                                    <span className="text-sm text-[#1e1e1e] dark:text-[#cccccc] group-hover:text-[#0078d4]">Something else...</span>
                                                    {isCustomSelected && (
                                                        <input
                                                            type="text"
                                                            value={state.customText}
                                                            onChange={e => updateQuestion(question.questionId, { customText: e.target.value })}
                                                            disabled={inputDisabled}
                                                            placeholder="Type your answer..."
                                                            autoFocus
                                                            className="mt-1 w-full px-3 py-1.5 text-sm rounded border border-[#d4d4d4] dark:border-[#3e3e3e] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-2 focus:ring-[#0078d4]"
                                                            onKeyDown={e => {
                                                                if (e.key === 'Enter' && canSubmitAll) void submitAll();
                                                            }}
                                                            data-testid="ask-user-custom-input"
                                                        />
                                                    )}
                                                </div>
                                            </label>
                                        </div>
                                    )}

                                    {question.type === 'multi-select' && question.options && (
                                        <div className="space-y-2 mb-3">
                                            {question.options.map(opt => (
                                                <label key={opt.value} className="flex items-start gap-2 cursor-pointer group">
                                                    <input
                                                        type="checkbox"
                                                        value={opt.value}
                                                        checked={Array.isArray(state.value) && state.value.includes(opt.value)}
                                                        onChange={e => {
                                                            const arr = Array.isArray(state.value) ? [...state.value] : [];
                                                            if (e.target.checked) arr.push(opt.value);
                                                            else {
                                                                const idx = arr.indexOf(opt.value);
                                                                if (idx >= 0) arr.splice(idx, 1);
                                                            }
                                                            updateQuestion(question.questionId, { value: arr });
                                                        }}
                                                        disabled={inputDisabled}
                                                        className="mt-0.5 accent-[#0078d4]"
                                                    />
                                                    <div>
                                                        <AskUserMarkdown
                                                            inline
                                                            markdown={opt.label}
                                                            className="text-sm text-[#1e1e1e] dark:text-[#cccccc] group-hover:text-[#0078d4]"
                                                            data-testid="ask-user-option-label"
                                                        />
                                                        {opt.description && (
                                                            <AskUserMarkdown
                                                                markdown={opt.description}
                                                                className="text-xs text-[#848484] mt-0.5 ask-user-markdown ask-user-markdown--description"
                                                                data-testid="ask-user-option-description"
                                                            />
                                                        )}
                                                    </div>
                                                </label>
                                            ))}
                                        </div>
                                    )}

                                    {question.type === 'text' && (
                                        <input
                                            type="text"
                                            value={typeof state.value === 'string' ? state.value : ''}
                                            onChange={e => updateQuestion(question.questionId, { value: e.target.value })}
                                            disabled={inputDisabled}
                                            placeholder="Type your answer..."
                                            className="w-full px-3 py-1.5 text-sm rounded border border-[#d4d4d4] dark:border-[#3e3e3e] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-2 focus:ring-[#0078d4]"
                                            onKeyDown={e => {
                                                if (e.key === 'Enter' && canSubmitAll) void submitAll();
                                            }}
                                            data-testid="ask-user-text-input"
                                        />
                                    )}

                                    {(question.type === 'yes-no' || question.type === 'confirm') && (
                                        <div className="flex items-center gap-3">
                                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                                <input
                                                    type="radio"
                                                    name={`ask-user-${question.questionId}`}
                                                    checked={state.value === true}
                                                    onChange={() => updateQuestion(question.questionId, { value: true })}
                                                    disabled={inputDisabled}
                                                    className="accent-[#0078d4]"
                                                    data-testid={question.type === 'yes-no' ? 'ask-user-yes-radio' : 'ask-user-confirm-radio'}
                                                />
                                                {question.type === 'yes-no' ? 'Yes' : 'Confirm'}
                                            </label>
                                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                                <input
                                                    type="radio"
                                                    name={`ask-user-${question.questionId}`}
                                                    checked={state.value === false}
                                                    onChange={() => updateQuestion(question.questionId, { value: false })}
                                                    disabled={inputDisabled}
                                                    className="accent-[#0078d4]"
                                                    data-testid={question.type === 'yes-no' ? 'ask-user-no-radio' : 'ask-user-cancel-radio'}
                                                />
                                                {question.type === 'yes-no' ? 'No' : 'Cancel'}
                                            </label>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="flex items-center gap-2 mt-4">
                <button
                    onClick={() => void submitAll(false)}
                    disabled={submitting || !canSubmitAll}
                    className="px-4 py-1.5 text-sm font-medium rounded bg-[#0078d4] text-white hover:bg-[#106ebe] disabled:opacity-50 transition-colors"
                    data-testid="ask-user-submit-all-btn"
                >
                    Submit all
                </button>
                <button
                    onClick={() => void submitAll(true)}
                    disabled={submitting}
                    className="px-3 py-1.5 text-sm text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] transition-colors"
                    data-testid="ask-user-skip-all-btn"
                >
                    Skip all
                </button>
                {submitting && <p className="text-xs text-[#848484]">Submitting...</p>}
            </div>
        </div>
    );
}
