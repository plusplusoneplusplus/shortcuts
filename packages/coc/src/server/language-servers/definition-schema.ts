import { z } from 'zod';
import type {
    LanguageServerDefinition,
    LanguageServerDefinitionError,
    LanguageServerDefinitionValidation,
} from './types';

/** Ids appear in log file names and status payloads, so keep them slug-safe. */
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Characters that would be meaningful to a shell. The executable is spawned
 * without a shell, so their presence means the value was built as a command
 * line and must be rejected rather than silently split.
 */
const SHELL_METACHARACTERS = /[;&|<>`$'"\n\r]/;

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
    z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
);

const definitionSchema = z.object({
    id: z.string().regex(ID_PATTERN, 'Id must start with a letter or digit and use only a-z, 0-9, dot, dash, underscore'),
    displayName: z.string().trim().min(1, 'Display name is required'),
    languageIds: z.array(z.string().trim().min(1, 'Language id cannot be empty')).min(1, 'At least one language id is required'),
    filePatterns: z.array(z.string().trim().min(1, 'File pattern cannot be empty')).min(1, 'At least one file pattern is required'),
    command: z
        .string()
        .trim()
        .min(1, 'Command is required')
        .refine((value) => !SHELL_METACHARACTERS.test(value), 'Command must be an executable, not a shell command line'),
    args: z.array(z.string().refine((value) => !/[\n\r]/.test(value), 'Argument cannot contain a line break')),
    rootMarkers: z.array(z.string().trim().min(1, 'Root marker cannot be empty')),
    extensionLanguageIds: z.record(z.string(), z.string().trim().min(1, 'Language id cannot be empty')).optional(),
    initializationOptions: jsonValueSchema.optional(),
    settings: jsonValueSchema.optional(),
    priority: z.number().int('Priority must be a whole number').optional(),
    sessionScope: z.enum(['editing-session', 'workspace']).optional(),
    maxSessions: z.number().int('Session limit must be a whole number').positive('Session limit must be positive').optional(),
    requestTimeoutMs: z.number().int('Request timeout must be a whole number').positive('Request timeout must be positive').optional(),
    idleTimeoutMs: z.number().int('Idle timeout must be a whole number').nonnegative('Idle timeout cannot be negative').optional(),
    enabled: z.boolean().optional(),
    builtIn: z.boolean().optional(),
});

/**
 * Validate one definition, returning either the normalized value or every
 * field-level error so settings can highlight the offending inputs and keep
 * the last valid configuration.
 */
export function validateLanguageServerDefinition(raw: unknown): LanguageServerDefinitionValidation {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return { ok: false, errors: [{ field: '', message: 'Definition must be a JSON object' }] };
    }
    const result = definitionSchema.safeParse(raw);
    if (!result.success) {
        return { ok: false, errors: toFieldErrors(result.error) };
    }
    return { ok: true, definition: normalize(result.data as LanguageServerDefinition) };
}

/** Extension keys are stored lowercase and dot-prefixed so lookups are direct. */
function normalize(definition: LanguageServerDefinition): LanguageServerDefinition {
    const normalized: LanguageServerDefinition = {
        ...definition,
        displayName: definition.displayName.trim(),
        command: definition.command.trim(),
    };
    if (definition.extensionLanguageIds) {
        const entries = Object.entries(definition.extensionLanguageIds).map(
            ([extension, languageId]) =>
                [extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`, languageId.trim()] as const,
        );
        normalized.extensionLanguageIds = Object.fromEntries(entries);
    }
    return normalized;
}

function toFieldErrors(error: z.ZodError): LanguageServerDefinitionError[] {
    return error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
    }));
}

/**
 * Validate a list of definitions. Duplicate ids are reported against the later
 * entry so the first definition of an id stays usable.
 */
export function validateLanguageServerDefinitions(raw: unknown): {
    definitions: LanguageServerDefinition[];
    errors: LanguageServerDefinitionError[];
} {
    if (!Array.isArray(raw)) {
        return { definitions: [], errors: [{ field: '', message: 'Definitions must be a JSON array' }] };
    }
    const definitions: LanguageServerDefinition[] = [];
    const errors: LanguageServerDefinitionError[] = [];
    const seen = new Set<string>();
    raw.forEach((entry, index) => {
        const result = validateLanguageServerDefinition(entry);
        if (!result.ok) {
            for (const error of result.errors) {
                errors.push({ field: error.field ? `${index}.${error.field}` : `${index}`, message: error.message });
            }
            return;
        }
        if (seen.has(result.definition.id)) {
            errors.push({ field: `${index}.id`, message: `Duplicate definition id "${result.definition.id}"` });
            return;
        }
        seen.add(result.definition.id);
        definitions.push(result.definition);
    });
    return { definitions, errors };
}
