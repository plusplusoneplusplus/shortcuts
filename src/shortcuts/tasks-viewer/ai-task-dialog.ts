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
import { getAvailableModels, getLastUsedAIModel, saveLastUsedAIModel, getLastUsedDepth, saveLastUsedDepth, getLastUsedLocation, saveLastUsedLocation } from '../ai-service/ai-config-helpers';
import { skillExists } from '@plusplusoneplusplus/pipeline-core';
import { getSharedDialogCSS } from '../shared/webview/dialog-styles';
import { AUTO_FOLDER_SENTINEL } from './types';

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
    private readonly context: vscode.ExtensionContext;
    private currentPanel: vscode.WebviewPanel | undefined;
    private pendingResolve: ((result: AITaskDialogResult) => void) | undefined;
    private statusBarItem: vscode.StatusBarItem | undefined;

    constructor(taskManager: TaskManager, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this.taskManager = taskManager;
        this.extensionUri = extensionUri;
        this.context = context;
    }

    /** Whether the dialog panel is currently open (visible or minimized) */
    get isOpen(): boolean {
        return this.currentPanel !== undefined;
    }

    /** Whether the status bar indicator is currently visible */
    get hasStatusBarItem(): boolean {
        return this.statusBarItem !== undefined;
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
        // If panel already exists, reveal it and return a new promise
        if (this.currentPanel) {
            this.currentPanel.reveal(vscode.ViewColumn.Active);
            return new Promise<AITaskDialogResult>((resolve) => {
                this.pendingResolve = resolve;
            });
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
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.extensionUri, 'media')
                ]
            }
        );

        this.currentPanel = panel;

        // Create status bar item for re-revealing minimized dialog
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
        this.statusBarItem.text = '$(edit) Generate Task';
        this.statusBarItem.tooltip = 'Click to resume the Generate Task dialog';
        this.statusBarItem.command = 'workspaceShortcuts.revealAITaskDialog';
        this.statusBarItem.show();

        // Register a disposable command to reveal the panel
        const revealCommand = vscode.commands.registerCommand('workspaceShortcuts.revealAITaskDialog', () => {
            if (this.currentPanel) {
                this.currentPanel.reveal(vscode.ViewColumn.Active);
            }
        });

        // Get available folders and models
        const folders = await this.getAvailableFolders();
        const models = getAvailableModels();
        const defaultModel = getLastUsedAIModel(this.context);
        const defaultDepth = getLastUsedDepth(this.context);
        const defaultLocation = options?.preselectedFolder ?? getLastUsedLocation(this.context);
        const workspaceRoot = this.taskManager.getWorkspaceRoot();
        const hasDeepSkill = skillExists('go-deep', workspaceRoot);

        // Set webview content
        panel.webview.html = this.getWebviewContent(
            panel.webview,
            folders,
            models,
            defaultModel,
            defaultDepth,
            hasDeepSkill,
            defaultLocation,
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
            if (this.statusBarItem) {
                this.statusBarItem.dispose();
                this.statusBarItem = undefined;
            }
            revealCommand.dispose();
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
                            model: message.model,
                            depth: message.depth,
                            images: message.images
                        };
                    } else {
                        result.fromFeatureOptions = {
                            name: message.name,
                            location: message.location,
                            focus: message.focus,
                            depth: message.depth,
                            model: message.model,
                            images: message.images
                        };
                    }

                    // Save the selected model for future dialogs
                    if (message.model) {
                        saveLastUsedAIModel(this.context, message.model);
                    }

                    // Save the selected depth for future dialogs
                    if (message.depth) {
                        saveLastUsedDepth(this.context, message.depth);
                    }

                    // Save the selected location for future dialogs (create mode only)
                    if (message.mode === 'create' && message.location !== undefined) {
                        saveLastUsedLocation(this.context, message.location);
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

            case 'minimize':
                // Move focus away from the dialog without disposing it
                vscode.commands.executeCommand('workbench.action.focusSideBar');
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
     * @param value - The task name to validate
     * @param allowEmpty - If true, empty names are allowed (AI will generate the name)
     */
    validateTaskName(value: string, allowEmpty: boolean = false): string | null {
        // Allow empty if the caller permits it (AI will generate a name)
        if (!value || value.trim().length === 0) {
            return allowEmpty ? null : 'Task name cannot be empty';
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
        defaultDepth: string,
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
        const autoFolderSentinelJson = JSON.stringify(AUTO_FOLDER_SENTINEL);

        // Determine if we have any feature folders
        const hasFeatureFolders = folders.some(f => f.isFeatureFolder);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <link href="${stylesUri}" rel="stylesheet">
    <title>Create AI Task</title>
    <style nonce="${nonce}">
        ${getSharedDialogCSS()}
        
        /* Dialog-specific: Depth Selection (radio group) */
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
        
        /* Image paste preview */
        .image-preview-container {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 8px;
        }

        .image-preview-container:empty {
            display: none;
        }

        .image-preview-item {
            position: relative;
            width: 80px;
            height: 80px;
            border-radius: 4px;
            border: 1px solid var(--vscode-input-border, #3c3c3c);
            overflow: hidden;
            background: var(--vscode-input-background, #3c3c3c);
        }

        .image-preview-item img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }

        .image-preview-item .remove-image-btn {
            position: absolute;
            top: 2px;
            right: 2px;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            border: none;
            background: rgba(0, 0, 0, 0.6);
            color: #fff;
            font-size: 14px;
            line-height: 1;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity 0.15s;
        }

        .image-preview-item:hover .remove-image-btn {
            opacity: 1;
        }

        .paste-hint {
            font-size: 11px;
            color: var(--vscode-descriptionForeground, #a0a0a0);
            margin-top: 4px;
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
                    <label for="taskName">Task Name <span class="optional">(Optional)</span></label>
                    <input type="text" id="taskName" placeholder="implement-user-authentication" autocomplete="off" />
                    <div class="hint">Leave empty to let AI generate a name from the description</div>
                    <div class="error" id="nameError"></div>
                </div>
                
                <div class="form-group">
                    <label for="taskLocation">Location</label>
                    <select id="taskLocation">
                        <!-- Populated by JavaScript -->
                    </select>
                    <div class="hint" id="locationHint">Select where to create the task</div>
                    <div class="hint" id="autoFolderHint" style="display:none;color:var(--vscode-descriptionForeground);">✨ AI will choose an existing folder or create a new one based on the task.</div>
                </div>
                
                <div class="form-group">
                    <label for="taskDescription">Brief Description</label>
                    <textarea id="taskDescription" placeholder="Add JWT-based authentication with refresh tokens for the REST API endpoints..." rows="4"></textarea>
                    <div class="hint">AI will expand this into a comprehensive task document</div>
                    <div class="paste-hint">💡 Paste images from clipboard (Ctrl+V)</div>
                    <div class="image-preview-container" id="createImagePreviews"></div>
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
                <div class="form-group" id="featureNameGroup">
                    <label for="featureTaskName">Task Name <span class="optional">(Optional)</span></label>
                    <input type="text" id="featureTaskName" placeholder="implement-user-authentication" autocomplete="off" />
                    <div class="hint">Leave empty to let AI generate a name based on the feature</div>
                    <div class="error" id="featureNameError"></div>
                </div>
                
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
                    <div class="paste-hint">💡 Paste images from clipboard (Ctrl+V)</div>
                    <div class="image-preview-container" id="featureImagePreviews"></div>
                </div>
                
                <hr class="form-divider" />
                
                <div class="form-group">
                    <label>Generation Depth</label>
                    <div class="depth-options">
                        <label class="depth-option ${defaultDepth !== 'deep' ? 'selected' : ''}" id="depthSimple">
                            <input type="radio" name="depth" value="simple" ${defaultDepth !== 'deep' ? 'checked' : ''} />
                            <div class="depth-content">
                                <div class="depth-title">⚡ Simple</div>
                                <div class="depth-desc">Quick, single-pass AI analysis - fast task creation</div>
                            </div>
                        </label>
                        <label class="depth-option ${!hasDeepSkill ? 'disabled' : (defaultDepth === 'deep' ? 'selected' : '')}" id="depthDeep">
                            <input type="radio" name="depth" value="deep" ${!hasDeepSkill ? 'disabled' : (defaultDepth === 'deep' ? 'checked' : '')} />
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
            <button class="btn btn-secondary" id="minimizeBtn" title="Minimize to status bar (Escape)">↓ Minimize</button>
            <button class="btn btn-secondary" id="cancelBtn" title="Close and discard (Shift+Escape)">✕ Close</button>
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
            const AUTO_FOLDER_SENTINEL = ${autoFolderSentinelJson};
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
            const locationHint = document.getElementById('locationHint');
            const autoFolderHint = document.getElementById('autoFolderHint');
            const taskDescriptionInput = document.getElementById('taskDescription');
            const aiModelCreateSelect = document.getElementById('aiModelCreate');
            const nameGroup = document.getElementById('nameGroup');
            const nameError = document.getElementById('nameError');
            
            // DOM elements - From Feature mode
            const featureTaskNameInput = document.getElementById('featureTaskName');
            const featureNameGroup = document.getElementById('featureNameGroup');
            const featureNameError = document.getElementById('featureNameError');
            const featureLocationSelect = document.getElementById('featureLocation');
            const taskFocusInput = document.getElementById('taskFocus');
            const aiModelFeatureSelect = document.getElementById('aiModelFeature');
            const depthSimple = document.getElementById('depthSimple');
            const depthDeep = document.getElementById('depthDeep');
            
            // DOM elements - Buttons
            const createBtn = document.getElementById('createBtn');
            const cancelBtn = document.getElementById('cancelBtn');
            const closeBtn = document.getElementById('closeBtn');
            const minimizeBtn = document.getElementById('minimizeBtn');
            
            // Image storage per mode
            const createImages = [];
            const featureImages = [];
            
            // Preview containers
            const createImagePreviews = document.getElementById('createImagePreviews');
            const featureImagePreviews = document.getElementById('featureImagePreviews');
            
            // Handle image paste on textareas
            function handleImagePaste(e, imageArray, previewContainer) {
                const items = e.clipboardData && e.clipboardData.items;
                if (!items) return;

                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    if (item.type.startsWith('image/')) {
                        e.preventDefault();
                        const file = item.getAsFile();
                        if (!file) continue;

                        const reader = new FileReader();
                        reader.onload = function(event) {
                            const dataUrl = event.target.result;
                            imageArray.push(dataUrl);
                            renderImagePreviews(imageArray, previewContainer);
                        };
                        reader.readAsDataURL(file);
                    }
                }
            }
            
            function renderImagePreviews(imageArray, container) {
                container.innerHTML = '';
                imageArray.forEach((dataUrl, index) => {
                    const item = document.createElement('div');
                    item.className = 'image-preview-item';

                    const img = document.createElement('img');
                    img.src = dataUrl;
                    img.alt = 'Pasted image ' + (index + 1);

                    const removeBtn = document.createElement('button');
                    removeBtn.className = 'remove-image-btn';
                    removeBtn.textContent = '\u00d7';
                    removeBtn.title = 'Remove image';
                    removeBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        imageArray.splice(index, 1);
                        renderImagePreviews(imageArray, container);
                    });

                    item.appendChild(img);
                    item.appendChild(removeBtn);
                    container.appendChild(item);
                });
            }
            
            function updateLocationHints() {
                const isAuto = taskLocationSelect.value === AUTO_FOLDER_SENTINEL;
                if (locationHint) { locationHint.style.display = isAuto ? 'none' : ''; }
                if (autoFolderHint) { autoFolderHint.style.display = isAuto ? '' : 'none'; }
            }

            // Populate location dropdown (all folders for create mode)
            // Prepend ✨ Auto option
            (function() {
                const autoOption = document.createElement('option');
                autoOption.value = AUTO_FOLDER_SENTINEL;
                autoOption.textContent = '✨ Auto (AI decides)';
                if (preselectedFolder === AUTO_FOLDER_SENTINEL) {
                    autoOption.selected = true;
                }
                taskLocationSelect.appendChild(autoOption);
            })();

            folders.forEach(folder => {
                const option = document.createElement('option');
                option.value = folder.relativePath;
                option.textContent = folder.label;
                if (folder.relativePath === preselectedFolder) {
                    option.selected = true;
                }
                taskLocationSelect.appendChild(option);
            });

            taskLocationSelect.addEventListener('change', updateLocationHints);
            updateLocationHints();
            
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
            
            // Validation - name is now optional (AI can generate it)
            function validateName(value) {
                // Empty is allowed - AI will generate a name
                if (!value || value.trim().length === 0) {
                    return null;
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
                    // From feature mode - validate task name if provided
                    if (featureTaskNameInput && featureNameGroup && featureNameError) {
                        const error = validateName(featureTaskNameInput.value);
                        if (error) {
                            featureNameGroup.classList.add('has-error');
                            featureNameError.textContent = error;
                            createBtn.disabled = true;
                        } else {
                            featureNameGroup.classList.remove('has-error');
                            featureNameError.textContent = '';
                            createBtn.disabled = !hasFeatureFolders;
                        }
                    } else {
                        createBtn.disabled = !hasFeatureFolders;
                    }
                }
            }
            
            // Event listeners
            taskNameInput.addEventListener('input', updateValidation);
            if (featureTaskNameInput) {
                featureTaskNameInput.addEventListener('input', updateValidation);
            }
            
            // Paste image handling for create mode
            taskDescriptionInput.addEventListener('paste', (e) => {
                handleImagePaste(e, createImages, createImagePreviews);
            });
            
            // Paste image handling for from-feature mode
            if (taskFocusInput) {
                taskFocusInput.addEventListener('paste', (e) => {
                    handleImagePaste(e, featureImages, featureImagePreviews);
                });
            }
            
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
                        model: aiModelCreateSelect.value,
                        images: createImages.length > 0 ? createImages : undefined
                    });
                } else {
                    // Validate feature task name
                    if (featureTaskNameInput) {
                        const error = validateName(featureTaskNameInput.value);
                        if (error) {
                            updateValidation();
                            featureTaskNameInput.focus();
                            return;
                        }
                    }
                    
                    const depthValue = document.querySelector('input[name="depth"]:checked')?.value || 'simple';
                    
                    vscode.postMessage({
                        type: 'submit',
                        mode: 'from-feature',
                        name: featureTaskNameInput ? featureTaskNameInput.value.trim() : '',
                        location: featureLocationSelect ? featureLocationSelect.value : '',
                        focus: taskFocusInput ? taskFocusInput.value.trim() : '',
                        depth: depthValue,
                        model: aiModelFeatureSelect ? aiModelFeatureSelect.value : defaultModel,
                        images: featureImages.length > 0 ? featureImages : undefined
                    });
                }
            });
            
            cancelBtn.addEventListener('click', () => {
                vscode.postMessage({ type: 'cancel' });
            });
            
            closeBtn.addEventListener('click', () => {
                vscode.postMessage({ type: 'cancel' });
            });
            
            minimizeBtn.addEventListener('click', () => {
                vscode.postMessage({ type: 'minimize' });
            });
            
            // Keyboard shortcuts
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && e.shiftKey) {
                    // Shift+Escape: Close and discard
                    vscode.postMessage({ type: 'cancel' });
                } else if (e.key === 'Escape') {
                    // Escape: Minimize (move to background)
                    vscode.postMessage({ type: 'minimize' });
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
