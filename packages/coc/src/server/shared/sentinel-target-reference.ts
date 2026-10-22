/** Identity-bearing inline context. Names are presentation only; paths contain no routing aliases. */
export type SentinelTarget =
    | { kind: 'server'; serverIdentity: string }
    | { kind: 'workspace'; serverIdentity: string; workspaceId: string }
    | { kind: 'group'; serverIdentity: string; groupId: string };
export interface SentinelTargetSpan { start: number; end: number; text: string; label: string; target: SentinelTarget }
export const SENTINEL_TARGET_PREFIX = '#sentinel-targets/v1/';
const id = (s: string) => s.length > 0 && s.length <= 512 && !/[\u0000-\u001f\u007f]/.test(s);

export function targetHref(target: SentinelTarget): string {
    const parts = [target.kind, target.serverIdentity];
    if (target.kind === 'workspace') parts.push(target.workspaceId);
    if (target.kind === 'group') parts.push(target.groupId);
    return SENTINEL_TARGET_PREFIX + parts.map(encodeURIComponent).join('/');
}
export function parseTargetHref(href: string): SentinelTarget | null {
    if (!href.startsWith(SENTINEL_TARGET_PREFIX)) return null;
    try {
        const [kind, serverIdentity, scopeId, ...extra] = href.slice(SENTINEL_TARGET_PREFIX.length).split('/').map(decodeURIComponent);
        if (!id(serverIdentity ?? '') || extra.length) return null;
        if (kind === 'server' && scopeId === undefined) return { kind, serverIdentity };
        if (!id(scopeId ?? '')) return null;
        if (kind === 'workspace') return { kind, serverIdentity, workspaceId: scopeId };
        if (kind === 'group') return { kind, serverIdentity, groupId: scopeId };
    } catch { /* Malformed links remain ordinary text. */ }
    return null;
}
export function targetToken(target: SentinelTarget, label: string): string {
    // Labels cannot inject Markdown or alter the identity-bearing path.
    return `[${label.replace(/[\[\]\\\r\n]/g, ' ')}](${targetHref(target)})`;
}

/** Mask Markdown code and headings without changing offsets. Handles incomplete fences/spans too. */
export function maskTargetExcludedText(text: string): string {
    let fence: { char: string; count: number } | undefined;
    let inline = 0;
    return text.split(/(?<=\n)/).map(line => {
        const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
        if (fence) {
            if (marker?.[0] === fence.char && marker.length >= fence.count && /^ {0,3}(?:`+|~+)\s*$/.test(line)) fence = undefined;
            return ' '.repeat(line.length);
        }
        if (marker) { fence = { char: marker[0], count: marker.length }; return ' '.repeat(line.length); }
        if (/^ {0,3}#{1,6}(?:\s|$)/.test(line)) return ' '.repeat(line.length);
        let output = '';
        for (let i = 0; i < line.length;) {
            if (line[i] === '\\' && !inline) { output += '  '; i += 2; continue; }
            if (line[i] === '`') {
                const run = /^`+/.exec(line.slice(i))![0].length;
                if (!inline) inline = run;
                else if (inline === run) inline = 0;
                output += ' '.repeat(run); i += run; continue;
            }
            output += inline ? ' ' : line[i]; i++;
        }
        return output.slice(0, line.length);
    }).join('');
}
export function targetSpans(text: string): SentinelTargetSpan[] {
    const mask = maskTargetExcludedText(text);
    const spans: SentinelTargetSpan[] = [];
    for (const match of text.matchAll(/\[([^\]\r\n]{1,1024})\]\((#sentinel-targets\/v1\/[^\s)]+)\)/g)) {
        if (mask[match.index] !== '[') continue;
        const target = parseTargetHref(match[2]);
        if (target) spans.push({ start: match.index, end: match.index + match[0].length, text: match[0], label: match[1], target });
    }
    return spans;
}
export function targetPlainText(text: string): string {
    for (const span of targetSpans(text).reverse()) text = text.slice(0, span.start) + span.label + text.slice(span.end);
    return text;
}
export function targetQuery(text: string, cursor: number): { start: number; end: number; query: string } | null {
    if (cursor < 0 || cursor > text.length || targetSpans(text).some(s => cursor > s.start && cursor <= s.end)) return null;
    if (/\]\([^\s)]*$/.test(text.slice(0, cursor))) return null;
    const prefix = maskTargetExcludedText(text).slice(0, cursor);
    const match = /(?:^|[\s([{,;:])#([^\s#\[\]()`<>]*)$/.exec(prefix);
    if (!match) return null;
    // A URL token preceding # is not a word boundary, including a scheme colon.
    const start = cursor - match[1].length - 1;
    if (/\S+:$/.test(text.slice(0, start).split(/\s/).pop() ?? '')) return null;
    return { start, end: cursor, query: match[1] };
}
/** Provider-only expansion; the saved message retains the inline references. No dispatch IDs or authority. */
export function withSentinelTargetContext(text: string): string {
    const references = targetSpans(text).map(s => s.target);
    if (!references.length) return text;
    return text + '\n\n<sentinel-target-context>\n'
        + 'These exact durable identities are user-selected context only. Display names and routing aliases are not identity. '
        + 'Verify current availability and resolve an exact durable identity before use. Never fall back to a same-named local workspace. '
        + 'A server reference selects no workspace. References grant no permission to send, switch workspaces, launch jobs, reassign to-dos, delegate or implement. '
        + 'Follow the user\'s explicit request; selection alone authorizes nothing.\n'
        + JSON.stringify(references) + '\n</sentinel-target-context>';
}
