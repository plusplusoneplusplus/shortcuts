/**
 * Discovery Preview Provider
 * 
 * Webview panel for displaying and managing discovery results.
 * 
 * Uses shared webview utilities:
 * - WebviewSetupHelper for webview configuration
 * - WebviewMessageRouter for type-safe message handling
 */

import * as vscode from 'vscode';
import { DiscoveryProcess, DiscoveryResult } from '../types';
import { LogicalGroupItem, LogicalGroup, ShortcutsConfig } from '../../types';
import { DiscoveryEngine } from '../discovery-engine';
import { getWebviewContent, WebviewMessage, ExtensionFilters, FeatureFolderInfo, DestinationType } from './webview-content';
import { ConfigurationManager } from '../../configuration-manager';
import { getExtensionLogger, LogCategory } from '../../shared/extension-logger';
import { WebviewSetupHelper, WebviewMessageRouter } from '../../shared/webview/extension-webview-utils';
import { TaskManager } from '../../tasks-viewer/task-manager';
import { RelatedItem } from '../../tasks-viewer/types';
import { categorizeItem } from '../../tasks-viewer/related-items-loader';

/**
 * Options for creating or showing the discovery preview panel
 */
export interface DiscoveryPreviewPanelOptions {
    /** Default destination type (shortcutGroups or featureFolders) */
    defaultDestinationType?: DestinationType;
    /** Default feature folder path (when destinationType is featureFolders) */
    defaultFeatureFolder?: string;
}

/**
 * Discovery Preview Panel
 * Manages the webview panel for discovery results
 * 
 * Uses shared webview utilities for consistent setup and message handling.
 */
export class DiscoveryPreviewPanel {
    public static currentPanel: DiscoveryPreviewPanel | undefined;
    public static readonly viewType = 'discoveryPreview';
    
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _discoveryEngine: DiscoveryEngine;
    private readonly _configManager: ConfigurationManager;
    private readonly _taskManager: TaskManager | undefined;
    private readonly _setupHelper: WebviewSetupHelper;
    private readonly _messageRouter: WebviewMessageRouter<WebviewMessage>;
    
    private _currentProcess: DiscoveryProcess | undefined;
    private _minScore: number = 30;
    private _selectedTargetGroup: string = '';
    private _selectedFeatureFolder: string = '';
    private _destinationType: DestinationType = 'shortcutGroups';
    private _extensionFilters: ExtensionFilters = {};
    private _featureFolders: FeatureFolderInfo[] = [];
    private _disposables: vscode.Disposable[] = [];
    private _onDidAddToFeatureFolder: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    
    /**
     * Event fired when items are added to a feature folder (for refreshing Tasks tree)
     */
    public readonly onDidAddToFeatureFolder: vscode.Event<void> = this._onDidAddToFeatureFolder.event;
    
    /**
     * Create or show the discovery preview panel
     */
    public static createOrShow(
        extensionUri: vscode.Uri,
        discoveryEngine: DiscoveryEngine,
        configManager: ConfigurationManager,
        process?: DiscoveryProcess,
        taskManager?: TaskManager,
        options?: DiscoveryPreviewPanelOptions
    ): DiscoveryPreviewPanel {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        
        // If we already have a panel, show it
        if (DiscoveryPreviewPanel.currentPanel) {
            DiscoveryPreviewPanel.currentPanel._panel.reveal(column);
            if (process) {
                DiscoveryPreviewPanel.currentPanel.setProcess(process, options);
            }
            return DiscoveryPreviewPanel.currentPanel;
        }
        
        // Use shared setup helper for consistent webview options
        const setupHelper = new WebviewSetupHelper(extensionUri);
        
        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            DiscoveryPreviewPanel.viewType,
            'Discovery Results',
            column || vscode.ViewColumn.One,
            setupHelper.getWebviewPanelOptions()
        );
        
        DiscoveryPreviewPanel.currentPanel = new DiscoveryPreviewPanel(
            panel,
            extensionUri,
            discoveryEngine,
            configManager,
            process,
            taskManager,
            options
        );
        
        return DiscoveryPreviewPanel.currentPanel;
    }
    
    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        discoveryEngine: DiscoveryEngine,
        configManager: ConfigurationManager,
        process?: DiscoveryProcess,
        taskManager?: TaskManager,
        options?: DiscoveryPreviewPanelOptions
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._discoveryEngine = discoveryEngine;
        this._configManager = configManager;
        this._taskManager = taskManager;
        this._currentProcess = process;
        this._setupHelper = new WebviewSetupHelper(extensionUri);
        this._messageRouter = new WebviewMessageRouter<WebviewMessage>({
            logUnhandledMessages: false
        });
        
        // Set the default target group from the process if available
        if (process?.targetGroupPath) {
            this._selectedTargetGroup = process.targetGroupPath;
        }
        
        // Apply options for default destination type and feature folder
        if (options?.defaultDestinationType) {
            this._destinationType = options.defaultDestinationType;
        }
        if (options?.defaultFeatureFolder) {
            this._selectedFeatureFolder = options.defaultFeatureFolder;
        }
        
        // Setup type-safe message routing
        this._setupMessageHandlers();
        
        // Set the webview's initial html content
        this._update();
        
        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        
        // Update the content based on view state changes
        this._panel.onDidChangeViewState(
            e => {
                if (this._panel.visible) {
                    this._update();
                }
            },
            null,
            this._disposables
        );
        
        // Connect router to panel
        this._panel.webview.onDidReceiveMessage(
            (message: WebviewMessage) => this._messageRouter.route(message),
            null,
            this._disposables
        );
        
        // Listen for discovery process updates
        this._discoveryEngine.onDidChangeProcess(
            event => {
                if (this._currentProcess && event.process.id === this._currentProcess.id) {
                    this._currentProcess = event.process;
                    this._update();
                }
            },
            null,
            this._disposables
        );
    }
    
    /**
     * Setup message handlers using the type-safe router
     */
    private _setupMessageHandlers(): void {
        this._messageRouter
            .on('toggleItem', (message: WebviewMessage) => {
                this._toggleItem(message.payload.id);
            })
            .on('selectAll', () => {
                this._selectAll();
            })
            .on('deselectAll', () => {
                this._deselectAll();
            })
            .on('addToGroup', async (message: WebviewMessage) => {
                await this._addToGroup(message.payload.targetGroup);
            })
            .on('addToFeatureFolder', async (message: WebviewMessage) => {
                await this._addToFeatureFolder(message.payload.folderPath);
            })
            .on('switchDestinationType', (message: WebviewMessage) => {
                this._destinationType = message.payload.destinationType as DestinationType;
                this._update();
            })
            .on('filterByScore', (message: WebviewMessage) => {
                this._minScore = message.payload.minScore;
                this._update();
            })
            .on('filterByExtension', (message: WebviewMessage) => {
                this._setExtensionFilter(message.payload.sourceType, message.payload.extension);
            })
            .on('refresh', () => {
                this._update();
            })
            .on('cancel', () => {
                if (this._currentProcess) {
                    this._discoveryEngine.cancelProcess(this._currentProcess.id);
                }
            })
            .on('showWarning', (message: WebviewMessage) => {
                vscode.window.showWarningMessage(message.payload.message);
            });
    }
    
    /**
     * Set the current discovery process
     */
    public setProcess(process: DiscoveryProcess, options?: DiscoveryPreviewPanelOptions): void {
        this._currentProcess = process;
        // Reset extension filters when a new process is set
        this._extensionFilters = {};
        // Set the default target group from the process if available
        if (process.targetGroupPath && !this._selectedTargetGroup) {
            this._selectedTargetGroup = process.targetGroupPath;
        }
        // Apply options for default destination type and feature folder
        if (options?.defaultDestinationType) {
            this._destinationType = options.defaultDestinationType;
        }
        if (options?.defaultFeatureFolder) {
            this._selectedFeatureFolder = options.defaultFeatureFolder;
        }
        this._update();
    }
    
    /**
     * Toggle selection of a result item
     */
    private _toggleItem(id: string): void {
        if (!this._currentProcess?.results) return;
        
        const result = this._currentProcess.results.find(r => r.id === id);
        if (result) {
            result.selected = !result.selected;
            this._update();
        }
    }
    
    /**
     * Select all visible results
     */
    private _selectAll(): void {
        if (!this._currentProcess?.results) return;
        
        for (const result of this._currentProcess.results) {
            if (result.relevanceScore >= this._minScore) {
                result.selected = true;
            }
        }
        this._update();
    }
    
    /**
     * Deselect all results
     */
    private _deselectAll(): void {
        if (!this._currentProcess?.results) return;
        
        for (const result of this._currentProcess.results) {
            result.selected = false;
        }
        this._update();
    }
    
    /**
     * Set extension filter for a source type
     */
    private _setExtensionFilter(sourceType: string, extension: string): void {
        if (extension) {
            this._extensionFilters[sourceType] = extension;
        } else {
            // Remove filter when "All" is selected
            delete this._extensionFilters[sourceType];
        }
        this._update();
    }
    
    /**
     * Add selected results to a logical group
     * Groups items by type (source code, docs, commits) as subgroups
     */
    private async _addToGroup(targetGroup: string): Promise<void> {
        if (!this._currentProcess?.results || !targetGroup) {
            vscode.window.showWarningMessage('Please select a target group');
            return;
        }
        
        // Store the selected target group so it persists after update
        this._selectedTargetGroup = targetGroup;
        
        const selectedResults = this._currentProcess.results.filter(r => r.selected);
        if (selectedResults.length === 0) {
            vscode.window.showWarningMessage('No items selected');
            return;
        }
        
        try {
            // Group results by type
            const sourceResults: DiscoveryResult[] = [];
            const docResults: DiscoveryResult[] = [];
            const commitResults: DiscoveryResult[] = [];
            
            for (const result of selectedResults) {
                if (result.type === 'commit') {
                    commitResults.push(result);
                } else if (result.type === 'doc') {
                    docResults.push(result);
                } else {
                    // file, folder, or other source code
                    sourceResults.push(result);
                }
            }
            
            let addedCount = 0;
            
            // Add source code items to "Source Code" subgroup
            if (sourceResults.length > 0) {
                const subgroupPath = await this._ensureSubgroup(targetGroup, 'Source Code', 'Source code files');
                for (const result of sourceResults) {
                    try {
                        if (result.path) {
                            const itemType = result.type === 'folder' ? 'folder' : 'file';
                            await this._configManager.addToLogicalGroup(
                                subgroupPath,
                                result.path,
                                result.name,
                                itemType
                            );
                            addedCount++;
                        }
                    } catch (error) {
                        const logger = getExtensionLogger();
                        logger.error(LogCategory.DISCOVERY, `Failed to add ${result.name} to group`, error instanceof Error ? error : new Error(String(error)));
                    }
                }
            }
            
            // Add documentation items to "Documentation" subgroup
            if (docResults.length > 0) {
                const subgroupPath = await this._ensureSubgroup(targetGroup, 'Documentation', 'Documentation files');
                for (const result of docResults) {
                    try {
                        if (result.path) {
                            await this._configManager.addToLogicalGroup(
                                subgroupPath,
                                result.path,
                                result.name,
                                'file'
                            );
                            addedCount++;
                        }
                    } catch (error) {
                        const logger = getExtensionLogger();
                        logger.error(LogCategory.DISCOVERY, `Failed to add ${result.name} to group`, error instanceof Error ? error : new Error(String(error)));
                    }
                }
            }
            
            // Add commit items to "Commits" subgroup
            if (commitResults.length > 0) {
                const subgroupPath = await this._ensureSubgroup(targetGroup, 'Commits', 'Related git commits');
                for (const result of commitResults) {
                    try {
                        if (result.commit) {
                            await this._addCommitToGroup(subgroupPath, result);
                            addedCount++;
                        }
                    } catch (error) {
                        const logger = getExtensionLogger();
                        logger.error(LogCategory.DISCOVERY, `Failed to add ${result.name} to group`, error instanceof Error ? error : new Error(String(error)));
                    }
                }
            }
            
            if (addedCount > 0) {
                vscode.window.showInformationMessage(
                    `Added ${addedCount} item(s) to "${targetGroup}"`
                );
                
                // Deselect added items
                for (const result of selectedResults) {
                    result.selected = false;
                }
                this._update();
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to add items: ${err.message}`);
        }
    }
    
    /**
     * Add selected results to a feature folder's related.yaml
     */
    private async _addToFeatureFolder(folderPath: string): Promise<void> {
        if (!this._currentProcess?.results || !folderPath) {
            vscode.window.showWarningMessage('Please select a target folder');
            return;
        }
        
        if (!this._taskManager) {
            vscode.window.showErrorMessage('Tasks viewer not available');
            return;
        }
        
        // Store the selected folder so it persists after update
        this._selectedFeatureFolder = folderPath;
        
        const selectedResults = this._currentProcess.results.filter(r => r.selected);
        if (selectedResults.length === 0) {
            vscode.window.showWarningMessage('No items selected');
            return;
        }
        
        try {
            // Convert discovery results to related items
            const workspaceRoot = this._taskManager.getWorkspaceRoot();
            const relatedItems = this._convertToRelatedItems(selectedResults, workspaceRoot);
            
            // Add to the feature folder
            await this._taskManager.addRelatedItems(folderPath, relatedItems);
            
            // Get folder display name for the notification
            const folderName = this._featureFolders.find(f => f.path === folderPath)?.displayName 
                || folderPath.split('/').pop() 
                || folderPath;
            
            vscode.window.showInformationMessage(
                `Added ${relatedItems.length} item(s) to "${folderName}"`
            );
            
            // Deselect added items
            for (const result of selectedResults) {
                result.selected = false;
            }
            
            // Fire event to refresh Tasks tree
            this._onDidAddToFeatureFolder.fire();
            
            this._update();
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            const logger = getExtensionLogger();
            logger.error(LogCategory.DISCOVERY, 'Failed to add items to feature folder', err, { folderPath });
            vscode.window.showErrorMessage(`Failed to add items: ${err.message}`);
        }
    }
    
    /**
     * Convert discovery results to related items format
     */
    private _convertToRelatedItems(results: DiscoveryResult[], workspaceRoot: string): RelatedItem[] {
        return results.map(result => {
            const item: RelatedItem = {
                name: result.name,
                type: result.type === 'commit' ? 'commit' : 'file',
                category: this._getCategory(result),
                relevance: result.relevanceScore,
                reason: result.relevanceReason
            };

            if (result.type === 'commit' && result.commit) {
                item.hash = result.commit.hash;
            } else if (result.path) {
                // Make path relative to workspace
                item.path = result.path.startsWith(workspaceRoot)
                    ? result.path.substring(workspaceRoot.length + 1)
                    : result.path;
            }

            return item;
        });
    }
    
    /**
     * Get category for a discovery result
     */
    private _getCategory(result: DiscoveryResult): 'source' | 'test' | 'doc' | 'config' | 'commit' {
        if (result.type === 'commit') {
            return 'commit';
        }
        
        if (result.type === 'doc') {
            return 'doc';
        }

        if (result.path) {
            return categorizeItem(result.path);
        }

        return 'source';
    }
    
    /**
     * Ensure a subgroup exists within the target group, create if needed
     */
    private async _ensureSubgroup(parentGroupPath: string, subgroupName: string, description: string): Promise<string> {
        const config = await this._configManager.loadConfiguration();
        const subgroupPath = `${parentGroupPath}/${subgroupName}`;
        
        // Find the parent group
        const pathParts = parentGroupPath.split('/');
        let currentGroups = config.logicalGroups;
        let targetGroup = currentGroups.find(g => g.name === pathParts[0]);
        
        for (let i = 1; i < pathParts.length && targetGroup; i++) {
            currentGroups = targetGroup.groups || [];
            targetGroup = currentGroups.find(g => g.name === pathParts[i]);
        }
        
        if (!targetGroup) {
            throw new Error(`Parent group not found: ${parentGroupPath}`);
        }
        
        // Check if subgroup already exists
        if (!targetGroup.groups) {
            targetGroup.groups = [];
        }
        
        const existingSubgroup = targetGroup.groups.find(g => g.name === subgroupName);
        if (!existingSubgroup) {
            // Create the subgroup
            await this._configManager.createNestedLogicalGroup(parentGroupPath, subgroupName, description);
        }
        
        return subgroupPath;
    }
    
    /**
     * Add a commit to a logical group
     */
    private async _addCommitToGroup(
        groupPath: string,
        result: DiscoveryResult
    ): Promise<void> {
        if (!result.commit) return;
        
        const config = await this._configManager.loadConfiguration();
        
        // Find the group
        const pathParts = groupPath.split('/');
        let currentGroups = config.logicalGroups;
        let targetGroup = currentGroups.find(g => g.name === pathParts[0]);
        
        for (let i = 1; i < pathParts.length && targetGroup; i++) {
            currentGroups = targetGroup.groups || [];
            targetGroup = currentGroups.find(g => g.name === pathParts[i]);
        }
        
        if (!targetGroup) {
            throw new Error(`Group not found: ${groupPath}`);
        }
        
        // Check if commit already exists
        const existingCommit = targetGroup.items.find(
            item => item.type === 'commit' && 
                   item.commitRef?.hash === result.commit!.hash
        );
        
        if (existingCommit) {
            const logger = getExtensionLogger();
            logger.debug(LogCategory.DISCOVERY, 'Commit already exists in group', {
                commitHash: result.commit!.hash,
                groupPath
            });
            return;
        }
        
        // Add commit item
        const commitItem: LogicalGroupItem = {
            name: result.name,
            type: 'commit',
            commitRef: {
                hash: result.commit.hash,
                repositoryRoot: result.commit.repositoryRoot
            }
        };
        
        targetGroup.items.push(commitItem);
        await this._configManager.saveConfiguration(config);
    }
    
    /**
     * Update the webview content
     */
    private async _update(): Promise<void> {
        const webview = this._panel.webview;
        
        // Get available groups
        const config = await this._configManager.loadConfiguration();
        const groups = this._getGroupPaths(config.logicalGroups);
        
        // Filter out items that already exist in the target group
        let processToShow = this._currentProcess;
        if (this._currentProcess?.results && this._selectedTargetGroup) {
            const existingItems = await this._getExistingItemsInGroup(config, this._selectedTargetGroup);
            processToShow = {
                ...this._currentProcess,
                results: this._currentProcess.results.filter(result => {
                    // Check if this result already exists in the group
                    if (result.type === 'commit' && result.commit) {
                        return !existingItems.commitHashes.has(result.commit.hash);
                    } else if (result.path) {
                        return !existingItems.filePaths.has(result.path);
                    }
                    return true;
                })
            };
        }
        
        // Load feature folders if TaskManager is available
        if (this._taskManager) {
            this._featureFolders = await this._taskManager.getFeatureFolders();
        }
        
        this._panel.webview.html = getWebviewContent(
            webview,
            this._extensionUri,
            processToShow,
            groups,
            this._minScore,
            this._selectedTargetGroup,
            this._extensionFilters,
            this._featureFolders,
            this._destinationType,
            this._selectedFeatureFolder
        );
    }
    
    /**
     * Get existing items in a group (including subgroups)
     */
    private async _getExistingItemsInGroup(
        config: ShortcutsConfig,
        groupPath: string
    ): Promise<{ filePaths: Set<string>; commitHashes: Set<string> }> {
        const filePaths = new Set<string>();
        const commitHashes = new Set<string>();
        
        // Find the group
        const pathParts = groupPath.split('/');
        let currentGroups = config.logicalGroups;
        let targetGroup = currentGroups.find(g => g.name === pathParts[0]);
        
        for (let i = 1; i < pathParts.length && targetGroup; i++) {
            currentGroups = targetGroup.groups || [];
            targetGroup = currentGroups.find(g => g.name === pathParts[i]);
        }
        
        if (!targetGroup) {
            return { filePaths, commitHashes };
        }
        
        // Collect all items from the group and its subgroups
        this._collectItemsFromGroup(targetGroup, filePaths, commitHashes);
        
        return { filePaths, commitHashes };
    }
    
    /**
     * Recursively collect items from a group and its subgroups
     */
    private _collectItemsFromGroup(
        group: LogicalGroup,
        filePaths: Set<string>,
        commitHashes: Set<string>
    ): void {
        // Collect items from this group
        for (const item of group.items) {
            if (item.type === 'commit' && item.commitRef) {
                commitHashes.add(item.commitRef.hash);
            } else if (item.path) {
                filePaths.add(item.path);
            }
        }
        
        // Recursively collect from subgroups
        if (group.groups) {
            for (const subgroup of group.groups) {
                this._collectItemsFromGroup(subgroup, filePaths, commitHashes);
            }
        }
    }
    
    /**
     * Get all group paths (including nested groups)
     */
    private _getGroupPaths(
        groups: Array<{ name: string; groups?: any[] }>,
        prefix: string = ''
    ): string[] {
        const paths: string[] = [];
        
        for (const group of groups) {
            const path = prefix ? `${prefix}/${group.name}` : group.name;
            paths.push(path);
            
            if (group.groups && group.groups.length > 0) {
                paths.push(...this._getGroupPaths(group.groups, path));
            }
        }
        
        return paths;
    }
    
    /**
     * Dispose the panel
     */
    public dispose(): void {
        DiscoveryPreviewPanel.currentPanel = undefined;
        
        this._onDidAddToFeatureFolder.dispose();
        this._messageRouter.dispose();
        this._panel.dispose();
        
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}

