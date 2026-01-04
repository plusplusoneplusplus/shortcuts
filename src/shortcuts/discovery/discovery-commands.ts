/**
 * Discovery Commands
 * 
 * Registers and handles commands for the Auto AI Discovery feature.
 */

import * as vscode from 'vscode';
import { AIProcessManager } from '../ai-service';
import { DiscoveryEngine, createDiscoveryRequest } from './discovery-engine';
import { DiscoveryPreviewPanel } from './discovery-webview';
import { ConfigurationManager } from '../configuration-manager';
import { LogicalGroupItem, CommitShortcutItem } from '../tree-items';
import { DEFAULT_DISCOVERY_SCOPE, serializeDiscoveryProcess } from './types';

/**
 * Register discovery commands
 */
export function registerDiscoveryCommands(
    context: vscode.ExtensionContext,
    discoveryEngine: DiscoveryEngine,
    configManager: ConfigurationManager,
    workspaceRoot: string,
    aiProcessManager: AIProcessManager
): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // Start discovery (global)
    disposables.push(
        vscode.commands.registerCommand('shortcuts.discovery.start', async () => {
            await startDiscovery(context, discoveryEngine, configManager, workspaceRoot, aiProcessManager);
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

                await startDiscovery(
                    context,
                    discoveryEngine,
                    configManager,
                    workspaceRoot,
                    aiProcessManager,
                    groupPath
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
    targetGroupPath?: string
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
    
    // Get feature description from user
    const featureDescription = await vscode.window.showInputBox({
        prompt: 'Describe the feature you want to find related items for',
        placeHolder: 'e.g., "user authentication with JWT tokens"',
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
    
    // Create discovery request
    const request = createDiscoveryRequest(featureDescription, workspaceRoot, {
        keywords,
        targetGroupPath,
        scope
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
                        event.process
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
                    discoveryProcess
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
        console.error('Error opening commit:', error);
        
        // Fallback: copy hash to clipboard
        await vscode.env.clipboard.writeText(item.commitHash);
        vscode.window.showInformationMessage(
            `Commit hash copied: ${item.shortHash}`
        );
    }
}

