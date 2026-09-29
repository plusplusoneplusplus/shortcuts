/**
 * RalphAwaitingInputNode — timeline node shown after the iteration that ended
 * with RALPH_NEEDS_INPUT. Renders the agent's context and question batch, and
 * lets the user answer (or fill every answer from the agent's
 * recommendations), add a note, and either submit or stop the session.
 *
 * Question text and option labels go through `AskUserMarkdown`, the same
 * sanitizing renderer the ask_user form uses.
 */

import type React from 'react';
import { useEffect, useState } from 'react';
import type { RalphInputQuestion, RalphPendingInput } from '@plusplusoneplusplus/coc-client';
import { AskUserMarkdown } from './AskUserMarkdown';

export type RalphInputAnswer = string | string[];

export interface RalphAwaitingInputNodeProps {
    pendingInput: RalphPendingInput;
    onSubmit: (answers: RalphInputAnswer[], note: string | undefined) => Promise<void>;
    onStop: () => Promise<void>;
}

const OPTION_ROW_CLASS = 'flex w-full min-w-0 items-start gap-2 cursor-pointer rounded px-1.5 py-[3px] hover:bg-black/[0.03] dark:hover:bg-white/5';
const OPTION_INPUT_CLASS = 'h-3 w-3 shrink-0 mt-1 accent-[#0078d4]';
const OPTION_LABEL_CLASS = 'min-w-0 text-[13px] leading-5 text-[#1e1e1e] dark:text-[#cccccc]';
const OPTION_DESCRIPTION_CLASS = 'min-w-0 ml-2 text-[11px] leading-5 text-[#848484] ask-user-markdown ask-user-markdown--description';
const TEXT_INPUT_CLASS = 'w-full px-2 py-1 text-[13px] rounded border border-[#d4d4d4] dark:border-[#3e3e3e] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-2 focus:ring-[#0078d4]';

/** Fixed choices for the option-less question types. */
const BUILTIN_OPTIONS: Partial<Record<RalphInputQuestion['type'], Array<{ value: string; label: string }>>> = {
    'yes-no': [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
    confirm: [{ value: 'confirm', label: 'Confirm' }, { value: 'decline', label: 'Decline' }],
};

function optionsFor(question: RalphInputQuestion): Array<{ value: string; label: string; description?: string }> {
    return question.options && question.options.length > 0 ? question.options : BUILTIN_OPTIONS[question.type] ?? [];
}

function coerce(question: RalphInputQuestion, value: RalphInputAnswer | undefined): RalphInputAnswer {
    if (question.type === 'multi-select') {
        if (Array.isArray(value)) return value;
        return value ? [value] : [];
    }
    if (Array.isArray(value)) return value.join(', ');
    return value ?? '';
}

/** Starting answer: the question's default when present, otherwise empty. */
export function initialRalphAnswer(question: RalphInputQuestion): RalphInputAnswer {
    return coerce(question, question.defaultValue);
}

/** The agent's recommendation, shaped for the question type. */
export function recommendedRalphAnswer(question: RalphInputQuestion): RalphInputAnswer {
    const value = coerce(question, question.recommendation);
    if (question.type === 'yes-no' || question.type === 'confirm') {
        return typeof value === 'string' ? value.trim().toLowerCase() : value;
    }
    return value;
}

function isAnswered(question: RalphInputQuestion, value: RalphInputAnswer): boolean {
    if (question.type === 'multi-select') return Array.isArray(value) && value.length > 0;
    return typeof value === 'string' && value.trim().length > 0;
}

export function RalphAwaitingInputNode({ pendingInput, onSubmit, onStop }: RalphAwaitingInputNodeProps): React.ReactElement {
    const { request, iteration } = pendingInput;
    const [answers, setAnswers] = useState<RalphInputAnswer[]>(() => request.questions.map(initialRalphAnswer));
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState<'idle' | 'submitting' | 'stopping'>('idle');
    const [error, setError] = useState<string | null>(null);

    // A new batch (a later iteration asked again) starts from a clean form.
    useEffect(() => {
        setAnswers(request.questions.map(initialRalphAnswer));
        setNote('');
        setError(null);
    }, [pendingInput.requestedAt, pendingInput.iteration]); // eslint-disable-line react-hooks/exhaustive-deps

    const setAnswer = (index: number, value: RalphInputAnswer) => {
        setAnswers(prev => prev.map((a, i) => (i === index ? value : a)));
    };

    const canSubmit = busy === 'idle' && request.questions.every((q, i) => isAnswered(q, answers[i]));

    const run = async (kind: 'submitting' | 'stopping', action: () => Promise<void>) => {
        setBusy(kind);
        setError(null);
        try {
            await action();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy('idle');
        }
    };

    const handleSubmit = () => run('submitting', () => {
        const trimmedNote = note.trim();
        const payload = answers.map(a => (Array.isArray(a) ? a : a.trim()));
        return onSubmit(payload, trimmedNote ? trimmedNote : undefined);
    });

    return (
        <div
            className="rounded-md border border-amber-300 bg-amber-50/70 px-3 py-2 text-xs dark:border-amber-600/60 dark:bg-amber-500/[0.08]"
            data-testid="ralph-awaiting-input-node"
        >
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-amber-500 dark:bg-amber-400" />
                <span className="font-semibold text-amber-800 dark:text-amber-200">Awaiting input</span>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Iteration {iteration} asked {request.questions.length === 1 ? '1 question' : `${request.questions.length} questions`}
                </span>
            </div>

            <AskUserMarkdown
                markdown={request.context}
                className="markdown-body ask-user-markdown mb-2 min-w-0 text-[12px] text-zinc-700 dark:text-zinc-300"
                data-testid="ralph-awaiting-input-context"
            />

            <div className="space-y-2">
                {request.questions.map((question, index) => {
                    const value = answers[index];
                    const name = `ralph-input-${pendingInput.iteration}-${index}`;
                    const options = optionsFor(question);
                    return (
                        <div
                            key={index}
                            className="rounded border border-[#d4d4d4]/70 bg-white/70 px-2 py-1.5 dark:border-[#3e3e3e] dark:bg-[#1e1e1e]/60"
                            data-testid="ralph-awaiting-input-question"
                        >
                            <div className="flex items-start gap-1.5 text-[13px] leading-5 text-[#1e1e1e] dark:text-[#e0e0e0]">
                                <span className="shrink-0 text-[#848484]">{index + 1}.</span>
                                <AskUserMarkdown markdown={question.question} className="markdown-body ask-user-markdown min-w-0 flex-1" />
                            </div>
                            <p className="ml-4 text-[11px] text-[#848484]" data-testid="ralph-awaiting-input-recommendation">
                                Recommended: {Array.isArray(question.recommendation) ? question.recommendation.join(', ') : question.recommendation}
                            </p>
                            {question.type === 'text' || options.length === 0 ? (
                                <textarea
                                    value={typeof value === 'string' ? value : ''}
                                    onChange={e => setAnswer(index, e.target.value)}
                                    disabled={busy !== 'idle'}
                                    rows={2}
                                    placeholder="Type your answer..."
                                    className={`mt-1 ml-4 ${TEXT_INPUT_CLASS}`}
                                    data-testid="ralph-awaiting-input-text"
                                />
                            ) : (
                                <div className="mt-1 ml-4 min-w-0">
                                    {options.map(opt => {
                                        const multi = question.type === 'multi-select';
                                        const checked = multi
                                            ? Array.isArray(value) && value.includes(opt.value)
                                            : value === opt.value;
                                        return (
                                            <label key={opt.value} className={OPTION_ROW_CLASS} title={opt.description}>
                                                <input
                                                    type={multi ? 'checkbox' : 'radio'}
                                                    name={name}
                                                    value={opt.value}
                                                    checked={checked}
                                                    disabled={busy !== 'idle'}
                                                    onChange={e => {
                                                        if (!multi) {
                                                            setAnswer(index, opt.value);
                                                            return;
                                                        }
                                                        const current = Array.isArray(value) ? value : [];
                                                        setAnswer(index, e.target.checked
                                                            ? [...current, opt.value]
                                                            : current.filter(v => v !== opt.value));
                                                    }}
                                                    className={OPTION_INPUT_CLASS}
                                                    data-testid="ralph-awaiting-input-option"
                                                />
                                                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                                                    <AskUserMarkdown inline markdown={opt.label} className={OPTION_LABEL_CLASS} />
                                                    {opt.description && (
                                                        <AskUserMarkdown inline markdown={opt.description} className={OPTION_DESCRIPTION_CLASS} />
                                                    )}
                                                </span>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                disabled={busy !== 'idle'}
                rows={2}
                placeholder="Optional note for the next iteration..."
                className={`mt-2 ${TEXT_INPUT_CLASS}`}
                data-testid="ralph-awaiting-input-note"
            />

            {error && (
                <p className="mt-1 text-red-700 dark:text-red-300" data-testid="ralph-awaiting-input-error">{error}</p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={() => void handleSubmit()}
                    disabled={!canSubmit}
                    className="rounded bg-[#0078d4] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#106ebe] disabled:opacity-50"
                    data-testid="ralph-awaiting-input-submit"
                >
                    {busy === 'submitting' ? 'Submitting…' : 'Submit answers'}
                </button>
                <button
                    type="button"
                    onClick={() => setAnswers(request.questions.map(recommendedRalphAnswer))}
                    disabled={busy !== 'idle'}
                    className="rounded border border-[#0078d4]/50 px-2 py-1 text-xs text-[#0078d4] hover:bg-[#0078d4]/10 disabled:opacity-50 dark:text-[#3794ff]"
                    data-testid="ralph-awaiting-input-use-recommendation"
                >
                    Use recommendation
                </button>
                <div className="flex-1" />
                <button
                    type="button"
                    onClick={() => void run('stopping', onStop)}
                    disabled={busy !== 'idle'}
                    className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950/40"
                    data-testid="ralph-awaiting-input-stop"
                >
                    {busy === 'stopping' ? 'Stopping…' : 'Stop session'}
                </button>
            </div>
        </div>
    );
}
