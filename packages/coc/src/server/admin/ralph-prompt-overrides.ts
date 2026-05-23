/**
 * Ralph Prompt Override Persistence
 *
 * Reads and writes per-prompt admin overrides from/to a global JSON file at
 * `<dataDir>/admin-prompt-overrides.json`.  Absent file = all built-in
 * defaults.  Any read / write failure is handled silently so the server
 * never crashes over a missing or corrupt overrides file.
 *
 * Callers
 *  - `admin-handler.ts` — GET /api/admin/prompts (read), PUT/DELETE (write)
 *  - `chat-base-executor.ts` — grilling phase suffix
 *  - `ralph-executor.ts` — execution system prompt
 *  - `synthesis-prompt.ts` caller — synthesis base
 *  - `iteration-prompt.ts` caller — iteration user prompt
 */

import * as fs from 'fs';
import * as path from 'path';

/** IDs for the four tunable Ralph prompt blocks. */
export const RALPH_PROMPT_IDS = [
    'ralph-grill-suffix',
    'ralph-synthesis',
    'ralph-execution-system',
    'ralph-iteration-user',
] as const;

export type RalphPromptId = typeof RALPH_PROMPT_IDS[number];

export function getPromptOverridesPath(dataDir: string): string {
    return path.join(dataDir, 'admin-prompt-overrides.json');
}

function readOverrides(dataDir: string): Record<string, string> {
    try {
        const raw = fs.readFileSync(getPromptOverridesPath(dataDir), 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, string>;
        }
        return {};
    } catch {
        return {};
    }
}

/** Returns the override text for the given prompt ID, or undefined if not overridden. */
export function getPromptOverride(id: string, dataDir: string): string | undefined {
    return readOverrides(dataDir)[id];
}

/** Read all current overrides as a plain record. */
export function getAllPromptOverrides(dataDir: string): Record<string, string> {
    return readOverrides(dataDir);
}

/** Save an override for the given prompt ID. Creates the file if absent. */
export function savePromptOverride(id: string, text: string, dataDir: string): void {
    const overridesPath = getPromptOverridesPath(dataDir);
    const overrides = readOverrides(dataDir);
    overrides[id] = text;
    fs.writeFileSync(overridesPath, JSON.stringify(overrides, null, 2) + '\n', 'utf8');
}

/** Remove the override for the given prompt ID (resets to built-in default). */
export function deletePromptOverride(id: string, dataDir: string): void {
    const overridesPath = getPromptOverridesPath(dataDir);
    const overrides = readOverrides(dataDir);
    if (!(id in overrides)) return;
    delete overrides[id];
    fs.writeFileSync(overridesPath, JSON.stringify(overrides, null, 2) + '\n', 'utf8');
}
