/**
 * Strip optional markdown code fences that some AI models wrap around JSON.
 * Handles ```json ... ``` and ``` ... ``` variants.
 */
export function stripAiCodeFences(raw: string): string {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
    return fenced ? fenced[1].trim() : trimmed;
}

/**
 * Parse a JSON object from an AI response that may be wrapped in code fences.
 * Throws a descriptive error when the response cannot be parsed.
 */
export function parseAiJsonObject(raw: string, label: string): Record<string, unknown> {
    const jsonText = stripAiCodeFences(raw);
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        throw new Error(`AI returned non-JSON ${label}: ${raw.slice(0, 200)}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`AI ${label} response must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
}
