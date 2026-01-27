/**
 * AI Task Commands
 * 
 * Provides AI-powered task creation commands for the Tasks Viewer.
 * - Create Task with AI: Generate task content from a description
 * - Create Task from Feature: Bootstrap task from feature folder context
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskManager } from './task-manager';
import { TasksTreeDataProvider } from './tree-data-provider';
import { TaskFolderItem } from './task-folder-item';
import { loadRelatedItems } from './related-items-loader';
import { createAIInvoker, IAIProcessManager } from '../ai-service';
import { getAIBackendSetting } from '../ai-service/ai-config-helpers';
import { getExtensionLogger, LogCategory } from '../shared/extension-logger';
import { skillExists } from '@plusplusoneplusplus/pipeline-core';

const logger = getExtensionLogger();

/** Task template with frontmatter */
const TASK_TEMPLATE = `---
created: {{CREATED}}
type: {{TYPE}}
ai_generated: true
---

{{CONTENT}}`;

/** Default empty task template when AI is not available */
const DEFAULT_TASK_CONTENT = `# {{TITLE}}

## Description



## Acceptance Criteria

- [ ] 

## Subtasks

- [ ] 

## Notes

`;

/**
 * Register AI task creation commands
 */
export function registerTasksAICommands(
    context: vscode.ExtensionContext,
    taskManager: TaskManager,
    treeDataProvider: TasksTreeDataProvider,
    aiProcessManager?: IAIProcessManager
): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // Create Task with AI
    disposables.push(
        vscode.commands.registerCommand(
            'tasksViewer.createWithAI',
            async (item?: TaskFolderItem) => {
                await createTaskWithAI(taskManager, treeDataProvider, item, aiProcessManager);
            }
        )
    );

    // Create Task from Feature
    disposables.push(
        vscode.commands.registerCommand(
            'tasksViewer.createFromFeature',
            async (item?: TaskFolderItem) => {
                await createTaskFromFeature(taskManager, treeDataProvider, item, aiProcessManager);
            }
        )
    );

    return disposables;
}

/**
 * Create a new task with AI-generated content
 */
async function createTaskWithAI(
    taskManager: TaskManager,
    treeDataProvider: TasksTreeDataProvider,
    folderItem?: TaskFolderItem,
    processManager?: IAIProcessManager
): Promise<void> {
    // Check if AI service is available
    const backend = getAIBackendSetting();
    if (backend === 'clipboard') {
        const action = await vscode.window.showWarningMessage(
            'AI Service is in clipboard mode. Create task without AI content?',
            'Create Empty Task',
            'Open Settings',
            'Cancel'
        );
        
        if (action === 'Open Settings') {
            await vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'workspaceShortcuts.aiService.backend'
            );
            return;
        }
        if (action !== 'Create Empty Task') {
            return;
        }
        // Fall through to create empty task
        await createEmptyTask(taskManager, treeDataProvider, folderItem);
        return;
    }

    // Step 1: Get task description from user
    const description = await vscode.window.showInputBox({
        prompt: 'Describe the task you want to create',
        placeHolder: 'e.g., Implement user authentication with OAuth2',
        validateInput: (value) => {
            if (!value || value.trim().length < 5) {
                return 'Please enter a description (at least 5 characters)';
            }
            return undefined;
        }
    });

    if (!description) {
        return;
    }

    // Step 2: Generate task content with AI
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Creating task with AI...',
            cancellable: true
        },
        async (progress, token) => {
            try {
                progress.report({ message: 'Creating task with AI...' });

                // Compute target folder path
                const targetFolderPath = folderItem instanceof TaskFolderItem 
                    ? folderItem.folder.folderPath 
                    : taskManager.getTasksFolder();
                
                taskManager.ensureFoldersExist();
                
                const prompt = buildCreateTaskPrompt(description, targetFolderPath);
                const workingDirectory = taskManager.getWorkspaceRoot();
                
                const aiInvoker = createAIInvoker({
                    usePool: false,
                    workingDirectory,
                    featureName: 'Task Creation',
                    clipboardFallback: false,
                    approvePermissions: true,
                    processManager
                });

                const result = await aiInvoker(prompt);

                if (token.isCancellationRequested) {
                    return;
                }

                if (!result.success) {
                    throw new Error(result.error || 'Failed to create task');
                }

                treeDataProvider.refresh();
                
                // Parse file path from AI response and open it
                const createdFile = parseCreatedFilePath(result.response, targetFolderPath);
                if (createdFile && fs.existsSync(createdFile)) {
                    await vscode.commands.executeCommand(
                        'vscode.openWith',
                        vscode.Uri.file(createdFile),
                        'reviewEditorView'
                    );
                }
                
                vscode.window.showInformationMessage('Task created');

            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                logger.error(LogCategory.TASKS, 'Error creating task with AI', err);

                const action = await vscode.window.showErrorMessage(
                    `Failed to generate task content: ${err.message}`,
                    'Create Empty Task',
                    'Retry',
                    'Cancel'
                );

                if (action === 'Create Empty Task') {
                    await createEmptyTask(taskManager, treeDataProvider, folderItem, description);
                } else if (action === 'Retry') {
                    await createTaskWithAI(taskManager, treeDataProvider, folderItem);
                }
            }
        }
    );
}

/**
 * Create a task from feature folder context
 */
async function createTaskFromFeature(
    taskManager: TaskManager,
    treeDataProvider: TasksTreeDataProvider,
    folderItem?: TaskFolderItem,
    processManager?: IAIProcessManager
): Promise<void> {
    // Determine the feature folder
    let folderPath: string;
    let folderName: string;

    // Check if folderItem is a valid TaskFolderItem with folder property
    if (folderItem instanceof TaskFolderItem && folderItem.folder) {
        folderPath = folderItem.folder.folderPath;
        folderName = folderItem.folder.name;
    } else {
        // Prompt user to select a feature folder
        const folders = await taskManager.getFeatureFolders();
        
        if (folders.length === 0) {
            vscode.window.showInformationMessage(
                'No feature folders found. Create a feature folder first.'
            );
            return;
        }

        const selected = await vscode.window.showQuickPick(
            folders.map(f => ({
                label: f.displayName,
                description: f.relativePath,
                path: f.path
            })),
            {
                placeHolder: 'Select a feature folder'
            }
        );

        if (!selected) {
            return;
        }

        folderPath = selected.path;
        folderName = path.basename(folderPath);
    }

    // Check if AI service is available
    const backend = getAIBackendSetting();
    if (backend === 'clipboard') {
        const action = await vscode.window.showWarningMessage(
            'AI Service is in clipboard mode. Create task without AI content?',
            'Create Empty Task',
            'Open Settings',
            'Cancel'
        );
        
        if (action === 'Open Settings') {
            await vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'workspaceShortcuts.aiService.backend'
            );
            return;
        }
        if (action !== 'Create Empty Task') {
            return;
        }
        await createEmptyTaskInFolder(taskManager, treeDataProvider, folderPath, folderName);
        return;
    }

    // Gather feature context
    const context = await gatherFeatureContext(folderPath, taskManager.getWorkspaceRoot());

    if (!context.hasContent) {
        const proceed = await vscode.window.showWarningMessage(
            'No context found in this feature folder. Create task anyway?',
            'Continue',
            'Cancel'
        );
        if (proceed !== 'Continue') {
            return;
        }
    }

    // Step 1: Show context and allow deselection (optional)
    const selectedContext = await selectFeatureContext(context);
    if (!selectedContext) {
        return;
    }

    // Step 2: Get task focus from user
    const focus = await vscode.window.showInputBox({
        prompt: 'What specific aspect should this task focus on?',
        placeHolder: 'Leave empty for general task, or specify: "implement API endpoints"',
        value: context.description || folderName
    });

    if (focus === undefined) {
        return; // User cancelled
    }

    // Step 3: Select creation mode (Simple vs Deep)
    const workspaceRoot = taskManager.getWorkspaceRoot();
    const mode = await selectCreationMode(workspaceRoot);
    if (!mode) {
        return; // User cancelled
    }

    // Step 4: Generate task with AI
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Creating task for "${folderName}" (${mode.label})...`,
            cancellable: true
        },
        async (progress, token) => {
            try {
                progress.report({ message: `Creating task with AI (${mode.label} mode)...` });

                const prompt = mode.id === 'deep'
                    ? await buildDeepModePrompt(selectedContext, focus, folderPath, workspaceRoot)
                    : buildCreateFromFeaturePrompt(selectedContext, focus, folderPath);
                const workingDirectory = workspaceRoot;

                const aiInvoker = createAIInvoker({
                    usePool: false,
                    workingDirectory,
                    featureName: 'Task from Feature',
                    clipboardFallback: false,
                    approvePermissions: true,
                    processManager
                });

                const result = await aiInvoker(prompt);

                if (token.isCancellationRequested) {
                    return;
                }

                if (!result.success) {
                    throw new Error(result.error || 'Failed to create task');
                }

                treeDataProvider.refresh();
                
                // Parse file path from AI response and open it
                const createdFile = parseCreatedFilePath(result.response, folderPath);
                if (createdFile && fs.existsSync(createdFile)) {
                    await vscode.commands.executeCommand(
                        'vscode.openWith',
                        vscode.Uri.file(createdFile),
                        'reviewEditorView'
                    );
                }
                
                vscode.window.showInformationMessage('Task created');

            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                logger.error(LogCategory.TASKS, 'Error creating task from feature', err);

                const action = await vscode.window.showErrorMessage(
                    `Failed to generate task content: ${err.message}`,
                    'Create Empty Task',
                    'Retry',
                    'Cancel'
                );

                if (action === 'Create Empty Task') {
                    await createEmptyTaskInFolder(taskManager, treeDataProvider, folderPath, folderName);
                } else if (action === 'Retry') {
                    await createTaskFromFeature(taskManager, treeDataProvider, folderItem);
                }
            }
        }
    );
}

// ============================================================================
// Helper Functions
// ============================================================================

interface FeatureContext {
    hasContent: boolean;
    description?: string;
    planContent?: string;
    specContent?: string;
    relatedFiles?: string[];
    relatedCommits?: string[];
}

interface SelectedContext {
    description?: string;
    planContent?: string;
    specContent?: string;
    relatedFiles?: string[];
}

/** Creation mode for task generation */
type CreationMode = 'simple' | 'deep';

/** Mode selection result */
interface ModeSelection {
    id: CreationMode;
    label: string;
}

/**
 * Show mode selection QuickPick for task creation
 * Always shows both options, but indicates if Deep mode is unavailable
 */
async function selectCreationMode(workspaceRoot: string): Promise<ModeSelection | undefined> {
    const hasDeepSkill = skillExists('go-deep', workspaceRoot);
    
    const items: vscode.QuickPickItem[] = [
        {
            label: '$(zap) Simple',
            description: 'Quick, single-pass AI analysis',
            detail: 'Fast task creation with basic AI analysis'
        },
        {
            label: '$(telescope) Deep',
            description: hasDeepSkill 
                ? 'Multi-phase research using go-deep skill'
                : '(go-deep skill not found)',
            detail: hasDeepSkill
                ? 'Comprehensive analysis with exploration, deep-dive, and synthesis phases'
                : 'Add .github/skills/go-deep/prompt.md to enable'
        }
    ];
    
    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select task creation mode',
        title: 'Task Creation Mode'
    });
    
    if (!selected) {
        return undefined;
    }
    
    const isDeep = selected.label.includes('Deep');
    
    // If Deep selected but skill not available, warn and fall back to Simple
    if (isDeep && !hasDeepSkill) {
        vscode.window.showWarningMessage('go-deep skill not found. Using Simple mode.');
        return { id: 'simple', label: 'Simple' };
    }
    
    return {
        id: isDeep ? 'deep' : 'simple',
        label: isDeep ? 'Deep' : 'Simple'
    };
}

/**
 * Build prompt for deep mode task creation
 * Simply adds instruction to use go-deep skill
 */
async function buildDeepModePrompt(
    context: SelectedContext,
    focus: string,
    targetPath: string,
    _workspaceRoot: string
): Promise<string> {
    // Build the base prompt (same as simple mode)
    const basePrompt = buildCreateFromFeaturePrompt(context, focus, targetPath);
    
    // Prepend instruction to use go-deep skill
    return `Use go-deep skill when available.\n\n${basePrompt}`;
}

/**
 * Gather context from a feature folder
 */
async function gatherFeatureContext(
    folderPath: string,
    workspaceRoot: string
): Promise<FeatureContext> {
    const context: FeatureContext = { hasContent: false };

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
    const files = await fs.promises.readdir(folderPath);
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
 * Allow user to select which context items to include
 */
async function selectFeatureContext(context: FeatureContext): Promise<SelectedContext | undefined> {
    // Build list of available context items
    const items: vscode.QuickPickItem[] = [];

    if (context.description) {
        items.push({
            label: '$(info) Feature Description',
            description: context.description.substring(0, 50) + (context.description.length > 50 ? '...' : ''),
            picked: true
        });
    }

    if (context.planContent) {
        items.push({
            label: '$(file) Plan Document',
            description: 'plan.md or *.plan.md',
            picked: true
        });
    }

    if (context.specContent) {
        items.push({
            label: '$(file) Spec Document',
            description: 'spec.md or *.spec.md',
            picked: true
        });
    }

    if (context.relatedFiles && context.relatedFiles.length > 0) {
        items.push({
            label: '$(files) Related Source Files',
            description: `${context.relatedFiles.length} files`,
            picked: true
        });
    }

    // If no items, return minimal context
    if (items.length === 0) {
        return {};
    }

    // Show QuickPick for context selection
    const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: 'Select context to include (all selected by default)',
        title: 'Feature Context'
    });

    if (!selected) {
        return undefined; // User cancelled
    }

    // Build selected context
    const result: SelectedContext = {};
    const selectedLabels = new Set(selected.map(s => s.label));

    if (selectedLabels.has('$(info) Feature Description')) {
        result.description = context.description;
    }
    if (selectedLabels.has('$(file) Plan Document')) {
        result.planContent = context.planContent;
    }
    if (selectedLabels.has('$(file) Spec Document')) {
        result.specContent = context.specContent;
    }
    if (selectedLabels.has('$(files) Related Source Files')) {
        result.relatedFiles = context.relatedFiles;
    }

    return result;
}

/**
 * Parse created file path from AI response
 * Looks for markdown file paths in the response text
 */
function parseCreatedFilePath(response: string | undefined, targetFolder: string): string | undefined {
    if (!response) {
        return undefined;
    }
    
    // Look for file paths ending in .md
    // Common patterns: "Created file: /path/to/file.md", "I've created /path/file.md", etc.
    const patterns = [
        // Absolute paths
        /(?:created|wrote|saved|generated)[^`\n]*?([\/\\][^\s`"']+\.md)/gi,
        // Paths in backticks
        /`([^`]+\.md)`/g,
        // Any .md path that includes the target folder
        new RegExp(`(${targetFolder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\s\`"']+\\.md)`, 'gi')
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
 * Build prompt for creating a task from scratch
 */
function buildCreateTaskPrompt(description: string, targetPath: string): string {
    return `Can you draft a plan given User's ask: ${description}

Create a single markdown file under ${targetPath}`;
}

/**
 * Build prompt for creating a task from feature context
 */
function buildCreateFromFeaturePrompt(context: SelectedContext, focus: string, targetPath: string): string {
    let contextText = '';

    if (context.description) {
        contextText += `Feature Description:\n${context.description}\n\n`;
    }

    if (context.planContent) {
        // Truncate if too long
        const planText = context.planContent.length > 2000 
            ? context.planContent.substring(0, 2000) + '\n...(truncated)'
            : context.planContent;
        contextText += `Plan Document:\n${planText}\n\n`;
    }

    if (context.specContent) {
        const specText = context.specContent.length > 2000
            ? context.specContent.substring(0, 2000) + '\n...(truncated)'
            : context.specContent;
        contextText += `Spec Document:\n${specText}\n\n`;
    }

    if (context.relatedFiles && context.relatedFiles.length > 0) {
        contextText += `Related Source Files:\n${context.relatedFiles.slice(0, 20).join('\n')}\n\n`;
    }

    return `Can you draft a plan given User's ask: ${focus || 'Create an implementation task'}

Context:
${contextText}

Put it under ${targetPath}`;
}

/**
 * Clean AI response - remove code fences if present
 */
function cleanAIResponse(response: string): string {
    let cleaned = response.trim();
    
    // Remove markdown code fences
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

/**
 * Extract title from markdown content
 */
function extractTitleFromContent(content: string): string | undefined {
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('# ')) {
            return trimmed.substring(2).trim();
        }
    }
    return undefined;
}

/**
 * Sanitize description to use as title
 */
function sanitizeTitle(description: string): string {
    // Take first 50 chars, remove special chars
    return description
        .substring(0, 50)
        .replace(/[^a-zA-Z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .toLowerCase();
}

/**
 * Create a task file with content
 */
async function createTaskFile(
    taskManager: TaskManager,
    title: string,
    content: string,
    type: string,
    folderPath?: string
): Promise<string> {
    taskManager.ensureFoldersExist();

    const sanitizedName = taskManager.sanitizeFileName(title);
    const baseFolder = folderPath || taskManager.getTasksFolder();
    let filePath = path.join(baseFolder, `${sanitizedName}.md`);

    // Handle duplicates
    if (fs.existsSync(filePath)) {
        const timestamp = Date.now();
        filePath = path.join(baseFolder, `${sanitizedName}-${timestamp}.md`);
    }

    await writeTaskFile(filePath, content, type);
    return filePath;
}

/**
 * Write task file with frontmatter
 */
async function writeTaskFile(
    filePath: string,
    content: string,
    type: string
): Promise<void> {
    const fullContent = TASK_TEMPLATE
        .replace('{{CREATED}}', new Date().toISOString())
        .replace('{{TYPE}}', type)
        .replace('{{CONTENT}}', content);

    await fs.promises.writeFile(filePath, fullContent, 'utf-8');
}

/**
 * Open task file in Review Editor
 */
async function openTaskFile(filePath: string): Promise<void> {
    await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(filePath),
        'reviewEditorView'
    );
}

/**
 * Create an empty task (fallback when AI is not available)
 */
async function createEmptyTask(
    taskManager: TaskManager,
    treeDataProvider: TasksTreeDataProvider,
    folderItem?: TaskFolderItem,
    defaultTitle?: string
): Promise<void> {
    const name = await vscode.window.showInputBox({
        prompt: 'Enter task name',
        placeHolder: 'My new task',
        value: defaultTitle,
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return 'Task name cannot be empty';
            }
            if (value.includes('/') || value.includes('\\')) {
                return 'Task name cannot contain path separators';
            }
            return null;
        }
    });

    if (!name) {
        return;
    }

    try {
        const content = DEFAULT_TASK_CONTENT.replace('{{TITLE}}', name.trim());
        // Safely get folder path - only access folder if folderItem is a TaskFolderItem
        const folderPath = folderItem instanceof TaskFolderItem 
            ? folderItem.folder.folderPath 
            : undefined;
        const filePath = await createTaskFile(taskManager, name.trim(), content, 'feature', folderPath);
        
        treeDataProvider.refresh();
        await openTaskFile(filePath);
    } catch (error) {
        const err = error instanceof Error ? error : new Error('Unknown error');
        vscode.window.showErrorMessage(`Failed to create task: ${err.message}`);
    }
}

/**
 * Create an empty task in a specific folder
 */
async function createEmptyTaskInFolder(
    taskManager: TaskManager,
    treeDataProvider: TasksTreeDataProvider,
    folderPath: string,
    folderName: string
): Promise<void> {
    const name = await vscode.window.showInputBox({
        prompt: 'Enter task name',
        placeHolder: 'My new task',
        value: `${folderName}-plan`,
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return 'Task name cannot be empty';
            }
            if (value.includes('/') || value.includes('\\')) {
                return 'Task name cannot contain path separators';
            }
            return null;
        }
    });

    if (!name) {
        return;
    }

    try {
        const content = DEFAULT_TASK_CONTENT.replace('{{TITLE}}', name.trim());
        const filePath = await createTaskFile(taskManager, name.trim(), content, 'feature', folderPath);
        
        treeDataProvider.refresh();
        await openTaskFile(filePath);
    } catch (error) {
        const err = error instanceof Error ? error : new Error('Unknown error');
        vscode.window.showErrorMessage(`Failed to create task: ${err.message}`);
    }
}

// ============================================================================
// Exports for Testing
// ============================================================================

export { CreationMode, ModeSelection, SelectedContext };

/**
 * Check if deep mode is available (go-deep skill exists)
 * Exported for testing
 */
export function isDeepModeAvailable(workspaceRoot: string): boolean {
    return skillExists('go-deep', workspaceRoot);
}

/**
 * Build deep mode prompt - exported for testing
 */
export { buildDeepModePrompt };
