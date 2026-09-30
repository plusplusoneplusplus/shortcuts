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

export type WhatsAppCommand =
    | { type: 'list-repos' | 'list-topics' | 'create-topic'; args: '' }
    | { type: 'select-repo' | 'select-topic'; args: string }
    | { type: 'chat'; args: string; mode: 'ask' | 'autopilot' }
    | { type: 'invalid'; args: string };

export function parseWhatsAppCommand(text: string): WhatsAppCommand {
    const value = text.trim();
    if (/^\/?list\s+repos?$/i.test(value)) return { type: 'list-repos', args: '' };
    if (/^\/?list\s+(?:chat\s+)?topics?$/i.test(value)) return { type: 'list-topics', args: '' };
    if (/^\/?create\s+(?:chat\s+)?topic$/i.test(value)) return { type: 'create-topic', args: '' };
    const repo = /^\/?select\s+repos?\s+(.+)$/i.exec(value);
    if (repo) return { type: 'select-repo', args: repo[1].trim() };
    const topic = /^\/?select\s+(?:chat\s+)?topic\s+(.+)$/i.exec(value);
    if (topic) return { type: 'select-topic', args: topic[1].trim() };
    if (/^\/autopilot(?:\s|$)/i.test(value)) {
        const args = value.replace(/^\/autopilot(?:\s+|$)/i, '').trim();
        return args ? { type: 'chat', args, mode: 'autopilot' } : { type: 'invalid', args: value };
    }
    if (/^\/?(?:list|select|create)\b/i.test(value) || value.startsWith('/')) return { type: 'invalid', args: value };
    return { type: 'chat', args: value, mode: 'ask' };
}

/** Container bridge's account-wide session prefix, kept separate from CoC commands. */
export function stripWhatsAppGlobalPrefix(text: string): string | null {
    return /^\[global\]\s*/i.test(text) ? text.replace(/^\[global\]\s*/i, '') : null;
}
