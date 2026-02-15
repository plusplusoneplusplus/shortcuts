/**
 * Seeds Phase — Response Parser
 *
 * Parses and validates AI JSON responses into ThemeSeed structures.
 * Handles JSON extraction from markdown, validation, normalization,
 * and error recovery.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ThemeSeed } from '../types';
import { normalizeComponentId } from '../schemas';
import { parseAIJsonResponse } from '../utils/parse-ai-response';

// ============================================================================
// Response Parsing
// ============================================================================

/**
 * Parse an AI response into an array of ThemeSeed objects.
 *
 * Handles:
 * 1. Raw JSON → parse directly
 * 2. JSON in markdown code blocks → extract and parse
 * 3. Multiple JSON blocks → take the largest one
 * 4. Trailing text after JSON → strip and parse
 * 5. Invalid JSON → attempt repair
 * 6. Missing required fields → skip invalid entries with warnings
 *
 * @param response - Raw AI response string
 * @returns Parsed and validated ThemeSeed array
 * @throws Error if response cannot be parsed into valid seeds
 */
export function parseSeedsResponse(response: string): ThemeSeed[] {
    const obj = parseAIJsonResponse(response, { context: 'seeds', repair: true });
    if (!('themes' in obj)) {
        throw new Error("Missing 'themes' field in AI response");
    }

    return parseThemesArray(obj.themes);
}

// ============================================================================
// Themes Array Parsing
// ============================================================================

/**
 * Parse and validate an array of ThemeSeed objects.
 */
function parseThemesArray(raw: unknown): ThemeSeed[] {
    if (!Array.isArray(raw)) {
        throw new Error("'themes' field must be an array");
    }

    const themes: ThemeSeed[] = [];
    const warnings: string[] = [];

    for (let i = 0; i < raw.length; i++) {
        const item = raw[i];
        if (typeof item !== 'object' || item === null) {
            warnings.push(`Skipping invalid theme at index ${i}: not an object`);
            continue;
        }

        const obj = item as Record<string, unknown>;

        // Check required fields
        if (typeof obj.theme !== 'string' || !obj.theme) {
            warnings.push(`Skipping theme at index ${i}: missing or invalid 'theme' field`);
            continue;
        }

        if (typeof obj.description !== 'string' || !obj.description) {
            warnings.push(`Skipping theme at index ${i}: missing or invalid 'description' field`);
            continue;
        }

        // Normalize theme ID to kebab-case
        const themeId = normalizeComponentId(String(obj.theme));

        // Parse hints (can be array or comma-separated string)
        let hints: string[] = [];
        if (Array.isArray(obj.hints)) {
            hints = obj.hints
                .filter(h => typeof h === 'string')
                .map(h => String(h).trim())
                .filter(h => h.length > 0);
        } else if (typeof obj.hints === 'string') {
            // Split comma-separated string
            hints = obj.hints
                .split(',')
                .map(h => h.trim())
                .filter(h => h.length > 0);
        } else {
            // Default: use theme name as hint
            hints = [themeId];
        }

        // Ensure at least one hint
        if (hints.length === 0) {
            hints = [themeId];
        }

        themes.push({
            theme: themeId,
            description: String(obj.description).trim(),
            hints,
        });
    }

    // Log warnings to stderr for visibility
    if (warnings.length > 0) {
        for (const w of warnings) {
            process.stderr.write(`[WARN] ${w}\n`);
        }
    }

    // Deduplicate by theme ID
    const seenIds = new Set<string>();
    const deduplicated: ThemeSeed[] = [];
    for (const theme of themes) {
        if (seenIds.has(theme.theme)) {
            warnings.push(`Duplicate theme ID '${theme.theme}', keeping first occurrence`);
            continue;
        }
        seenIds.add(theme.theme);
        deduplicated.push(theme);
    }

    return deduplicated;
}


