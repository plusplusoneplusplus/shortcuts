import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AI_PROCESS_SCHEME, AIProcessDocumentProvider, AIProcessManager, AIProcessTreeDataProvider } from './shortcuts/ai-service';
import { registerCodeReviewCommands } from './shortcuts/code-review';
import { ShortcutsCommands } from './shortcuts/commands';
import { ConfigurationManager } from './shortcuts/configuration-manager';
import { DiscoveryEngine, registerDiscoveryCommands } from './shortcuts/discovery';
import { ShortcutsDragDropController } from './shortcuts/drag-drop-controller';
import { FileSystemWatcherManager } from './shortcuts/file-system-watcher-manager';
import { GitChangeItem, GitCommitFile, GitCommitItem, GitDragDropController, GitLogService, GitTreeDataProvider, LookedUpCommitItem } from './shortcuts/git';
import {
    DiffCommentFileItem,
    DiffCommentItem,
    DiffCommentsCommands,
    DiffCommentsManager,
    DiffReviewEditorProvider
} from './shortcuts/git-diff-comments';
import { GlobalNotesTreeDataProvider, NoteDocumentManager } from './shortcuts/global-notes';
import { TaskManager, TasksTreeDataProvider, TasksCommands } from './shortcuts/tasks-viewer';
import { KeyboardNavigationHandler } from './shortcuts/keyboard-navigation';
import { LogicalTreeDataProvider } from './shortcuts/logical-tree-data-provider';
import {
    CommentsManager,
    MarkdownCommentsCommands,
    MarkdownCommentsTreeDataProvider,
    PromptGenerator,
    ReviewEditorViewProvider
} from './shortcuts/markdown-comments';
import { registerLanguageModelTools } from './shortcuts/lm-tools';
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

        // Initialize Tasks Viewer
        const tasksViewerEnabled = vscode.workspace.getConfiguration('workspaceShortcuts.tasksViewer').get<boolean>('enabled', true);
        let tasksTreeView: vscode.TreeView<vscode.TreeItem> | undefined;
        let taskManager: TaskManager | undefined;
        let tasksTreeDataProvider: TasksTreeDataProvider | undefined;
        let tasksCommands: TasksCommands | undefined;
        let tasksCommandDisposables: vscode.Disposable[] = [];

        if (tasksViewerEnabled && workspaceFolder) {
            taskManager = new TaskManager(workspaceRoot);
            taskManager.ensureFoldersExist();

            tasksTreeDataProvider = new TasksTreeDataProvider(taskManager);

            // Set up file watching for auto-refresh
            taskManager.watchTasksFolder(() => {
                tasksTreeDataProvider?.refresh();
            });

            tasksTreeView = vscode.window.createTreeView('tasksView', {
                treeDataProvider: tasksTreeDataProvider,
                showCollapseAll: false
            });

            // Update view description with task count
            const updateTasksViewDescription = async () => {
                if (taskManager && tasksTreeView) {
                    const tasks = await taskManager.getTasks();
                    const activeCount = tasks.filter(t => !t.isArchived).length;
                    tasksTreeView.description = `${activeCount} task${activeCount !== 1 ? 's' : ''}`;
                }
            };
            tasksTreeDataProvider.onDidChangeTreeData(updateTasksViewDescription);
            updateTasksViewDescription();

            tasksCommands = new TasksCommands(taskManager, tasksTreeDataProvider);
            tasksCommandDisposables = tasksCommands.registerCommands(context);
        }

        // Initialize Git Diff Comments feature (must be before git tree provider)
        const diffCommentsManager = new DiffCommentsManager(workspaceRoot);
        await diffCommentsManager.initialize();

        // Initialize Git tree data provider (unified Changes + Commits + Comments view)
        const gitTreeDataProvider = new GitTreeDataProvider();
        gitTreeDataProvider.setContext(context);
        gitTreeDataProvider.setDiffCommentsManager(diffCommentsManager);
        const gitInitialized = await gitTreeDataProvider.initialize();

        // Restore any previously looked-up commit from workspace state
        await gitTreeDataProvider.restoreLookedUpCommit();

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
        let gitOpenWithMarkdownReviewCommand: vscode.Disposable | undefined;
        let gitLookupCommitCommand: vscode.Disposable | undefined;
        let gitClearLookedUpCommitCommand: vscode.Disposable | undefined;
        let gitDiffCommentsCleanupCommand: vscode.Disposable | undefined;
        let gitStageFileCommand: vscode.Disposable | undefined;
        let gitUnstageFileCommand: vscode.Disposable | undefined;
        let gitStageAllCommand: vscode.Disposable | undefined;
        let gitUnstageAllCommand: vscode.Disposable | undefined;

        // Create Git drag and drop controller for Copilot Chat integration
        const gitDragDropController = new GitDragDropController();

        if (gitInitialized) {
            gitTreeView = vscode.window.createTreeView('gitView', {
                treeDataProvider: gitTreeDataProvider,
                showCollapseAll: true,
                canSelectMany: true,
                dragAndDropController: gitDragDropController
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

            gitCopyHashCommand = vscode.commands.registerCommand('gitView.copyCommitHash', async (itemOrHash?: GitCommitItem | LookedUpCommitItem | string) => {
                // Handle GitCommitItem, LookedUpCommitItem (from context menu), or string (from tooltip link)
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

            // Lookup commit command
            gitLookupCommitCommand = vscode.commands.registerCommand('gitView.lookupCommit', () => {
                gitTreeDataProvider.showCommitLookup();
            });

            // Clear looked-up commit command
            gitClearLookedUpCommitCommand = vscode.commands.registerCommand('gitView.clearLookedUpCommit', () => {
                gitTreeDataProvider.clearLookedUpCommit();
            });

            // Register command to open commit file diff using extension's diff review
            gitOpenFileDiffCommand = vscode.commands.registerCommand(
                'gitView.openCommitFileDiff',
                async (file: GitCommitFile) => {
                    if (!file) {
                        return;
                    }

                    try {
                        // Open using the extension's diff review with commenting capability
                        await vscode.commands.executeCommand('gitDiffComments.openWithReview', {
                            commitFile: file
                        });
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
                        // Create a synthetic git change item to open the diff review with scroll to comment
                        await vscode.commands.executeCommand('gitDiffComments.openWithReview', {
                            change: {
                                path: item.absoluteFilePath,
                                stage: item.comment.gitContext.wasStaged ? 'staged' : 'unstaged',
                                repositoryRoot: item.comment.gitContext.repositoryRoot,
                                repositoryName: item.comment.gitContext.repositoryName
                            }
                        }, item.comment.id);  // Pass comment ID to scroll to
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

            // Register command to cleanup obsolete comments
            gitDiffCommentsCleanupCommand = vscode.commands.registerCommand(
                'gitDiffComments.cleanupObsolete',
                async () => {
                    // Get current changes from git service
                    const gitService = gitTreeDataProvider['gitService'];
                    const currentChanges = gitService.getAllChanges().map((c: { path: string }) => c.path);

                    // Preview what will be cleaned up
                    const obsoleteComments = diffCommentsManager.getObsoleteComments(currentChanges);

                    if (obsoleteComments.length === 0) {
                        vscode.window.showInformationMessage('No obsolete comments found.');
                        return;
                    }

                    // Show confirmation with details
                    const details = obsoleteComments
                        .slice(0, 5)
                        .map(({ comment, reason }) => `• ${comment.filePath}: ${reason}`)
                        .join('\n');
                    const moreText = obsoleteComments.length > 5
                        ? `\n... and ${obsoleteComments.length - 5} more`
                        : '';

                    const confirmed = await vscode.window.showWarningMessage(
                        `Found ${obsoleteComments.length} obsolete comment(s). Remove them?`,
                        { modal: true, detail: details + moreText },
                        'Remove All'
                    );

                    if (confirmed === 'Remove All') {
                        const result = await diffCommentsManager.cleanupObsoleteComments(currentChanges);
                        vscode.window.showInformationMessage(
                            `Removed ${result.removed} obsolete comment(s).`
                        );
                    }
                }
            );

            // Register command to open markdown files from git view with Review Editor
            gitOpenWithMarkdownReviewCommand = vscode.commands.registerCommand(
                'gitView.openWithMarkdownReview',
                async (item: any) => {
                    // Handle GitChangeItem from git changes section
                    const filePath = item?.change?.path || item?.resourceUri?.fsPath;
                    if (filePath && filePath.endsWith('.md')) {
                        const targetUri = vscode.Uri.file(filePath);
                        await vscode.commands.executeCommand(
                            'vscode.openWith',
                            targetUri,
                            ReviewEditorViewProvider.viewType
                        );
                    } else {
                        vscode.window.showWarningMessage('This command only works with markdown files.');
                    }
                }
            );

            // Register stage file command
            gitStageFileCommand = vscode.commands.registerCommand(
                'gitView.stageFile',
                async (item: GitChangeItem) => {
                    if (item?.change?.path) {
                        const filePath = item.change.path;
                        const gitService = gitTreeDataProvider['gitService'];
                        
                        // Set loading state
                        gitTreeDataProvider.setFileLoading(filePath);
                        
                        try {
                            const success = await gitService.stageFile(filePath);
                            if (!success) {
                                vscode.window.showErrorMessage(`Failed to stage file: ${filePath}`);
                            }
                        } finally {
                            // Clear loading state
                            gitTreeDataProvider.clearFileLoading(filePath);
                        }
                    }
                }
            );

            // Register unstage file command
            gitUnstageFileCommand = vscode.commands.registerCommand(
                'gitView.unstageFile',
                async (item: GitChangeItem) => {
                    if (item?.change?.path) {
                        const filePath = item.change.path;
                        const gitService = gitTreeDataProvider['gitService'];
                        
                        // Set loading state
                        gitTreeDataProvider.setFileLoading(filePath);
                        
                        try {
                            const success = await gitService.unstageFile(filePath);
                            if (!success) {
                                vscode.window.showErrorMessage(`Failed to unstage file: ${filePath}`);
                            }
                        } finally {
                            // Clear loading state
                            gitTreeDataProvider.clearFileLoading(filePath);
                        }
                    }
                }
            );

            // Register stage all command
            gitStageAllCommand = vscode.commands.registerCommand(
                'gitView.stageAll',
                async () => {
                    const gitService = gitTreeDataProvider['gitService'];
                    const changes = gitService.getAllChanges();
                    const unstagedChanges = changes.filter(
                        (c: { stage: string }) => c.stage === 'unstaged' || c.stage === 'untracked'
                    );
                    
                    if (unstagedChanges.length === 0) {
                        vscode.window.showInformationMessage('No unstaged changes to stage');
                        return;
                    }
                    
                    // Set loading state for all files
                    for (const change of unstagedChanges) {
                        gitTreeDataProvider.setFileLoading(change.path);
                    }
                    
                    try {
                        let successCount = 0;
                        for (const change of unstagedChanges) {
                            const success = await gitService.stageFile(change.path);
                            if (success) {
                                successCount++;
                            }
                        }
                        
                        if (successCount > 0) {
                            vscode.window.showInformationMessage(`Staged ${successCount} file(s)`);
                        } else {
                            vscode.window.showErrorMessage('Failed to stage files');
                        }
                    } finally {
                        // Clear all loading states
                        gitTreeDataProvider.clearAllLoading();
                    }
                }
            );

            // Register unstage all command
            gitUnstageAllCommand = vscode.commands.registerCommand(
                'gitView.unstageAll',
                async () => {
                    const gitService = gitTreeDataProvider['gitService'];
                    const changes = gitService.getAllChanges();
                    const stagedChanges = changes.filter((c: { stage: string }) => c.stage === 'staged');
                    
                    if (stagedChanges.length === 0) {
                        vscode.window.showInformationMessage('No staged changes to unstage');
                        return;
                    }
                    
                    // Set loading state for all files
                    for (const change of stagedChanges) {
                        gitTreeDataProvider.setFileLoading(change.path);
                    }
                    
                    try {
                        let successCount = 0;
                        for (const change of stagedChanges) {
                            const success = await gitService.unstageFile(change.path);
                            if (success) {
                                successCount++;
                            }
                        }
                        
                        if (successCount > 0) {
                            vscode.window.showInformationMessage(`Unstaged ${successCount} file(s)`);
                        } else {
                            vscode.window.showErrorMessage('Failed to unstage files');
                        }
                    } finally {
                        // Clear all loading states
                        gitTreeDataProvider.clearAllLoading();
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

        // Initialize AI Process Manager with persistence (must be before ReviewEditorViewProvider and DiffReviewEditorProvider)
        const aiProcessManager = new AIProcessManager();
        await aiProcessManager.initialize(context);

        // Register diff review commands (diffCommentsManager already initialized above)
        // Pass aiProcessManager so AI clarification requests from diff view are tracked
        const diffReviewCommands = DiffReviewEditorProvider.registerCommands(context, diffCommentsManager, aiProcessManager);

        // Get the diff comments tree data provider from git tree provider
        const diffCommentsTreeDataProvider = gitTreeDataProvider.getDiffCommentsTreeProvider();

        // Initialize diff comments commands (context menu handlers)
        let diffCommentsCommands: DiffCommentsCommands | undefined;
        if (diffCommentsTreeDataProvider) {
            diffCommentsCommands = new DiffCommentsCommands(
                diffCommentsManager,
                diffCommentsTreeDataProvider,
                context
            );
        }

        const commentsTreeDataProvider = new MarkdownCommentsTreeDataProvider(commentsManager);
        const promptGenerator = new PromptGenerator(commentsManager);
        const commentsCommands = new MarkdownCommentsCommands(
            commentsManager,
            commentsTreeDataProvider,
            promptGenerator
        );

        // Register Language Model Tools for Copilot Chat integration
        const lmToolDisposables = registerLanguageModelTools(
            context,
            commentsManager,
            diffCommentsManager
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

        // Initialize AI Process document provider for read-only viewing
        const aiProcessDocumentProvider = new AIProcessDocumentProvider(aiProcessManager);
        const aiProcessDocumentProviderDisposable = vscode.workspace.registerTextDocumentContentProvider(
            AI_PROCESS_SCHEME,
            aiProcessDocumentProvider
        );

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

        const clearAllProcessesCommand = vscode.commands.registerCommand(
            'clarificationProcesses.clearAll',
            async () => {
                const confirm = await vscode.window.showWarningMessage(
                    'Clear all AI processes including history?',
                    { modal: true },
                    'Clear All'
                );
                if (confirm === 'Clear All') {
                    aiProcessManager.clearAllProcesses();
                }
            }
        );

        const removeProcessCommand = vscode.commands.registerCommand(
            'clarificationProcesses.remove',
            (item: { process?: { id: string } }) => {
                if (item?.process?.id) {
                    aiProcessManager.removeProcess(item.process.id);
                }
            }
        );

        const viewProcessDetailsCommand = vscode.commands.registerCommand(
            'clarificationProcesses.viewDetails',
            async (item: { process?: { id: string } }) => {
                if (!item?.process?.id) {
                    return;
                }

                // Use the document provider to open a read-only view
                await aiProcessDocumentProvider.openProcess(item.process.id);
            }
        );

        // Command to view code review details in the structured viewer
        const viewCodeReviewDetailsCommand = vscode.commands.registerCommand(
            'clarificationProcesses.viewCodeReviewDetails',
            async (item: { process?: { structuredResult?: string } }) => {
                if (!item?.process?.structuredResult) {
                    vscode.window.showWarningMessage('No structured result available for this code review.');
                    return;
                }

                try {
                    const { deserializeCodeReviewResult, CodeReviewViewer } = await import('./shortcuts/code-review');
                    const serialized = JSON.parse(item.process.structuredResult);
                    const result = deserializeCodeReviewResult(serialized);
                    CodeReviewViewer.createOrShow(context.extensionUri, result);
                } catch (error) {
                    console.error('Failed to parse code review result:', error);
                    vscode.window.showErrorMessage('Failed to display code review result.');
                }
            }
        );

        // Command to view raw response as text file
        const viewRawResponseCommand = vscode.commands.registerCommand(
            'clarificationProcesses.viewRawResponse',
            async (item: { process?: { id: string; result?: string; resultFilePath?: string } }) => {
                if (!item?.process?.id) {
                    vscode.window.showWarningMessage('No process available.');
                    return;
                }

                // If there's a result file, open it directly
                if (item.process.resultFilePath) {
                    try {
                        const uri = vscode.Uri.file(item.process.resultFilePath);
                        const doc = await vscode.workspace.openTextDocument(uri);
                        await vscode.window.showTextDocument(doc, { preview: true });
                        return;
                    } catch (error) {
                        // Fall back to document provider if file doesn't exist
                        console.warn('Result file not found, falling back to document provider:', error);
                    }
                }

                // Fall back to the document provider
                await aiProcessDocumentProvider.openProcess(item.process.id);
            }
        );

        // Command to view discovery results in the preview panel
        const viewDiscoveryResultsCommand = vscode.commands.registerCommand(
            'clarificationProcesses.viewDiscoveryResults',
            async (item: { process?: { structuredResult?: string; discoveryMetadata?: { featureDescription: string } } }) => {
                if (!item?.process?.structuredResult) {
                    vscode.window.showWarningMessage('No discovery results available for this process.');
                    return;
                }

                try {
                    const { deserializeDiscoveryProcess, DiscoveryPreviewPanel } = await import('./shortcuts/discovery');
                    const serialized = JSON.parse(item.process.structuredResult);
                    const discoveryProcess = deserializeDiscoveryProcess(serialized);
                    
                    // Show the discovery preview panel with the restored results
                    DiscoveryPreviewPanel.createOrShow(
                        context.extensionUri,
                        discoveryEngine,
                        configurationManager,
                        discoveryProcess
                    );
                } catch (error) {
                    console.error('Failed to parse discovery results:', error);
                    vscode.window.showErrorMessage('Failed to display discovery results.');
                }
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

        // Track files we've already redirected to avoid infinite loops
        const redirectedFiles = new Set<string>();

        // Listen for markdown files being opened and redirect to Review Editor when setting is enabled
        const markdownOpenListener = vscode.workspace.onDidOpenTextDocument(async (document) => {
            // Check if it's a markdown file
            if (!document.fileName.toLowerCase().endsWith('.md')) {
                return;
            }

            // Check if the setting is enabled
            const config = vscode.workspace.getConfiguration('workspaceShortcuts');
            const alwaysOpenInReviewEditor = config.get<boolean>('alwaysOpenMarkdownInReviewEditor', false);

            if (!alwaysOpenInReviewEditor) {
                return;
            }

            // Check if we've already redirected this file (to avoid infinite loops)
            const fileKey = document.uri.toString();
            if (redirectedFiles.has(fileKey)) {
                redirectedFiles.delete(fileKey);
                return;
            }

            // Mark as redirected before opening to prevent loop
            redirectedFiles.add(fileKey);

            // Small delay to allow the document to fully open before we close and reopen
            setTimeout(async () => {
                try {
                    // Close the current text editor for this file
                    const editor = vscode.window.visibleTextEditors.find(
                        e => e.document.uri.toString() === document.uri.toString()
                    );
                    
                    if (editor) {
                        // Close the text editor tab
                        await vscode.window.showTextDocument(document, { preview: false, preserveFocus: true });
                        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                    }

                    // Open with Review Editor View
                    await vscode.commands.executeCommand(
                        'vscode.openWith',
                        document.uri,
                        ReviewEditorViewProvider.viewType
                    );
                } catch (error) {
                    console.error('Error redirecting markdown to Review Editor:', error);
                    // Clean up the redirect tracking on error
                    redirectedFiles.delete(fileKey);
                }
            }, 50);
        });

        // Collect all disposables for proper cleanup
        const disposables: vscode.Disposable[] = [
            treeView,
            globalNotesTreeView,
            // Tasks Viewer disposables
            ...(tasksTreeView ? [tasksTreeView] : []),
            ...(taskManager ? [taskManager] : []),
            ...(tasksTreeDataProvider ? [tasksTreeDataProvider] : []),
            ...tasksCommandDisposables,
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
            markdownOpenListener,
            ...commentsCommandDisposables,
            // AI Process disposables
            aiProcessesTreeView,
            aiProcessManager,
            aiProcessTreeDataProvider,
            aiProcessDocumentProviderDisposable,
            cancelProcessCommand,
            clearCompletedCommand,
            clearAllProcessesCommand,
            removeProcessCommand,
            viewProcessDetailsCommand,
            viewCodeReviewDetailsCommand,
            viewRawResponseCommand,
            viewDiscoveryResultsCommand,
            refreshProcessesCommand,
            // Git view disposables
            gitTreeDataProvider,
            // Git Diff Comments disposables
            diffCommentsManager,
            ...diffReviewCommands,
            ...(diffCommentsCommands ? [diffCommentsCommands] : []),
            // Language Model Tools disposables
            ...lmToolDisposables
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
        if (gitDiffCommentsCleanupCommand) disposables.push(gitDiffCommentsCleanupCommand);
        if (gitOpenWithMarkdownReviewCommand) disposables.push(gitOpenWithMarkdownReviewCommand);
        if (gitLookupCommitCommand) disposables.push(gitLookupCommitCommand);
        if (gitClearLookedUpCommitCommand) disposables.push(gitClearLookedUpCommitCommand);
        if (gitStageFileCommand) disposables.push(gitStageFileCommand);
        if (gitUnstageFileCommand) disposables.push(gitUnstageFileCommand);
        if (gitStageAllCommand) disposables.push(gitStageAllCommand);
        if (gitUnstageAllCommand) disposables.push(gitUnstageAllCommand);

        // Register code review commands (requires git log service)
        if (gitInitialized) {
            const gitLogService = gitTreeDataProvider['gitLogService'] as GitLogService;
            const codeReviewDisposables = registerCodeReviewCommands(context, gitLogService, aiProcessManager);
            disposables.push(...codeReviewDisposables);
        }

        // Register discovery commands
        const discoveryEngine = new DiscoveryEngine();
        const discoveryDisposables = registerDiscoveryCommands(
            context,
            discoveryEngine,
            configurationManager,
            workspaceRoot,
            aiProcessManager
        );
        disposables.push(discoveryEngine, ...discoveryDisposables);

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
