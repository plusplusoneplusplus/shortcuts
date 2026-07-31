/**
 * Built-in Prompt Catalogue
 *
 * Pure metadata + override projection/validation for the admin prompt editor.
 * No route or HTTP concerns live here.
 */

import { READ_ONLY_SYSTEM_MESSAGE, SECURITY_PATTERNS_DESCRIPTION } from '@plusplusoneplusplus/forge';
import { getAllPromptOverrides } from './admin-prompt-overrides';

export interface BuiltInPrompt {
    id: string;
    title: string;
    group: string;
    source: string;
    description: string;
    /** Built-in default text. */
    text: string;
    /** Whether this prompt supports admin overrides. */
    editable?: boolean;
    /** Required template variable names that must appear in any override. */
    templateVars?: string[];
    /** Active override text, if set. */
    overrideText?: string;
    /** True when an override is currently active. */
    hasOverride?: boolean;
}

/** Return all built-in prompts as a record keyed by prompt id. */
export function getBuiltInPrompts(): Record<string, BuiltInPrompt> {
    return {
        'read-only-mode': {
            id: 'read-only-mode',
            title: 'Read-only Mode',
            group: 'Pipeline',
            source: 'forge/copilot-sdk-wrapper/types.ts',
            description: 'System message injected in Ask-mode sessions blocking file edits',
            text: READ_ONLY_SYSTEM_MESSAGE,
        },
        'task-creation': {
            id: 'task-creation',
            title: 'Task Creation',
            group: 'Pipeline',
            source: 'forge/tasks/task-prompt-builder.ts',
            description: 'Instructions for creating .plan.md files — naming, structure',
            text: `Can you draft a plan given user's ask: \${description}

**IMPORTANT: Output Location Requirement**
1. You MUST save the file to this EXACT directory: \${targetPath}
- Create a single .plan.md file
- Do NOT save to any other location
- Do NOT use your session state or any other directory
2. You MUST NOT implement the task, you are only responsible for creating the plan file.`,
        },
        'plan-generation': {
            id: 'plan-generation',
            title: 'Plan Generation',
            group: 'Pipeline',
            source: 'forge/tasks/task-prompt-builder.ts',
            description: 'System message governing plan document structure and output location',
            text: `You are a plan generator. Your sole responsibility is to produce a .plan.md file(s).

## Output Rules
\${locationBlock}
- File names MUST be kebab-case and end with \`.plan.md\` (e.g. \`oauth2-authentication.plan.md\`).
- You MUST NOT implement the plan. Only create the plan document.
- Do NOT save files to your session state or any directory other than the specified target.

## Plan Document Structure
The plan file should include:
- A clear title (H1)
- Problem statement and proposed approach
- Acceptance criteria
- Subtasks broken into actionable items
- Notes or open questions (if any)`,
        },
        'skill-prompt-wrapper': {
            id: 'skill-prompt-wrapper',
            title: 'Skill Prompt Wrapper',
            group: 'Pipeline',
            source: 'forge/pipeline/phases/prompt-resolution.ts',
            description: 'Section headers [Skill Guidance] / [Task] wrapping skill + main prompt',
            text: `[Skill Guidance: \${skillName}]
\${skillContent}

[Task]
\${mainPrompt}`,
        },
        'memory-security-patterns': {
            id: 'memory-security-patterns',
            title: 'Memory — Security Scanning Patterns',
            group: 'Memory',
            source: 'forge/memory/memory-security.ts',
            description: 'Injection/exfiltration patterns blocked before memory writes are accepted',
            text: SECURITY_PATTERNS_DESCRIPTION,
        },
        'follow-up-suggestions': {
            id: 'follow-up-suggestions',
            title: 'Follow-up Suggestions',
            group: 'UI',
            source: 'coc/server/suggest-follow-ups-tool.ts',
            description: 'Tool description controlling when/how AI calls suggest_follow_ups',
            text: 'After completing your response, call this tool to suggest 2-3 brief follow-up actions the user might want to take next. Each suggestion should be a short, direct action phrase (imperative, not a question) that continues the conversation — e.g., "Show an example", "Explain the config options", "Generate the fix". IMPORTANT: Never list follow-up suggestions in your response text. Always call this tool instead.',
        },
    };
}

/**
 * Return all built-in prompts annotated with any active admin overrides.
 * Called by GET /api/admin/prompts so the UI sees override state without a
 * separate request.
 */
export function getPromptsWithOverrides(dataDir: string): Record<string, BuiltInPrompt> {
    const builtins = getBuiltInPrompts();
    const overrides = getAllPromptOverrides(dataDir);
    for (const [id, overrideText] of Object.entries(overrides)) {
        if (builtins[id]) {
            builtins[id].overrideText = overrideText;
            builtins[id].hasOverride = true;
        }
    }
    return builtins;
}

/**
 * Validate a prompt override.  Returns an error message, or undefined if valid.
 * Currently only checks required template variables.
 */
export function validatePromptOverride(prompt: BuiltInPrompt, text: string): string | undefined {
    const vars = prompt.templateVars ?? [];
    const missing = vars.filter(v => !text.includes(v));
    if (missing.length > 0) {
        return `Override must contain required template variable(s): ${missing.join(', ')}`;
    }
    return undefined;
}
