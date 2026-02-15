/**
 * Task Prompt Builder
 *
 * Pure-Node prompt-building functions for AI task generation.
 * Extracted from the VS Code extension's ai-task-commands.ts for reuse
 * in CLI tools and the CoC server without any VS Code dependencies.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadRelatedItems } from './related-items-loader';

// ============================================================================
// Types
// ============================================================================

/**
 * Feature context gathered from a feature folder.
 * Mirror of the extension's FeatureContext but without VS Code types.
 */
export interface FeatureContextInput {
    hasContent: boolean;
    description?: string;
    planContent?: string;
    specContent?: string;
    relatedFiles?: string[];
    relatedCommits?: string[];
}

/**
 * Selected subset of feature context to include in a prompt.
 */
export interface SelectedContext {
    description?: string;
    planContent?: string;
    specContent?: string;
    relatedFiles?: string[];
}

/**
 * Options controlling task generation prompt construction.
 */
export interface TaskGenerationOptions {
    /** Task name (used as filename) */
    name?: string;
    /** Target folder absolute path */
    targetPath: string;
    /** Task description or focus */
    description: string;
    /** AI model to use */
    model?: string;
    /** Generation depth */
    depth?: 'simple' | 'deep';
}

// ============================================================================
// Content truncation limit
// ============================================================================

/** Maximum character length for plan/spec content before truncation */
const MAX_CONTENT_LENGTH = 2000;

// ============================================================================
// Prompt Builders
// ============================================================================

/**
 * Build prompt for creating a task from scratch (no name provided).
 */
export function buildCreateTaskPrompt(description: string, targetPath: string): string {
    return `Can you draft a plan given User's ask: ${description}

**IMPORTANT: Output Location Requirement**
You MUST save the file to this EXACT directory: ${targetPath}
- Create a single .plan.md file
- Do NOT save to any other location
- Do NOT use your session state or any other directory
- The file MUST be created directly under: ${targetPath}/`;
}

/**
 * Build prompt for creating a task with a specific name.
 * If name is empty/undefined, prompts AI to generate a filename.
 */
export function buildCreateTaskPromptWithName(
    name: string | undefined,
    description: string,
    targetPath: string
): string {
    const descriptionPart = description
        ? `\n\nDescription: ${description}`
        : '';

    if (name && name.trim()) {
        return `Create a task document for: ${name}${descriptionPart}

Generate a comprehensive markdown task document with:
- Clear title and description
- Acceptance criteria
- Subtasks (if applicable)
- Notes section

**IMPORTANT: Output Location Requirement**
You MUST save the file to this EXACT directory: ${targetPath}
- Full file path: ${targetPath}/${name}.plan.md
- Do NOT save to any other location
- Do NOT use your session state or any other directory
- The file MUST be created at: ${targetPath}/${name}.plan.md`;
    } else {
        return `Create a task document based on this description:${descriptionPart || '\n\n(General task)'}

Generate a comprehensive markdown task document with:
- Clear title and description
- Acceptance criteria
- Subtasks (if applicable)
- Notes section

Choose an appropriate filename based on the task content.
The filename should be in kebab-case, descriptive, and end with .plan.md (e.g., "oauth2-authentication.plan.md").

**IMPORTANT: Output Location Requirement**
You MUST save the file to this EXACT directory: ${targetPath}
- Example: ${targetPath}/your-generated-name.plan.md
- Do NOT save to any other location
- Do NOT use your session state or any other directory
- The file MUST be created directly under: ${targetPath}/`;
    }
}

/**
 * Build prompt for creating a task from feature context.
 *
 * @param context - The selected feature context
 * @param focus - Task focus/description
 * @param name - Optional task name for the filename
 * @param targetPath - Target directory path
 */
export function buildCreateFromFeaturePrompt(
    context: SelectedContext,
    focus: string,
    name: string | undefined,
    targetPath: string
): string {
    let contextText = '';

    if (context.description) {
        contextText += `Feature Description:\n${context.description}\n\n`;
    }

    if (context.planContent) {
        const planText = context.planContent.length > MAX_CONTENT_LENGTH
            ? context.planContent.substring(0, MAX_CONTENT_LENGTH) + '\n...(truncated)'
            : context.planContent;
        contextText += `Plan Document:\n${planText}\n\n`;
    }

    if (context.specContent) {
        const specText = context.specContent.length > MAX_CONTENT_LENGTH
            ? context.specContent.substring(0, MAX_CONTENT_LENGTH) + '\n...(truncated)'
            : context.specContent;
        contextText += `Spec Document:\n${specText}\n\n`;
    }

    if (context.relatedFiles && context.relatedFiles.length > 0) {
        contextText += `Related Source Files:\n${context.relatedFiles.slice(0, 20).join('\n')}\n\n`;
    }

    const filenameInstruction = name && name.trim()
        ? `- Full file path: ${targetPath}/${name}.plan.md
- The file MUST be created at: ${targetPath}/${name}.plan.md`
        : `- The file should be a .plan.md file (e.g., "${targetPath}/feature-plan.plan.md")
- Choose an appropriate filename based on the task content
- The filename should be in kebab-case, descriptive, and end with .plan.md
- The file MUST be created directly under: ${targetPath}/`;

    return `Can you draft a plan given User's ask: ${focus || 'Create an implementation task'}

Context:
${contextText}

**IMPORTANT: Output Location Requirement**
You MUST save the file to this EXACT directory: ${targetPath}
${filenameInstruction}
- Do NOT save to any other location
- Do NOT use your session state or any other directory`;
}

/**
 * Build prompt for deep mode task creation.
 * Prepends instruction to use go-deep skill.
 */
export function buildDeepModePrompt(
    context: SelectedContext,
    focus: string,
    name: string | undefined,
    targetPath: string,
    _workspaceRoot: string
): string {
    const basePrompt = buildCreateFromFeaturePrompt(context, focus, name, targetPath);
    return `Use go-deep skill when available.\n\n${basePrompt}`;
}

/**
 * Gather context from a feature folder (related.yaml, plan.md, spec.md).
 * Pure Node.js — no VS Code dependencies.
 */
export async function gatherFeatureContext(
    folderPath: string,
    _workspaceRoot: string
): Promise<FeatureContextInput> {
    const context: FeatureContextInput = { hasContent: false };

    // Load related.yaml if exists
    const relatedItems = await loadRelatedItems(folderPath);
    if (relatedItems) {
        context.description = relatedItems.description;
        context.relatedFiles = relatedItems.items
            .filter(item => item.type === 'file' && item.path)
            .map(item => item.path!);
        context.relatedCommits = relatedItems.items
            .filter(item => item.type === 'commit' && item.hash)
            .map(item => `${item.hash!.substring(0, 7)}: ${item.name}`);
        context.hasContent = true;
    }

    // Read plan.md if exists
    const planPath = path.join(folderPath, 'plan.md');
    if (fs.existsSync(planPath)) {
        context.planContent = await fs.promises.readFile(planPath, 'utf-8');
        context.hasContent = true;
    }

    // Read spec.md if exists
    const specPath = path.join(folderPath, 'spec.md');
    if (fs.existsSync(specPath)) {
        context.specContent = await fs.promises.readFile(specPath, 'utf-8');
        context.hasContent = true;
    }

    // Also check for files with common doc patterns
    const files = await fs.promises.readdir(folderPath).catch(() => [] as string[]);
    for (const file of files) {
        if (!context.planContent && file.endsWith('.plan.md')) {
            const filePath = path.join(folderPath, file);
            context.planContent = await fs.promises.readFile(filePath, 'utf-8');
            context.hasContent = true;
        }
        if (!context.specContent && file.endsWith('.spec.md')) {
            const filePath = path.join(folderPath, file);
            context.specContent = await fs.promises.readFile(filePath, 'utf-8');
            context.hasContent = true;
        }
    }

    return context;
}

/**
 * Parse created file path from AI response.
 * Looks for markdown file paths in the response text.
 *
 * @param response - AI response text
 * @param targetFolder - Expected target folder for path matching
 * @returns Absolute file path if found and exists, otherwise undefined
 */
export function parseCreatedFilePath(
    response: string | undefined,
    targetFolder: string
): string | undefined {
    if (!response) {
        return undefined;
    }

    const patterns = [
        // Absolute paths mentioned after create/write verbs
        /(?:created|wrote|saved|generated)[^`\n]*?([/\\][^\s`"']+\.md)/gi,
        // Paths in backticks
        /`([^`]+\.md)`/g,
        // Any .md path that includes the target folder
        new RegExp(
            `(${targetFolder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\s\`"']+\\.md)`,
            'gi'
        ),
    ];

    for (const pattern of patterns) {
        const matches = response.matchAll(pattern);
        for (const match of matches) {
            const filePath = match[1];
            if (filePath && fs.existsSync(filePath)) {
                return filePath;
            }
        }
    }

    return undefined;
}

/**
 * Clean AI response — strip code fences if present.
 */
export function cleanAIResponse(response: string): string {
    let cleaned = response.trim();

    if (cleaned.startsWith('```markdown')) {
        cleaned = cleaned.substring('```markdown'.length);
    } else if (cleaned.startsWith('```md')) {
        cleaned = cleaned.substring('```md'.length);
    } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.substring(3);
    }

    if (cleaned.endsWith('```')) {
        cleaned = cleaned.substring(0, cleaned.length - 3);
    }

    return cleaned.trim();
}
