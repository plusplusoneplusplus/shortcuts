/**
 * Front Matter Parser for Code Review Rule Files
 * 
 * Parses YAML front matter from markdown files in a cross-platform way.
 * Front matter is delimited by --- at the start and end.
 * 
 * Example:
 * ```
 * ---
 * id: naming-conventions
 * name: Naming Conventions
 * model: claude-sonnet-4-5
 * severity: warning
 * category: style
 * applies-to: ["*.ts", "*.js"]
 * ---
 * 
 * # Naming Conventions Rule
 * ...
 * ```
 */

import * as yaml from 'js-yaml';
import { RuleFrontMatter } from './types';

/**
 * Result of parsing front matter from a file
 */
export interface FrontMatterParseResult {
    /** Parsed front matter object (empty if no front matter found) */
    frontMatter: RuleFrontMatter;
    /** Content after front matter (or full content if no front matter) */
    content: string;
    /** Whether front matter was found and parsed */
    hasFrontMatter: boolean;
    /** Any parsing errors encountered */
    error?: string;
}

/**
 * Regular expression to match front matter at the start of a file.
 * Handles both Unix (LF) and Windows (CRLF) line endings.
 * 
 * Pattern breakdown:
 * - ^---[ \t]*   : Start with --- followed by optional whitespace (no newline chars)
 * - (?:\r?\n)    : Unix or Windows newline after opening ---
 * - ([\s\S]*?)   : Front matter content (non-greedy, can be empty)
 * - (?:\r?\n)?   : Optional newline before closing --- (allows empty content)
 * - ---[ \t]*    : Closing --- with optional trailing whitespace
 * - (?:\r?\n|$)  : Followed by newline or end of string
 * 
 * Note: The pattern allows empty front matter (---\n---) by making the newline
 * before the closing --- optional.
 */
const FRONT_MATTER_REGEX = /^---[ \t]*(?:\r?\n)([\s\S]*?)(?:\r?\n)?---[ \t]*(?:\r?\n|$)/;

/**
 * Parse front matter from a markdown file content.
 * 
 * @param content The full file content
 * @returns ParseResult with front matter and remaining content
 */
export function parseFrontMatter(content: string): FrontMatterParseResult {
    // Handle empty or whitespace-only content
    if (!content || content.trim() === '') {
        return {
            frontMatter: {},
            content: content || '',
            hasFrontMatter: false
        };
    }

    // Try to match front matter
    const match = content.match(FRONT_MATTER_REGEX);

    if (!match) {
        // No front matter found, return content as-is
        return {
            frontMatter: {},
            content: content,
            hasFrontMatter: false
        };
    }

    const yamlContent = match[1];
    const remainingContent = content.slice(match[0].length);

    try {
        // Parse the YAML content
        const parsed = yaml.load(yamlContent);

        // Handle case where YAML is empty or not an object
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {
                frontMatter: {},
                content: remainingContent,
                hasFrontMatter: true
            };
        }

        // Normalize the front matter to our expected format
        const frontMatter = normalizeFrontMatter(parsed as Record<string, unknown>);

        return {
            frontMatter,
            content: remainingContent,
            hasFrontMatter: true
        };
    } catch (error) {
        // YAML parsing failed
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            frontMatter: {},
            content: remainingContent,
            hasFrontMatter: true,
            error: `Failed to parse front matter YAML: ${errorMessage}`
        };
    }
}

/**
 * Normalize front matter to extract supported fields.
 * Currently only supports 'model' field.
 */
function normalizeFrontMatter(raw: Record<string, unknown>): RuleFrontMatter {
    const frontMatter: RuleFrontMatter = {};

    // Extract model field (case-insensitive)
    for (const [key, value] of Object.entries(raw)) {
        if (key.toLowerCase() === 'model' && typeof value === 'string') {
            frontMatter.model = value;
            break;
        }
    }

    return frontMatter;
}

/**
 * Check if a file content has front matter
 */
export function hasFrontMatter(content: string): boolean {
    if (!content) {
        return false;
    }
    return FRONT_MATTER_REGEX.test(content);
}

/**
 * Extract just the front matter content as a string (for debugging/display)
 */
export function extractFrontMatterString(content: string): string | null {
    if (!content) {
        return null;
    }
    const match = content.match(FRONT_MATTER_REGEX);
    return match ? match[1] : null;
}
