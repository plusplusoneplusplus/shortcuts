/**
 * Slash-command parser for extracting `/skill-name` tokens from chat input.
 *
 * Pure utility — no React dependency.
 */

export interface ParsedSlashCommands {
    /** Matched skill names (lowercased to match availableSkills) */
    skills: string[];
    /** Remaining prompt text with skill tokens stripped and whitespace normalized */
    prompt: string;
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

/**
 * Parse all `/skill-name` tokens from text, validating against known skills.
 *
 * - Case-insensitive matching against availableSkills
 * - Unknown `/tokens` are left as-is in the prompt
 * - Duplicate skills are deduplicated (first occurrence wins)
 */
export function parseSlashCommands(text: string, availableSkills: string[]): ParsedSlashCommands {
    if (!text.trim()) {
        return { skills: [], prompt: '' };
    }

    const skillSet = new Set(availableSkills.map(s => s.toLowerCase()));
    const matchedSkills: string[] = [];
    const seen = new Set<string>();

    // Collect all /token matches and their positions for removal
    const tokensToRemove: { start: number; end: number }[] = [];

    let match: RegExpExecArray | null;
    const regex = new RegExp(SLASH_TOKEN_REGEX.source, 'g');
    while ((match = regex.exec(text)) !== null) {
        const fullMatch = match[0];
        const token = match[1]; // the /word part
        const name = token.slice(1).toLowerCase(); // strip leading /

        if (skillSet.has(name) && !seen.has(name)) {
            seen.add(name);
            matchedSkills.push(name);
            // Calculate precise position of the /token within the full match
            const tokenStart = match.index + fullMatch.indexOf(token);
            tokensToRemove.push({ start: tokenStart, end: tokenStart + token.length });
        } else if (skillSet.has(name) && seen.has(name)) {
            // Duplicate of a matched skill — still remove from prompt
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

    return { skills: matchedSkills, prompt };
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
