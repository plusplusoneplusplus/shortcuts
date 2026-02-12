/**
 * Job Template Types
 *
 * Type definitions for saved AI job templates.
 * Templates allow users to save and reuse job configurations
 * for the AI task queue system.
 */

// ============================================================================
// Template Types
// ============================================================================

/**
 * Scope determines where a template is stored:
 * - workspace: Stored in VS Code workspaceState (isolated per workspace)
 * - global: Stored in VS Code globalState (available across all workspaces)
 */
export type JobTemplateScope = 'workspace' | 'global';

/**
 * Template type matches the queue job modes
 */
export type JobTemplateType = 'freeform' | 'skill';

/**
 * Sort order for template listing
 */
export type JobTemplateSortBy = 'lastUsed' | 'name' | 'useCount';

/**
 * A saved job template capturing everything needed to replay a job.
 */
export interface JobTemplate {
    /** Unique identifier (UUID) */
    id: string;
    /** User-given display name */
    name: string;
    /** Where the template is stored */
    scope: JobTemplateScope;

    // Job configuration
    /** The prompt text (may contain {{variables}}) */
    prompt: string;
    /** AI model ID, or undefined for default */
    model?: string;
    /** Relative path or undefined for workspace root */
    workingDirectory?: string;
    /** Template type: freeform prompt or skill-based */
    type: JobTemplateType;
    /** Skill name if type is 'skill' */
    skillName?: string;

    // Metadata
    /** ISO timestamp when template was created */
    createdAt: string;
    /** ISO timestamp when template was last used (updated each time) */
    lastUsedAt?: string;
    /** Number of times this template has been used */
    useCount: number;
}

/**
 * Serialized form of a JobTemplate (stored in Memento).
 * Currently identical to JobTemplate since all fields are serializable.
 */
export type SerializedJobTemplate = JobTemplate;

// ============================================================================
// Template Variable Extraction
// ============================================================================

/** Regex pattern for template variables: {{variableName}} */
const TEMPLATE_VARIABLE_PATTERN = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

/**
 * Extract template variable names from a prompt string.
 *
 * @param prompt - The prompt text to scan
 * @returns Array of unique variable names found (e.g., ['file', 'module'])
 */
export function extractTemplateVariables(prompt: string): string[] {
    const variables = new Set<string>();
    let match;
    // Reset lastIndex in case of reuse
    TEMPLATE_VARIABLE_PATTERN.lastIndex = 0;
    while ((match = TEMPLATE_VARIABLE_PATTERN.exec(prompt)) !== null) {
        variables.add(match[1]);
    }
    return Array.from(variables);
}

/**
 * Check if a prompt contains template variables.
 *
 * @param prompt - The prompt text to check
 * @returns true if the prompt contains at least one {{variable}}
 */
export function hasTemplateVariables(prompt: string): boolean {
    TEMPLATE_VARIABLE_PATTERN.lastIndex = 0;
    return TEMPLATE_VARIABLE_PATTERN.test(prompt);
}

/**
 * Substitute template variables in a prompt with provided values.
 *
 * @param prompt - The prompt text with {{variables}}
 * @param values - Map of variable name to value
 * @returns The prompt with variables replaced
 */
export function substituteTemplateVariables(
    prompt: string,
    values: Record<string, string>
): string {
    return prompt.replace(TEMPLATE_VARIABLE_PATTERN, (match, varName) => {
        return varName in values ? values[varName] : match;
    });
}

// ============================================================================
// Template Creation Helpers
// ============================================================================

/**
 * Options for creating a new template
 */
export interface CreateTemplateOptions {
    /** Display name */
    name: string;
    /** Storage scope */
    scope: JobTemplateScope;
    /** Prompt text */
    prompt: string;
    /** Template type */
    type: JobTemplateType;
    /** AI model ID */
    model?: string;
    /** Working directory */
    workingDirectory?: string;
    /** Skill name (for skill type) */
    skillName?: string;
}

/**
 * Validate a template name.
 *
 * @param name - The proposed template name
 * @returns Error message or null if valid
 */
export function validateTemplateName(name: string): string | null {
    if (!name || name.trim().length === 0) {
        return 'Template name cannot be empty';
    }
    if (name.trim().length > 100) {
        return 'Template name must be 100 characters or fewer';
    }
    return null;
}
