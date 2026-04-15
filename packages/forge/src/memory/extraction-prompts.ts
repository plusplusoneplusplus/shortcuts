/**
 * Extraction Prompts
 *
 * System and user prompt templates for extracting durable facts from
 * conversation transcripts. Used by the offline extraction pipeline
 * (TranscriptExtractor in coc-server) to turn completed conversations
 * into raw memory observations.
 *
 * No VS Code dependencies — pure Node.js.
 */

// ============================================================================
// System Prompt
// ============================================================================

export const EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction assistant. Given a conversation transcript between a user and an AI assistant about a software codebase, extract durable facts that would be useful in future conversations about the same codebase.

Output a JSON array of objects with this schema:
[{ "fact": "<self-contained statement>", "category": "<category>" }]

### Categories
- conventions — coding standards, naming patterns, style rules, team preferences
- architecture — system structure, module boundaries, data flow, key abstractions
- patterns — recurring implementation patterns, design decisions, idioms
- gotchas — pitfalls, known issues, non-obvious behaviors, workarounds
- tools — build tools, CI/CD, testing frameworks, dev environment setup
- decisions — design choices made during the conversation, rationale, trade-offs

### Rules
- Extract ONLY facts that would help future sessions working on this codebase
- Each fact must be self-contained — understandable without the original conversation
- Skip debugging noise, one-off errors, stack traces, file content listings
- Skip ephemeral information (timestamps, session IDs, temporary workarounds)
- Preserve all opaque identifiers exactly (file paths, package names, config keys)
- Target 2–8 facts per conversation (most have 3–5)
- If the conversation has no durable facts, return an empty array: []
- Output ONLY the JSON array — no preamble, no explanation, no markdown fences`;

// ============================================================================
// User Prompt Template
// ============================================================================

/**
 * Build the user prompt for fact extraction from a transcript.
 *
 * @param transcript - The conversation transcript (user/assistant turns only)
 * @param repoContext - Optional repo name or path for context
 */
export function buildExtractionUserPrompt(transcript: string, repoContext?: string): string {
    const parts: string[] = [];
    if (repoContext) {
        parts.push(`Repository: ${repoContext}\n`);
    }
    parts.push('## Conversation Transcript\n');
    parts.push(transcript);
    return parts.join('\n');
}

// ============================================================================
// Response Parsing
// ============================================================================

export interface ExtractedFact {
    fact: string;
    category: string;
}

const VALID_CATEGORIES = new Set(['conventions', 'architecture', 'patterns', 'gotchas', 'tools', 'decisions']);

/**
 * Parse the AI response into extracted facts.
 * Handles various edge cases: markdown fences, whitespace, malformed JSON.
 */
export function parseExtractionResponse(response: string): ExtractedFact[] {
    if (!response || response.trim().length === 0) return [];

    // Strip markdown code fences if present
    let cleaned = response.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    cleaned = cleaned.trim();

    if (cleaned === '[]') return [];

    let parsed: unknown;
    try {
        parsed = JSON.parse(cleaned);
    } catch {
        // Try to extract JSON array from surrounding text
        const match = cleaned.match(/\[[\s\S]*\]/);
        if (!match) return [];
        try {
            parsed = JSON.parse(match[0]);
        } catch {
            return [];
        }
    }

    if (!Array.isArray(parsed)) return [];

    return parsed
        .filter((item): item is { fact: string; category: string } =>
            item !== null &&
            typeof item === 'object' &&
            typeof (item as any).fact === 'string' &&
            (item as any).fact.trim().length > 0,
        )
        .map(item => ({
            fact: item.fact.trim(),
            category: VALID_CATEGORIES.has(item.category) ? item.category : 'patterns',
        }));
}
