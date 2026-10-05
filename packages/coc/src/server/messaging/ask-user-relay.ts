/**
 * Relays `ask_user` questions from a chat or handed-off job that came from WhatsApp or
 * Teams back to the originating group/thread, one question at a time, and
 * turns replies there into answers.
 *
 * Platform-neutral: answer parsing, the question layout, the in-memory
 * pending-question registry and reply matching live here. Each connector
 * registers a {@link QuestionTransport} that knows where a request came from
 * and how to post a formatted question.
 *
 * Answers go through the same `ask_user` pending map the dashboard resolves
 * (`AskUserEmitControl`), so whichever answer arrives first wins. Questions
 * never time out; the turn's `cancelAll` clears them.
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { AskUserAnswerValue, AskUserEmitControl, AskUserSSEPayload } from '../llm-tools/ask-user-tool';
import type { MessagingJobOrigin } from './job-notices';

// ============================================================================
// Answer parsing
// ============================================================================

export type QuestionReply =
    | { kind: 'answer'; value: AskUserAnswerValue }
    | { kind: 'skip' }
    | { kind: 'invalid'; error: string };

type QuestionShape = Pick<AskUserSSEPayload, 'type' | 'options'>;

function hasOptions(question: QuestionShape): boolean {
    return (question.type === 'select' || question.type === 'multi-select') && !!question.options?.length;
}

function optionByText(question: QuestionShape, text: string) {
    const needle = text.toLowerCase();
    return question.options?.find(option =>
        option.label.toLowerCase() === needle || option.value.toLowerCase() === needle);
}

/** Parse a chat reply into an answer for `question`. */
export function parseQuestionReply(question: QuestionShape, text: string): QuestionReply {
    const reply = text.trim();
    if (!reply) return { kind: 'invalid', error: 'Please reply with your answer.' };
    if (/^skip$/i.test(reply)) return { kind: 'skip' };
    const options = question.options ?? [];
    if (question.type === 'yes-no' || question.type === 'confirm') {
        if (/^(y|yes)$/i.test(reply)) return { kind: 'answer', value: true };
        if (/^(n|no)$/i.test(reply)) return { kind: 'answer', value: false };
    }
    if (hasOptions(question)) {
        if (question.type === 'select') {
            const option = /^\d+$/.test(reply) ? options[Number(reply) - 1] : optionByText(question, reply);
            if (option) return { kind: 'answer', value: option.value };
        } else {
            const option = optionByText(question, reply);
            if (option) return { kind: 'answer', value: [option.value] };
            const parts = reply.split(/[\s,]+/).filter(Boolean);
            if (parts.length && parts.every(part => /^\d+$/.test(part) && options[Number(part) - 1])) {
                return { kind: 'answer', value: [...new Set(parts.map(part => options[Number(part) - 1].value))] };
            }
        }
    }
    return { kind: 'answer', value: reply };
}

// ============================================================================
// Layout
// ============================================================================

/** Platform-neutral question layout; each connector renders it with its own formatting. */
export interface QuestionLayout {
    /** `(Question 2 of 3)`, only when the batch has more than one question. */
    progress?: string;
    question: string;
    /** One entry per option, already numbered (`1. Postgres`). */
    options: string[];
    /** One-line reply hint, e.g. `Reply: 2 or "skip"`. */
    hint: string;
}

export function questionHint(question: QuestionShape): string {
    const count = question.options?.length ?? 0;
    const example = question.type === 'yes-no' || question.type === 'confirm' ? 'yes / no'
        : hasOptions(question) && question.type === 'multi-select' ? (count > 1 ? '1,2' : '1')
            : hasOptions(question) ? (count > 1 ? `1-${count}` : '1')
                : 'your answer';
    return `Reply: ${example}${example === 'your answer' ? '' : ', your own answer,'} or "skip"`;
}

export function buildQuestionLayout(question: AskUserSSEPayload, index: number, total: number): QuestionLayout {
    return {
        ...(total > 1 ? { progress: `(Question ${index + 1} of ${total})` } : {}),
        question: question.question.trim(),
        options: hasOptions(question)
            ? question.options!.map((option, i) =>
                `${i + 1}. ${option.label}${option.description ? ` — ${option.description}` : ''}`)
            : [],
        hint: questionHint(question),
    };
}

// ============================================================================
// Relay hub
// ============================================================================

/** Where a relayed question is posted. */
export interface QuestionTarget {
    /** Group/channel identity shared by every message in that chat. */
    chatKey: string;
    /**
     * Reply-to id that addresses the whole thread (Teams thread root). Teams
     * replies always point at the root, so a reply there answers the thread's
     * posted question.
     */
    threadId?: string;
}

export interface QuestionRelayLocation {
    processId: string;
    /** Connector request id, or the question batch id for a handed-off job. */
    requestId: string;
    /** Durable origin of a handed-off job, independent of the selected dispatcher. */
    origin?: MessagingJobOrigin;
}

export interface QuestionTransport {
    readonly platform: 'whatsapp' | 'teams';
    /** The request's origin, or undefined when this connector did not start it. */
    locate(request: QuestionRelayLocation): QuestionTarget | undefined;
    /** Post one question; resolves to its message id. Throws when the connector is unreachable. */
    post(target: QuestionTarget, layout: QuestionLayout, request: QuestionRelayLocation): Promise<string>;
    /** A question message id from an earlier turn (persisted receipt). */
    isPastQuestion?(messageId: string): boolean;
}

/** An inbound connector message that may answer a relayed question. */
export interface QuestionReplyInbound {
    chatKey: string;
    messageId: string;
    replyToId?: string;
    text: string;
    reply: (text: string) => Promise<void>;
    acknowledge: () => Promise<void>;
}

export interface AskUserQuestionRelayRequest extends QuestionRelayLocation {
    questions: AskUserSSEPayload[];
    control: AskUserEmitControl;
}

/** Late-bound executor capability: route a turn's questions to its connector. */
export interface AskUserQuestionRelay {
    /** Returns true when a connector owns the request and is relaying it. */
    relay(request: AskUserQuestionRelayRequest): boolean;
    /** The connector and group/channel a turn came from; undefined for dashboard turns. */
    locateOrigin?(request: QuestionRelayLocation): MessagingJobOrigin | undefined;
}

interface Entry {
    origin?: MessagingJobOrigin;
    transport: QuestionTransport;
    requestId: string;
    platform: QuestionTransport['platform'];
    target: QuestionTarget;
    processId: string;
    question: AskUserSSEPayload;
    hint: string;
    messageId: string;
    control: AskUserEmitControl;
    state: 'pending' | 'answered';
    answeredElsewhere?: boolean;
}

export const QUESTION_RELAY_TEXT = {
    alreadyAnswered: 'This question was already answered.',
    inactive: 'This question is no longer active.',
    ambiguous: 'Multiple questions are waiting in this thread. Reply to a specific question or answer in the dashboard.',
} as const;

const MAX_REMEMBERED = 2_000;

function remember(set: Set<string>, key: string): void {
    set.add(key);
    if (set.size > MAX_REMEMBERED) set.delete(set.values().next().value as string);
}

export class AskUserQuestionRelayHub implements AskUserQuestionRelay {
    private readonly transports: QuestionTransport[] = [];
    private readonly entries = new Set<Entry>();
    private readonly cleared = new Set<string>();
    private readonly handled = new Set<string>();

    constructor(private readonly deps: { store: Pick<ProcessStore, 'getProcess' | 'updateProcess'> }) {}

    register(transport: QuestionTransport): void {
        this.transports.push(transport);
    }

    relay(request: AskUserQuestionRelayRequest): boolean {
        const located = this.locate(request);
        if (!located) return false;
        const { transport, target } = located;
        void this.run(transport, target, request).catch(error =>
            console.error(`[ask-user-relay] ${transport.platform} relay failed:`, error));
        return true;
    }

    locateOrigin(request: QuestionRelayLocation): MessagingJobOrigin | undefined {
        const located = this.locate(request);
        return located ? { connector: located.transport.platform, chatKey: located.target.chatKey,
            ...(located.target.threadId ? { threadId: located.target.threadId } : {}),
        } : undefined;
    }

    private locate(request: QuestionRelayLocation): { transport: QuestionTransport; target: QuestionTarget } | undefined {
        for (const transport of this.transports) {
            if (request.origin && request.origin.connector !== transport.platform) continue;
            try {
                const target = transport.locate(request);
                if (target) return { transport, target };
            } catch (error) {
                console.error(`[ask-user-relay] Could not locate ${transport.platform} request:`, error);
            }
        }
        return undefined;
    }

    /** Pending questions, for tests and diagnostics. */
    pendingCount(chatKey?: string): number {
        return [...this.entries].filter(e => e.state === 'pending' && (!chatKey || e.target.chatKey === chatKey)).length;
    }

    private async run(transport: QuestionTransport, target: QuestionTarget, request: AskUserQuestionRelayRequest): Promise<void> {
        const { control, questions } = request;
        const session = new Set<Entry>();
        let cancelled = false;
        // Turn end (`cancelAll`) clears the session, answered or not.
        control.onCancelAll(() => {
            cancelled = true;
            for (const entry of session) {
                this.entries.delete(entry);
                remember(this.cleared, `${entry.platform}:${entry.messageId}`);
            }
        });
        for (let i = 0; i < questions.length; i++) {
            const question = questions[i];
            if (cancelled || !control.isPending(question.questionId)) continue;
            const layout = buildQuestionLayout(question, i, questions.length);
            let messageId: string;
            try {
                messageId = await transport.post(target, layout, request);
                if (!messageId) throw new Error('Send returned no message id');
            } catch (error) {
                console.error(`[ask-user-relay] Could not post ${transport.platform} question; resolving as unavailable:`, error);
                if (control.resolveUnavailable(question.questionId)) await this.syncPending(request);
                continue;
            }
            const entry: Entry = {
                transport, requestId: request.requestId, origin: request.origin,
                platform: transport.platform, target, processId: request.processId, question,
                hint: layout.hint, messageId, control, state: 'pending',
            };
            if (cancelled || !control.isPending(question.questionId)) {
                remember(this.cleared, `${entry.platform}:${messageId}`);
                continue;
            }
            session.add(entry);
            this.entries.add(entry);
            await control.waitFor(question.questionId);
            if (entry.state === 'pending') {
                entry.state = 'answered';
                entry.answeredElsewhere = true;
            }
        }
    }

    /**
     * Try to consume an inbound message as an answer. Returns true when the
     * message was handled here (answered, rejected, or a late reply) and must
     * not be routed as a new request.
     */
    async tryAnswer(platform: QuestionTransport['platform'], inbound: QuestionReplyInbound): Promise<boolean> {
        const handledKey = `${platform}:${inbound.messageId}`;
        if (this.handled.has(handledKey)) return true;
        for (const entry of this.entries) {
            if (entry.platform !== platform || entry.target.chatKey !== inbound.chatKey) continue;
            const target = entry.transport.locate({ processId: entry.processId, requestId: entry.requestId, origin: entry.origin });
            if (target?.chatKey === entry.target.chatKey && target.threadId === entry.target.threadId) continue;
            this.entries.delete(entry);
            remember(this.cleared, `${entry.platform}:${entry.messageId}`);
            if (entry.control.resolveUnavailable(entry.question.questionId)) await this.syncPending(entry);
        }
        const own = [...this.entries].filter(e => e.platform === platform && e.target.chatKey === inbound.chatKey);
        const replyTo = inbound.replyToId;
        const byMessage = replyTo ? own.filter(e => e.messageId === replyTo) : [];
        const byThread = replyTo ? own.filter(e => e.target.threadId === replyTo) : [];
        const pending = (list: Entry[]) => list.filter(e => e.state === 'pending');
        const direct = pending(byMessage)[0];
        if (!direct && pending(byThread).length > 1) {
            remember(this.handled, handledKey);
            await inbound.reply(QUESTION_RELAY_TEXT.ambiguous);
            return true;
        }
        let entry = direct ?? pending(byThread)[0];
        if (!entry && !replyTo && pending(own).length === 1) entry = pending(own)[0];
        if (!entry) {
            const late = byMessage.length > 0 || byThread.some(e => e.answeredElsewhere)
                ? QUESTION_RELAY_TEXT.alreadyAnswered
                : replyTo && (this.cleared.has(`${platform}:${replyTo}`)
                    || this.transports.some(t => t.platform === platform && t.isPastQuestion?.(replyTo)))
                    ? QUESTION_RELAY_TEXT.inactive : undefined;
            if (!late) return false;
            remember(this.handled, handledKey);
            await inbound.reply(late);
            return true;
        }
        remember(this.handled, handledKey);
        const parsed = parseQuestionReply(entry.question, inbound.text);
        if (parsed.kind === 'invalid') {
            await inbound.reply(`${parsed.error}\n${entry.hint}`);
            return true;
        }
        const accepted = parsed.kind === 'skip'
            ? entry.control.skip(entry.question.questionId)
            : entry.control.answer(entry.question.questionId, parsed.value);
        entry.state = 'answered';
        if (!accepted) {
            await inbound.reply(QUESTION_RELAY_TEXT.alreadyAnswered);
            return true;
        }
        await this.syncPending({ processId: entry.processId, control: entry.control });
        try {
            await inbound.acknowledge();
        } catch (error) {
            console.error(`[ask-user-relay] ${platform} acknowledgement failed:`, error);
        }
        return true;
    }

    /** Keep the dashboard's persisted batch to the questions still waiting. */
    private async syncPending(request: Pick<AskUserQuestionRelayRequest, 'processId' | 'control'>): Promise<void> {
        try {
            const process = await this.deps.store.getProcess(request.processId);
            const remaining = (process?.pendingAskUser ?? []).filter(q => request.control.isPending(q.questionId));
            await this.deps.store.updateProcess(request.processId, { pendingAskUser: remaining.length ? remaining : undefined });
        } catch (error) {
            console.error('[ask-user-relay] Could not update pending questions:', error);
        }
    }
}
