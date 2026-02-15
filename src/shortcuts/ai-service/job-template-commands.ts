/**
 * Job Template Commands
 *
 * Command handlers for saving, loading, and managing AI job templates.
 * Integrates with the existing queue job dialog and AI Processes tree.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getAIQueueService } from './ai-queue-service';
import { getExtensionLogger, LogCategory } from './ai-service-logger';
import { getJobTemplateManager } from './job-template-manager';
import {
    JobTemplate,
    JobTemplateScope,
    CreateTemplateOptions,
    extractTemplateVariables,
    hasTemplateVariables,
    substituteTemplateVariables,
    validateTemplateName
} from './job-template-types';
import { AIProcessItem } from './ai-process-tree-provider';
import { getSkills } from '../shared/skill-files-utils';
import { getWorkspaceRoot } from '../shared/workspace-utils';
import { DEFAULT_AI_TIMEOUT_MS } from '../shared/ai-timeouts';

// ============================================================================
// Command Registration
// ============================================================================

/**
 * Register all template-related commands.
 */
export function registerTemplateCommands(context: vscode.ExtensionContext): void {
    const logger = getExtensionLogger();

    const safeRegister = (commandId: string, handler: (...args: any[]) => any): void => {
        try {
            context.subscriptions.push(vscode.commands.registerCommand(commandId, handler));
        } catch (error) {
            logger.warn(LogCategory.AI, `Command already registered: ${commandId}`);
        }
    };

    // Save as Template (from AI Processes tree context menu)
    safeRegister('shortcuts.templates.saveFromProcess', async (item?: AIProcessItem) => {
        if (!item || !item.process) {
            vscode.window.showWarningMessage('No process selected');
            return;
        }

        const process = item.process;
        const prompt = process.fullPrompt || process.promptPreview || '';

        if (!prompt) {
            vscode.window.showWarningMessage('No prompt found for this process');
            return;
        }

        await saveTemplateInteractive({
            prompt,
            type: 'freeform',
            model: process.metadata?.model as string | undefined,
            workingDirectory: process.workingDirectory,
        });
    });

    // Queue Job from Template (command palette direct)
    safeRegister('shortcuts.templates.queueFromTemplate', async () => {
        const queueService = getAIQueueService();
        if (!queueService) {
            vscode.window.showWarningMessage('Queue service not initialized');
            return;
        }

        if (!queueService.isEnabled()) {
            vscode.window.showWarningMessage(
                'Queue feature is disabled. Enable it in settings: workspaceShortcuts.queue.enabled'
            );
            return;
        }

        const templateManager = getJobTemplateManager();
        const templates = templateManager.getAllTemplates();

        if (templates.length === 0) {
            vscode.window.showInformationMessage(
                'No saved templates. Save a template from the Add Job dialog or AI Processes context menu.'
            );
            return;
        }

        const selected = await showTemplatePicker(templates);
        if (!selected) {
            return;
        }

        await queueFromTemplate(selected, context);
    });

    // Manage Templates
    safeRegister('shortcuts.templates.manage', async () => {
        await manageTemplates();
    });
}

// ============================================================================
// Save Template Flow
// ============================================================================

/**
 * Interactive flow to save a template: prompts for name and scope.
 *
 * @param config - Partial template configuration to save
 * @returns The saved template, or undefined if cancelled
 */
export async function saveTemplateInteractive(config: {
    prompt: string;
    type: 'freeform' | 'skill';
    model?: string;
    workingDirectory?: string;
    skillName?: string;
}): Promise<JobTemplate | undefined> {
    const templateManager = getJobTemplateManager();
    const logger = getExtensionLogger();

    // Step 1: Ask for template name
    const name = await vscode.window.showInputBox({
        prompt: 'Template name',
        placeHolder: 'e.g., Review PR changes',
        validateInput: (value) => {
            const error = validateTemplateName(value);
            if (error) {
                return error;
            }
            // Check for duplicates
            if (templateManager.hasTemplateName(value)) {
                return `A template named "${value.trim()}" already exists. Choose a different name or it will be overwritten.`;
            }
            return null;
        }
    });

    if (name === undefined) {
        return undefined; // User cancelled
    }

    // Check if overwriting
    const existing = templateManager.getTemplateByName(name);
    if (existing) {
        const overwrite = await vscode.window.showWarningMessage(
            `A template named "${name.trim()}" already exists. Overwrite?`,
            { modal: true },
            'Overwrite'
        );
        if (overwrite !== 'Overwrite') {
            return undefined;
        }
    }

    // Step 2: Ask for scope
    const scopeItems: vscode.QuickPickItem[] = [
        {
            label: '$(folder) Save to Workspace',
            description: 'Only available in this workspace',
            detail: 'workspace',
        },
        {
            label: '$(globe) Save Globally',
            description: 'Available across all workspaces',
            detail: 'global',
        }
    ];

    const scopeSelection = await vscode.window.showQuickPick(scopeItems, {
        placeHolder: 'Choose where to save the template',
    });

    if (!scopeSelection) {
        return undefined; // User cancelled
    }

    const scope = scopeSelection.detail as JobTemplateScope;

    // Step 3: Save
    const createOptions: CreateTemplateOptions = {
        name: name.trim(),
        scope,
        prompt: config.prompt,
        type: config.type,
        model: config.model,
        workingDirectory: config.workingDirectory,
        skillName: config.skillName,
    };

    const template = await templateManager.saveTemplate(createOptions);

    if (template) {
        logger.info(LogCategory.AI, `Template saved: ${template.name} (${scope})`);
        vscode.window.showInformationMessage(`Template saved: ${template.name}`);
    } else {
        vscode.window.showErrorMessage('Failed to save template');
    }

    return template;
}

// ============================================================================
// Queue from Template Flow
// ============================================================================

/**
 * Queue a job from a saved template, prompting for variables if needed.
 *
 * @param template - The template to queue from
 * @param context - VS Code extension context
 */
export async function queueFromTemplate(
    template: JobTemplate,
    context: vscode.ExtensionContext
): Promise<void> {
    const queueService = getAIQueueService();
    if (!queueService) {
        vscode.window.showWarningMessage('Queue service not initialized');
        return;
    }

    const logger = getExtensionLogger();
    const templateManager = getJobTemplateManager();
    const workspaceRoot = getWorkspaceRoot();

    let finalPrompt = template.prompt;

    // Check for template variables
    if (hasTemplateVariables(template.prompt)) {
        const variables = extractTemplateVariables(template.prompt);
        const lastUsedValues = templateManager.getLastUsedVariables(template.id);
        const values: Record<string, string> = {};

        for (const varName of variables) {
            const defaultValue = lastUsedValues[varName] || '';
            const value = await vscode.window.showInputBox({
                prompt: `Enter value for {{${varName}}}`,
                value: defaultValue,
                placeHolder: `Value for ${varName}`,
            });

            if (value === undefined) {
                // User cancelled — abort entire queue action
                return;
            }

            values[varName] = value;
        }

        finalPrompt = substituteTemplateVariables(template.prompt, values);

        // Save variable values for next time
        await templateManager.saveLastUsedVariables(template.id, values);
    }

    // Resolve prompt file and queue the job
    let promptFilePath: string | undefined;
    let promptContent: string | undefined;
    let displayName: string;
    let skillName: string | undefined;

    if (template.type === 'skill' && template.skillName) {
        // Skill mode
        const skills = await getSkills(workspaceRoot || undefined);
        const skill = skills.find(s => s.name === template.skillName);

        if (!skill) {
            vscode.window.showWarningMessage(
                `Skill "${template.skillName}" not found. The template may reference a skill that is no longer available.`
            );
            return;
        }

        promptFilePath = path.join(skill.absolutePath, 'prompt.md');
        if (!fs.existsSync(promptFilePath)) {
            promptFilePath = path.join(skill.absolutePath, 'SKILL.md');
            if (!fs.existsSync(promptFilePath)) {
                vscode.window.showErrorMessage(`No prompt file found for skill: ${template.skillName}`);
                return;
            }
        }

        skillName = template.skillName;
        displayName = `Template: ${template.name} (Skill: ${template.skillName})`;
    } else {
        // Freeform mode — store prompt content directly (no temp file for SDK)
        promptContent = finalPrompt;
        displayName = `Template: ${template.name}`;
    }

    // Validate working directory
    let workingDirectory = template.workingDirectory || workspaceRoot || undefined;
    if (workingDirectory && !fs.existsSync(workingDirectory)) {
        vscode.window.showInformationMessage(
            `Working directory "${workingDirectory}" no longer exists. Using workspace root.`
        );
        workingDirectory = workspaceRoot || undefined;
    }

    const result = queueService.queueTask({
        type: 'follow-prompt',
        payload: {
            promptFilePath,
            promptContent,
            skillName,
            workingDirectory,
            model: template.model,
        },
        displayName,
        config: {
            model: template.model,
            timeoutMs: DEFAULT_AI_TIMEOUT_MS,
        },
    });

    // Record usage
    await templateManager.recordUsage(template.id);

    logger.info(LogCategory.AI, `Queued from template: ${template.name} at position #${result.position}`);
    vscode.window.showInformationMessage(
        `Queued from template: ${template.name} (#${result.position})`
    );
}

// ============================================================================
// Template Picker
// ============================================================================

/**
 * Show a quick-pick list of saved templates.
 *
 * @param templates - Templates to display
 * @returns The selected template, or undefined if cancelled
 */
export async function showTemplatePicker(
    templates: JobTemplate[]
): Promise<JobTemplate | undefined> {
    if (templates.length === 0) {
        return undefined;
    }

    const items = templates.map(t => ({
        label: `${t.scope === 'global' ? '$(star-full)' : '$(folder)'} ${t.name}`,
        description: t.scope === 'global' ? '(global)' : '(workspace)',
        detail: truncatePrompt(t.prompt, 80),
        template: t,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a saved template',
        matchOnDescription: true,
        matchOnDetail: true,
    });

    return selected?.template;
}

// ============================================================================
// Manage Templates
// ============================================================================

/**
 * Show the template management quick-pick with edit/delete options.
 */
export async function manageTemplates(): Promise<void> {
    const templateManager = getJobTemplateManager();
    const templates = templateManager.getAllTemplates();

    if (templates.length === 0) {
        vscode.window.showInformationMessage(
            'No saved templates. Save a template from the Add Job dialog or AI Processes context menu.'
        );
        return;
    }

    const items = templates.map(t => ({
        label: `${t.scope === 'global' ? '$(star-full)' : '$(folder)'} ${t.name}`,
        description: `${t.scope === 'global' ? '(global)' : '(workspace)'} · Used ${t.useCount} times`,
        detail: truncatePrompt(t.prompt, 80),
        template: t,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a template to manage',
        matchOnDescription: true,
        matchOnDetail: true,
    });

    if (!selected) {
        return;
    }

    // Show action picker
    const actions: vscode.QuickPickItem[] = [
        { label: '$(edit) Rename', description: 'Change the template name' },
        { label: '$(trash) Delete', description: 'Remove this template' },
    ];

    const action = await vscode.window.showQuickPick(actions, {
        placeHolder: `Manage template: ${selected.template.name}`,
    });

    if (!action) {
        return;
    }

    if (action.label.includes('Rename')) {
        const newName = await vscode.window.showInputBox({
            prompt: 'New template name',
            value: selected.template.name,
            validateInput: (value) => {
                const error = validateTemplateName(value);
                if (error) {
                    return error;
                }
                if (value.trim().toLowerCase() !== selected.template.name.toLowerCase() &&
                    templateManager.hasTemplateName(value)) {
                    return `A template named "${value.trim()}" already exists`;
                }
                return null;
            }
        });

        if (newName !== undefined) {
            const renamed = await templateManager.renameTemplate(selected.template.id, newName);
            if (renamed) {
                vscode.window.showInformationMessage(`Template renamed to: ${newName.trim()}`);
            } else {
                vscode.window.showErrorMessage('Failed to rename template');
            }
        }
    } else if (action.label.includes('Delete')) {
        const confirm = await vscode.window.showWarningMessage(
            `Delete template "${selected.template.name}"?`,
            { modal: true },
            'Delete'
        );

        if (confirm === 'Delete') {
            const deleted = await templateManager.deleteTemplate(selected.template.id);
            if (deleted) {
                vscode.window.showInformationMessage(`Template deleted: ${selected.template.name}`);
            } else {
                vscode.window.showErrorMessage('Failed to delete template');
            }
        }
    }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Truncate a prompt string for display in quick-pick lists.
 */
function truncatePrompt(prompt: string, maxLength: number): string {
    const singleLine = prompt.replace(/\n/g, ' ').trim();
    if (singleLine.length <= maxLength) {
        return singleLine;
    }
    return singleLine.substring(0, maxLength - 3) + '...';
}
