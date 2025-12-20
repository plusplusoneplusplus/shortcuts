import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AIProcessManager, AIProcessTreeDataProvider } from './shortcuts/ai-service';
import { ShortcutsCommands } from './shortcuts/commands';
import { ConfigurationManager } from './shortcuts/configuration-manager';
import { ShortcutsDragDropController } from './shortcuts/drag-drop-controller';
import { FileSystemWatcherManager } from './shortcuts/file-system-watcher-manager';
import { GitTreeDataProvider, GitCommitItem, GitCommitFile } from './shortcuts/git';
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
import { DiffCommentFileItem, DiffCommentItem, DiffCommentsManager, DiffReviewEditorProvider } from './shortcuts/git-diff-comments';
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
 * Empty tree hash for git - represents an empty directory/file
 * Used for diffing newly added files (no parent content) or deleted files
 */
const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * Create a Git URI for accessing file content at a specific commit
 * Uses VSCode's Git extension URI scheme
 * @param filePath Relative file path within the repository
 * @param ref Git reference (commit hash)
 * @param repoRoot Repository root path
 * @returns VSCode Uri for the file at the specified commit
 */
function toGitUri(filePath: string, ref: string, repoRoot: string): vscode.Uri {
    // Construct the absolute path
    const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(repoRoot, filePath);

    // Create the query parameters for the git URI
    const params = {
        path: absolutePath,
        ref: ref
    };

    // Return the git URI
    return vscode.Uri.parse(`git:${absolutePath}?${JSON.stringify(params)}`);
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

        // Initialize Git Diff Comments feature (must be before git tree provider)
        const diffCommentsManager = new DiffCommentsManager(workspaceRoot);
        await diffCommentsManager.initialize();

        // Initialize Git tree data provider (unified Changes + Commits + Comments view)
        const gitTreeDataProvider = new GitTreeDataProvider();
        gitTreeDataProvider.setDiffCommentsManager(diffCommentsManager);
        const gitInitialized = await gitTreeDataProvider.initialize();

        let gitTreeView: vscode.TreeView<vscode.TreeItem> | undefined;
        let gitRefreshCommand: vscode.Disposable | undefined;
        let gitOpenScmCommand: vscode.Disposable | undefined;
        let gitLoadMoreCommand: vscode.Disposable | undefined;
        let gitCopyHashCommand: vscode.Disposable | undefined;
        let gitCopyToClipboardCommand: vscode.Disposable | undefined;
        let gitOpenFileDiffCommand: vscode.Disposable | undefined;
        let gitDiffCommentsGoToCommand: vscode.Disposable | undefined;
        let gitDiffCommentsOpenFileCommand: vscode.Disposable | undefined;
        let gitDiffCommentsDeleteCommand: vscode.Disposable | undefined;
        let gitDiffCommentsResolveCommand: vscode.Disposable | undefined;
        let gitDiffCommentsReopenCommand: vscode.Disposable | undefined;

        if (gitInitialized) {
            gitTreeView = vscode.window.createTreeView('gitView', {
                treeDataProvider: gitTreeDataProvider,
                showCollapseAll: true
            });

            // Update view description with combined counts
            const updateGitViewDescription = () => {
                const counts = gitTreeDataProvider.getViewCounts();
                const parts: string[] = [];
                
                // Changes summary
                if (counts.changes.total > 0) {
                    parts.push(`${counts.changes.total} change${counts.changes.total === 1 ? '' : 's'}`);
                }
                
                // Commits summary
                if (counts.commitCount > 0) {
                    const commitText = counts.hasMoreCommits 
                        ? `${counts.commitCount}+ commits` 
                        : `${counts.commitCount} commit${counts.commitCount === 1 ? '' : 's'}`;
                    parts.push(commitText);
                }

                // Comments summary
                if (counts.comments.total > 0) {
                    parts.push(`${counts.comments.open} comment${counts.comments.open === 1 ? '' : 's'}`);
                }
                
                gitTreeView!.description = parts.length > 0 ? parts.join(', ') : undefined;
            };
            updateGitViewDescription();
            gitTreeDataProvider.onDidChangeTreeData(updateGitViewDescription);

            // Register git view commands
            gitRefreshCommand = vscode.commands.registerCommand('gitView.refresh', () => {
                gitTreeDataProvider.refresh();
            });

            gitOpenScmCommand = vscode.commands.registerCommand('gitView.openInScm', () => {
                vscode.commands.executeCommand('workbench.view.scm');
            });

            gitLoadMoreCommand = vscode.commands.registerCommand('gitView.loadMoreCommits', async (count?: number) => {
                await gitTreeDataProvider.loadMoreCommits(count);
            });

            gitCopyHashCommand = vscode.commands.registerCommand('gitView.copyCommitHash', async (itemOrHash?: GitCommitItem | string) => {
                // Handle both GitCommitItem (from context menu) and string (from tooltip link)
                let hash: string | undefined;
                if (typeof itemOrHash === 'string') {
                    hash = itemOrHash;
                } else if (itemOrHash?.commit?.hash) {
                    hash = itemOrHash.commit.hash;
                }
                if (hash) {
                    await gitTreeDataProvider.copyCommitHash(hash);
                }
            });

            // Generic copy to clipboard command for tooltip links
            gitCopyToClipboardCommand = vscode.commands.registerCommand('gitView.copyToClipboard', async (text?: string) => {
                if (text) {
                    await vscode.env.clipboard.writeText(text);
                    vscode.window.showInformationMessage(`Copied to clipboard`);
                }
            });

            // Register command to open commit file diff
            gitOpenFileDiffCommand = vscode.commands.registerCommand(
                'gitView.openCommitFileDiff',
                async (file: GitCommitFile) => {
                    if (!file) {
                        return;
                    }

                    try {
                        const fileName = file.path.split('/').pop() || file.path;
                        const shortHash = file.commitHash.slice(0, 7);

                        // Handle different file statuses
                        if (file.status === 'added') {
                            // For newly added files, show the file content at the commit
                            // Left side is empty (file didn't exist), right side is the new file
                            const rightUri = toGitUri(
                                file.path,
                                file.commitHash,
                                file.repositoryRoot
                            );
                            const emptyUri = toGitUri(
                                file.path,
                                EMPTY_TREE_HASH,
                                file.repositoryRoot
                            );
                            const title = `${fileName} (${shortHash}) [Added]`;
                            await vscode.commands.executeCommand('vscode.diff', emptyUri, rightUri, title);
                        } else if (file.status === 'deleted') {
                            // For deleted files, show the file content at the parent
                            // Left side is the old file, right side is empty (file was deleted)
                            const leftUri = toGitUri(
                                file.path,
                                file.parentHash,
                                file.repositoryRoot
                            );
                            const emptyUri = toGitUri(
                                file.path,
                                file.commitHash,
                                file.repositoryRoot
                            );
                            const title = `${fileName} (${shortHash}) [Deleted]`;
                            await vscode.commands.executeCommand('vscode.diff', leftUri, emptyUri, title);
                        } else {
                            // For modified, renamed, copied files - standard diff
                            const leftUri = toGitUri(
                                file.originalPath || file.path,
                                file.parentHash,
                                file.repositoryRoot
                            );
                            const rightUri = toGitUri(
                                file.path,
                                file.commitHash,
                                file.repositoryRoot
                            );
                            const title = `${fileName} (${shortHash})`;
                            await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
                        }
                    } catch (error) {
                        console.error('Failed to open commit file diff:', error);
                        vscode.window.showErrorMessage('Failed to open diff view');
                    }
                }
            );

            // Register git diff comments tree view commands
            gitDiffCommentsGoToCommand = vscode.commands.registerCommand(
                'gitDiffComments.goToComment',
                async (item: DiffCommentItem) => {
                    if (item?.comment) {
                        // Open the diff review for this file and navigate to the comment
                        const gitService = gitTreeDataProvider['gitService'];
                        const repoRoot = gitService?.getFirstRepositoryRoot();
                        if (repoRoot) {
                            // Create a synthetic git change item to open the diff review
                            await vscode.commands.executeCommand('gitDiffComments.openWithReview', {
                                change: {
                                    path: item.absoluteFilePath,
                                    stage: item.comment.gitContext.wasStaged ? 'staged' : 'unstaged',
                                    repositoryRoot: item.comment.gitContext.repositoryRoot,
                                    repositoryName: item.comment.gitContext.repositoryName
                                }
                            });
                        }
                    }
                }
            );

            gitDiffCommentsOpenFileCommand = vscode.commands.registerCommand(
                'gitDiffComments.openFileWithReview',
                async (item: DiffCommentFileItem) => {
                    if (item?.filePath) {
                        const gitService = gitTreeDataProvider['gitService'];
                        const repoRoot = gitService?.getFirstRepositoryRoot();
                        if (repoRoot && item.gitContext) {
                            // Create a synthetic git change item to open the diff review
                            await vscode.commands.executeCommand('gitDiffComments.openWithReview', {
                                change: {
                                    path: item.filePath,
                                    stage: item.gitContext.wasStaged ? 'staged' : 'unstaged',
                                    repositoryRoot: item.gitContext.repositoryRoot,
                                    repositoryName: item.gitContext.repositoryName
                                }
                            });
                        }
                    }
                }
            );

            gitDiffCommentsDeleteCommand = vscode.commands.registerCommand(
                'gitDiffComments.deleteComment',
                async (item: DiffCommentItem) => {
                    if (item?.comment?.id) {
                        const confirmed = await vscode.window.showWarningMessage(
                            'Are you sure you want to delete this comment?',
                            { modal: true },
                            'Delete'
                        );
                        if (confirmed === 'Delete') {
                            await diffCommentsManager.deleteComment(item.comment.id);
                        }
                    }
                }
            );

            gitDiffCommentsResolveCommand = vscode.commands.registerCommand(
                'gitDiffComments.resolveComment',
                async (item: DiffCommentItem) => {
                    if (item?.comment?.id) {
                        await diffCommentsManager.updateComment(item.comment.id, { status: 'resolved' });
                    }
                }
            );

            gitDiffCommentsReopenCommand = vscode.commands.registerCommand(
                'gitDiffComments.reopenComment',
                async (item: DiffCommentItem) => {
                    if (item?.comment?.id) {
                        await diffCommentsManager.updateComment(item.comment.id, { status: 'open' });
                    }
                }
            );

            console.log('Git view initialized successfully');
        } else {
            console.log('Git extension not available, Git view disabled');
        }

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

        // Register diff review commands (diffCommentsManager already initialized above)
        const diffReviewCommands = DiffReviewEditorProvider.registerCommands(context, diffCommentsManager);

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
            refreshProcessesCommand,
            // Git view disposables
            gitTreeDataProvider,
            // Git Diff Comments disposables
            diffCommentsManager,
            ...diffReviewCommands
        ];

        // Add optional git disposables if git extension is available
        if (gitTreeView) disposables.push(gitTreeView);
        if (gitRefreshCommand) disposables.push(gitRefreshCommand);
        if (gitOpenScmCommand) disposables.push(gitOpenScmCommand);
        if (gitLoadMoreCommand) disposables.push(gitLoadMoreCommand);
        if (gitCopyHashCommand) disposables.push(gitCopyHashCommand);
        if (gitCopyToClipboardCommand) disposables.push(gitCopyToClipboardCommand);
        if (gitOpenFileDiffCommand) disposables.push(gitOpenFileDiffCommand);
        if (gitDiffCommentsGoToCommand) disposables.push(gitDiffCommentsGoToCommand);
        if (gitDiffCommentsOpenFileCommand) disposables.push(gitDiffCommentsOpenFileCommand);
        if (gitDiffCommentsDeleteCommand) disposables.push(gitDiffCommentsDeleteCommand);
        if (gitDiffCommentsResolveCommand) disposables.push(gitDiffCommentsResolveCommand);
        if (gitDiffCommentsReopenCommand) disposables.push(gitDiffCommentsReopenCommand);

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
