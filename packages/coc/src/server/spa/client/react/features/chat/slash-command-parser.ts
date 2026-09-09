/**
 * Slash-command parser for extracting `/skill-name` tokens from chat input.
 *
 * Pure utility — no React dependency.
 *
 * Supports two token types:
 * - **Skill tokens**: `/skill-name` where the name matches an available skill
 * - **Meta-command tokens**: `/model` (built-in commands that are not skills)
 */

/** Built-in meta-commands (not skills). */
export const META_COMMANDS = ['model', 'cron', 'compact', 'delegate'] as const;
export type MetaCommand = (typeof META_COMMANDS)[number];

/**
 * Return the set of meta-commands available in the current runtime.
 * Filters out `cron` when the cron feature is disabled.
 */
export function getActiveMetaCommands(cronEnabled: boolean): readonly MetaCommand[] {
    if (cronEnabled) return META_COMMANDS;
    return META_COMMANDS.filter(c => c !== 'cron');
}

export interface ParsedSlashCommands {
    /** Matched skill names (lowercased to match availableSkills) */
    skills: string[];
    /** Remaining prompt text with skill tokens stripped and whitespace normalized */
    prompt: string;
    /** Matched meta-commands (e.g., 'model') */
    metaCommands: MetaCommand[];
}

export interface SlashCommandContext {
    /** Whether the cursor is inside a `/` token */
    active: boolean;
    /** Partial text after `/` for filtering (e.g., cursor after `/go` → "go") */
    prefix: string;
    /** Start index of the `/` in the text */
    startIndex: number;
}

/**
 * Regex matching `/word` tokens at word boundaries.
 * Must be at start of string or preceded by whitespace.
 */
const SLASH_TOKEN_REGEX = /(?:^|\s)(\/[a-zA-Z][a-zA-Z0-9_-]*)(?=\s|$)/g;

/** Check whether a token name is a built-in meta-command. */
export function isMetaCommand(name: string): name is MetaCommand {
    return (META_COMMANDS as readonly string[]).includes(name.toLowerCase());
}

/**
 * Parse all `/skill-name` and `/meta-command` tokens from text,
 * validating against known skills and built-in meta-commands.
 *
 * - Case-insensitive matching against availableSkills and META_COMMANDS
 * - Unknown `/tokens` are left as-is in the prompt
 * - Duplicate skills are deduplicated (first occurrence wins)
 * - Meta-command tokens (e.g., `/model`) are stripped and returned separately
 * - When `metaCommands` is provided, only tokens in that list are treated as meta-commands.
 */
export function parseSlashCommands(
    text: string,
    availableSkills: string[],
    metaCommands: readonly string[] = META_COMMANDS,
): ParsedSlashCommands {
    if (!text.trim()) {
        return { skills: [], prompt: '', metaCommands: [] };
    }

    const skillSet = new Set(availableSkills.map(s => s.toLowerCase()));
    const metaSet = new Set<string>(metaCommands);
    const matchedSkills: string[] = [];
    const matchedMeta: MetaCommand[] = [];
    const seen = new Set<string>();

    // Collect all /token matches and their positions for removal
    const tokensToRemove: { start: number; end: number }[] = [];

    let match: RegExpExecArray | null;
    const regex = new RegExp(SLASH_TOKEN_REGEX.source, 'g');
    while ((match = regex.exec(text)) !== null) {
        const fullMatch = match[0];
        const token = match[1]; // the /word part
        const name = token.slice(1).toLowerCase(); // strip leading /

        if (metaSet.has(name) && !seen.has(name)) {
            seen.add(name);
            matchedMeta.push(name as MetaCommand);
            const tokenStart = match.index + fullMatch.indexOf(token);
            tokensToRemove.push({ start: tokenStart, end: tokenStart + token.length });
        } else if (skillSet.has(name) && !seen.has(name)) {
            seen.add(name);
            matchedSkills.push(name);
            const tokenStart = match.index + fullMatch.indexOf(token);
            tokensToRemove.push({ start: tokenStart, end: tokenStart + token.length });
        } else if ((skillSet.has(name) || metaSet.has(name)) && seen.has(name)) {
            // Duplicate — still remove from prompt
            const tokenStart = match.index + fullMatch.indexOf(token);
            tokensToRemove.push({ start: tokenStart, end: tokenStart + token.length });
        }
    }

    // Build prompt with matched tokens removed
    let prompt = text;
    // Remove in reverse order to preserve indices
    for (let i = tokensToRemove.length - 1; i >= 0; i--) {
        const { start, end } = tokensToRemove[i];
        prompt = prompt.slice(0, start) + prompt.slice(end);
    }

    // Normalize whitespace
    prompt = prompt.replace(/\s+/g, ' ').trim();

    return { skills: matchedSkills, prompt, metaCommands: matchedMeta };
}

/**
 * Determine whether the cursor is inside a `/` token for autocomplete.
 *
 * Returns context only when:
 * - There is a `/` preceded by whitespace or at start of input
 * - The cursor is positioned between the `/` and the end of the partial token
 */
export function getSlashCommandContext(text: string, cursorPosition: number): SlashCommandContext | null {
    // Look backwards from cursor to find a `/`
    const textBeforeCursor = text.slice(0, cursorPosition);

    // Find the last `/` that could be a slash command trigger
    const lastSlashIdx = textBeforeCursor.lastIndexOf('/');
    if (lastSlashIdx === -1) {
        return null;
    }

    // The `/` must be at start of string or preceded by whitespace
    if (lastSlashIdx > 0 && !/\s/.test(text[lastSlashIdx - 1])) {
        return null;
    }

    // Extract text between `/` and cursor
    const afterSlash = textBeforeCursor.slice(lastSlashIdx + 1);

    // Must be a valid partial token (only word chars and hyphens, no spaces)
    if (/[^a-zA-Z0-9_-]/.test(afterSlash)) {
        return null;
    }

    // Must not have text immediately after cursor that continues the token
    // (this means cursor is at end or next char is whitespace)
    if (cursorPosition < text.length && /[a-zA-Z0-9_-]/.test(text[cursorPosition])) {
        return null;
    }

    return {
        active: true,
        prefix: afterSlash,
        startIndex: lastSlashIdx,
    };
}

export interface RepoMentionContext {
    /** Whether the cursor is inside a `#` token */
    active: boolean;
    /** Partial text after `#` for filtering (e.g., cursor after `#co` → "co") */
    prefix: string;
    /** Start index of the `#` in the text */
    startIndex: number;
}

/** Characters that may appear in the partial `#repo-name` token being typed. */
const REPO_MENTION_CHAR = /[a-zA-Z0-9_.-]/;

/**
 * Determine whether the cursor is inside a `#repo-name` token, for the
 * repo-group mention picker. Deliberately mirrors {@link getSlashCommandContext}
 * so both composer triggers behave identically.
 *
 * Returns context only when:
 * - The `#` is at the start of the input or preceded by whitespace, so
 *   `issue#12` and `abc#` never open the menu
 * - Everything between the `#` and the cursor is a legal name character
 * - The cursor is not in the middle of a longer token
 */
export function getRepoMentionContext(text: string, cursorPosition: number): RepoMentionContext | null {
    const textBeforeCursor = text.slice(0, cursorPosition);

    const lastHashIdx = textBeforeCursor.lastIndexOf('#');
    if (lastHashIdx === -1) {
        return null;
    }

    // The `#` must be at start of string or preceded by whitespace.
    if (lastHashIdx > 0 && !/\s/.test(text[lastHashIdx - 1])) {
        return null;
    }

    const afterHash = textBeforeCursor.slice(lastHashIdx + 1);

    // Must be a valid partial token (name characters only, no spaces).
    for (const ch of afterHash) {
        if (!REPO_MENTION_CHAR.test(ch)) return null;
    }

    // The cursor must sit at the end of the token, not inside a longer one.
    if (cursorPosition < text.length && REPO_MENTION_CHAR.test(text[cursorPosition])) {
        return null;
    }

    return {
        active: true,
        prefix: afterHash,
        startIndex: lastHashIdx,
    };
}

export interface FileMentionContext {
    /** Whether the caret is inside a token that should open the file picker. */
    active: boolean;
    /** The path fragment to search for — the token without any leading `@`. */
    prefix: string;
    /** Start index of the token in the text, including the `@` when present. */
    startIndex: number;
    /** True when the token was opened with an explicit `@` sigil. */
    hasSigil: boolean;
}

/** Trailing `.ext` that makes a bare token look like a file name. */
const FILE_EXTENSION_SUFFIX = /\.[A-Za-z0-9_]+$/;

/**
 * Determine whether the caret sits inside a token that should open the file
 * mention picker. Shaped like {@link getRepoMentionContext} so all three
 * composer triggers behave the same way.
 *
 * The token is the run of non-whitespace characters ending at the caret. It
 * opens the picker when either:
 * - it starts with `@`, and that `@` is at the start of the input or preceded
 *   by whitespace, or
 * - trigger-less: it contains a `/` or ends in `.ext`.
 *
 * Bare prose words never trigger, and neither does anything with an `@` in the
 * middle, so `index` and `email@example.com` type as ordinary text. Tokens
 * starting with `/` or `#` belong to the slash and repo menus and are left
 * alone.
 */
export function getFileMentionContext(text: string, cursorPosition: number): FileMentionContext | null {
    // The caret must sit at the end of the token, not inside a longer one.
    if (cursorPosition < text.length && !/\s/.test(text[cursorPosition])) {
        return null;
    }

    const textBeforeCursor = text.slice(0, cursorPosition);

    let start = cursorPosition;
    while (start > 0 && !/\s/.test(text[start - 1])) {
        start--;
    }
    const token = textBeforeCursor.slice(start);
    if (!token) return null;

    // Owned by the slash-command and repo-mention menus.
    if (token[0] === '/' || token[0] === '#') return null;

    if (token[0] === '@') {
        return { active: true, prefix: token.slice(1), startIndex: start, hasSigil: true };
    }

    // A stray `@` mid-token means an email address or a handle, not a path.
    if (token.includes('@')) return null;

    if (token.includes('/') || FILE_EXTENSION_SUFFIX.test(token)) {
        return { active: true, prefix: token, startIndex: start, hasSigil: false };
    }

    return null;
}
