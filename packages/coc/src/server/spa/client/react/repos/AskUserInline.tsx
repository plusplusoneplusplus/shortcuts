/**
 * AskUserInline
 *
 * Renders an interactive question from the AI inline in the conversation.
 * Supports: select (radio), multi-select (checkboxes), yes-no, confirm, text.
 */

import { useState, useCallback } from 'react';
import { getApiBase } from '../utils/config';
import type { AskUserQuestion } from '../hooks/useChatSSE';

export interface AskUserInlineProps {
    question: AskUserQuestion;
    processId: string;
    onAnswered: () => void;
}

export function AskUserInline({ question, processId, onAnswered }: AskUserInlineProps) {
    const [selected, setSelected] = useState<string | string[] | boolean | null>(() => {
        if (question.type === 'yes-no' || question.type === 'confirm') return null;
        if (question.type === 'multi-select') return (question.defaultValue as string[] | undefined) ?? [];
        if (question.type === 'text') return (question.defaultValue as string | undefined) ?? '';
        return (question.defaultValue as string | undefined) ?? null;
    });
    const [submitting, setSubmitting] = useState(false);

    const submit = useCallback(async (answer: string | string[] | boolean, skipped = false) => {
        setSubmitting(true);
        try {
            await fetch(`${getApiBase()}/processes/${encodeURIComponent(processId)}/ask-user-response`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(skipped ? { questionId: question.questionId, skipped: true } : { questionId: question.questionId, answer }),
            });
            onAnswered();
        } catch {
            // Silently handle failure — the AI session timeout will clean up
        } finally {
            setSubmitting(false);
        }
    }, [processId, question.questionId, onAnswered]);

    const handleSkip = useCallback(() => submit('', true), [submit]);

    return (
        <div className="mx-2 my-3 rounded-lg border border-[#0078d4]/30 bg-[#f0f6ff] dark:bg-[#1a2332] p-4 shadow-sm" data-testid="ask-user-inline">
            <div className="flex items-start gap-2 mb-3">
                <span className="text-lg">🤖</span>
                <p className="text-sm text-[#1e1e1e] dark:text-[#e0e0e0] font-medium">{question.question}</p>
            </div>

            {/* Select (radio buttons) */}
            {question.type === 'select' && question.options && (
                <div className="space-y-2 ml-7 mb-3">
                    {question.options.map(opt => (
                        <label key={opt.value} className="flex items-start gap-2 cursor-pointer group">
                            <input
                                type="radio"
                                name={`ask-user-${question.questionId}`}
                                value={opt.value}
                                checked={selected === opt.value}
                                onChange={() => setSelected(opt.value)}
                                disabled={submitting}
                                className="mt-0.5 accent-[#0078d4]"
                            />
                            <div>
                                <span className="text-sm text-[#1e1e1e] dark:text-[#cccccc] group-hover:text-[#0078d4]">{opt.label}</span>
                                {opt.description && <p className="text-xs text-[#848484] mt-0.5">{opt.description}</p>}
                            </div>
                        </label>
                    ))}
                </div>
            )}

            {/* Multi-select (checkboxes) */}
            {question.type === 'multi-select' && question.options && (
                <div className="space-y-2 ml-7 mb-3">
                    {question.options.map(opt => (
                        <label key={opt.value} className="flex items-start gap-2 cursor-pointer group">
                            <input
                                type="checkbox"
                                value={opt.value}
                                checked={Array.isArray(selected) && selected.includes(opt.value)}
                                onChange={e => {
                                    const arr = Array.isArray(selected) ? [...selected] : [];
                                    if (e.target.checked) arr.push(opt.value);
                                    else {
                                        const idx = arr.indexOf(opt.value);
                                        if (idx >= 0) arr.splice(idx, 1);
                                    }
                                    setSelected(arr);
                                }}
                                disabled={submitting}
                                className="mt-0.5 accent-[#0078d4]"
                            />
                            <div>
                                <span className="text-sm text-[#1e1e1e] dark:text-[#cccccc] group-hover:text-[#0078d4]">{opt.label}</span>
                                {opt.description && <p className="text-xs text-[#848484] mt-0.5">{opt.description}</p>}
                            </div>
                        </label>
                    ))}
                </div>
            )}

            {/* Text input */}
            {question.type === 'text' && (
                <div className="ml-7 mb-3">
                    <input
                        type="text"
                        value={typeof selected === 'string' ? selected : ''}
                        onChange={e => setSelected(e.target.value)}
                        disabled={submitting}
                        placeholder="Type your answer..."
                        className="w-full px-3 py-1.5 text-sm rounded border border-[#d4d4d4] dark:border-[#3e3e3e] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-2 focus:ring-[#0078d4]"
                        onKeyDown={e => {
                            if (e.key === 'Enter' && typeof selected === 'string' && selected.trim()) {
                                void submit(selected);
                            }
                        }}
                        data-testid="ask-user-text-input"
                    />
                </div>
            )}

            {/* Yes/No buttons */}
            {question.type === 'yes-no' && (
                <div className="flex items-center gap-2 ml-7 mb-2">
                    <button
                        onClick={() => submit(true)}
                        disabled={submitting}
                        className="px-4 py-1.5 text-sm font-medium rounded bg-[#0078d4] text-white hover:bg-[#106ebe] disabled:opacity-50 transition-colors"
                        data-testid="ask-user-yes-btn"
                    >
                        Yes
                    </button>
                    <button
                        onClick={() => submit(false)}
                        disabled={submitting}
                        className="px-4 py-1.5 text-sm font-medium rounded bg-[#d4d4d4] dark:bg-[#3e3e3e] text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#c0c0c0] dark:hover:bg-[#505050] disabled:opacity-50 transition-colors"
                        data-testid="ask-user-no-btn"
                    >
                        No
                    </button>
                </div>
            )}

            {/* Confirm/Cancel buttons */}
            {question.type === 'confirm' && (
                <div className="flex items-center gap-2 ml-7 mb-2">
                    <button
                        onClick={() => submit(true)}
                        disabled={submitting}
                        className="px-4 py-1.5 text-sm font-medium rounded bg-[#0078d4] text-white hover:bg-[#106ebe] disabled:opacity-50 transition-colors"
                        data-testid="ask-user-confirm-btn"
                    >
                        Confirm
                    </button>
                    <button
                        onClick={() => submit(false)}
                        disabled={submitting}
                        className="px-4 py-1.5 text-sm font-medium rounded bg-[#d4d4d4] dark:bg-[#3e3e3e] text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#c0c0c0] dark:hover:bg-[#505050] disabled:opacity-50 transition-colors"
                        data-testid="ask-user-cancel-btn"
                    >
                        Cancel
                    </button>
                </div>
            )}

            {/* Submit + Skip for select/multi-select/text */}
            {(question.type === 'select' || question.type === 'multi-select' || question.type === 'text') && (
                <div className="flex items-center gap-2 ml-7">
                    <button
                        onClick={() => {
                            if (selected !== null) void submit(selected as string | string[]);
                        }}
                        disabled={submitting || selected === null || (question.type === 'text' && typeof selected === 'string' && !selected.trim())}
                        className="px-4 py-1.5 text-sm font-medium rounded bg-[#0078d4] text-white hover:bg-[#106ebe] disabled:opacity-50 transition-colors"
                        data-testid="ask-user-submit-btn"
                    >
                        Submit
                    </button>
                    <button
                        onClick={handleSkip}
                        disabled={submitting}
                        className="px-3 py-1.5 text-sm text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] transition-colors"
                        data-testid="ask-user-skip-btn"
                    >
                        Skip
                    </button>
                </div>
            )}

            {/* Skip for yes-no and confirm */}
            {(question.type === 'yes-no' || question.type === 'confirm') && (
                <div className="ml-7">
                    <button
                        onClick={handleSkip}
                        disabled={submitting}
                        className="px-3 py-1 text-xs text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] transition-colors"
                        data-testid="ask-user-skip-btn"
                    >
                        Skip
                    </button>
                </div>
            )}

            {submitting && (
                <p className="text-xs text-[#848484] mt-2 ml-7">Submitting...</p>
            )}
        </div>
    );
}
