/**
 * Seeds Phase — Response Parser
 *
 * Parses and validates AI JSON responses into TopicSeed structures.
 * Handles JSON extraction from markdown, validation, normalization,
 * and error recovery.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { TopicSeed } from '../types';
import { normalizeComponentId } from '../schemas';
import { parseAIJsonResponse } from '../utils/parse-ai-response';

// ============================================================================
// Response Parsing
// ============================================================================

/**
 * Parse an AI response into an array of TopicSeed objects.
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
 * @returns Parsed and validated TopicSeed array
 * @throws Error if response cannot be parsed into valid seeds
 */
export function parseSeedsResponse(response: string): TopicSeed[] {
    const obj = parseAIJsonResponse(response, { context: 'seeds', repair: true });
    if (!('topics' in obj)) {
        throw new Error("Missing 'topics' field in AI response");
    }

    return parseTopicsArray(obj.topics);
}

// ============================================================================
// Topics Array Parsing
// ============================================================================

/**
 * Parse and validate an array of TopicSeed objects.
 */
function parseTopicsArray(raw: unknown): TopicSeed[] {
    if (!Array.isArray(raw)) {
        throw new Error("'topics' field must be an array");
    }

    const topics: TopicSeed[] = [];
    const warnings: string[] = [];

    for (let i = 0; i < raw.length; i++) {
        const item = raw[i];
        if (typeof item !== 'object' || item === null) {
            warnings.push(`Skipping invalid topic at index ${i}: not an object`);
            continue;
        }

        const obj = item as Record<string, unknown>;

        // Check required fields
        if (typeof obj.topic !== 'string' || !obj.topic) {
            warnings.push(`Skipping topic at index ${i}: missing or invalid 'topic' field`);
            continue;
        }

        if (typeof obj.description !== 'string' || !obj.description) {
            warnings.push(`Skipping topic at index ${i}: missing or invalid 'description' field`);
            continue;
        }

        // Normalize topic ID to kebab-case
        const topicId = normalizeComponentId(String(obj.topic));

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
            // Default: use topic name as hint
            hints = [topicId];
        }

        // Ensure at least one hint
        if (hints.length === 0) {
            hints = [topicId];
        }

        topics.push({
            topic: topicId,
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

    // Deduplicate by topic ID
    const seenIds = new Set<string>();
    const deduplicated: TopicSeed[] = [];
    for (const topic of topics) {
        if (seenIds.has(topic.topic)) {
            warnings.push(`Duplicate topic ID '${topic.topic}', keeping first occurrence`);
            continue;
        }
        seenIds.add(topic.topic);
        deduplicated.push(topic);
    }

    return deduplicated;
}


