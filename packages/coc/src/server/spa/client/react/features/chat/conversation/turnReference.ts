/**
 * Display-side helpers for quoted conversation-turn references.
 *
 * `formatAttachedContext` prepends each attached turn snippet to the sent
 * message as `<context from="user|assistant" turn="N">\n…\n</context>`. The
 * stored content (and so the model payload and raw view) keeps that markup;
 * these helpers only turn the leading blocks into quote cards for normal
 * rendering and verify a jump target before navigating to it.
 */
import type { ClientConversationTurn } from '../../../types/dashboard';

export interface TurnReference {
    role: 'user' | 'assistant';
    /** Canonical `turnIndex` of the quoted message in the same conversation. */
    turnIndex: number;
    snippet: string;
}

export interface ParsedTurnReferences {
    references: TurnReference[];
    remainingContent: string;
}

// Anchored at the start: only the prefix formatAttachedContext writes is
// reference metadata, never a `<context>` tag later in the message or code.
const LEADING_TURN_REFERENCE = /^<context from="(user|assistant)" turn="(\d+)">\r?\n([\s\S]*?)\r?\n<\/context>(?:[ \t]*\r?\n)*/;

export function parseTurnReferenceBlocks(content: string): ParsedTurnReferences {
    const references: TurnReference[] = [];
    let rest = content;
    for (let match = LEADING_TURN_REFERENCE.exec(rest); match; match = LEADING_TURN_REFERENCE.exec(rest)) {
        const turnIndex = Number(match[2]);
        if (!Number.isSafeInteger(turnIndex)) break;
        references.push({ role: match[1] as TurnReference['role'], turnIndex, snippet: match[3] });
        rest = rest.slice(match[0].length);
    }
    return references.length ? { references, remainingContent: rest } : { references, remainingContent: content };
}

const EXCERPT_LENGTH = 180;

/** Plain-text excerpt of a Markdown snippet: syntax stripped, whitespace collapsed, capped. */
export function turnReferenceExcerpt(snippet: string, max = EXCERPT_LENGTH): string {
    const text = snippet
        .replace(/```[^\n]*\n?/g, ' ')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '')
        .replace(/(\*\*|__|~~|`)/g, '')
        .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function normalizeForMatch(text: string): string {
    return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function turnText(turn: ClientConversationTurn): string {
    const timelineText = (turn.timeline ?? [])
        .filter(item => item.type === 'content' && item.content)
        .map(item => item.content)
        .join('\n');
    return `${turn.content ?? ''}\n${timelineText}`;
}

const MATCH_PREFIX = 48;

/**
 * True when `turn` is plausibly the quoted message: same role and its text
 * contains the start of the snippet (compared letters/digits only, so the
 * rendered-text vs. Markdown difference of a selection does not matter).
 */
export function turnMatchesReference(turn: ClientConversationTurn | undefined, reference: TurnReference): boolean {
    if (!turn || turn.role !== reference.role) return false;
    const needle = normalizeForMatch(reference.snippet).slice(0, MATCH_PREFIX);
    return !needle || normalizeForMatch(turnText(turn)).includes(needle);
}
