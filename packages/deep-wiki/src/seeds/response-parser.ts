/**
 * Seeds Phase — Response Parser
 *
 * Parses and validates AI JSON responses into TopicSeed structures.
 * Handles JSON extraction from markdown, validation, normalization,
 * and error recovery.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { extractJSON } from '@plusplusoneplusplus/pipeline-core';
import type { TopicSeed } from '../types';
import { normalizeModuleId } from '../schemas';

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
    if (!response || typeof response !== 'string') {
        throw new Error('Empty or invalid response from AI');
    }

    // Step 1: Extract JSON from response
    const jsonStr = extractJSON(response);
    if (!jsonStr) {
        throw new Error('No JSON found in AI response. The AI may not have returned structured output.');
    }

    // Step 2: Parse JSON
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonStr);
    } catch (parseError) {
        // Try to fix common issues
        const fixed = attemptJsonRepair(jsonStr);
        if (fixed) {
            try {
                parsed = JSON.parse(fixed);
            } catch {
                throw new Error(`Invalid JSON in AI response: ${(parseError as Error).message}`);
            }
        } else {
            throw new Error(`Invalid JSON in AI response: ${(parseError as Error).message}`);
        }
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('AI response is not a JSON object');
    }

    // Step 3: Extract and validate topics array
    const obj = parsed as Record<string, unknown>;
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
        const topicId = normalizeModuleId(String(obj.topic));

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

// ============================================================================
// Utility Helpers
// ============================================================================

/**
 * Attempt to repair common JSON formatting issues.
 */
function attemptJsonRepair(jsonStr: string): string | null {
    try {
        let fixed = jsonStr;
        // Replace single quotes with double quotes
        fixed = fixed.replace(/'/g, '"');
        // Quote unquoted keys
        fixed = fixed.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
        // Remove trailing commas
        fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
        // Fix missing commas between properties
        fixed = fixed.replace(/"\s*\n\s*"/g, '",\n"');
        JSON.parse(fixed);
        return fixed;
    } catch {
        return null;
    }
}
