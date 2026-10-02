export interface WhatsAppOutbound {
    role: string;
    agent: string;
    repo: string;
    title: string;
    content: string;
    userName?: string;
}

export function formatWhatsAppOutbound(opts: WhatsAppOutbound): string {
    const sender = opts.role === 'user' ? (opts.userName || 'You') : 'CoC Agent';
    const lines = [`*${sender}*`, `Agent: ${opts.agent}`, `Repo: ${opts.repo}`];
    if (opts.title) lines.push(`Title: ${opts.title}`);
    lines.push('', '*Message:*', opts.content.trimStart());
    return lines.join('\n');
}

/** Split on natural boundaries when possible, retaining every character of the message. */
export function chunkWhatsAppText(text: string, limit = 4096): string[] {
    if (!Number.isSafeInteger(limit) || limit < 2) throw new RangeError('Invalid WhatsApp chunk size');
    if (!text) return [];
    const chunks: string[] = [];
    let offset = 0;
    while (offset < text.length) {
        let end = Math.min(offset + limit, text.length);
        if (end < text.length) {
            if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
            const boundary = Math.max(text.lastIndexOf('\n', end - 1), text.lastIndexOf(' ', end - 1));
            if (boundary > offset + Math.floor(limit / 2)) end = boundary + 1;
        }
        chunks.push(text.slice(offset, end));
        offset = end;
    }
    return chunks;
}

/** Container bridge's account-wide session prefix, kept separate from CoC commands. */
export function stripWhatsAppGlobalPrefix(text: string): string | null {
    return /^\[global\]\s*/i.test(text) ? text.replace(/^\[global\]\s*/i, '') : null;
}
