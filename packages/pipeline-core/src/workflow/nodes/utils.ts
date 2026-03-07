/**
 * Shared utilities for AI processing nodes (map, reduce, ai).
 *
 * Internal helpers — not exported from the public workflow surface.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { Item, Items, WorkflowExecutionOptions } from '../types';
import { substituteVariables } from '../../utils/template-engine';
import { resolveSkill } from '../../pipeline/skill-resolver';
import { getLogger, LogCategory } from '../../logger';

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

/**
 * Extract JSON from an AI response that may be wrapped in markdown code fences.
 *
 * Strategy:
 * 1. Strip triple-backtick fences (```json ... ``` or ``` ... ```)
 * 2. Attempt direct JSON.parse
 * 3. Fall back to extracting the first `{...}` or `[...]` substring
 */
export function extractJsonFromResponse(response: string): unknown {
    const fenceMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenceMatch ? fenceMatch[1].trim() : response.trim();

    try {
        return JSON.parse(candidate);
    } catch {
        const objectMatch = candidate.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (objectMatch) {
            return JSON.parse(objectMatch[1]);
        }
        throw new Error(`Cannot extract JSON from AI response: ${candidate.slice(0, 120)}`);
    }
}

// ---------------------------------------------------------------------------
// Output merging
// ---------------------------------------------------------------------------

/**
 * Merge an AI response into an existing item.
 *
 * - If `outputFields` is empty/undefined → text mode: adds raw response as `text`.
 * - If `outputFields` is provided → JSON mode: parse response, extract declared fields.
 * - On parse failure in JSON mode → fall back to text mode with `__parseError: true`.
 */
export function mergeOutput(item: Item, response: string, outputFields?: string[]): Item {
    if (!outputFields || outputFields.length === 0) {
        return { ...item, text: response } as Item;
    }

    let parsed: Record<string, unknown>;
    try {
        const raw = extractJsonFromResponse(response);
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
            throw new Error('Expected a JSON object');
        }
        parsed = raw as Record<string, unknown>;
    } catch {
        return { ...item, text: response, __parseError: true } as Item;
    }

    const merged: Item = { ...item };
    for (const field of outputFields) {
        merged[field] = field in parsed ? (parsed[field] as Item[string]) : null;
    }
    return merged;
}

// ---------------------------------------------------------------------------
// Prompt resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a prompt template from either an inline string or a file path.
 * Optionally resolves one or more skills (prepended) and substitutes top-level parameters.
 *
 * @param skillNames - Array of skill names to resolve. Takes precedence over `skillName`.
 * @param skillName  - Single skill name (backward compat). Ignored if `skillNames` is provided.
 */
export async function resolvePrompt(
    prompt: string | undefined,
    promptFile: string | undefined,
    options: WorkflowExecutionOptions,
    parameters?: Record<string, string>,
    skillName?: string,
    skillNames?: string[],
): Promise<string> {
    let resolved: string;
    if (prompt) {
        resolved = prompt;
    } else if (promptFile) {
        const workflowDir = options.workflowDirectory ?? process.cwd();
        const filePath = path.resolve(workflowDir, promptFile);
        resolved = await fs.readFile(filePath, 'utf-8');
    } else {
        throw new Error('Node config requires either `prompt` or `promptFile`');
    }

    // Normalize to array: skillNames takes precedence over singular skillName
    const effectiveSkills = skillNames ?? (skillName ? [skillName] : []);

    // Prepend skill content if specified
    if (effectiveSkills.length > 0 && options.workspaceRoot) {
        const skillContents: string[] = [];
        for (const name of effectiveSkills) {
            try {
                const skillContent = await resolveSkill(name, options.workspaceRoot);
                skillContents.push(skillContent);
            } catch (err) {
                getLogger().warn(
                    LogCategory.PIPELINE,
                    `[Workflow] Failed to resolve skill "${name}": ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        }
        if (skillContents.length > 0) {
            resolved = skillContents.join('\n\n') + '\n\n' + resolved;
        }
    }

    // Substitute top-level parameters (before item-level substitution)
    if (parameters && Object.keys(parameters).length > 0) {
        resolved = substituteVariables(resolved, parameters, {
            missingValueBehavior: 'preserve',
            preserveSpecialVariables: true,
        });
    }
    return resolved;
}

// ---------------------------------------------------------------------------
// Template substitution
// ---------------------------------------------------------------------------

/**
 * Substitute `{{fieldName}}` placeholders in a template with item values.
 * Unknown variables become empty strings.
 */
export function buildItemPrompt(template: string, item: Item): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(item[key] ?? ''));
}

/**
 * Substitute `{{ITEMS}}` in a template with the JSON representation of a batch.
 */
export function buildBatchPrompt(template: string, batch: Items): string {
    return template.replace(/\{\{ITEMS\}\}/g, JSON.stringify(batch, null, 2));
}

/**
 * Split an array of items into batches of a given size.
 */
export function splitIntoBatches(items: Items, size: number): Items[] {
    const batches: Items[] = [];
    for (let i = 0; i < items.length; i += size) {
        batches.push(items.slice(i, i + size));
    }
    return batches;
}
