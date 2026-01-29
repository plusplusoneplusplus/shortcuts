/**
 * AI Task Dialog Service
 *
 * Provides a rich webview-based modal dialog for creating AI-generated tasks.
 * Supports two modes:
 * 1. Create: User provides name, description, location, and model
 * 2. From Feature: Generate task from existing feature folder context
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { TaskManager } from './task-manager';
import {
    AITaskCreationOptions,
    AITaskDialogResult,
    TaskCreationMode,
    FeatureContext
} from './types';
import { getAvailableModels, getFollowPromptDefaultModel } from '../ai-service/ai-config-helpers';
import { skillExists } from '@plusplusoneplusplus/pipeline-core';

/** Folder option for the dropdown */
interface FolderOption {
    label: string;
    description: string;
    relativePath: string;
    isFeatureFolder: boolean;
}

/**
 * Service for showing the AI Task creation dialog as a webview panel
 */
export class AITaskDialogService {
    private readonly taskManager: TaskManager;
    private readonly extensionUri: vscode.Uri;
    private currentPanel: vscode.WebviewPanel | undefined;
    private pendingResolve: ((result: AITaskDialogResult) => void) | undefined;

    constructor(taskManager: TaskManager, extensionUri: vscode.Uri) {
        this.taskManager = taskManager;
        this.extensionUri = extensionUri;
    }

    /**
     * Show the AI Task creation dialog
     * @param options Configuration options for the dialog
     * @returns Dialog result with options or cancelled flag
     */
    async showDialog(options?: {
        preselectedFolder?: string;
        initialMode?: TaskCreationMode;
        featureContext?: FeatureContext;
    }): Promise<AITaskDialogResult> {
        // If panel already exists, reveal it
        if (this.currentPanel) {
            this.currentPanel.reveal(vscode.ViewColumn.Active);
            return { cancelled: true, options: null };
        }

        return new Promise<AITaskDialogResult>((resolve) => {
            this.pendingResolve = resolve;
            this.createWebviewPanel(options);
        });
    }

    /**
     * Create and show the webview panel
     */
    private async createWebviewPanel(options?: {
        preselectedFolder?: string;
        initialMode?: TaskCreationMode;
        featureContext?: FeatureContext;
    }): Promise<void> {
        const panel = vscode.window.createWebviewPanel(
            'aiTaskDialog',
            'Create AI Task',
            { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
            {
                enableScripts: true,
                retainContextWhenHidden: false,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.extensionUri, 'media')
                ]
            }
        );

        this.currentPanel = panel;

        // Get available folders and models
        const folders = await this.getAvailableFolders();
        const models = getAvailableModels();
        const defaultModel = getFollowPromptDefaultModel();
        const workspaceRoot = this.taskManager.getWorkspaceRoot();
        const hasDeepSkill = skillExists('go-deep', workspaceRoot);

        // Set webview content
        panel.webview.html = this.getWebviewContent(
            panel.webview,
            folders,
            models,
            defaultModel,
            hasDeepSkill,
            options?.preselectedFolder,
            options?.initialMode,
            options?.featureContext
        );

        // Handle messages from webview
        panel.webview.onDidReceiveMessage(
            (message) => this.handleMessage(message),
            undefined
        );

        // Handle panel disposal
        panel.onDidDispose(() => {
            this.currentPanel = undefined;
            if (this.pendingResolve) {
                this.pendingResolve({ cancelled: true, options: null });
                this.pendingResolve = undefined;
            }
        });
    }

    /**
     * Handle messages from the webview
     */
    private handleMessage(message: { type: string; [key: string]: any }): void {
        switch (message.type) {
            case 'submit':
                if (this.pendingResolve) {
                    const result: AITaskCreationOptions = {
                        mode: message.mode
                    };

                    if (message.mode === 'create') {
                        result.createOptions = {
                            name: message.name,
                            location: message.location,
                            description: message.description,
                            model: message.model
                        };
                    } else {
                        result.fromFeatureOptions = {
                            location: message.location,
                            focus: message.focus,
                            depth: message.depth,
                            model: message.model
                        };
                    }

                    this.pendingResolve({
                        cancelled: false,
                        options: result
                    });
                    this.pendingResolve = undefined;
                }
                this.currentPanel?.dispose();
                break;

            case 'cancel':
                if (this.pendingResolve) {
                    this.pendingResolve({ cancelled: true, options: null });
                    this.pendingResolve = undefined;
                }
                this.currentPanel?.dispose();
                break;
        }
    }

    /**
     * Get available folders for task creation
     */
    async getAvailableFolders(): Promise<FolderOption[]> {
        const folders = await this.taskManager.getFeatureFolders();

        // Add root option (only for 'create' mode)
        const options: FolderOption[] = [
            {
                label: '(Root)',
                description: 'Create task at root level',
                relativePath: '',
                isFeatureFolder: false
            }
        ];

        // Add feature folders
        for (const folder of folders) {
            options.push({
                label: folder.displayName,
                description: folder.relativePath,
                relativePath: folder.relativePath,
                isFeatureFolder: true
            });
        }

        return options;
    }

    /**
     * Validate task name
     */
    validateTaskName(value: string): string | null {
        if (!value || value.trim().length === 0) {
            return 'Task name cannot be empty';
        }

        if (value.includes('/') || value.includes('\\')) {
            return 'Task name cannot contain path separators';
        }

        const invalidChars = /[<>:"|?*]/;
        if (invalidChars.test(value)) {
            return 'Task name contains invalid characters';
        }

        return null;
    }

    /**
     * Get the absolute folder path for a relative location
     */
    getAbsoluteFolderPath(location: string): string {
        const tasksFolder = this.taskManager.getTasksFolder();
        return location ? path.join(tasksFolder, location) : tasksFolder;
    }

    /**
     * Generate webview HTML content
     */
    private getWebviewContent(
        webview: vscode.Webview,
        folders: FolderOption[],
        models: Array<{ id: string; label: string; description?: string; isDefault?: boolean }>,
        defaultModel: string,
        hasDeepSkill: boolean,
        preselectedFolder?: string,
        initialMode?: TaskCreationMode,
        featureContext?: FeatureContext
    ): string {
        const nonce = this.getNonce();
        const stylesUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'media', 'styles', 'components.css')
        );

        const foldersJson = JSON.stringify(folders);
        const modelsJson = JSON.stringify(models);
        const preselectedJson = JSON.stringify(preselectedFolder || '');
        const defaultModelJson = JSON.stringify(defaultModel);
        const initialModeJson = JSON.stringify(initialMode || 'create');
        const hasDeepSkillJson = JSON.stringify(hasDeepSkill);
        const featureContextJson = JSON.stringify(featureContext || null);

        // Determine if we have any feature folders
        const hasFeatureFolders = folders.some(f => f.isFeatureFolder);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <link href="${stylesUri}" rel="stylesheet">
    <title>Create AI Task</title>
    <style nonce="${nonce}">
        body {
            padding: 0;
            margin: 0;
            background: transparent;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
        }
        
        .dialog-container {
            background: var(--vscode-editor-background, #1e1e1e);
            border: 1px solid var(--vscode-widget-border, #454545);
            border-radius: 8px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
            max-width: 560px;
            width: 100%;
            max-height: 90vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        
        .dialog-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            border-bottom: 1px solid var(--vscode-widget-border, #454545);
            background: var(--vscode-editorGroupHeader-tabsBackground, rgba(0, 0, 0, 0.2));
        }
        
        .dialog-header h2 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: var(--vscode-foreground, #cccccc);
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .dialog-header h2 .icon {
            font-size: 20px;
        }
        
        .dialog-close-btn {
            background: none;
            border: none;
            font-size: 20px;
            cursor: pointer;
            color: var(--vscode-foreground, #cccccc);
            opacity: 0.7;
            padding: 4px 8px;
            border-radius: 4px;
            line-height: 1;
        }
        
        .dialog-close-btn:hover {
            opacity: 1;
            background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1));
        }
        
        /* Mode Tabs */
        .mode-tabs {
            display: flex;
            border-bottom: 1px solid var(--vscode-widget-border, #454545);
            background: var(--vscode-editorGroupHeader-tabsBackground, rgba(0, 0, 0, 0.1));
        }
        
        .mode-tab {
            flex: 1;
            padding: 12px 16px;
            border: none;
            background: transparent;
            color: var(--vscode-foreground, #cccccc);
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            opacity: 0.7;
            transition: opacity 0.2s, background 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }
        
        .mode-tab:hover {
            opacity: 1;
            background: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.05));
        }
        
        .mode-tab.active {
            opacity: 1;
            background: var(--vscode-editor-background, #1e1e1e);
            border-bottom: 2px solid var(--vscode-focusBorder, #007acc);
            margin-bottom: -1px;
        }
        
        .mode-tab:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        
        .mode-tab .tab-icon {
            font-size: 16px;
        }
        
        .dialog-body {
            padding: 20px;
            overflow-y: auto;
            flex: 1;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        .form-group:last-child {
            margin-bottom: 0;
        }
        
        .form-group > label {
            display: block;
            font-size: 13px;
            font-weight: 500;
            color: var(--vscode-foreground, #cccccc);
            margin-bottom: 8px;
        }
        
        .form-group input[type="text"],
        .form-group textarea,
        .form-group select {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid var(--vscode-input-border, #3c3c3c);
            border-radius: 4px;
            background: var(--vscode-input-background, #3c3c3c);
            color: var(--vscode-input-foreground, #cccccc);
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
            font-size: 13px;
            box-sizing: border-box;
        }
        
        .form-group input[type="text"]:focus,
        .form-group textarea:focus,
        .form-group select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder, #007acc);
        }
        
        .form-group textarea {
            resize: vertical;
            min-height: 80px;
        }
        
        .form-group select {
            cursor: pointer;
            appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23cccccc' d='M2 4l4 4 4-4'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 12px center;
            padding-right: 32px;
        }
        
        .form-group .hint {
            font-size: 11px;
            color: var(--vscode-descriptionForeground, #a0a0a0);
            margin-top: 6px;
        }
        
        .form-group .error {
            font-size: 11px;
            color: var(--vscode-errorForeground, #f48771);
            margin-top: 6px;
            display: none;
        }
        
        .form-group.has-error input,
        .form-group.has-error textarea {
            border-color: var(--vscode-inputValidation-errorBorder, #be1100);
        }
        
        .form-group.has-error .error {
            display: block;
        }
        
        .form-divider {
            border: none;
            border-top: 1px solid var(--vscode-widget-border, #454545);
            margin: 20px 0;
        }
        
        /* Depth Selection (radio group) */
        .depth-options {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        .depth-option {
            display: flex;
            align-items: flex-start;
            padding: 12px;
            border: 1px solid var(--vscode-input-border, #3c3c3c);
            border-radius: 6px;
            background: var(--vscode-input-background, #3c3c3c);
            cursor: pointer;
            transition: border-color 0.2s, background-color 0.2s;
        }
        
        .depth-option:hover {
            border-color: var(--vscode-focusBorder, #007acc);
            background: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.05));
        }
        
        .depth-option.selected {
            border-color: var(--vscode-focusBorder, #007acc);
            background: var(--vscode-list-activeSelectionBackground, rgba(0, 122, 204, 0.1));
        }
        
        .depth-option.disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .depth-option input[type="radio"] {
            margin: 0;
            margin-right: 12px;
            margin-top: 2px;
            accent-color: var(--vscode-focusBorder, #007acc);
        }
        
        .depth-content {
            flex: 1;
        }
        
        .depth-title {
            font-size: 13px;
            font-weight: 500;
            color: var(--vscode-foreground, #cccccc);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        .depth-desc {
            font-size: 11px;
            color: var(--vscode-descriptionForeground, #a0a0a0);
            margin-top: 4px;
        }
        
        .dialog-footer {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            padding: 16px 20px;
            border-top: 1px solid var(--vscode-widget-border, #454545);
            background: var(--vscode-editorGroupHeader-tabsBackground, rgba(0, 0, 0, 0.2));
        }
        
        .btn {
            padding: 10px 20px;
            border-radius: 4px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: background-color 0.2s, opacity 0.2s;
            border: none;
        }
        
        .btn-primary {
            background: var(--vscode-button-background, #0e639c);
            color: var(--vscode-button-foreground, #ffffff);
        }
        
        .btn-primary:hover:not(:disabled) {
            background: var(--vscode-button-hoverBackground, #1177bb);
        }
        
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground, #3a3d41);
            color: var(--vscode-button-secondaryForeground, #cccccc);
        }
        
        .btn-secondary:hover:not(:disabled) {
            background: var(--vscode-button-secondaryHoverBackground, #45494e);
        }
        
        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        /* Mode content visibility */
        .mode-content {
            display: none;
        }
        
        .mode-content.active {
            display: block;
        }
        
        /* No features message */
        .no-features-message {
            padding: 16px;
            background: var(--vscode-inputValidation-warningBackground, rgba(255, 204, 0, 0.1));
            border: 1px solid var(--vscode-inputValidation-warningBorder, #cca700);
            border-radius: 4px;
            font-size: 12px;
            color: var(--vscode-foreground, #cccccc);
        }
    </style>
</head>
<body>
    <div class="dialog-container">
        <div class="dialog-header">
            <h2><span class="icon">🤖</span> Create AI Task</h2>
            <button class="dialog-close-btn" id="closeBtn" title="Cancel">×</button>
        </div>
        
        <div class="mode-tabs">
            <button class="mode-tab active" id="tabCreate" data-mode="create">
                <span class="tab-icon">✨</span>
                Create New
            </button>
            <button class="mode-tab" id="tabFromFeature" data-mode="from-feature" ${!hasFeatureFolders ? 'disabled title="No feature folders found"' : ''}>
                <span class="tab-icon">📁</span>
                From Feature
            </button>
        </div>
        
        <div class="dialog-body">
            <!-- Create Mode Content -->
            <div class="mode-content active" id="createContent">
                <div class="form-group" id="nameGroup">
                    <label for="taskName">Task Name</label>
                    <input type="text" id="taskName" placeholder="implement-user-authentication" autocomplete="off" />
                    <div class="hint">Used as the filename (without .md extension)</div>
                    <div class="error" id="nameError"></div>
                </div>
                
                <div class="form-group">
                    <label for="taskLocation">Location</label>
                    <select id="taskLocation">
                        <!-- Populated by JavaScript -->
                    </select>
                    <div class="hint">Select where to create the task</div>
                </div>
                
                <div class="form-group">
                    <label for="taskDescription">Brief Description</label>
                    <textarea id="taskDescription" placeholder="Add JWT-based authentication with refresh tokens for the REST API endpoints..." rows="4"></textarea>
                    <div class="hint">AI will expand this into a comprehensive task document</div>
                </div>
                
                <hr class="form-divider" />
                
                <div class="form-group">
                    <label for="aiModelCreate">AI Model</label>
                    <select id="aiModelCreate">
                        <!-- Populated by JavaScript -->
                    </select>
                </div>
            </div>
            
            <!-- From Feature Mode Content -->
            <div class="mode-content" id="fromFeatureContent">
                ${!hasFeatureFolders ? `
                <div class="no-features-message">
                    No feature folders found. Create a feature folder first to use this mode.
                </div>
                ` : `
                <div class="form-group">
                    <label for="featureLocation">Feature Folder</label>
                    <select id="featureLocation">
                        <!-- Populated by JavaScript (feature folders only) -->
                    </select>
                    <div class="hint">Select the feature folder to analyze</div>
                </div>
                
                <div class="form-group">
                    <label for="taskFocus">Task Focus</label>
                    <textarea id="taskFocus" placeholder="Implement the core authentication flow..." rows="3"></textarea>
                    <div class="hint">What specific aspect should this task focus on? (Leave empty for general task)</div>
                </div>
                
                <hr class="form-divider" />
                
                <div class="form-group">
                    <label>Generation Depth</label>
                    <div class="depth-options">
                        <label class="depth-option selected" id="depthSimple">
                            <input type="radio" name="depth" value="simple" checked />
                            <div class="depth-content">
                                <div class="depth-title">⚡ Simple</div>
                                <div class="depth-desc">Quick, single-pass AI analysis - fast task creation</div>
                            </div>
                        </label>
                        <label class="depth-option ${!hasDeepSkill ? 'disabled' : ''}" id="depthDeep">
                            <input type="radio" name="depth" value="deep" ${!hasDeepSkill ? 'disabled' : ''} />
                            <div class="depth-content">
                                <div class="depth-title">🔬 Deep</div>
                                <div class="depth-desc">${hasDeepSkill 
                                    ? 'Multi-phase research using go-deep skill - comprehensive analysis'
                                    : 'Add .github/skills/go-deep/SKILL.md to enable'}</div>
                            </div>
                        </label>
                    </div>
                </div>
                
                <hr class="form-divider" />
                
                <div class="form-group">
                    <label for="aiModelFeature">AI Model</label>
                    <select id="aiModelFeature">
                        <!-- Populated by JavaScript -->
                    </select>
                </div>
                `}
            </div>
        </div>
        
        <div class="dialog-footer">
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
            <button class="btn btn-primary" id="createBtn">Create Task</button>
        </div>
    </div>
    
    <script nonce="${nonce}">
        (function() {
            const vscode = acquireVsCodeApi();
            
            // Data from extension
            const folders = ${foldersJson};
            const models = ${modelsJson};
            const preselectedFolder = ${preselectedJson};
            const defaultModel = ${defaultModelJson};
            const initialMode = ${initialModeJson};
            const hasDeepSkill = ${hasDeepSkillJson};
            const featureContext = ${featureContextJson};
            const hasFeatureFolders = folders.some(f => f.isFeatureFolder);
            
            // Current mode
            let currentMode = initialMode;
            
            // DOM elements - Tabs
            const tabCreate = document.getElementById('tabCreate');
            const tabFromFeature = document.getElementById('tabFromFeature');
            const createContent = document.getElementById('createContent');
            const fromFeatureContent = document.getElementById('fromFeatureContent');
            
            // DOM elements - Create mode
            const taskNameInput = document.getElementById('taskName');
            const taskLocationSelect = document.getElementById('taskLocation');
            const taskDescriptionInput = document.getElementById('taskDescription');
            const aiModelCreateSelect = document.getElementById('aiModelCreate');
            const nameGroup = document.getElementById('nameGroup');
            const nameError = document.getElementById('nameError');
            
            // DOM elements - From Feature mode
            const featureLocationSelect = document.getElementById('featureLocation');
            const taskFocusInput = document.getElementById('taskFocus');
            const aiModelFeatureSelect = document.getElementById('aiModelFeature');
            const depthSimple = document.getElementById('depthSimple');
            const depthDeep = document.getElementById('depthDeep');
            
            // DOM elements - Buttons
            const createBtn = document.getElementById('createBtn');
            const cancelBtn = document.getElementById('cancelBtn');
            const closeBtn = document.getElementById('closeBtn');
            
            // Populate location dropdown (all folders for create mode)
            folders.forEach(folder => {
                const option = document.createElement('option');
                option.value = folder.relativePath;
                option.textContent = folder.label;
                if (folder.relativePath === preselectedFolder) {
                    option.selected = true;
                }
                taskLocationSelect.appendChild(option);
            });
            
            // Populate feature location dropdown (feature folders only)
            if (hasFeatureFolders && featureLocationSelect) {
                folders.filter(f => f.isFeatureFolder).forEach(folder => {
                    const option = document.createElement('option');
                    option.value = folder.relativePath;
                    option.textContent = folder.label;
                    if (folder.relativePath === preselectedFolder) {
                        option.selected = true;
                    }
                    featureLocationSelect.appendChild(option);
                });
            }
            
            // Populate model dropdowns
            function populateModelSelect(select) {
                models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.id;
                    option.textContent = model.label + (model.description ? ' ' + model.description : '');
                    if (model.id === defaultModel) {
                        option.selected = true;
                    }
                    select.appendChild(option);
                });
            }
            populateModelSelect(aiModelCreateSelect);
            if (aiModelFeatureSelect) {
                populateModelSelect(aiModelFeatureSelect);
            }
            
            // Tab switching
            function switchMode(mode) {
                currentMode = mode;
                
                // Update tabs
                tabCreate.classList.toggle('active', mode === 'create');
                tabFromFeature.classList.toggle('active', mode === 'from-feature');
                
                // Update content
                createContent.classList.toggle('active', mode === 'create');
                fromFeatureContent.classList.toggle('active', mode === 'from-feature');
                
                // Update validation
                updateValidation();
                
                // Focus appropriate field
                if (mode === 'create') {
                    setTimeout(() => taskNameInput.focus(), 100);
                } else if (taskFocusInput) {
                    setTimeout(() => taskFocusInput.focus(), 100);
                }
            }
            
            tabCreate.addEventListener('click', () => switchMode('create'));
            tabFromFeature.addEventListener('click', () => {
                if (hasFeatureFolders) {
                    switchMode('from-feature');
                }
            });
            
            // Depth option selection
            if (depthSimple && depthDeep) {
                depthSimple.addEventListener('click', () => {
                    depthSimple.classList.add('selected');
                    depthDeep.classList.remove('selected');
                    depthSimple.querySelector('input').checked = true;
                });
                
                depthDeep.addEventListener('click', () => {
                    if (hasDeepSkill) {
                        depthDeep.classList.add('selected');
                        depthSimple.classList.remove('selected');
                        depthDeep.querySelector('input').checked = true;
                    }
                });
            }
            
            // Validation
            function validateName(value) {
                if (!value || value.trim().length === 0) {
                    return 'Task name cannot be empty';
                }
                if (value.includes('/') || value.includes('\\\\')) {
                    return 'Task name cannot contain path separators';
                }
                if (/[<>:"|?*]/.test(value)) {
                    return 'Task name contains invalid characters';
                }
                return null;
            }
            
            function updateValidation() {
                if (currentMode === 'create') {
                    const error = validateName(taskNameInput.value);
                    if (error) {
                        nameGroup.classList.add('has-error');
                        nameError.textContent = error;
                        createBtn.disabled = true;
                    } else {
                        nameGroup.classList.remove('has-error');
                        nameError.textContent = '';
                        createBtn.disabled = false;
                    }
                } else {
                    // From feature mode - always valid (focus is optional)
                    createBtn.disabled = !hasFeatureFolders;
                }
            }
            
            // Event listeners
            taskNameInput.addEventListener('input', updateValidation);
            
            createBtn.addEventListener('click', () => {
                if (currentMode === 'create') {
                    const error = validateName(taskNameInput.value);
                    if (error) {
                        updateValidation();
                        taskNameInput.focus();
                        return;
                    }
                    
                    vscode.postMessage({
                        type: 'submit',
                        mode: 'create',
                        name: taskNameInput.value.trim(),
                        location: taskLocationSelect.value,
                        description: taskDescriptionInput.value.trim(),
                        model: aiModelCreateSelect.value
                    });
                } else {
                    const depthValue = document.querySelector('input[name="depth"]:checked')?.value || 'simple';
                    
                    vscode.postMessage({
                        type: 'submit',
                        mode: 'from-feature',
                        location: featureLocationSelect ? featureLocationSelect.value : '',
                        focus: taskFocusInput ? taskFocusInput.value.trim() : '',
                        depth: depthValue,
                        model: aiModelFeatureSelect ? aiModelFeatureSelect.value : defaultModel
                    });
                }
            });
            
            cancelBtn.addEventListener('click', () => {
                vscode.postMessage({ type: 'cancel' });
            });
            
            closeBtn.addEventListener('click', () => {
                vscode.postMessage({ type: 'cancel' });
            });
            
            // Keyboard shortcuts
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    vscode.postMessage({ type: 'cancel' });
                }
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    createBtn.click();
                }
            });
            
            // Initialize
            if (initialMode === 'from-feature' && hasFeatureFolders) {
                switchMode('from-feature');
            } else {
                switchMode('create');
            }
            
            // Set initial focus
            setTimeout(() => {
                if (currentMode === 'create') {
                    taskNameInput.focus();
                } else if (taskFocusInput) {
                    taskFocusInput.focus();
                }
            }, 100);
        })();
    </script>
</body>
</html>`;
    }

    /**
     * Generate a nonce for Content Security Policy
     */
    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
