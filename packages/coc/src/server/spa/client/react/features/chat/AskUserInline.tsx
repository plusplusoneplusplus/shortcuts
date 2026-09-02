/**
 * AskUserInline — renders one batched interactive ask_user form from the AI.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AskUserResponseRequest } from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../repos/cloneRouting';
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
    /** Owning workspace, so the ask_user reply routes to the chat's clone (AC-07). */
    workspaceId?: string;
}

type AnswerValue = AskUserDraftValue;

interface QuestionState {
    value: AnswerValue;
    customText: string;
    disposition: AskUserQuestionDisposition;
    note: string;
}

const CUSTOM_OPTION_VALUE = '__ask_user_custom__';

/**
 * Compact option rows: the label and its description flow as inline text in one
 * shrinkable column next to the radio/checkbox. Nothing is truncated - long
 * options wrap onto as many lines as they need while staying inside the card's
 * border. The radio sits on the first line.
 */
const OPTION_ROW_CLASS = 'flex w-full min-w-0 items-start gap-2 cursor-pointer group rounded px-1.5 py-[3px] hover:bg-black/[0.03] dark:hover:bg-white/5';
const OPTION_ROW_SELECTED_CLASS = 'bg-[#0078d4]/10';
const OPTION_INPUT_CLASS = 'h-3 w-3 shrink-0 mt-1 accent-[#0078d4]';
const OPTION_TEXT_CLASS = 'min-w-0 flex-1 [overflow-wrap:anywhere]';
const OPTION_LABEL_CLASS = 'min-w-0 text-[13px] leading-5 text-[#1e1e1e] dark:text-[#cccccc] group-hover:text-[#0078d4]';
const OPTION_DESCRIPTION_CLASS = 'min-w-0 ml-2 text-[11px] leading-5 text-[#848484] ask-user-markdown ask-user-markdown--description';

function optionRowClass(selected: boolean): string {
    return selected ? `${OPTION_ROW_CLASS} ${OPTION_ROW_SELECTED_CLASS}` : OPTION_ROW_CLASS;
}
type RalphGrillPlanningSummary = NonNullable<NonNullable<AskUserQuestion['ralphGrill']>['planning']>;

interface QuestionGroup {
    key: string;
    label?: string;
    questions: AskUserQuestion[];
}

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

function planningSummaryFor(batch: AskUserBatch): RalphGrillPlanningSummary | undefined {
    return batch.questions.find(question => question.ralphGrill?.planning)?.ralphGrill?.planning;
}

function roleGroupLabel(question: AskUserQuestion): string | undefined {
    const labels = question.ralphGrill?.sources
        ?.map(source => source.roleLabel)
        .filter((label, index, all) => all.indexOf(label) === index);
    if (!labels || labels.length === 0) return undefined;
    return labels.join(' + ');
}

function groupQuestions(questions: AskUserQuestion[]): QuestionGroup[] {
    if (!questions.some(question => question.ralphGrill?.sources?.length)) {
        return [{ key: 'all', questions }];
    }

    const groups: QuestionGroup[] = [];
    const byKey = new Map<string, QuestionGroup>();
    for (const question of questions) {
        const label = roleGroupLabel(question) ?? 'Other questions';
        const key = label.toLowerCase();
        let group = byKey.get(key);
        if (!group) {
            group = { key, label, questions: [] };
            byKey.set(key, group);
            groups.push(group);
        }
        group.questions.push(question);
    }
    return groups;
}

function formatDepth(depth: string): string {
    return depth ? depth.charAt(0).toUpperCase() + depth.slice(1) : 'Standard';
}

function PlanningCard({ planning }: { planning: RalphGrillPlanningSummary }) {
    const completedCount = planning.agentOutcomes.filter(outcome => outcome.status === 'completed').length;
    const failedCount = planning.agentOutcomes.filter(outcome => outcome.status === 'failed').length;
    const emptyCount = planning.agentOutcomes.filter(outcome => outcome.status === 'empty').length;
    const warningCount = planning.warnings.length;
    return (
        <div className="mb-2 rounded-md border border-purple-200 bg-purple-50/80 p-3 text-xs text-purple-900 dark:border-purple-500/30 dark:bg-purple-500/10 dark:text-purple-100" data-testid="ralph-grill-planning-card">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <div className="font-semibold">Question planning</div>
                    <div className="mt-0.5 text-purple-800/80 dark:text-purple-100/75">
                        Round {planning.round} of up to {planning.maxRounds} · {formatDepth(planning.depth)} depth · {planning.consolidation.rawCandidateCount} candidates → {planning.consolidation.selectedQuestionCount} questions
                    </div>
                </div>
                <div className="rounded-full bg-white/80 px-2 py-0.5 font-medium text-purple-700 dark:bg-purple-500/15 dark:text-purple-200">
                    {completedCount} completed{failedCount ? ` · ${failedCount} failed` : ''}{emptyCount ? ` · ${emptyCount} empty` : ''}
                </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
                {planning.agentOutcomes.map(outcome => (
                    <span
                        key={`${outcome.role}-${outcome.provenanceLabel}`}
                        className="rounded-full border border-purple-200 bg-white/80 px-2 py-0.5 text-[11px] text-purple-800 dark:border-purple-500/30 dark:bg-[#1f1f1f]/70 dark:text-purple-100"
                        data-testid="ralph-grill-agent-outcome-chip"
                    >
                        {outcome.provenanceLabel} · {outcome.status} · {outcome.candidateCount}
                    </span>
                ))}
            </div>
            <div className="mt-2 text-[11px] text-purple-800/85 dark:text-purple-100/75">
                Dedupe: {planning.consolidation.exactDuplicatesMerged} exact, {planning.consolidation.semanticDuplicatesMerged} semantic, {planning.consolidation.conflictsConverted} conflicts converted.
                {planning.consolidation.duplicateOnlyAgents.length > 0 && (
                    <> Duplicate-only: {planning.consolidation.duplicateOnlyAgents.join(', ')}.</>
                )}
            </div>
            {warningCount > 0 && (
                <div className="mt-2 rounded border border-amber-300/60 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" data-testid="ralph-grill-planning-warnings">
                    {warningCount === 1 ? planning.warnings[0] : `${warningCount} planning warnings; goal creation can continue.`}
                </div>
            )}
        </div>
    );
}

function QuestionProvenance({ question }: { question: AskUserQuestion }) {
    const sources = question.ralphGrill?.sources ?? [];
    const consolidation = question.ralphGrill?.consolidation;
    if (sources.length === 0 && !consolidation) return null;
    return (
        <div className="mt-2 flex flex-wrap gap-1" data-testid="ask-user-provenance-row">
            {sources.map(source => (
                <span
                    key={`${source.role}-${source.provenanceLabel}`}
                    className="rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-700 dark:bg-purple-500/10 dark:text-purple-200"
                    data-testid="ask-user-provenance-chip"
                >
                    {source.provenanceLabel}
                </span>
            ))}
            {consolidation && consolidation.mergedCandidateCount > 1 && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-[#2d2d2d] dark:text-[#cccccc]" data-testid="ask-user-consolidation-chip">
                    {consolidation.kind} · {consolidation.mergedCandidateCount} candidates
                </span>
            )}
        </div>
    );
}

export function AskUserInline({ batch, processId, onAnswered, workspaceId }: AskUserInlineProps) {
    const cloneClient = useCocClient(workspaceId);
    const responseAcceptedRef = useRef(false);
    const [answers, setAnswers] = useState<Record<string, QuestionState>>(() => initialAnswers(batch, processId));
    const [submitting, setSubmitting] = useState(false);
    const planning = planningSummaryFor(batch);
    const questionGroups = groupQuestions(batch.questions);
    // A one-question batch is already framed by the outer card, so the nested
    // border/padding is pure noise; keep it only when questions need separating.
    const nestQuestionCards = batch.questions.length > 1;

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
            await cloneClient.processes.askUserResponse(processId, {
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
    }, [answers, batch.batchId, batch.questions, onAnswered, processId, cloneClient]);

    return (
        <div className="mx-2 my-3 overflow-hidden rounded-md border border-[#0078d4]/30 bg-[#f0f6ff] dark:bg-[#1a2332] px-2.5 py-2 shadow-sm" data-testid="ask-user-inline">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <span className="text-xs">🤖</span>
                <p className="text-xs font-semibold text-[#1e1e1e] dark:text-[#e0e0e0]">The AI needs your input</p>
                <p className="text-[11px] text-[#848484]">
                    {batch.questions.length === 1 ? '1 question' : `${batch.questions.length} questions`}
                </p>
                <div className="flex-1" />
                {submitting && <p className="text-[11px] text-[#848484]">Submitting...</p>}
                <button
                    onClick={() => void submitAll(false)}
                    disabled={submitting || !canSubmitAll}
                    className="px-2.5 py-1 text-xs font-medium rounded bg-[#0078d4] text-white hover:bg-[#106ebe] disabled:opacity-50 transition-colors"
                    data-testid="ask-user-submit-all-btn"
                >
                    {batch.questions.length === 1 ? 'Submit' : 'Submit all'}
                </button>
                <button
                    onClick={() => void submitAll(true)}
                    disabled={submitting}
                    className="px-1.5 py-1 text-xs text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] transition-colors"
                    data-testid="ask-user-skip-all-btn"
                >
                    {batch.questions.length === 1 ? 'Skip' : 'Skip all'}
                </button>
            </div>

            {planning && <PlanningCard planning={planning} />}

            <div className="space-y-2">
                {questionGroups.map(group => (
                    <div key={group.key} className="space-y-1" data-testid="ask-user-question-group">
                        {group.label && (
                            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-200" data-testid="ask-user-question-group-label">
                                <span className="h-px flex-1 bg-purple-200 dark:bg-purple-500/30" />
                                {group.label}
                                <span className="h-px flex-1 bg-purple-200 dark:bg-purple-500/30" />
                            </div>
                        )}
                        {group.questions.map((question) => {
                            const questionIndex = batch.questions.findIndex(item => item.questionId === question.questionId);
                            const state = answers[question.questionId];
                            const isCustomSelected = question.type === 'select' && state.value === CUSTOM_OPTION_VALUE;
                            const inputDisabled = submitting || state.disposition !== 'answer';
                            return (
                                <div
                                    key={question.questionId}
                                    className={nestQuestionCards
                                        ? 'rounded border border-[#d4d4d4]/70 dark:border-[#3e3e3e] bg-white/70 dark:bg-[#1e1e1e]/60 px-2 py-1.5'
                                        : ''}
                                    data-testid="ask-user-question"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="text-[13px] leading-5 text-[#1e1e1e] dark:text-[#e0e0e0] flex items-start gap-1.5 min-w-0">
                                            <span className="text-[#848484] shrink-0">{questionIndex + 1}.</span>
                                            <div className="min-w-0 flex-1">
                                                <AskUserMarkdown
                                                    markdown={question.question}
                                                    className="markdown-body ask-user-markdown min-w-0"
                                                    data-testid="ask-user-question-markdown"
                                                />
                                                <QuestionProvenance question={question} />
                                            </div>
                                        </div>
                                        <label className="shrink-0">
                                            <span className="sr-only">Response type for question {questionIndex + 1}</span>
                                            <select
                                                value={state.disposition}
                                                onChange={e => updateQuestion(question.questionId, { disposition: e.target.value as AskUserQuestionDisposition })}
                                                disabled={submitting}
                                                className="max-w-[9rem] cursor-pointer rounded border border-transparent bg-transparent px-1 py-0 text-[11px] text-[#848484] hover:border-[#d4d4d4] hover:text-[#1e1e1e] dark:hover:border-[#3e3e3e] dark:hover:text-[#cccccc] focus:outline-none focus:ring-2 focus:ring-[#0078d4]"
                                                data-testid="ask-user-question-disposition"
                                            >
                                                <option value="answer">Answer</option>
                                                <option value="skip">Skip</option>
                                                <option value="needs-context">Need context</option>
                                            </select>
                                        </label>
                                    </div>

                            {state.disposition === 'skip' ? (
                                <p className="mt-1 ml-4 text-[11px] text-[#848484]">This question will be skipped.</p>
                            ) : state.disposition === 'needs-context' ? (
                                <div className="mt-1 ml-4 space-y-1">
                                    <p className="text-[11px] text-[#848484]">
                                        The AI should explain the missing context and re-ask this question if it is still needed.
                                    </p>
                                    <input
                                        type="text"
                                        value={state.note}
                                        onChange={e => updateQuestion(question.questionId, { note: e.target.value })}
                                        disabled={submitting}
                                        maxLength={300}
                                        placeholder="Optional note about what context you need..."
                                        className="w-full px-2 py-1 text-[13px] rounded border border-[#d4d4d4] dark:border-[#3e3e3e] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-2 focus:ring-[#0078d4]"
                                        data-testid="ask-user-deferred-note-input"
                                    />
                                </div>
                            ) : (
                                <>
                                    {question.type === 'select' && question.options && (
                                        <div className="mt-1 ml-4 min-w-0">
                                            {question.options.map(opt => (
                                                <label
                                                    key={opt.value}
                                                    title={opt.description}
                                                    className={optionRowClass(state.value === opt.value)}
                                                >
                                                    <input
                                                        type="radio"
                                                        name={`ask-user-${question.questionId}`}
                                                        value={opt.value}
                                                        checked={state.value === opt.value}
                                                        onChange={() => updateQuestion(question.questionId, { value: opt.value })}
                                                        disabled={inputDisabled}
                                                        className={OPTION_INPUT_CLASS}
                                                    />
                                                    <span className={OPTION_TEXT_CLASS}>
                                                        <AskUserMarkdown
                                                            inline
                                                            markdown={opt.label}
                                                            className={OPTION_LABEL_CLASS}
                                                            data-testid="ask-user-option-label"
                                                        />
                                                        {opt.description && (
                                                            <AskUserMarkdown
                                                                inline
                                                                markdown={opt.description}
                                                                className={OPTION_DESCRIPTION_CLASS}
                                                                data-testid="ask-user-option-description"
                                                            />
                                                        )}
                                                    </span>
                                                </label>
                                            ))}
                                            <label className={optionRowClass(isCustomSelected)}>
                                                <input
                                                    type="radio"
                                                    name={`ask-user-${question.questionId}`}
                                                    value={CUSTOM_OPTION_VALUE}
                                                    checked={isCustomSelected}
                                                    onChange={() => updateQuestion(question.questionId, { value: CUSTOM_OPTION_VALUE })}
                                                    disabled={inputDisabled}
                                                    className={OPTION_INPUT_CLASS}
                                                    data-testid="ask-user-custom-radio"
                                                />
                                                <span className={OPTION_TEXT_CLASS}>
                                                    <span className={OPTION_LABEL_CLASS}>Something else...</span>
                                                </span>
                                            </label>
                                            {isCustomSelected && (
                                                <input
                                                    type="text"
                                                    value={state.customText}
                                                    onChange={e => updateQuestion(question.questionId, { customText: e.target.value })}
                                                    disabled={inputDisabled}
                                                    placeholder="Type your answer..."
                                                    autoFocus
                                                    className="mt-1 w-full px-2 py-1 text-[13px] rounded border border-[#d4d4d4] dark:border-[#3e3e3e] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-2 focus:ring-[#0078d4]"
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter' && canSubmitAll) void submitAll();
                                                    }}
                                                    data-testid="ask-user-custom-input"
                                                />
                                            )}
                                        </div>
                                    )}

                                    {question.type === 'multi-select' && question.options && (
                                        <div className="mt-1 ml-4 min-w-0">
                                            {question.options.map(opt => (
                                                <label
                                                    key={opt.value}
                                                    title={opt.description}
                                                    className={optionRowClass(Array.isArray(state.value) && state.value.includes(opt.value))}
                                                >
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
                                                        className={OPTION_INPUT_CLASS}
                                                    />
                                                    <span className={OPTION_TEXT_CLASS}>
                                                        <AskUserMarkdown
                                                            inline
                                                            markdown={opt.label}
                                                            className={OPTION_LABEL_CLASS}
                                                            data-testid="ask-user-option-label"
                                                        />
                                                        {opt.description && (
                                                            <AskUserMarkdown
                                                                inline
                                                                markdown={opt.description}
                                                                className={OPTION_DESCRIPTION_CLASS}
                                                                data-testid="ask-user-option-description"
                                                            />
                                                        )}
                                                    </span>
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
                                            className="mt-1 w-full px-2 py-1 text-[13px] rounded border border-[#d4d4d4] dark:border-[#3e3e3e] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-2 focus:ring-[#0078d4]"
                                            onKeyDown={e => {
                                                if (e.key === 'Enter' && canSubmitAll) void submitAll();
                                            }}
                                            data-testid="ask-user-text-input"
                                        />
                                    )}

                                    {(question.type === 'yes-no' || question.type === 'confirm') && (
                                        <div className="mt-1 ml-4 flex items-center gap-3">
                                            <label className="flex items-center gap-2 text-[13px] leading-5 text-[#1e1e1e] dark:text-[#cccccc] cursor-pointer">
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
                                            <label className="flex items-center gap-2 text-[13px] leading-5 text-[#1e1e1e] dark:text-[#cccccc] cursor-pointer">
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
                ))}
            </div>
        </div>
    );
}
