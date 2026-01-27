/**
 * Discovery Commands for Tasks Viewer
 * 
 * Handles AI Discovery integration for feature folders in the Tasks Viewer.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskManager } from './task-manager';
import { TasksTreeDataProvider } from './tree-data-provider';
import { TaskFolderItem } from './task-folder-item';
import { RelatedItemsSectionItem, RelatedFileItem, RelatedCommitItem } from './related-items-tree-items';
import { 
    saveRelatedItems, 
    deleteRelatedItems, 
    removeRelatedItem, 
    mergeRelatedItems,
    getRelatedItemsPath,
    loadRelatedItems,
    categorizeItem
} from './related-items-loader';
import { RelatedItem, RelatedItemsConfig } from './types';
import { DiscoveryEngine, createDiscoveryRequest } from '../discovery/discovery-engine';
import { DiscoveryPreviewPanel } from '../discovery/discovery-webview';
import { AIProcessManager } from '../ai-service';
import { DEFAULT_DISCOVERY_SCOPE, serializeDiscoveryProcess, DiscoveryResult } from '../discovery/types';
import { getExtensionLogger, LogCategory } from '../shared/extension-logger';

const logger = getExtensionLogger();

/**
 * Register discovery commands for the Tasks Viewer
 */
export function registerTasksDiscoveryCommands(
    context: vscode.ExtensionContext,
    taskManager: TaskManager,
    treeDataProvider: TasksTreeDataProvider,
    discoveryEngine: DiscoveryEngine,
    aiProcessManager: AIProcessManager
): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // Discover related items for a feature folder
    disposables.push(
        vscode.commands.registerCommand(
            'tasksViewer.discoverRelated',
            async (item: TaskFolderItem) => {
                await discoverRelatedItems(
                    context,
                    taskManager,
                    treeDataProvider,
                    discoveryEngine,
                    aiProcessManager,
                    item
                );
            }
        )
    );

    // Re-discover related items (merge or replace)
    disposables.push(
        vscode.commands.registerCommand(
            'tasksViewer.rediscoverRelated',
            async (item: TaskFolderItem | RelatedItemsSectionItem) => {
                const folderPath = item instanceof TaskFolderItem ? item.folder.folderPath : item.folderPath;
                const folderItem = item instanceof TaskFolderItem ? item : undefined;
                
                // Ask whether to merge or replace
                const action = await vscode.window.showQuickPick(
                    [
                        { label: 'Merge', description: 'Add new items, keep existing (deduplicate)' },
                        { label: 'Replace', description: 'Overwrite with new results' },
                        { label: 'Cancel', description: 'Keep existing file' }
                    ],
                    { 
                        placeHolder: 'Existing related items found. What would you like to do?',
                        title: 'Re-discover Related Items'
                    }
                );

                if (!action || action.label === 'Cancel') {
                    return;
                }

                const merge = action.label === 'Merge';
                await discoverRelatedItems(
                    context,
                    taskManager,
                    treeDataProvider,
                    discoveryEngine,
                    aiProcessManager,
                    folderItem,
                    folderPath,
                    merge
                );
            }
        )
    );

    // Clear related items (delete related.yaml)
    disposables.push(
        vscode.commands.registerCommand(
            'tasksViewer.clearRelated',
            async (item: RelatedItemsSectionItem) => {
                const confirm = await vscode.window.showWarningMessage(
                    `Clear all related items for this feature?`,
                    { modal: true },
                    'Clear'
                );

                if (confirm !== 'Clear') {
                    return;
                }

                try {
                    await deleteRelatedItems(item.folderPath);
                    treeDataProvider.refresh();
                    vscode.window.showInformationMessage('Related items cleared');
                } catch (error) {
                    logger.error(LogCategory.TASKS, 'Error clearing related items', error instanceof Error ? error : new Error(String(error)));
                    vscode.window.showErrorMessage('Failed to clear related items');
                }
            }
        )
    );

    // Edit related.yaml
    disposables.push(
        vscode.commands.registerCommand(
            'tasksViewer.editRelated',
            async (item: RelatedItemsSectionItem) => {
                const filePath = getRelatedItemsPath(item.folderPath);
                const uri = vscode.Uri.file(filePath);
                await vscode.window.showTextDocument(uri);
            }
        )
    );

    // Remove single related item
    disposables.push(
        vscode.commands.registerCommand(
            'tasksViewer.removeRelatedItem',
            async (item: RelatedFileItem | RelatedCommitItem) => {
                const itemPath = item.relatedItem.type === 'file' 
                    ? item.relatedItem.path 
                    : item.relatedItem.hash;

                if (!itemPath) {
                    return;
                }

                try {
                    const removed = await removeRelatedItem(item.folderPath, itemPath);
                    if (removed) {
                        treeDataProvider.refresh();
                        vscode.window.showInformationMessage('Item removed from related items');
                    }
                } catch (error) {
                    logger.error(LogCategory.TASKS, 'Error removing related item', error instanceof Error ? error : new Error(String(error)));
                    vscode.window.showErrorMessage('Failed to remove related item');
                }
            }
        )
    );

    // View related commit
    disposables.push(
        vscode.commands.registerCommand(
            'tasksViewer.viewRelatedCommit',
            async (commitHash: string, repositoryRoot: string) => {
                try {
                    // Try to use VS Code's built-in git extension
                    await vscode.commands.executeCommand('git.viewCommit', commitHash);
                } catch {
                    // Fallback: copy hash to clipboard
                    await vscode.env.clipboard.writeText(commitHash);
                    const action = await vscode.window.showInformationMessage(
                        `Commit hash copied: ${commitHash.substring(0, 7)}`,
                        'View in Terminal'
                    );
                    if (action === 'View in Terminal') {
                        const terminal = vscode.window.createTerminal('Git Show');
                        terminal.sendText(`cd "${repositoryRoot}" && git show ${commitHash}`);
                        terminal.show();
                    }
                }
            }
        )
    );

    return disposables;
}

/**
 * Start discovery for a feature folder
 */
async function discoverRelatedItems(
    context: vscode.ExtensionContext,
    taskManager: TaskManager,
    treeDataProvider: TasksTreeDataProvider,
    discoveryEngine: DiscoveryEngine,
    aiProcessManager: AIProcessManager,
    folderItem?: TaskFolderItem,
    overrideFolderPath?: string,
    mergeWithExisting: boolean = false
): Promise<void> {
    const folderPath = overrideFolderPath || folderItem?.folder.folderPath;
    if (!folderPath) {
        return;
    }

    const folderName = path.basename(folderPath);
    const workspaceRoot = taskManager.getWorkspaceRoot();
    const settings = taskManager.getSettings();

    // Check if discovery is enabled
    if (!settings.discovery.enabled) {
        const action = await vscode.window.showWarningMessage(
            'AI Discovery for Tasks is disabled. Enable it in settings?',
            'Enable',
            'Cancel'
        );
        
        if (action === 'Enable') {
            await vscode.workspace.getConfiguration('workspaceShortcuts.tasksViewer.discovery')
                .update('enabled', true, vscode.ConfigurationTarget.Global);
        } else {
            return;
        }
    }

    // Check for existing related.yaml if not merging
    if (!mergeWithExisting) {
        const existing = await loadRelatedItems(folderPath);
        if (existing && existing.items.length > 0) {
            const action = await vscode.window.showQuickPick(
                [
                    { label: 'Merge', description: 'Add new items, keep existing (deduplicate)' },
                    { label: 'Replace', description: 'Overwrite with new results' },
                    { label: 'Cancel', description: 'Keep existing file' }
                ],
                { 
                    placeHolder: 'Existing related items found. What would you like to do?',
                    title: 'Discover Related Items'
                }
            );

            if (!action || action.label === 'Cancel') {
                return;
            }
            mergeWithExisting = action.label === 'Merge';
        }
    }

    // Extract description from task files in the folder
    const defaultDescription = await extractFeatureDescription(folderPath, folderName);

    // Get feature description from user
    const featureDescription = await vscode.window.showInputBox({
        prompt: `Describe the feature for "${folderName}"`,
        placeHolder: 'e.g., "user authentication with JWT tokens"',
        value: defaultDescription,
        validateInput: (value) => {
            if (!value || value.trim().length < 3) {
                return 'Please enter a description (at least 3 characters)';
            }
            return undefined;
        }
    });

    if (!featureDescription) {
        return;
    }

    // Get optional keywords
    const keywordsInput = await vscode.window.showInputBox({
        prompt: 'Optional: Add specific keywords (comma-separated)',
        placeHolder: `e.g., ${folderName}, api, service`
    });

    const keywords = keywordsInput
        ? keywordsInput.split(',').map(k => k.trim()).filter(k => k)
        : undefined;

    // Build scope from settings
    const { defaultScope } = settings.discovery;
    const scope = {
        ...DEFAULT_DISCOVERY_SCOPE,
        includeSourceFiles: defaultScope.includeSourceFiles,
        includeDocs: defaultScope.includeDocs,
        includeConfigFiles: defaultScope.includeConfigFiles,
        includeGitHistory: defaultScope.includeGitHistory,
        maxCommits: defaultScope.maxCommits
    };

    // Create discovery request
    const request = createDiscoveryRequest(featureDescription, workspaceRoot, {
        keywords,
        scope
    });

    // Register with AI Process Manager
    const aiProcessId = aiProcessManager.registerDiscoveryProcess({
        featureDescription,
        keywords,
        targetGroupPath: `tasks/${folderName}`,
        scope: {
            includeSourceFiles: scope.includeSourceFiles,
            includeDocs: scope.includeDocs,
            includeConfigFiles: scope.includeConfigFiles,
            includeGitHistory: scope.includeGitHistory
        }
    });

    // Show progress notification
    vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Discovering related items for "${folderName}"...`,
            cancellable: true
        },
        async (progress, token) => {
            let resolveCompletion: () => void;
            let discoveryProcessId: string | undefined;

            const completionPromise = new Promise<void>((resolve) => {
                resolveCompletion = resolve;
            });

            // Register event listeners
            const progressListener = discoveryEngine.onDidChangeProcess(event => {
                if (discoveryProcessId && event.process.id === discoveryProcessId) {
                    progress.report({
                        message: `${event.process.phase} (${event.process.progress}%)`,
                        increment: 0
                    });
                }
            });

            const completionListener = discoveryEngine.onDidChangeProcess(async event => {
                if (discoveryProcessId &&
                    event.process.id === discoveryProcessId &&
                    event.process.status !== 'running') {

                    completionListener.dispose();
                    progressListener.dispose();

                    if (event.process.status === 'completed' && event.process.results) {
                        // Convert discovery results to related items
                        const relatedItems = convertDiscoveryResultsToRelatedItems(
                            event.process.results,
                            workspaceRoot
                        );

                        // Save to related.yaml
                        if (mergeWithExisting) {
                            await mergeRelatedItems(folderPath, relatedItems, featureDescription);
                        } else {
                            const config: RelatedItemsConfig = {
                                description: featureDescription,
                                items: relatedItems
                            };
                            await saveRelatedItems(folderPath, config);
                        }

                        // Update AI Process Manager
                        const resultCount = relatedItems.length;
                        const serializedResults = JSON.stringify(serializeDiscoveryProcess(event.process));
                        aiProcessManager.completeDiscoveryProcess(
                            aiProcessId,
                            resultCount,
                            `Found ${resultCount} related items for "${folderName}"`,
                            serializedResults
                        );

                        // Refresh tree view
                        treeDataProvider.refresh();

                        vscode.window.showInformationMessage(
                            `Found ${resultCount} related items for "${folderName}"`
                        );
                    } else if (event.process.status === 'failed') {
                        aiProcessManager.failProcess(aiProcessId, event.process.error || 'Discovery failed');
                        vscode.window.showErrorMessage(
                            `Discovery failed: ${event.process.error || 'Unknown error'}`
                        );
                    }

                    resolveCompletion();
                }
            });

            // Listen for cancellation
            token.onCancellationRequested(() => {
                if (discoveryProcessId) {
                    discoveryEngine.cancelProcess(discoveryProcessId);
                }
                aiProcessManager.updateProcess(aiProcessId, 'cancelled', undefined, 'Cancelled by user');
                completionListener.dispose();
                progressListener.dispose();
                resolveCompletion();
            });

            // Start discovery
            const discoveryProcess = await discoveryEngine.discover(request);
            discoveryProcessId = discoveryProcess.id;

            // If discovery completed synchronously
            if (discoveryProcess.status !== 'running') {
                completionListener.dispose();
                progressListener.dispose();

                if (discoveryProcess.status === 'completed' && discoveryProcess.results) {
                    const relatedItems = convertDiscoveryResultsToRelatedItems(
                        discoveryProcess.results,
                        workspaceRoot
                    );

                    if (mergeWithExisting) {
                        await mergeRelatedItems(folderPath, relatedItems, featureDescription);
                    } else {
                        const config: RelatedItemsConfig = {
                            description: featureDescription,
                            items: relatedItems
                        };
                        await saveRelatedItems(folderPath, config);
                    }

                    const resultCount = relatedItems.length;
                    const serializedResults = JSON.stringify(serializeDiscoveryProcess(discoveryProcess));
                    aiProcessManager.completeDiscoveryProcess(
                        aiProcessId,
                        resultCount,
                        `Found ${resultCount} related items for "${folderName}"`,
                        serializedResults
                    );

                    treeDataProvider.refresh();
                    vscode.window.showInformationMessage(
                        `Found ${resultCount} related items for "${folderName}"`
                    );
                } else if (discoveryProcess.status === 'failed') {
                    aiProcessManager.failProcess(aiProcessId, discoveryProcess.error || 'Discovery failed');
                }

                return;
            }

            return completionPromise;
        }
    );
}

/**
 * Extract feature description from task files in a folder
 */
async function extractFeatureDescription(folderPath: string, folderName: string): Promise<string> {
    try {
        // Look for common task files that might have description
        const candidateFiles = ['plan.md', 'spec.md', 'readme.md', 'meta.md'];
        
        for (const fileName of candidateFiles) {
            const filePath = path.join(folderPath, fileName);
            if (fs.existsSync(filePath)) {
                const content = await fs.promises.readFile(filePath, 'utf-8');
                // Extract first non-empty line that's not a header marker
                const lines = content.split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    // Skip empty lines and pure header markers
                    if (!trimmed || trimmed === '#' || trimmed === '##') {
                        continue;
                    }
                    // Extract text from header
                    if (trimmed.startsWith('#')) {
                        return trimmed.replace(/^#+\s*/, '');
                    }
                    // Use first non-header line
                    if (trimmed.length > 3) {
                        return trimmed.substring(0, 100);
                    }
                }
            }
        }

        // Also check for files with folder name prefix
        const prefixedFiles = await fs.promises.readdir(folderPath);
        for (const file of prefixedFiles) {
            if (file.toLowerCase().startsWith(folderName.toLowerCase()) && file.endsWith('.md')) {
                const filePath = path.join(folderPath, file);
                const content = await fs.promises.readFile(filePath, 'utf-8');
                const lines = content.split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('#')) {
                        return trimmed.replace(/^#+\s*/, '');
                    }
                }
            }
        }
    } catch (error) {
        // Ignore errors, fall back to folder name
    }

    // Default to folder name
    return folderName;
}

/**
 * Convert discovery results to related items format
 */
function convertDiscoveryResultsToRelatedItems(
    results: DiscoveryResult[],
    workspaceRoot: string
): RelatedItem[] {
    // Filter to only selected items
    const selectedResults = results.filter(r => r.selected);

    return selectedResults.map(result => {
        const item: RelatedItem = {
            name: result.name,
            type: result.type === 'commit' ? 'commit' : 'file',
            category: getCategory(result),
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
function getCategory(result: DiscoveryResult): 'source' | 'test' | 'doc' | 'config' | 'commit' {
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
