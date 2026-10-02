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

export interface WhatsAppQuestion {
    progress?: string;
    question: string;
    options: string[];
    hint: string;
}

/** Phone-readable question: bold question, one option per line, then the reply hint. */
export function formatWhatsAppQuestion(q: WhatsAppQuestion): string {
    // WhatsApp bold cannot span a newline, so each question line is bolded on its own.
    const question = q.question.split('\n').map(line => line.trim() ? `*${line.trim()}*` : '').join('\n');
    return [...(q.progress ? [q.progress] : []), question, ...q.options, '', q.hint].join('\n');
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
