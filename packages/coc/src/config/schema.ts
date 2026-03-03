/**
 * Zod schema for CLI configuration file.
 *
 * Provides declarative validation with clear error messages
 * instead of manual typeof checks.
 */

import { z } from 'zod';

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
    /** How compact to render tool calls in conversation views: 0=full, 1=compact, 2=minimal (default: 0) */
    toolCompactness: z.number().int().min(0).max(2).optional(),
    chat: z.object({
        followUpSuggestions: z.object({
            enabled: z.boolean().optional(),
            count: z.number().int().min(1).max(5).optional(),
        }).strict().optional(),
    }).strict().optional(),
    serve: z.object({
        port: z.number().int().positive().max(65535).optional(),
        host: z.string().optional(),
        dataDir: z.string().optional(),
        theme: z.enum(['auto', 'light', 'dark']).optional(),
    }).strict().optional(),
    queue: z.object({
        historyLimit: z.number().int().positive().optional(),
        restartPolicy: z.enum(['fail', 'requeue', 'requeue-if-retriable']).optional(),
    }).strict().optional(),
}).strict();

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
            const messages = error.errors.map(e =>
                `  - ${e.path.join('.')}: ${e.message}`
            ).join('\n');
            throw new Error(`Invalid config file:\n${messages}`);
        }
        throw error;
    }
}
