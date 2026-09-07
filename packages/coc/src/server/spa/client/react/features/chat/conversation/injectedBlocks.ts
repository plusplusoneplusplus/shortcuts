export interface ExtractedInjectedBlocks {
    text: string;
    chatStyle?: string;
    chatMode?: string;
    selectedSkills?: string;
    selectedSkillNames?: string[];
}

/** Tag wrapping the per-turn mode directive; mirrors `CHAT_MODE_DIRECTIVE_TAG`. */
const CHAT_MODE_TAG = 'coc-chat-mode';

/** Tags the server injects ahead of the user prompt, in no guaranteed order. */
const INJECTED_TAGS = ['chat-style', CHAT_MODE_TAG, 'selected_skills'] as const;

type InjectedTag = typeof INJECTED_TAGS[number];

function trimLeadingBlankLines(text: string): string {
    return text.replace(/^(?:[\t ]*(?:\r\n|\n|\r))+/, '');
}

/**
 * Recovers the selected skill names from the `<selected_skills>` block text.
 *
 * This parses a prompt string built by `prependSelectedSkillsDirective` in
 * `server/executors/prompt-builder.ts` — the two must stay in sync. Once the
 * selected skills are persisted as structured turn metadata, delete this
 * parser and read the names off the turn instead.
 *
 * Never throws: an absent or reworded sentence yields `[]`, and the caller
 * falls back to showing the raw block only.
 */
export function parseSelectedSkillNames(block: string): string[] {
    const match = /^The user explicitly selected these skills:[ \t]*(.+?)\.?[ \t]*$/m.exec(block);
    if (!match) {
        return [];
    }

    const names: string[] = [];
    for (const part of match[1].split(',')) {
        const name = part.trim();
        if (name.length > 0 && !names.includes(name)) {
            names.push(name);
        }
    }
    return names;
}

/**
 * Removes the server-injected blocks from the leading prefix of display text
 * while retaining each complete block verbatim. Blocks may appear in any order
 * and any subset; each tag is consumed at most once, so a quoted repeat in the
 * user's own text stays in `text`.
 */
export function extractInjectedBlocks(text: string): ExtractedInjectedBlocks {
    let remaining = text;
    const blocks = new Map<InjectedTag, string>();

    for (;;) {
        const tag = INJECTED_TAGS.find(candidate => !blocks.has(candidate) && remaining.startsWith(`<${candidate}>`));
        if (tag === undefined) {
            break;
        }

        const closingTag = `</${tag}>`;
        const closingTagStart = remaining.indexOf(closingTag, tag.length + 2);
        if (closingTagStart < 0) {
            break;
        }

        const blockEnd = closingTagStart + closingTag.length;
        blocks.set(tag, remaining.slice(0, blockEnd));
        remaining = trimLeadingBlankLines(remaining.slice(blockEnd));
    }

    const result: ExtractedInjectedBlocks = { text: remaining };
    const chatStyle = blocks.get('chat-style');
    if (chatStyle !== undefined) {
        result.chatStyle = chatStyle;
    }
    const chatMode = blocks.get('coc-chat-mode');
    if (chatMode !== undefined) {
        result.chatMode = chatMode;
    }
    const selectedSkills = blocks.get('selected_skills');
    if (selectedSkills !== undefined) {
        result.selectedSkills = selectedSkills;
        const names = parseSelectedSkillNames(selectedSkills);
        if (names.length > 0) {
            result.selectedSkillNames = names;
        }
    }
    return result;
}

/**
 * Project a stored `chatModeContext` marker down to the part a transcript may
 * show: the `<coc-read-only-mode>` section, including any nested plan save
 * destination.
 *
 * The marker is the directive the executor actually sent, so it is the only
 * source that reflects a workspace's live plan destination — the route that
 * writes the user turn's display copy cannot read the filesystem, and a
 * re-injection caused purely by folder drift leaves no leading block in the
 * stored content at all.
 *
 * The trailing half of the marker is the repo's mode-specific instructions
 * (`.github/coc/instructions-<mode>.md`), which have never been surfaced in a
 * transcript and would bury the user's message, so they are dropped here.
 *
 * Returns `undefined` for a marker with no read-only section — an autopilot
 * transition note or an instructions-only block. Callers fall back to the
 * block extracted from the stored turn content, which already carries the
 * transition prose alone.
 */
export function projectChatModeContextForDisplay(marker: string | undefined): string | undefined {
    if (!marker) {
        return undefined;
    }

    const open = `<${CHAT_MODE_TAG}>\n`;
    const close = `\n</${CHAT_MODE_TAG}>`;
    let body = marker;
    if (body.startsWith(open)) {
        body = body.slice(open.length);
    }
    if (body.endsWith(close)) {
        body = body.slice(0, -close.length);
    }

    const readOnlyOpen = '<coc-read-only-mode>';
    const readOnlyClose = '</coc-read-only-mode>';
    if (!body.startsWith(readOnlyOpen)) {
        return undefined;
    }
    const end = body.indexOf(readOnlyClose);
    if (end < 0) {
        return undefined;
    }
    const section = body.slice(0, end + readOnlyClose.length);
    return `<${CHAT_MODE_TAG}>\n${section}\n</${CHAT_MODE_TAG}>`;
}
