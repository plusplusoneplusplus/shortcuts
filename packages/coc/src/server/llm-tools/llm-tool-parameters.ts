/**
 * LLM tool parameter summarization
 *
 * Pure, display-only helpers that compress a tool's JSON-schema `parameters`
 * into a compact, scannable list for the workspace LLM tools settings UI.
 *
 * This module intentionally has no runtime dependencies and never affects tool
 * execution, validation, or persisted preferences — it only derives additive
 * display metadata from the schemas tools already declare via `defineTool()`.
 */

import type { LlmToolParam } from './llm-tool-registry';

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normalize a JSON-schema `type` field to a single primitive type name.
 * Handles union types (`['string', 'null']`) by picking the first non-null
 * concrete type. Returns `undefined` when no usable type string is present.
 */
function normalizeType(type: unknown): string | undefined {
    if (typeof type === 'string') return type;
    if (Array.isArray(type)) {
        const first = type.find((t) => typeof t === 'string' && t !== 'null');
        return typeof first === 'string' ? first : undefined;
    }
    return undefined;
}

/**
 * Compress a single JSON-schema property into a compact type label.
 *
 * - objects (explicit `type: 'object'` or a `properties` map) → `{...}`
 * - arrays (explicit `type: 'array'` or an `items` shape) → `[...]`
 * - primitives → their JSON-schema type name (`string`, `number`, …)
 * - typeless enums → `enum`
 * - anything indeterminate → `any`
 */
export function compactParamType(prop: unknown): string {
    if (!isPlainObject(prop)) return 'any';
    const type = normalizeType(prop.type);
    if (type === 'object') return '{...}';
    if (type === 'array') return '[...]';
    if (type) return type;
    // No explicit type — infer a concise shape from the schema structure.
    if (isPlainObject(prop.properties)) return '{...}';
    if (prop.items !== undefined) return '[...]';
    if (Array.isArray(prop.enum)) return 'enum';
    return 'any';
}

/**
 * Derive a compact, display-only parameter summary from a tool's `parameters`
 * JSON schema.
 *
 * Returns:
 *   - an array (possibly empty) when `schema` is a usable JSON-schema object;
 *     an empty array means the tool declares no parameters.
 *   - `undefined` when no JSON-schema object is available — e.g. a Zod schema,
 *     a non-object schema, or no schema at all — so callers can distinguish
 *     "no parameters" (empty array) from "parameters unavailable" (undefined).
 *
 * Parameters preserve the declaration order of the schema's `properties`.
 */
export function summarizeToolParameters(schema: unknown): LlmToolParam[] | undefined {
    if (!isPlainObject(schema)) return undefined;

    const type = normalizeType(schema.type);
    const properties = schema.properties;
    const isObjectSchema = type === 'object' || isPlainObject(properties);
    if (!isObjectSchema) return undefined;
    if (!isPlainObject(properties)) return [];

    const requiredList = schema.required;
    const required = new Set<string>(
        Array.isArray(requiredList)
            ? requiredList.filter((n): n is string => typeof n === 'string')
            : [],
    );

    return Object.entries(properties).map(([name, prop]) => ({
        name,
        type: compactParamType(prop),
        required: required.has(name),
    }));
}
