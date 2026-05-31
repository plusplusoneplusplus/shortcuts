/**
 * Zod schema for CLI configuration file.
 *
 * Provides declarative validation with clear error messages
 * instead of manual typeof checks.
 */

import { z } from 'zod';

// ============================================================================
// Logging sub-schemas
// ============================================================================

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

/**
 * Zod schema for CLI configuration file
 */
export const CLIConfigSchema = z.object({
    model: z.string().optional(),
    parallel: z.number().int().positive().optional(),
    output: z.enum(['table', 'json', 'csv', 'markdown']).optional(),
    approvePermissions: z.boolean().optional(),
    mcpConfig: z.string().optional(),
    timeout: z.number().positive().optional(),
    persist: z.boolean().optional(),
    /** Show report_intent tool calls in conversation views (default: false) */
    showReportIntent: z.boolean().optional(),
    /** How compact to render tool calls in conversation views: 0=full, 1=compact, 2=minimal, 3=whisper (default: 0) */
    toolCompactness: z.number().int().min(0).max(3).optional(),
    /** Density of task cards in the activity tab: 'compact' (default) or 'dense' (single-line) */
    taskCardDensity: z.enum(['compact', 'dense']).optional(),
    /** Absorb single-line messages between same-category tool groups (default: true) */
    groupSingleLineMessages: z.boolean().optional(),
    chat: z.object({
        followUpSuggestions: z.object({
            enabled: z.boolean().optional(),
            count: z.number().int().min(1).max(5).optional(),
        }).passthrough().optional(),
        askUser: z.object({
            enabled: z.boolean().optional(),
        }).passthrough().optional(),
    }).passthrough().optional(),
    serve: z.object({
        port: z.number().int().positive().max(65535).optional(),
        host: z.string().optional(),
        dataDir: z.string().optional(),
        theme: z.enum(['auto', 'light', 'dark']).optional(),
        serverName: z.string().optional(),
    }).passthrough().optional(),
    queue: z.object({
        historyLimit: z.number().int().positive().optional(),
        restartPolicy: z.enum(['fail', 'requeue', 'requeue-if-retriable']).optional(),
        restartPickupDelayMs: z.number().int().min(0).optional(),
    }).passthrough().optional(),
    models: z.object({
        enabled: z.array(z.string()).optional(),
    }).passthrough().optional(),
    logging: loggingConfigSchema.optional(),
    terminal: z.object({
        enabled: z.boolean().optional(),
    }).passthrough().optional(),
    notes: z.object({
        enabled: z.boolean().optional(),
    }).passthrough().optional(),
    myWork: z.object({
        enabled: z.boolean().optional(),
    }).passthrough().optional(),
    myLife: z.object({
        enabled: z.boolean().optional(),
    }).passthrough().optional(),
    scratchpad: z.object({
        enabled: z.boolean().optional(),
        layout: z.enum(['horizontal', 'vertical']).optional(),
    }).passthrough().optional(),
    workflows: z.object({
        enabled: z.boolean().optional(),
    }).passthrough().optional(),
    pullRequests: z.object({
        enabled: z.boolean().optional(),
        suggestions: z.boolean().optional(),
    }).passthrough().optional(),
    servers: z.object({
        enabled: z.boolean().optional(),
    }).passthrough().optional(),
    vimNavigation: z.object({
        enabled: z.boolean().optional(),
    }).passthrough().optional(),
    excalidraw: z.object({
        enabled: z.boolean().optional(),
    }).passthrough().optional(),
    codex: z.object({
        enabled: z.boolean().optional(),
    }).passthrough().optional(),
    claude: z.object({
        enabled: z.boolean().optional(),
    }).passthrough().optional(),
    defaultProvider: z.enum(['copilot', 'codex', 'claude']).optional(),
    ralph: z.object({
        enabled: z.boolean().optional(),
        finalCheck: z.object({
            maxGapFixLoops: z.number().int().min(1).optional(),
        }).passthrough().optional(),
    }).passthrough().optional(),
    loops: z.object({
        enabled: z.boolean().optional(),
    }).passthrough().optional(),
    mcpOauth: z.object({
        enabled: z.boolean().optional(),
    }).passthrough().optional(),
    features: z.object({
        autoMemoryPromotion: z.boolean().optional(),
        focusedDiff: z.boolean().optional(),
        gitCommitLookup: z.boolean().optional(),
    }).passthrough().optional(),
    memoryPromotion: z.object({
        batchSize: z.number().int().positive().optional(),
        timeoutMs: z.number().int().positive().optional(),
        model: z.string().optional(),
        aiNormalization: z.object({
            enabled: z.boolean().optional(),
            timeoutMs: z.number().int().positive().optional(),
            model: z.string().optional(),
        }).passthrough().optional(),
    }).passthrough().optional(),
    store: z.object({
        backend: z.enum(['file', 'sqlite']).optional(),
    }).passthrough().optional(),
    monitoring: z.object({
        heapCheck: z.object({
            enabled: z.boolean().optional(),
            intervalMs: z.number().int().positive().optional(),
            warnThreshold: z.number().min(0).max(100).optional(),
            criticalThreshold: z.number().min(0).max(100).optional(),
        }).passthrough().optional(),
    }).passthrough().optional(),
    skills: z.object({
        autoUpdate: z.boolean().optional(),
        defaultSkills: z.array(z.string()).optional(),
    }).passthrough().optional(),
    workItems: z.object({
        hierarchy: z.object({
            enabled: z.boolean().optional(),
        }).passthrough().optional(),
        aiAuthoring: z.object({
            enabled: z.boolean().optional(),
        }).passthrough().optional(),
    }).passthrough().optional(),
    effortLevels: z.object({
        enabled: z.boolean().optional(),
    }).passthrough().optional(),
}).passthrough();

/**
 * Inferred type from schema (should match CLIConfig)
 */
export type CLIConfigFromSchema = z.infer<typeof CLIConfigSchema>;

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
