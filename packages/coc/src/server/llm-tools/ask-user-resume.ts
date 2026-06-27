/**
 * Ask User Resume helpers
 *
 * Pure functions that support resuming a pending `ask_user` question across a
 * server restart. When an answer is submitted after the in-memory ask_user
 * resolver was torn down by a restart, the answer is converted into a durable
 * {@link PendingAskUserAnswer} record (persisted on the process) and later
 * replayed to the resumed SDK session as a synthesized user message.
 *
 * Keeping the record-builder and message-builder here (free of any store or
 * queue dependency) lets both the submit path and the startup re-enqueue path
 * rebuild the exact same synthesized message at execution time.
 */

import type {
    PendingAskUserAnswer,
    PendingAskUserAnswerEntry,
    PendingAskUserQuestion,
} from '@plusplusoneplusplus/forge';
import type { AskUserAnswerInput } from './ask-user-tool';

/**
 * User-visible error recorded on the process when a post-restart resume can't
 * proceed (session unresumable / provider rejects). Surfaced via AC-05.
 */
export const ASK_USER_RESUME_FAILED_MESSAGE =
    "We couldn't resume this conversation after the server restarted. Start a new turn to continue.";

const NEEDS_CONTEXT_GUIDANCE =
    'The user needs more context before they can answer; provide the missing context and ask a revised version of this question again if the answer is still needed.';

function isDeferred(answer: AskUserAnswerInput): boolean {
    return answer.deferred === true || answer.reason === 'needs-context';
}

/**
 * Coerce a submitted ask_user answer value into the durable record's
 * `string | string[] | null` shape. Booleans (yes-no / confirm questions) are
 * rendered as human-readable strings since the resume delivers prose, not a
 * typed tool_result.
 */
function coerceDurableAnswer(value: AskUserAnswerInput['answer']): string | string[] {
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.map(String);
    return String(value);
}

/**
 * Build a durable {@link PendingAskUserAnswer} record from the persisted
 * questions and the submitted answers, validating that the submission matches
 * the pending batch (same count, same questionIds, no duplicates, consistent
 * skipped/deferred/answer semantics).
 *
 * Returns `null` when the submission does not validly answer the batch — the
 * caller treats `null` as "not found / already answered" (404), mirroring the
 * live `answerQuestions` validation in ask-user-tool.ts so the post-restart
 * path rejects malformed submissions the same way.
 */
export function buildPendingAskUserAnswerRecord(
    pendingQuestions: PendingAskUserQuestion[],
    batchId: string,
    answers: AskUserAnswerInput[],
    submittedAt: string,
): PendingAskUserAnswer | null {
    if (answers.length === 0) return null;

    const batchQuestions = pendingQuestions.filter(q => q.batchId === batchId);
    if (batchQuestions.length === 0) return null;
    if (answers.length !== batchQuestions.length) return null;

    const byId = new Map(batchQuestions.map(q => [q.questionId, q]));
    const seen = new Set<string>();
    const entries: PendingAskUserAnswerEntry[] = [];

    for (const answer of answers) {
        if (seen.has(answer.questionId)) return null;
        seen.add(answer.questionId);

        const question = byId.get(answer.questionId);
        if (!question) return null;

        const skipped = answer.skipped === true;
        const deferred = isDeferred(answer);
        if (skipped && deferred) return null;
        if (!skipped && !deferred && answer.answer === undefined) return null;

        const note = typeof answer.note === 'string' ? answer.note.trim() : '';
        entries.push({
            questionId: answer.questionId,
            question: question.question,
            answer: skipped || deferred ? null : coerceDurableAnswer(answer.answer),
            skipped,
            deferred,
            ...(deferred ? { reason: 'needs-context' as const } : {}),
            ...(note ? { note } : {}),
        });
    }

    return { batchId, answers: entries, submittedAt };
}

function formatEntryAnswer(answer: string | string[]): string {
    return Array.isArray(answer) ? answer.join('; ') : answer;
}

function formatEntry(entry: PendingAskUserAnswerEntry, index: number): string {
    const lead = `${index + 1}. You asked: "${entry.question}"`;
    if (entry.skipped) {
        return `${lead}\n   The user skipped this question (no answer provided).`;
    }
    if (entry.deferred) {
        const note = entry.note ? ` They added: "${entry.note}"` : '';
        return `${lead}\n   The user did not answer yet. ${NEEDS_CONTEXT_GUIDANCE}${note}`;
    }
    return `${lead}\n   The user answered: ${formatEntryAnswer(entry.answer ?? '')}`;
}

/**
 * Build the synthesized user message that delivers a durable answer record to
 * the resumed agent. Carries every question, its answer, and the
 * skipped/deferred semantics so the agent sees the same information a live
 * `ask_user` tool_result would have conveyed.
 */
export function buildAskUserResumeMessage(record: PendingAskUserAnswer): string {
    const body = record.answers.map((entry, index) => formatEntry(entry, index)).join('\n');
    return (
        'The server restarted while you were waiting for the user to answer questions you asked ' +
        'via the ask_user tool. The answers are below. Continue your turn as if these answers had ' +
        'been returned to ask_user normally — do not call ask_user again for these same questions.\n\n' +
        `${body}\n\n` +
        'Continue.'
    );
}
