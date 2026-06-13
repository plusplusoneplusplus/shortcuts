/**
 * Zod schema for CLI configuration file.
 *
 * Admin-editable leaves are GENERATED from the unified setting registry in
 * admin-setting-definitions.ts — adding a setting there extends this schema
 * automatically. The hand-written base below only declares fields that are
 * not admin-editable (queue, models, logging, monitoring, skills, …).
 */

import { z } from 'zod';
import type { CLIConfig } from '../config';
import { ADMIN_SETTING_DEFINITIONS, type AdminSettingValueSpec } from './admin-setting-definitions';

// ============================================================================
// Hand-written sub-schemas (non-admin-editable structures)
// ============================================================================

const concreteAgentProviderEnum = z.enum(['copilot', 'codex', 'claude']);
const percentSchema = z.number().int().min(0).max(100);

const loggingLevelEnum = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

const loggingStoreSchema = z.object({
    level: loggingLevelEnum.optional(),
    file: z.boolean().optional(),
}).passthrough();

const loggingConfigSchema = z.object({
    level: loggingLevelEnum.optional(),
    dir: z.string().optional(),
    pretty: z.union([z.literal('auto'), z.boolean()]).optional(),
    stores: z.record(z.string(), loggingStoreSchema.optional()).optional(),
}).passthrough();

const autoProviderRoutingRuleSchema = z.object({
    provider: concreteAgentProviderEnum,
    enabled: z.boolean().optional(),
    minimumRemainingPercent: percentSchema.optional(),
    weeklyGuard: z.object({
        enabled: z.boolean().optional(),
        minimumRemainingPercent: percentSchema.optional(),
    }).passthrough().optional(),
}).passthrough();

const autoProviderRoutingSchema = z.object({
    rules: z.array(autoProviderRoutingRuleSchema).optional(),
    fallbackProvider: concreteAgentProviderEnum.optional(),
}).passthrough();

/**
 * File schemas for registry settings with `kind: 'custom'` validation.
 * Every custom setting must have an entry here (enforced at module load).
 */
const CUSTOM_FILE_SCHEMAS: Record<string, z.ZodTypeAny> = {
    'agentProviderRouting.auto': autoProviderRoutingSchema,
};

// ============================================================================
// Schema generation from the admin setting registry
// ============================================================================

type SchemaTree = { [key: string]: z.ZodTypeAny | SchemaTree };

function isZodType(value: z.ZodTypeAny | SchemaTree): value is z.ZodTypeAny {
    return value instanceof z.ZodType;
}

/**
 * Map a registry value spec to its (loose) file-schema leaf. Admin-only
 * constraints that would reject historically valid files (e.g. string length
 * limits) are intentionally not applied here.
 */
function zodLeafForSpec(key: string, spec: AdminSettingValueSpec): z.ZodTypeAny {
    switch (spec.kind) {
        case 'boolean':
            return z.boolean();
        case 'string':
            return z.string();
        case 'enum':
            return spec.nullable
                ? z.enum(spec.values as [string, ...string[]]).nullish()
                : z.enum(spec.values as [string, ...string[]]);
        case 'number': {
            let leaf = z.number();
            if (spec.integer) leaf = leaf.int();
            if (spec.gt === 0) leaf = leaf.positive();
            else if (spec.gt !== undefined) leaf = leaf.gt(spec.gt);
            if (spec.min !== undefined) leaf = leaf.min(spec.min);
            if (spec.max !== undefined) leaf = leaf.max(spec.max);
            return leaf;
        }
        case 'custom': {
            const custom = CUSTOM_FILE_SCHEMAS[key];
            if (!custom) {
                throw new Error(`No file schema registered for custom admin setting '${key}' — add it to CUSTOM_FILE_SCHEMAS in config/schema.ts`);
            }
            return custom;
        }
    }
}

/** Insert a leaf schema into a nested tree at a dot-notation key. */
function insertLeaf(tree: SchemaTree, key: string, leaf: z.ZodTypeAny): void {
    const segments = key.split('.');
    let current = tree;
    for (const segment of segments.slice(0, -1)) {
        const next = current[segment];
        if (next === undefined) {
            const created: SchemaTree = {};
            current[segment] = created;
            current = created;
        } else if (isZodType(next)) {
            throw new Error(`Schema tree conflict at '${key}': '${segment}' is already a leaf`);
        } else {
            current = next;
        }
    }
    current[segments[segments.length - 1]] = leaf;
}

function buildAdminSettingsSchemaTree(): SchemaTree {
    const tree: SchemaTree = {};
    for (const def of ADMIN_SETTING_DEFINITIONS) {
        insertLeaf(tree, def.key, zodLeafForSpec(def.key, def.value));
    }
    return tree;
}

/** Deep-merge two schema trees; overlay leaves win over base leaves. */
function mergeSchemaTrees(base: SchemaTree, overlay: SchemaTree): SchemaTree {
    const merged: SchemaTree = { ...base };
    for (const [key, value] of Object.entries(overlay)) {
        const existing = merged[key];
        if (existing !== undefined && !isZodType(existing) && !isZodType(value)) {
            merged[key] = mergeSchemaTrees(existing, value);
        } else {
            merged[key] = value;
        }
    }
    return merged;
}

/** Convert a schema tree to a zod object: every field optional, objects passthrough. */
function treeToZodObject(tree: SchemaTree): z.ZodTypeAny {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, value] of Object.entries(tree)) {
        shape[key] = (isZodType(value) ? value : treeToZodObject(value)).optional();
    }
    return z.object(shape).passthrough();
}

/**
 * Hand-written base tree: config-file fields that are NOT admin-editable.
 * Leaves here must not overlap with registry keys (the generated tree wins).
 */
const BASE_SCHEMA_TREE: SchemaTree = {
    approvePermissions: z.boolean(),
    mcpConfig: z.string(),
    persist: z.boolean(),
    serve: {
        port: z.number().int().positive().max(65535),
        host: z.string(),
        dataDir: z.string(),
        theme: z.enum(['auto', 'light', 'dark']),
    },
    queue: {
        historyLimit: z.number().int().positive(),
        restartPolicy: z.enum(['fail', 'requeue', 'requeue-if-retriable']),
        restartPickupDelayMs: z.number().int().min(0),
    },
    models: {
        enabled: z.array(z.string()),
    },
    logging: loggingConfigSchema,
    features: {
        autoMemoryPromotion: z.boolean(),
        gitCommitLookup: z.boolean(),
    },
    dreams: {
        idleCheckIntervalMs: z.number().int().positive(),
        minIdleMs: z.number().int().min(0),
        confidenceThreshold: z.number().min(0).max(1),
        maxCandidates: z.number().int().positive(),
        conversationLimit: z.number().int().positive(),
        timeoutMs: z.number().int().positive(),
    },
    memoryPromotion: {
        batchSize: z.number().int().positive(),
        timeoutMs: z.number().int().positive(),
        model: z.string(),
        aiNormalization: {
            enabled: z.boolean(),
            timeoutMs: z.number().int().positive(),
            model: z.string(),
        },
    },
    store: {
        backend: z.enum(['file', 'sqlite']),
    },
    monitoring: {
        heapCheck: {
            enabled: z.boolean(),
            intervalMs: z.number().int().positive(),
            warnThreshold: z.number().min(0).max(100),
            criticalThreshold: z.number().min(0).max(100),
        },
    },
    skills: {
        autoUpdate: z.boolean(),
        defaultSkills: z.array(z.string()),
    },
};

/**
 * Zod schema for CLI configuration file.
 * Base (non-admin) shape + generated admin-editable leaves.
 */
export const CLIConfigSchema = treeToZodObject(
    mergeSchemaTrees(BASE_SCHEMA_TREE, buildAdminSettingsSchemaTree())
) as unknown as z.ZodType<CLIConfig>;

/**
 * Parsed config type (should match CLIConfig)
 */
export type CLIConfigFromSchema = CLIConfig;

/**
 * Validate a config object using the Zod schema.
 * @throws {Error} if config is invalid with detailed error messages
 */
export function validateConfigWithSchema(config: unknown): CLIConfigFromSchema {
    try {
        return CLIConfigSchema.parse(config);
    } catch (error) {
        if (error instanceof z.ZodError) {
            const messages = error.issues.map(e =>
                `  - ${(e.path as (string | number)[]).join('.')}: ${e.message}`
            ).join('\n');
            throw new Error(`Invalid config file:\n${messages}`);
        }
        throw error;
    }
}
