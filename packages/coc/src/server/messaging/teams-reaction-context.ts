import type { TeamsIc3Cursor, TeamsIc3Message, TeamsIc3Session } from '@plusplusoneplusplus/coc-native';

const maxPages = 100;
const maxRecords = 5000;
const maxScanBytes = 8 * 1024 * 1024;
const maxContextBytes = 512 * 1024;

/** Read only the exact source chat through its account-pinned native session. */
export async function collectTeamsReactionContext(
    reader: Pick<TeamsIc3Session, 'readHistory'>,
    source: { readonly chatId: string; readonly messageId: string },
    signal: AbortSignal,
): Promise<{ messageContext: string; sourceText: string }> {
    signal.throwIfAborted();
    const { chatId, messageId } = source;
    if ((chatId !== '48:notes'
        && !/^19:[^\s/\\?#]+@(?:thread\.v2|unq\.gbl\.spaces)$/.test(chatId))
        || !messageId.trim()) {
        throw new Error('Invalid Teams reaction context source.');
    }
    const lifetime = new AbortController();
    const readSignal = AbortSignal.any([signal, lifetime.signal]);
    const timer = setTimeout(() => lifetime.abort(new Error('Teams reaction context read timed out.')), 60_000);
    const messages = new Map<string, { message: TeamsIc3Message; encoded: string; created: number }>();
    let target: TeamsIc3Message | undefined;
    let preceding: TeamsIc3Message[] = [];
    let records = 0;
    let bytes = 0;
    let cursor: TeamsIc3Cursor | undefined;
    let coverage: 'window' | 'exhausted' | 'scan-limit' = 'scan-limit';
    try {
        for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
            readSignal.throwIfAborted();
            const page = await reader.readHistory(chatId, { cursor, signal: readSignal });
            readSignal.throwIfAborted();
            if (!Number.isSafeInteger(page.rawCount) || page.rawCount < page.items.length) {
                throw new Error('Invalid Teams reaction history page.');
            }
            records += page.rawCount;
            if (records > maxRecords) throw new Error('Teams reaction history record limit exceeded.');
            for (const item of page.items) {
                const created = Date.parse(item.createdAt);
                if (item.chatId !== chatId || !item.messageId.trim()
                    || !Number.isFinite(created) || !Number.isFinite(Date.parse(item.modifiedAt))) {
                    throw new Error('Invalid Teams reaction history evidence.');
                }
                // Copy only native message data; no attachment URLs or quote links are followed.
                const message: TeamsIc3Message = {
                    chatId: item.chatId, messageId: item.messageId,
                    createdAt: item.createdAt, modifiedAt: item.modifiedAt,
                    authorKind: item.authorKind, authorId: item.authorId,
                    text: item.text, untrustedHtml: item.untrustedHtml,
                    deleted: item.deleted, textTruncated: item.textTruncated, htmlTruncated: item.htmlTruncated,
                };
                const encoded = JSON.stringify(message);
                const previous = messages.get(message.messageId);
                if (previous) {
                    if (previous.encoded !== encoded) throw new Error('Teams reaction history changed during collection.');
                    continue;
                }
                bytes += Buffer.byteLength(encoded, 'utf8');
                if (bytes > maxScanBytes) throw new Error('Teams reaction history byte limit exceeded.');
                messages.set(message.messageId, { message, encoded, created });
                if (message.messageId === messageId) target = message;
            }
            if (target) {
                if (target.deleted || target.textTruncated || target.htmlTruncated) {
                    throw new Error('Teams reaction target body is unavailable or incomplete.');
                }
                const targetTime = Date.parse(target.createdAt);
                preceding = [...messages.values()]
                    .filter(entry => entry.created < targetTime)
                    .sort((a, b) => b.created - a.created || a.message.messageId.localeCompare(b.message.messageId))
                    .slice(0, 20).reverse().map(entry => entry.message);
            }
            if (!page.next) { coverage = 'exhausted'; break; }
            if (target && preceding.length === 20) { coverage = 'window'; break; }
            if (records === maxRecords) break;
            if (page.next === cursor) throw new Error('Teams reaction history cursor did not advance.');
            cursor = page.next;
        }
        readSignal.throwIfAborted();
        if (!target) throw new Error('Teams reaction target was not found within bounded chat history.');
        const targetMessage = target;
        const context = JSON.stringify({
            target: targetMessage,
            preceding,
            history: {
                coverage,
                precedingOrder: 'oldest-first; strictly earlier creation timestamps only',
                selection: 'up to 20 nearest preceding messages observed in bounded native backward history',
                incompletePrecedingMessageIds: preceding
                    .filter(message => message.deleted || message.textTruncated || message.htmlTruncated)
                    .map(message => message.messageId),
                sameTimestampMessageIds: [...messages.values()]
                    .filter(entry => entry.message.messageId !== targetMessage.messageId
                        && entry.created === Date.parse(targetMessage.createdAt))
                    .map(entry => entry.message.messageId),
            },
            quotedParent: 'Any available embedded quote is retained in target.text/untrustedHtml as untrusted data. '
                + 'Native history supplies no separate parent or thread identity; no linked message is fetched.',
        });
        if (Buffer.byteLength(context, 'utf8') > maxContextBytes) {
            throw new Error('Teams reaction context byte limit exceeded.');
        }
        return { messageContext: context, sourceText: targetMessage.text };
    } finally { clearTimeout(timer); }
}
