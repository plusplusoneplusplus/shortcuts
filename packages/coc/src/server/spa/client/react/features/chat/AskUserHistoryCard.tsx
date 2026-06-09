import { AskUserMarkdown } from './AskUserMarkdown';

interface AskUserOption {
    value: string;
    label: string;
    description?: string;
}

interface AskUserHistoryQuestion {
    questionId?: string;
    question: string;
    type: string;
    options?: AskUserOption[];
    defaultValue?: unknown;
}

interface AskUserHistoryAnswer {
    questionId?: string;
    answer?: unknown;
    skipped?: boolean;
    deferred?: boolean;
    reason?: string;
    note?: string;
}

export interface AskUserHistoryToolCall {
    id?: string;
    toolName?: string;
    name?: string;
    args?: unknown;
    result?: unknown;
    status?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOption(value: unknown): AskUserOption | null {
    if (!isRecord(value)) return null;
    const optionValue = typeof value.value === 'string' ? value.value : '';
    if (!optionValue) return null;
    return {
        value: optionValue,
        label: typeof value.label === 'string' && value.label ? value.label : optionValue,
        ...(typeof value.description === 'string' && value.description ? { description: value.description } : {}),
    };
}

function normalizeQuestion(value: unknown): AskUserHistoryQuestion | null {
    if (!isRecord(value) || typeof value.question !== 'string' || !value.question.trim()) {
        return null;
    }
    const options = Array.isArray(value.options)
        ? value.options.map(normalizeOption).filter((opt): opt is AskUserOption => opt !== null)
        : undefined;
    return {
        ...(typeof value.questionId === 'string' && value.questionId ? { questionId: value.questionId } : {}),
        question: value.question,
        type: typeof value.type === 'string' && value.type ? value.type : 'text',
        ...(options && options.length > 0 ? { options } : {}),
        ...(value.defaultValue !== undefined ? { defaultValue: value.defaultValue } : {}),
    };
}

function getAskUserArgs(toolCall: AskUserHistoryToolCall): Record<string, unknown> | null {
    const args = toolCall.args;
    if (!isRecord(args)) return null;
    if (isRecord(args.arguments) && (Array.isArray(args.arguments.questions) || typeof args.arguments.question === 'string')) {
        return args.arguments;
    }
    return args;
}

export function getAskUserHistoryQuestions(toolCall: AskUserHistoryToolCall): AskUserHistoryQuestion[] {
    const args = getAskUserArgs(toolCall);
    if (!args) return [];
    if (Array.isArray(args.questions)) {
        return args.questions.map(normalizeQuestion).filter((question): question is AskUserHistoryQuestion => question !== null);
    }
    if (typeof args.question === 'string' && args.question.trim()) {
        return [{
            question: args.question,
            type: typeof args.type === 'string' && args.type ? args.type : 'text',
        }];
    }
    return [];
}

function parseAnswers(result: unknown): AskUserHistoryAnswer[] {
    let parsed = result;
    if (typeof result === 'string') {
        if (!result.trim()) return [];
        try {
            parsed = JSON.parse(result);
        } catch {
            return [];
        }
    }
    if (Array.isArray(parsed)) {
        return parsed.filter(isRecord).map((answer) => ({
            ...(typeof answer.questionId === 'string' && answer.questionId ? { questionId: answer.questionId } : {}),
            ...(answer.answer !== undefined ? { answer: answer.answer } : {}),
            ...(typeof answer.skipped === 'boolean' ? { skipped: answer.skipped } : {}),
            ...(typeof answer.deferred === 'boolean' ? { deferred: answer.deferred } : {}),
            ...(typeof answer.reason === 'string' && answer.reason ? { reason: answer.reason } : {}),
            ...(typeof answer.note === 'string' && answer.note ? { note: answer.note } : {}),
        }));
    }
    if (isRecord(parsed) && Array.isArray(parsed.answers)) {
        return parseAnswers(parsed.answers);
    }
    return [];
}

export function hasAskUserHistory(toolCall: AskUserHistoryToolCall): boolean {
    const name = toolCall.toolName ?? toolCall.name;
    if (name !== 'ask_user') return false;
    if (getAskUserHistoryQuestions(toolCall).length === 0) return false;
    return toolCall.status === 'completed' || toolCall.result !== undefined;
}

function answerForQuestion(
    question: AskUserHistoryQuestion,
    questionIndex: number,
    answers: AskUserHistoryAnswer[],
): AskUserHistoryAnswer | undefined {
    if (question.questionId) {
        const byId = answers.find(answer => answer.questionId === question.questionId);
        if (byId) return byId;
    }
    return answers[questionIndex];
}

function optionLabel(question: AskUserHistoryQuestion, value: string): string {
    const option = question.options?.find(opt => opt.value === value);
    if (!option) return value;
    return option.label === value ? value : `${option.label} (${value})`;
}

function formatAnswer(question: AskUserHistoryQuestion, answer: unknown): string {
    if (answer === undefined || answer === null) return 'No answer recorded';
    if (Array.isArray(answer)) {
        if (answer.length === 0) return 'No selections';
        return answer.map(item => formatAnswer(question, item)).join(', ');
    }
    if (typeof answer === 'boolean') {
        if (question.type === 'confirm') return answer ? 'Confirm' : 'Cancel';
        return answer ? 'Yes' : 'No';
    }
    if (typeof answer === 'string') return optionLabel(question, answer);
    if (typeof answer === 'number') return String(answer);
    return JSON.stringify(answer);
}

export function AskUserHistoryCard({ toolCall }: { toolCall: AskUserHistoryToolCall }) {
    const questions = getAskUserHistoryQuestions(toolCall);
    if (questions.length === 0) return null;

    const answers = parseAnswers(toolCall.result);
    const deferredCount = answers.filter(answer => answer.deferred === true || answer.reason === 'needs-context').length;
    const answeredCount = answers.filter(answer => !answer.skipped && answer.answer !== undefined && !(answer.deferred === true || answer.reason === 'needs-context')).length;
    const skippedCount = answers.filter(answer => answer.skipped).length;
    const statusLabel = deferredCount === questions.length
        ? 'Need context'
        : skippedCount === questions.length
        ? 'Skipped'
        : answeredCount > 0
            ? 'Answered'
            : 'Resolved';

    return (
        <div
            className="mx-0 my-2 rounded-lg border border-[#0078d4]/25 bg-[#f8fbff] dark:bg-[#17202b] p-3 shadow-sm"
            data-testid="ask-user-history-card"
        >
            <div className="flex items-start gap-2 mb-3">
                <span className="text-base font-semibold text-[#0969da] dark:text-[#79c0ff]" aria-hidden="true">Q</span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <p className="text-sm text-[#1e1e1e] dark:text-[#e0e0e0] font-semibold">Asked user</p>
                        <span
                            className="rounded-full bg-[#dbeafe] dark:bg-[#17324d] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#0969da] dark:text-[#79c0ff]"
                            data-testid="ask-user-history-status"
                        >
                            {statusLabel}
                        </span>
                    </div>
                    <p className="text-xs text-[#848484] mt-0.5">
                        {questions.length === 1 ? 'Question and response from this run.' : `${questions.length} questions and responses from this run.`}
                    </p>
                </div>
            </div>

            <div className="space-y-3">
                {questions.map((question, index) => {
                    const answer = answerForQuestion(question, index, answers);
                    const skipped = answer?.skipped === true;
                    const deferred = answer?.deferred === true || answer?.reason === 'needs-context';
                    return (
                        <div
                            key={question.questionId ?? `${toolCall.id ?? 'ask-user'}-${index}`}
                            className="rounded-md border border-[#d4d4d4]/70 dark:border-[#3e3e3e] bg-white/75 dark:bg-[#1e1e1e]/65 p-3"
                            data-testid="ask-user-history-question"
                        >
                            <div className="flex items-start gap-1.5 text-sm font-medium text-[#1e1e1e] dark:text-[#e0e0e0]">
                                {questions.length > 1 && <span className="shrink-0 text-[#848484]">{index + 1}.</span>}
                                <AskUserMarkdown
                                    markdown={question.question}
                                    className="markdown-body ask-user-markdown min-w-0 flex-1"
                                    data-testid="ask-user-history-question-markdown"
                                />
                            </div>

                            {question.options && question.options.length > 0 && (
                                <div className="mt-2 text-xs text-[#848484]" data-testid="ask-user-history-options">
                                    <span className="font-medium uppercase tracking-wide">Options</span>
                                    <div className="mt-1 flex flex-wrap gap-1.5">
                                        {question.options.map(option => (
                                            <span
                                                key={option.value}
                                                className="rounded-full border border-[#d4d4d4] dark:border-[#3e3e3e] px-2 py-0.5 text-[#4b5563] dark:text-[#b8b8b8]"
                                                title={option.description}
                                            >
                                                <AskUserMarkdown inline markdown={option.label} />
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div
                                className="mt-3 flex items-start gap-2 rounded-md bg-[#f3f4f6] dark:bg-[#252526] px-2.5 py-2 text-sm"
                                data-testid="ask-user-history-answer"
                                data-skipped={skipped ? 'true' : 'false'}
                                data-deferred={deferred ? 'true' : 'false'}
                            >
                                <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-[#6b7280] dark:text-[#9aa0a6]">
                                    {skipped ? 'Skipped' : deferred ? 'Need context' : 'Answer'}
                                </span>
                                <div className="min-w-0 whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                    <span>
                                        {skipped ? 'Question skipped' : deferred ? 'Need more context' : formatAnswer(question, answer?.answer)}
                                    </span>
                                    {deferred && answer?.note && (
                                        <p className="mt-1 text-xs text-[#6b7280] dark:text-[#9aa0a6]" data-testid="ask-user-history-deferred-note">
                                            Note: {answer.note}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
