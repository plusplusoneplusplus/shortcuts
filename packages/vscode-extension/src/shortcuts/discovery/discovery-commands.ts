/**
 * Discovery Commands
 * 
 * Registers and handles commands for the Auto AI Discovery feature.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { AIProcessManager } from '../ai-service';
import { DiscoveryEngine, createDiscoveryRequest } from './discovery-engine';
import { DiscoveryPreviewPanel } from './discovery-webview';
import { ConfigurationManager } from '../configuration-manager';
import { createGitShowUri, GIT_SHOW_SCHEME } from '../git/git-show-text-document-provider';
import { LogicalGroupItem, CommitShortcutItem, CommitFileItem } from '../tree-items';
import { DEFAULT_DISCOVERY_SCOPE, serializeDiscoveryProcess, ExistingGroupSnapshot, ExistingGroupItem } from './types';
import { LogicalGroup, LogicalGroupItem as LogicalGroupItemType } from '../types';
import { getExtensionLogger, LogCategory } from '../shared/extension-logger';

/**
 * Get existing group snapshot from configuration
 */
async function getExistingGroupSnapshot(
    configManager: ConfigurationManager,
    groupPath: string
): Promise<ExistingGroupSnapshot | undefined> {
    try {
        const config = await configManager.loadConfiguration();
        
        // Find the group by path (supports nested groups like "parent/child")
        const pathParts = groupPath.split('/');
        let currentGroups = config.logicalGroups;
        let targetGroup: LogicalGroup | undefined;

        for (const part of pathParts) {
            targetGroup = currentGroups.find(g => g.name === part);
            if (!targetGroup) {
                return undefined;
            }
            currentGroups = targetGroup.groups || [];
        }

        if (!targetGroup) {
            return undefined;
        }

        // Convert group items to ExistingGroupItem format
        const existingItems: ExistingGroupItem[] = [];
        
        for (const item of targetGroup.items) {
            if (item.type === 'file' || item.type === 'folder') {
                if (item.path) {
                    existingItems.push({
                        type: item.type,
                        path: item.path
                    });
                }
            } else if (item.type === 'commit' && item.commitRef) {
                existingItems.push({
                    type: 'commit',
                    commitHash: item.commitRef.hash
                });
            }
        }

        return {
            name: targetGroup.name,
            description: targetGroup.description,
            items: existingItems
        };
    } catch (error) {
        const logger = getExtensionLogger();
        logger.error(LogCategory.DISCOVERY, 'Error getting existing group snapshot', error instanceof Error ? error : new Error(String(error)), {
            groupPath
        });
        return undefined;
    }
}

/**
 * Register discovery commands
 */
export function registerDiscoveryCommands(
    context: vscode.ExtensionContext,
    discoveryEngine: DiscoveryEngine,
    configManager: ConfigurationManager,
    workspaceRoot: string,
    aiProcessManager: AIProcessManager,
    taskManager?: import('../tasks-viewer/task-manager').TaskManager
): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // Start discovery (global)
    disposables.push(
        vscode.commands.registerCommand('shortcuts.discovery.start', async () => {
            await startDiscovery(context, discoveryEngine, configManager, workspaceRoot, aiProcessManager, undefined, undefined, taskManager);
        })
    );

    // Start discovery for a specific group
    disposables.push(
        vscode.commands.registerCommand(
            'shortcuts.discovery.startForGroup',
            async (item: LogicalGroupItem) => {
                const groupPath = item.parentGroupPath
                    ? `${item.parentGroupPath}/${item.originalName}`
                    : item.originalName;

                // Get existing group snapshot for bypassing existing items
                const existingGroupSnapshot = await getExistingGroupSnapshot(configManager, groupPath);

                await startDiscovery(
                    context,
                    discoveryEngine,
                    configManager,
                    workspaceRoot,
                    aiProcessManager,
                    groupPath,
                    existingGroupSnapshot,
                    taskManager
                );
            }
        )
    );
    
    // Open commit in git history
    disposables.push(
        vscode.commands.registerCommand(
            'shortcuts.openCommit',
            async (item: CommitShortcutItem) => {
                await openCommit(item);
            }
        )
    );

    // Open commit file diff
    disposables.push(
        vscode.commands.registerCommand(
            'shortcuts.openCommitFileDiff',
            async (item: CommitFileItem) => {
                await openCommitFileDiff(item);
            }
        )
    );
    
    return disposables;
}

/**
 * Start a discovery process
 */
async function startDiscovery(
    context: vscode.ExtensionContext,
    discoveryEngine: DiscoveryEngine,
    configManager: ConfigurationManager,
    workspaceRoot: string,
    aiProcessManager: AIProcessManager,
    targetGroupPath?: string,
    existingGroupSnapshot?: ExistingGroupSnapshot,
    taskManager?: import('../tasks-viewer/task-manager').TaskManager
): Promise<void> {
    // Check if discovery is enabled
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.discovery');
    const enabled = config.get<boolean>('enabled', false);
    
    if (!enabled) {
        const action = await vscode.window.showWarningMessage(
            'Auto AI Discovery is a preview feature. Enable it in settings?',
            'Enable',
            'Cancel'
        );
        
        if (action === 'Enable') {
            await config.update('enabled', true, vscode.ConfigurationTarget.Global);
        } else {
            return;
        }
    }
    
    // Build default feature description from group name and description if available
    let defaultDescription = '';
    if (existingGroupSnapshot) {
        defaultDescription = existingGroupSnapshot.description 
            ? `${existingGroupSnapshot.name}: ${existingGroupSnapshot.description}`
            : existingGroupSnapshot.name;
    }
    
    // Get feature description from user, pre-filled with group info if available
    const featureDescription = await vscode.window.showInputBox({
        prompt: existingGroupSnapshot 
            ? `Describe the feature for "${existingGroupSnapshot.name}" group`
            : 'Describe the feature you want to find related items for',
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
        placeHolder: 'e.g., auth, jwt, token, login'
    });
    
    const keywords = keywordsInput
        ? keywordsInput.split(',').map(k => k.trim()).filter(k => k)
        : undefined;
    
    // Get scope options
    const scopeOptions = await vscode.window.showQuickPick(
        [
            { label: 'All Files', description: 'Source, docs, and config files', picked: true },
            { label: 'Source Files Only', description: '.ts, .js, .py, etc.' },
            { label: 'Documentation Only', description: '.md, .txt, .rst, etc.' },
            { label: 'Include Git History', description: 'Search commit messages', picked: true }
        ],
        {
            canPickMany: true,
            placeHolder: 'Select what to search'
        }
    );
    
    if (!scopeOptions || scopeOptions.length === 0) {
        return;
    }
    
    // Build scope from selections
    const scope = {
        ...DEFAULT_DISCOVERY_SCOPE,
        includeSourceFiles: scopeOptions.some(o => 
            o.label === 'All Files' || o.label === 'Source Files Only'
        ),
        includeDocs: scopeOptions.some(o => 
            o.label === 'All Files' || o.label === 'Documentation Only'
        ),
        includeConfigFiles: scopeOptions.some(o => o.label === 'All Files'),
        includeGitHistory: scopeOptions.some(o => o.label === 'Include Git History'),
        maxCommits: config.get<number>('maxCommits', 50),
        excludePatterns: config.get<string[]>('excludePatterns', DEFAULT_DISCOVERY_SCOPE.excludePatterns)
    };
    
    // Create discovery request with existing group snapshot if available
    const request = createDiscoveryRequest(featureDescription, workspaceRoot, {
        keywords,
        targetGroupPath,
        scope,
        existingGroupSnapshot
    });

    // Register with AI Process Manager for tracking in the panel
    const aiProcessId = aiProcessManager.registerDiscoveryProcess({
        featureDescription,
        keywords,
        targetGroupPath,
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
            title: 'Discovering related items...',
            cancellable: true
        },
        async (progress, token) => {
            // Set up completion promise BEFORE starting discovery to avoid missing events
            let resolveCompletion: () => void;
            let discoveryProcessId: string | undefined;

            const completionPromise = new Promise<void>((resolve) => {
                resolveCompletion = resolve;
            });

            // Register event listeners BEFORE starting discovery
            const progressListener = discoveryEngine.onDidChangeProcess(event => {
                if (discoveryProcessId && event.process.id === discoveryProcessId) {
                    progress.report({
                        message: `${event.process.phase} (${event.process.progress}%)`,
                        increment: 0
                    });
                }
            });

            const completionListener = discoveryEngine.onDidChangeProcess(event => {
                if (discoveryProcessId &&
                    event.process.id === discoveryProcessId &&
                    event.process.status !== 'running') {

                    completionListener.dispose();
                    progressListener.dispose();

                    // Update AI Process Manager based on discovery result
                    if (event.process.status === 'completed') {
                        const resultCount = event.process.results?.length || 0;
                        // Serialize the discovery process for later viewing
                        const serializedResults = JSON.stringify(serializeDiscoveryProcess(event.process));
                        aiProcessManager.completeDiscoveryProcess(
                            aiProcessId,
                            resultCount,
                            `Found ${resultCount} related items for "${featureDescription}"`,
                            serializedResults
                        );
                    } else if (event.process.status === 'failed') {
                        aiProcessManager.failProcess(aiProcessId, event.process.error || 'Discovery failed');
                    }

                    // Show results panel
                    DiscoveryPreviewPanel.createOrShow(
                        context.extensionUri,
                        discoveryEngine,
                        configManager,
                        event.process,
                        taskManager
                    );

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

            // NOW start discovery - events will be caught by listeners above
            const discoveryProcess = await discoveryEngine.discover(request);
            discoveryProcessId = discoveryProcess.id;

            // If discovery already completed synchronously, handle it
            if (discoveryProcess.status !== 'running') {
                completionListener.dispose();
                progressListener.dispose();

                if (discoveryProcess.status === 'completed') {
                    const resultCount = discoveryProcess.results?.length || 0;
                    // Serialize the discovery process for later viewing
                    const serializedResults = JSON.stringify(serializeDiscoveryProcess(discoveryProcess));
                    aiProcessManager.completeDiscoveryProcess(
                        aiProcessId,
                        resultCount,
                        `Found ${resultCount} related items for "${featureDescription}"`,
                        serializedResults
                    );
                } else if (discoveryProcess.status === 'failed') {
                    aiProcessManager.failProcess(aiProcessId, discoveryProcess.error || 'Discovery failed');
                }

                DiscoveryPreviewPanel.createOrShow(
                    context.extensionUri,
                    discoveryEngine,
                    configManager,
                    discoveryProcess,
                    taskManager
                );

                return;
            }

            // Wait for async completion
            return completionPromise;
        }
    );
}

/**
 * Open a commit in the git history view
 */
async function openCommit(item: CommitShortcutItem): Promise<void> {
    try {
        // Try to use VS Code's built-in git extension to show commit
        const gitExtension = vscode.extensions.getExtension('vscode.git');
        
        if (gitExtension) {
            // Show the commit in the git log
            await vscode.commands.executeCommand(
                'git.viewCommit',
                item.commitHash
            );
        } else {
            // Fallback: show commit hash in a message
            const action = await vscode.window.showInformationMessage(
                `Commit: ${item.shortHash}\n${item.label}`,
                'Copy Hash',
                'View in Terminal'
            );
            
            if (action === 'Copy Hash') {
                await vscode.env.clipboard.writeText(item.commitHash);
                vscode.window.showInformationMessage('Commit hash copied to clipboard');
            } else if (action === 'View in Terminal') {
                const terminal = vscode.window.createTerminal('Git Show');
                terminal.sendText(`cd "${item.repositoryRoot}" && git show ${item.commitHash}`);
                terminal.show();
            }
        }
    } catch (error) {
        const logger = getExtensionLogger();
        logger.error(LogCategory.DISCOVERY, 'Error opening commit', error instanceof Error ? error : new Error(String(error)), {
            commitHash: item.commitHash
        });
        
        // Fallback: copy hash to clipboard
        await vscode.env.clipboard.writeText(item.commitHash);
        vscode.window.showInformationMessage(
            `Commit hash copied: ${item.shortHash}`
        );
    }
}

/**
 * Empty tree hash for git - represents an empty directory/file
 * Used for diffing newly added files (no parent content)
 */
const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * Open a file diff for a commit file item
 * Uses VSCode's built-in diff viewer with git-show URIs
 */
async function openCommitFileDiff(item: CommitFileItem): Promise<void> {
    try {
        const { filePath, commitHash, parentHash, repositoryRoot, status, originalPath } = item;

        // Handle deleted files - show the file content at parent commit vs empty
        if (status === 'D') {
            const leftUri = createGitShowUri(filePath, parentHash, repositoryRoot);
            const rightUri = createGitShowUri(filePath, EMPTY_TREE_HASH, repositoryRoot);
            const title = `${path.basename(filePath)} (deleted in ${commitHash.slice(0, 7)})`;
            await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
            return;
        }

        // Handle added files - show empty vs file content at commit
        if (status === 'A') {
            const leftUri = createGitShowUri(filePath, EMPTY_TREE_HASH, repositoryRoot);
            const rightUri = createGitShowUri(filePath, commitHash, repositoryRoot);
            const title = `${path.basename(filePath)} (added in ${commitHash.slice(0, 7)})`;
            await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
            return;
        }

        // Handle renamed files - show original path at parent vs new path at commit
        if (status === 'R' && originalPath) {
            const leftUri = createGitShowUri(originalPath, parentHash, repositoryRoot);
            const rightUri = createGitShowUri(filePath, commitHash, repositoryRoot);
            const title = `${path.basename(originalPath)} → ${path.basename(filePath)} (${commitHash.slice(0, 7)})`;
            await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
            return;
        }

        // Handle copied files - show original path at parent vs new path at commit
        if (status === 'C' && originalPath) {
            const leftUri = createGitShowUri(originalPath, parentHash, repositoryRoot);
            const rightUri = createGitShowUri(filePath, commitHash, repositoryRoot);
            const title = `${path.basename(originalPath)} → ${path.basename(filePath)} (copied in ${commitHash.slice(0, 7)})`;
            await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
            return;
        }

        // Handle modified files - show file at parent vs file at commit
        const leftUri = createGitShowUri(filePath, parentHash, repositoryRoot);
        const rightUri = createGitShowUri(filePath, commitHash, repositoryRoot);
        const title = `${path.basename(filePath)} (${commitHash.slice(0, 7)})`;

        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
    } catch (error) {
        const logger = getExtensionLogger();
        logger.error(LogCategory.DISCOVERY, 'Error opening commit file diff', error instanceof Error ? error : new Error(String(error)), {
            filePath: item.filePath,
            commitHash: item.commitHash
        });
        vscode.window.showErrorMessage(`Failed to open diff: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

