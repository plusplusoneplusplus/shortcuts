/**
 * Extraction step (generic, skill-agnostic).
 *
 * Converts a free-text answer (e.g. a rollout's stdout) into a structured,
 * machine-comparable form: an ordered list of atomic "key points" / decisions.
 *
 *   { "points": [ { "id": 1, "text": "<atomic decision/claim>", "group"?: "<label>" } ] }
 *
 * This decouples the messy free-text produced by the target agent from the reward
 * math: the downstream scorer compares structured points, not prose. The extractor
 * is a *transcription* step — it must NOT add, remove, judge, or rank information.
 *
 * AI is reliable at this kind of constrained transform, so a single headless Copilot
 * call is used, with one retry on parse failure and a safe empty fallback.
 */

import { runCopilotCli, CopilotCliOptions } from './cli-driver';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StructuredPoint {
    id: number;
    text: string;
    group?: string;
}

export interface StructuredOutput {
    points: StructuredPoint[];
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

/**
 * Builds the extraction prompt. The model is asked to transcribe — not judge — the
 * answer into atomic points, optionally clustering them with a `group` label.
 */
export function buildExtractPrompt(text: string): string {
    return [
        'You are a precise information extractor. Convert the ANSWER below into a JSON',
        'list of atomic "points" — the distinct decisions, claims, or recommendations it',
        'makes. Do NOT add, remove, judge, rank, or editorialize. Preserve the original',
        "answer's meaning and ordering. If the answer groups items (e.g. by section,",
        'commit, category, or theme), record that grouping in an optional "group" label so',
        'points belonging together share the same label.',
        '',
        'Output ONLY a single JSON object in a ```json code block with this shape:',
        '```json',
        '{ "points": [ { "id": 1, "text": "<atomic point>", "group": "<optional label>" } ] }',
        '```',
        '',
        'ANSWER:',
        '"""',
        text.trim() || '(empty)',
        '"""',
    ].join('\n');
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Extracts the first ```json … ``` block (or a bare JSON object) from the CLI output
 * and validates it into a StructuredOutput. Throws on malformed input.
 */
export function parseStructuredOutput(raw: string): StructuredOutput {
    let jsonText: string | null = null;

    const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
    if (fenced) {
        jsonText = fenced[1].trim();
    } else {
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start !== -1 && end > start) {
            jsonText = raw.slice(start, end + 1);
        }
    }

    if (jsonText === null) {
        throw new Error('No JSON object found in extractor output');
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch (err) {
        throw new Error(`Extractor output is not valid JSON: ${(err as Error).message}`);
    }

    if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as Record<string, unknown>).points)) {
        throw new Error('Extractor output must be an object with a "points" array');
    }

    const rawPoints = (parsed as { points: unknown[] }).points;
    const points: StructuredPoint[] = [];
    for (let i = 0; i < rawPoints.length; i++) {
        const p = rawPoints[i];
        if (typeof p !== 'object' || p === null) {
            throw new Error(`points[${i}] must be an object`);
        }
        const obj = p as Record<string, unknown>;
        if (typeof obj.text !== 'string' || obj.text.trim().length === 0) {
            throw new Error(`points[${i}].text must be a non-empty string`);
        }
        const id = typeof obj.id === 'number' ? obj.id : i + 1;
        const point: StructuredPoint = { id, text: obj.text.trim() };
        if (typeof obj.group === 'string' && obj.group.trim().length > 0) {
            point.group = obj.group.trim();
        }
        points.push(point);
    }

    return { points };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Extracts a StructuredOutput from free text via a headless Copilot call.
 * Retries once on parse failure; returns `{ points: [] }` if both attempts fail
 * (the caller treats an empty structure as a zero structural score).
 */
export async function extractStructuredOutput(
    text: string,
    model: string,
    workdir: string,
    options: CopilotCliOptions = {}
): Promise<StructuredOutput> {
    if (!text || text.trim().length === 0) {
        return { points: [] };
    }

    const prompt = buildExtractPrompt(text);

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const result = await runCopilotCli(prompt, workdir, model, options);
            return parseStructuredOutput(result.stdout);
        } catch {
            // fall through to retry / fallback
        }
    }

    return { points: [] };
}
