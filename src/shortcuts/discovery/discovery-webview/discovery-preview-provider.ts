/**
 * Discovery Preview Provider
 * 
 * Webview panel for displaying and managing discovery results.
 */

import * as vscode from 'vscode';
import { DiscoveryProcess, DiscoveryResult } from '../types';
import { LogicalGroupItem } from '../../types';
import { DiscoveryEngine } from '../discovery-engine';
import { getWebviewContent, WebviewMessage } from './webview-content';
import { ConfigurationManager } from '../../configuration-manager';

/**
 * Discovery Preview Panel
 * Manages the webview panel for discovery results
 */
export class DiscoveryPreviewPanel {
    public static currentPanel: DiscoveryPreviewPanel | undefined;
    public static readonly viewType = 'discoveryPreview';
    
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _discoveryEngine: DiscoveryEngine;
    private readonly _configManager: ConfigurationManager;
    
    private _currentProcess: DiscoveryProcess | undefined;
    private _minScore: number = 30;
    private _disposables: vscode.Disposable[] = [];
    
    /**
     * Create or show the discovery preview panel
     */
    public static createOrShow(
        extensionUri: vscode.Uri,
        discoveryEngine: DiscoveryEngine,
        configManager: ConfigurationManager,
        process?: DiscoveryProcess
    ): DiscoveryPreviewPanel {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        
        // If we already have a panel, show it
        if (DiscoveryPreviewPanel.currentPanel) {
            DiscoveryPreviewPanel.currentPanel._panel.reveal(column);
            if (process) {
                DiscoveryPreviewPanel.currentPanel.setProcess(process);
            }
            return DiscoveryPreviewPanel.currentPanel;
        }
        
        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            DiscoveryPreviewPanel.viewType,
            'Discovery Results',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media')
                ]
            }
        );
        
        DiscoveryPreviewPanel.currentPanel = new DiscoveryPreviewPanel(
            panel,
            extensionUri,
            discoveryEngine,
            configManager,
            process
        );
        
        return DiscoveryPreviewPanel.currentPanel;
    }
    
    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        discoveryEngine: DiscoveryEngine,
        configManager: ConfigurationManager,
        process?: DiscoveryProcess
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._discoveryEngine = discoveryEngine;
        this._configManager = configManager;
        this._currentProcess = process;
        
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
        
        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => this._handleMessage(message),
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
     * Set the current discovery process
     */
    public setProcess(process: DiscoveryProcess): void {
        this._currentProcess = process;
        this._update();
    }
    
    /**
     * Handle messages from the webview
     */
    private async _handleMessage(message: WebviewMessage): Promise<void> {
        switch (message.type) {
            case 'toggleItem':
                this._toggleItem(message.payload.id);
                break;
            
            case 'selectAll':
                this._selectAll();
                break;
            
            case 'deselectAll':
                this._deselectAll();
                break;
            
            case 'addToGroup':
                await this._addToGroup(message.payload.targetGroup);
                break;
            
            case 'filterByScore':
                this._minScore = message.payload.minScore;
                this._update();
                break;
            
            case 'refresh':
                this._update();
                break;
            
            case 'cancel':
                if (this._currentProcess) {
                    this._discoveryEngine.cancelProcess(this._currentProcess.id);
                }
                break;
        }
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
     * Add selected results to a logical group
     */
    private async _addToGroup(targetGroup: string): Promise<void> {
        if (!this._currentProcess?.results || !targetGroup) {
            vscode.window.showWarningMessage('Please select a target group');
            return;
        }
        
        const selectedResults = this._currentProcess.results.filter(r => r.selected);
        if (selectedResults.length === 0) {
            vscode.window.showWarningMessage('No items selected');
            return;
        }
        
        try {
            // Add each selected result to the group
            let addedCount = 0;
            
            for (const result of selectedResults) {
                try {
                    if (result.type === 'commit' && result.commit) {
                        // Add commit to group
                        await this._addCommitToGroup(targetGroup, result);
                        addedCount++;
                    } else if (result.path) {
                        // Add file/folder to group
                        const itemType = result.type === 'folder' ? 'folder' : 'file';
                        await this._configManager.addToLogicalGroup(
                            targetGroup,
                            result.path,
                            result.name,
                            itemType
                        );
                        addedCount++;
                    }
                } catch (error) {
                    console.error(`Failed to add ${result.name} to group:`, error);
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
            console.log('Commit already exists in group');
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
        
        this._panel.webview.html = getWebviewContent(
            webview,
            this._extensionUri,
            this._currentProcess,
            groups,
            this._minScore
        );
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
        
        this._panel.dispose();
        
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}

