/**
 * Load node executor — reads items from external sources.
 *
 * Supports four source types: csv, json, inline, and ai.
 * This is the only node type that originates items (all others transform).
 */

import * as fs from 'fs';
import * as path from 'path';
import { readCSVFile } from '../../pipeline/csv-reader';
import type { Item, Items, LoadNodeConfig, WorkflowExecutionOptions } from '../types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolvePath(filePath: string, workflowDirectory: string): string {
    return path.isAbsolute(filePath)
        ? filePath
        : path.resolve(workflowDirectory, filePath);
}

function applyLimit(items: Items, limit?: number): Items {
    if (limit === undefined || limit <= 0) return items;
    return items.slice(0, limit);
}

/**
 * Extract a JSON array from an AI response that may contain markdown fences
 * or surrounding prose.
 */
function extractJsonArray(text: string): unknown[] {
    // Try to find a fenced block first (```json ... ``` or ``` ... ```)
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenceMatch ? fenceMatch[1].trim() : text.trim();

    // Extract the first '[' ... ']' span
    const start = candidate.indexOf('[');
    const end = candidate.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) {
        throw new Error('Load node (ai): AI response does not contain a JSON array');
    }
    const jsonSlice = candidate.slice(start, end + 1);

    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonSlice);
    } catch {
        throw new Error('Load node (ai): AI response contains malformed JSON array');
    }

    if (!Array.isArray(parsed)) {
        throw new Error('Load node (ai): Extracted JSON is not an array');
    }
    return parsed;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a load node, returning items from the configured source.
 *
 * @param config  - Load node configuration with source discriminant.
 * @param options - Workflow execution options (workflowDirectory, aiInvoker).
 */
export async function executeLoad(
    config: LoadNodeConfig,
    options: WorkflowExecutionOptions
): Promise<Items> {
    switch (config.source.type) {
        case 'csv': {
            const workflowDir = options.workflowDirectory ?? process.cwd();
            const resolved = resolvePath(config.source.path, workflowDir);
            const result = await readCSVFile(resolved, {
                delimiter: config.source.delimiter,
            });
            return applyLimit(result.items as Items, config.limit);
        }

        case 'json': {
            const workflowDir = options.workflowDirectory ?? process.cwd();
            const resolved = resolvePath(config.source.path, workflowDir);
            let raw: string;
            try {
                raw = await fs.promises.readFile(resolved, 'utf-8');
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                    throw new Error(`Load node: JSON file not found: ${resolved}`);
                }
                throw err;
            }

            let parsed: unknown;
            try {
                parsed = JSON.parse(raw);
            } catch {
                throw new Error(`Load node: Invalid JSON in file: ${resolved}`);
            }

            let items: Items;
            if (Array.isArray(parsed)) {
                items = parsed as Items;
            } else if (
                typeof parsed === 'object' &&
                parsed !== null &&
                'items' in parsed &&
                Array.isArray((parsed as { items: unknown }).items)
            ) {
                items = (parsed as { items: Items }).items;
            } else {
                throw new Error(
                    `Load node: JSON file must contain an array or an object with an "items" array: ${resolved}`
                );
            }

            return applyLimit(items, config.limit);
        }

        case 'inline': {
            return applyLimit(config.source.items, config.limit);
        }

        case 'ai': {
            if (!options.aiInvoker) {
                throw new Error('Load node (ai): aiInvoker is required but not provided');
            }

            const schema = config.source.schema;
            const prompt = [
                `Generate items as a JSON array. Each item must have these fields: ${schema.join(', ')}.`,
                '',
                config.source.prompt,
                '',
                'Return ONLY a JSON array of objects. No explanation.',
            ].join('\n');

            const result = await options.aiInvoker(prompt, { model: config.source.model });

            if (!result.success || !result.response) {
                throw new Error(`Load node (ai): AI invocation failed: ${result.error ?? 'unknown error'}`);
            }

            const rawItems = extractJsonArray(result.response);
            const items: Items = rawItems.map((entry, index) => {
                if (typeof entry !== 'object' || entry === null) {
                    throw new Error(`Load node (ai): Item at index ${index} is not an object`);
                }
                const obj = entry as Record<string, unknown>;
                for (const field of schema) {
                    if (!(field in obj)) {
                        throw new Error(
                            `Load node (ai): Item at index ${index} is missing required field "${field}"`
                        );
                    }
                }
                // Coerce all values to strings to keep Item contract predictable
                return Object.fromEntries(
                    Object.entries(obj).map(([k, v]) => [k, String(v)])
                ) as Item;
            });

            return applyLimit(items, config.limit);
        }

        default: {
            const _exhaustive: never = config.source;
            throw new Error(`Load node: Unknown source type: ${(_exhaustive as { type: string }).type}`);
        }
    }
}
