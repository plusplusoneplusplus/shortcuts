/** Pure, bounded formatting for outbound Teams thread replies. */

import { TEAMS_CHANNEL_PREFIX, escapeTeamsHtml, formatTeamsOutbound, safeTeamsHref } from './teams-outbound-format';

export const TEAMS_ANSWER_MAX_BYTES = 20_000;

const EMPTY_ANSWER = '(No answer provided.)';
const encoder = new TextEncoder();
type GraphemeSegmenterConstructor = new (
    locale: string | undefined,
    options: { granularity: 'grapheme' },
) => { segment(text: string): Iterable<{ segment: string }> };
const graphemeConstructor = (Intl as unknown as Record<'Segmenter', GraphemeSegmenterConstructor>).Segmenter;
const graphemes = new graphemeConstructor(undefined, { granularity: 'grapheme' });

function bytes(text: string): number {
    return encoder.encode(text).length;
}

function renderInline(text: string): string {
    const token = /\[([^\]\n]+)\]\(([^)\n]+)\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
    let result = '';
    let start = 0;
    for (const match of text.matchAll(token)) {
        const offset = match.index;
        result += escapeTeamsHtml(text.slice(start, offset));
        if (match[1] !== undefined) {
            const href = safeTeamsHref(match[2]);
            result += href === null
                ? escapeTeamsHtml(match[0])
                : `<a href="${href}">${escapeTeamsHtml(match[1])}</a>`;
        } else if (match[3] !== undefined) {
            result += `<code>${escapeTeamsHtml(match[3])}</code>`;
        } else if (match[4] !== undefined) {
            result += `<strong>${escapeTeamsHtml(match[4])}</strong>`;
        } else {
            result += `<em>${escapeTeamsHtml(match[5])}</em>`;
        }
        start = offset + match[0].length;
    }
    return result + escapeTeamsHtml(text.slice(start));
}

interface Block {
    html: string;
    source: string;
    kind: 'text' | 'code';
}

function blocksFor(answer: string): Block[] {
    const blocks: Block[] = [];
    const lines = (answer.trim() ? answer : EMPTY_ANSWER).replace(/\r\n?/g, '\n').split('\n');
    let code: string[] | null = null;
    let openingFence = '';
    for (const line of lines) {
        if (/^\s*```/.test(line)) {
            if (code === null) {
                code = [];
                openingFence = line;
            } else {
                const source = code.join('\n');
                blocks.push({ source, html: `<pre><code>${escapeTeamsHtml(source)}</code></pre>`, kind: 'code' });
                code = null;
            }
        } else if (code !== null) {
            code.push(line);
        } else if (line.trim() === '') {
            blocks.push({ source: '', html: '<br>', kind: 'text' });
        } else {
            const list = line.match(/^\s*((?:[-*+]|\d+[.)]))\s+(.*)$/);
            const heading = line.match(/^\s{0,3}#{1,6}\s+(.+)$/);
            const source = list?.[2] ?? heading?.[1] ?? line;
            const content = renderInline(source);
            const html = list
                ? `<p>${escapeTeamsHtml(list[1])} ${content}</p>`
                : heading ? `<p><strong>${content}</strong></p>` : `<p>${content}</p>`;
            blocks.push({ source: line, html, kind: 'text' });
        }
    }
    if (code !== null) {
        // An unmatched fence is content, not a reason to discard the remainder.
        const source = [openingFence, ...code].join('\n');
        blocks.push({ source, html: `<pre><code>${escapeTeamsHtml(source)}</code></pre>`, kind: 'code' });
    }
    return blocks;
}

function splitOversized(block: Block, limit: number): string[] {
    const [open, close] = block.kind === 'code'
        ? ['<pre><code>', '</code></pre>']
        : ['<p>', '</p>'];
    const available = limit - bytes(open + close);
    if (available < 16) {
        throw new RangeError('Teams answer header leaves no room for content');
    }
    const parts: string[] = [];
    let current = '';
    let size = 0;
    for (const { segment } of graphemes.segment(block.source)) {
        const escaped = escapeTeamsHtml(segment);
        const length = bytes(escaped);
        if (length > available) {
            throw new RangeError('A single grapheme exceeds the Teams message limit');
        }
        if (size + length > available) {
            parts.push(open + current + close);
            current = '';
            size = 0;
        }
        current += escaped;
        size += length;
        if (/\s/u.test(segment) && size >= available * 0.85) {
            parts.push(open + current + close);
            current = '';
            size = 0;
        }
    }
    if (current || !parts.length) {
        parts.push(open + current + close);
    }
    return parts;
}

/**
 * Format a complete assistant answer as ordered, independently valid Teams HTML replies.
 * `requestLabel` must be an opaque identifier, never a prompt or user-provided excerpt.
 * The caller sends the returned parts in order under the originating thread root.
 */
export function formatTeamsAnswerChunks(
    answer: string, requestLabel: string, contextLabel?: string, reservedContextLabel?: string,
    attribution: 'compact' | 'legacy' = 'compact',
): string[] {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(requestLabel)) {
        throw new TypeError('Teams request label must be a compact opaque identifier');
    }
    const blocks = blocksFor(answer);
    const prefix = attribution === 'legacy' ? 'AI: ' : TEAMS_CHANNEL_PREFIX;
    let expected = 1;
    for (;;) {
        const header = (part: number, total: number, label = contextLabel) =>
            `<p><strong>Request ${requestLabel} · Part ${part}/${total}</strong></p>`
            + (label ? `<p>${escapeTeamsHtml(label.slice(0, 140))}</p>` : '');
        const budget = TEAMS_ANSWER_MAX_BYTES - bytes(prefix
            + header(expected, expected, contextLabel ?? reservedContextLabel));
        const bodies: string[] = [];
        let body = '';
        let length = 0;
        for (const block of blocks) {
            const fragments = bytes(block.html) <= budget
                ? [block.html] : splitOversized(block, budget);
            for (const html of fragments) {
                const size = bytes(html);
                if (length + size > budget && body) {
                    bodies.push(body);
                    body = '';
                    length = 0;
                }
                body += html;
                length += size;
            }
        }
        bodies.push(body);
        if (bodies.length > expected) {
            expected = bodies.length;
            continue;
        }
        const result = bodies.map((content, index) => header(index + 1, bodies.length) + content);
        if (result.every(part => bytes(attribution === 'legacy' ? prefix + part
            : formatTeamsOutbound(part, 'html')) <= TEAMS_ANSWER_MAX_BYTES)) {
            return result;
        }
        expected = bodies.length + 1;
    }
}
