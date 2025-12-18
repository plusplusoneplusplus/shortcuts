import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AIProcessManager, AIProcessTreeDataProvider } from './shortcuts/ai-service';
import { ShortcutsCommands } from './shortcuts/commands';
import { ConfigurationManager } from './shortcuts/configuration-manager';
import { ShortcutsDragDropController } from './shortcuts/drag-drop-controller';
import { FileSystemWatcherManager } from './shortcuts/file-system-watcher-manager';
import { GlobalNotesTreeDataProvider } from './shortcuts/global-notes';
import { KeyboardNavigationHandler } from './shortcuts/keyboard-navigation';
import { LogicalTreeDataProvider } from './shortcuts/logical-tree-data-provider';
import {
    CommentsManager,
    MarkdownCommentsCommands,
    MarkdownCommentsTreeDataProvider,
    PromptGenerator,
    ReviewEditorViewProvider
} from './shortcuts/markdown-comments';
import { NoteDocumentManager } from './shortcuts/global-notes';
import { NotificationManager } from './shortcuts/notification-manager';
import { ThemeManager } from './shortcuts/theme-manager';

/**
 * Get a stable global configuration path when no workspace is open
 */
function getGlobalConfigPath(): string {
    // Use VS Code's global storage path or fallback to home directory
    return path.join(os.homedir(), '.vscode-shortcuts');
}

/**
 * This method is called when your extension is activated
 * Your extension is activated the very first time the command is executed
 */
export async function activate(context: vscode.ExtensionContext) {
    console.log('Shortcuts extension is now active!');

    // Check if we have a workspace folder, use stable directory if none
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const workspaceRoot = workspaceFolder?.uri.fsPath || getGlobalConfigPath();
    console.log(`Initializing shortcuts panel for workspace: ${workspaceRoot}`);

    try {
        // Initialize configuration and theme managers
        const configurationManager = new ConfigurationManager(workspaceRoot, context);
        const themeManager = new ThemeManager();

        // Initialize sync manager
        await configurationManager.initializeSyncManager();

        // Set up file watcher for configuration changes
        const treeDataProvider = new LogicalTreeDataProvider(
            workspaceRoot,
            configurationManager,
            themeManager
        );

        // Set up global notes tree data provider
        const globalNotesTreeDataProvider = new GlobalNotesTreeDataProvider(configurationManager);

        // Set up file system watchers for referenced folders
        const fileSystemWatcherManager = new FileSystemWatcherManager(
            workspaceRoot,
            configurationManager,
            () => {
                treeDataProvider.refresh();
                globalNotesTreeDataProvider.refresh();
            }
        );

        // Initialize file system watchers
        fileSystemWatcherManager.initialize();

        // Initialize theme management with refresh callback
        themeManager.initialize(() => {
            treeDataProvider.refresh();
            globalNotesTreeDataProvider.refresh();
        });

        // Initialize drag and drop controller
        const dragDropController = new ShortcutsDragDropController();

        // Register tree view with drag and drop support
        const treeView = vscode.window.createTreeView('shortcutsView', {
            treeDataProvider: treeDataProvider,
            showCollapseAll: true,
            canSelectMany: true,
            dragAndDropController: dragDropController
        });

        // Register global notes tree view
        const globalNotesTreeView = vscode.window.createTreeView('globalNotesView', {
            treeDataProvider: globalNotesTreeDataProvider,
            showCollapseAll: false
        });

        // Connect refresh callback and configuration manager to drag-drop controller
        dragDropController.setRefreshCallback(() => {
            treeDataProvider.refresh();
        });
        dragDropController.setConfigurationManager(configurationManager);

        // Function to update view descriptions - show config source
        const updateSearchDescriptions = () => {
            // Show which config source is active
            const configInfo = configurationManager.getActiveConfigSource();
            let sourceLabel: string;

            switch (configInfo.source) {
                case 'workspace':
                    sourceLabel = '📁 Workspace';
                    break;
                case 'global':
                    sourceLabel = '🌐 Global';
                    break;
                case 'default':
                    sourceLabel = '⚙️ Default';
                    break;
            }

            treeView.description = sourceLabel;
        };

        // Initial description setup
        updateSearchDescriptions();

        // Watch configuration file for changes
        configurationManager.watchConfigFile(() => {
            treeDataProvider.refresh();
            globalNotesTreeDataProvider.refresh();
            fileSystemWatcherManager.updateWatchers();
            updateSearchDescriptions();
        });

        // Initialize keyboard navigation handler
        const keyboardNavigationHandler = new KeyboardNavigationHandler(treeView, treeDataProvider, 'logical');

        // Initialize note document manager
        const noteDocumentManager = new NoteDocumentManager(configurationManager, context);

        // Initialize command handlers
        const commandsHandler = new ShortcutsCommands(
            treeDataProvider,
            updateSearchDescriptions,
            undefined,
            treeView,
            noteDocumentManager,
            globalNotesTreeDataProvider
        );
        const commandDisposables = commandsHandler.registerCommands(context);

        // Register keyboard help command
        const keyboardHelpCommand = vscode.commands.registerCommand('shortcuts.showKeyboardHelp', () => {
            const helpText = KeyboardNavigationHandler.getKeyboardShortcutsHelp();
            vscode.window.showInformationMessage(
                'Keyboard shortcuts for Shortcuts panel:',
                { modal: true, detail: helpText }
            );
        });

        // Register undo command for drag and drop operations
        const undoMoveCommand = vscode.commands.registerCommand('shortcuts.undoMove', async () => {
            if (dragDropController.canUndo()) {
                await dragDropController.undoLastMove();
            } else {
                vscode.window.showInformationMessage('No move operation to undo.');
            }
        });

        // Initialize Markdown Comments feature
        const commentsManager = new CommentsManager(workspaceRoot);
        await commentsManager.initialize();

        // Initialize AI Process Manager (must be before ReviewEditorViewProvider)
        const aiProcessManager = new AIProcessManager();

        const commentsTreeDataProvider = new MarkdownCommentsTreeDataProvider(commentsManager);
        const promptGenerator = new PromptGenerator(commentsManager);
        const commentsCommands = new MarkdownCommentsCommands(
            commentsManager,
            commentsTreeDataProvider,
            promptGenerator
        );

        // Register the Review Editor View provider for markdown files with comments
        const customEditorDisposable = ReviewEditorViewProvider.register(context, commentsManager, aiProcessManager);

        // Register comments tree view
        const commentsTreeView = vscode.window.createTreeView('markdownCommentsView', {
            treeDataProvider: commentsTreeDataProvider,
            showCollapseAll: true
        });
        commentsCommands.setTreeView(commentsTreeView);

        // Initialize AI Process tree data provider
        const aiProcessTreeDataProvider = new AIProcessTreeDataProvider(aiProcessManager);

        // Register AI processes tree view
        const aiProcessesTreeView = vscode.window.createTreeView('clarificationProcessesView', {
            treeDataProvider: aiProcessTreeDataProvider,
            showCollapseAll: false
        });

        // Update AI processes view description with counts
        const updateProcessesViewDescription = () => {
            const counts = aiProcessManager.getProcessCounts();
            if (counts.running > 0 || counts.completed > 0 || counts.failed > 0) {
                const parts: string[] = [];
                if (counts.running > 0) parts.push(`${counts.running} running`);
                if (counts.completed > 0) parts.push(`${counts.completed} done`);
                if (counts.failed > 0) parts.push(`${counts.failed} failed`);
                aiProcessesTreeView.description = parts.join(', ');
            } else {
                aiProcessesTreeView.description = undefined;
            }
        };
        updateProcessesViewDescription();
        aiProcessManager.onDidChangeProcesses(updateProcessesViewDescription);

        // Register AI process commands
        const cancelProcessCommand = vscode.commands.registerCommand(
            'clarificationProcesses.cancel',
            (item: { process?: { id: string } }) => {
                if (item?.process?.id) {
                    aiProcessManager.cancelProcess(item.process.id);
                }
            }
        );

        const clearCompletedCommand = vscode.commands.registerCommand(
            'clarificationProcesses.clearCompleted',
            () => {
                aiProcessManager.clearCompletedProcesses();
            }
        );

        const refreshProcessesCommand = vscode.commands.registerCommand(
            'clarificationProcesses.refresh',
            () => {
                aiProcessTreeDataProvider.refresh();
            }
        );

        // Update comments view description with count
        const updateCommentsViewDescription = () => {
            const openCount = commentsManager.getOpenCommentCount();
            const resolvedCount = commentsManager.getResolvedCommentCount();
            if (openCount > 0 || resolvedCount > 0) {
                commentsTreeView.description = `${openCount} open, ${resolvedCount} resolved`;
            } else {
                commentsTreeView.description = undefined;
            }
        };
        updateCommentsViewDescription();
        commentsManager.onDidChangeComments(updateCommentsViewDescription);

        // Register markdown comments commands
        const commentsCommandDisposables = commentsCommands.registerCommands(context);

        // Register command to open markdown file with Review Editor View
        const openWithCommentsCommand = vscode.commands.registerCommand(
            'markdownComments.openWithReviewEditor',
            async (uri?: vscode.Uri) => {
                const targetUri = uri || vscode.window.activeTextEditor?.document.uri;
                if (targetUri && targetUri.fsPath.endsWith('.md')) {
                    await vscode.commands.executeCommand(
                        'vscode.openWith',
                        targetUri,
                        ReviewEditorViewProvider.viewType
                    );
                } else {
                    vscode.window.showWarningMessage('Please select a markdown file.');
                }
            }
        );

        // Collect all disposables for proper cleanup
        const disposables: vscode.Disposable[] = [
            treeView,
            globalNotesTreeView,
            treeDataProvider,
            globalNotesTreeDataProvider,
            configurationManager,
            themeManager,
            fileSystemWatcherManager,
            keyboardNavigationHandler,
            noteDocumentManager,
            keyboardHelpCommand,
            undoMoveCommand,
            ...commandDisposables,
            // Markdown Comments disposables
            commentsTreeView,
            commentsManager,
            commentsTreeDataProvider,
            customEditorDisposable,
            openWithCommentsCommand,
            ...commentsCommandDisposables,
            // AI Process disposables
            aiProcessesTreeView,
            aiProcessManager,
            aiProcessTreeDataProvider,
            cancelProcessCommand,
            clearCompletedCommand,
            refreshProcessesCommand
        ];

        // Add all disposables to context subscriptions
        context.subscriptions.push(...disposables);

        console.log('Shortcuts extension activated successfully');

        // Show welcome message on first activation
        const hasShownWelcome = context.globalState.get('shortcuts.hasShownWelcome', false);
        if (!hasShownWelcome) {
            NotificationManager.showInfo(
                'Shortcuts panel is now available! Right-click in the panel to add groups.',
                { timeout: 8000, actions: ['Got it!'] }
            ).then(() => {
                context.globalState.update('shortcuts.hasShownWelcome', true);
            });
        }

    } catch (error) {
        console.error('Error activating shortcuts extension:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Failed to activate shortcuts extension: ${message}`);
    }
}

/**
 * This method is called when your extension is deactivated
 */
export function deactivate() {
    console.log('Shortcuts extension is being deactivated');
    // Cleanup is handled automatically by VSCode through context.subscriptions
    // All registered disposables will be disposed automatically
}
