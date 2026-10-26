import { Ic3ReactionClient } from '@plusplusoneplusplus/coc-connector/teams';
import { sendTeamsIc3SourceReply, type TeamsIc3CommandSource } from './teams-ic3-own-command-reply';
import { escapeTeamsHtml, TEAMS_CHANNEL_PREFIX } from './teams-outbound-format';

/** Request-owned dispatcher outcomes, not independent provider verification. */
export interface TeamsReactionResult {
    kind: 'task' | 'approval';
    outcome: 'done' | 'rejected';
}

export interface TeamsReactionNotice {
    sourceText: string;
    result: TeamsReactionResult;
}

const summaries = {
    task: {
        done: 'Task done.',
        rejected: 'Task rejected.',
    },
    approval: {
        done: 'PR approval done.',
        rejected: 'PR approval rejected.',
    },
} as const;

function sourceExcerpt(text: string): string {
    if (typeof text !== 'string') throw new Error('Invalid Teams reaction source text.');
    const normalized = text.replace(/\s+/gu, ' ').trim();
    if (!normalized) return '(Message without text)';
    let excerpt = '';
    let count = 0;
    for (const character of normalized) {
        if (count === 120) return `${excerpt}...`;
        excerpt += character;
        count++;
    }
    return excerpt;
}

/** One escaped source quote and one fixed outcome sentence. */
export function formatTeamsReactionNotice(notice: TeamsReactionNotice): string {
    const { result } = notice;
    if (!result || !Object.prototype.hasOwnProperty.call(summaries, result.kind)
        || !Object.prototype.hasOwnProperty.call(summaries[result.kind], result.outcome)) {
        throw new Error('Invalid Teams reaction result.');
    }
    const summary = result.kind === 'approval'
        ? summaries.approval[result.outcome] : summaries.task[result.outcome];
    const html = `<blockquote><p>${escapeTeamsHtml(sourceExcerpt(notice.sourceText))}</p></blockquote>`
        + `<p>${TEAMS_CHANNEL_PREFIX}${summary}</p>`;
    if (Buffer.byteLength(html, 'utf8') > 4096) throw new Error('Teams reaction notice is too long.');
    return html;
}

/** Delivery only: this function neither verifies approval nor adds outcome reactions. */
export async function sendTeamsReactionReply(
    source: TeamsIc3CommandSource, notice: TeamsReactionNotice, signal: AbortSignal,
): Promise<void> {
    signal.throwIfAborted();
    await sendTeamsIc3SourceReply(source, [formatTeamsReactionNotice(notice)], signal);
}

/** Deliver the captured dispatcher result without inferring success from queue status. */
export async function sendTeamsReactionResult(
    source: TeamsIc3CommandSource & { messageId: string }, notice: TeamsReactionNotice, signal: AbortSignal,
): Promise<void> {
    signal.throwIfAborted();
    const html = formatTeamsReactionNotice(notice);
    const { messageId, chatId, region } = source;
    if (typeof messageId !== 'string' || !messageId || messageId.length > 4096 || /[\u0000-\u0020/\\?#]/.test(messageId)) {
        throw new Error('Invalid Teams reaction result target.');
    }
    const captured: TeamsIc3CommandSource = {
        account: { ...source.account }, chatId, region, verifyAccess: source.verifyAccess.bind(source),
        compliance: source.compliance,
    };
    const reaction = notice.result.outcome === 'done' ? 'checkmark' : 'crossmark';

    if (reaction === 'crossmark') {
        await sendTeamsIc3SourceReply(captured, [html], signal);
        signal.throwIfAborted();
    }
    await captured.verifyAccess(signal);
    signal.throwIfAborted();
    const client = new Ic3ReactionClient({
        region, expectedAccount: { tenantId: captured.account.tenantId, objectId: captured.account.userId },
    });
    try {
        await client.reactToSourceMessage(chatId, messageId, reaction, signal);
        signal.throwIfAborted();
    } finally { client.dispose(); }
}
