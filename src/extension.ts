import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    AI_PROCESS_SCHEME,
    AIProcessDocumentProvider,
    AIProcessManager,
    AIProcessTreeDataProvider,
    InteractiveSessionManager,
    InteractiveSessionItem
} from './shortcuts/ai-service';
import { registerCodeReviewCommands } from './shortcuts/code-review';
import { ShortcutsCommands } from './shortcuts/commands';
import { ConfigurationManager } from './shortcuts/configuration-manager';
import { DebugPanelTreeDataProvider } from './shortcuts/debug-panel';
import { DiscoveryEngine, registerDiscoveryCommands } from './shortcuts/discovery';
import { ShortcutsDragDropController } from './shortcuts/drag-drop-controller';
import { FileSystemWatcherManager } from './shortcuts/file-system-watcher-manager';
import { GIT_SHOW_SCHEME, GitChangeItem, GitCommitFile, GitCommitFileItem, GitCommitItem, GitDragDropController, GitLogService, GitShowTextDocumentProvider, GitTreeDataProvider, LookedUpCommitItem } from './shortcuts/git';
import {
    DiffCommentFileItem,
    DiffCommentItem,
    DiffCommentsCommands,
    DiffCommentsManager,
    DiffReviewEditorProvider
} from './shortcuts/git-diff-comments';
import { GlobalNotesTreeDataProvider, NoteDocumentManager } from './shortcuts/global-notes';
import { KeyboardNavigationHandler } from './shortcuts/keyboard-navigation';
import { registerLanguageModelTools } from './shortcuts/lm-tools';
import { LogicalTreeDataProvider } from './shortcuts/logical-tree-data-provider';
import {
    CommentsManager,
    MarkdownCommentsCommands,
    MarkdownCommentsTreeDataProvider,
    PromptGenerator,
    ReviewEditorViewProvider
} from './shortcuts/markdown-comments';
import { NotificationManager } from './shortcuts/notification-manager';
import { getExtensionLogger, LogCategory } from './shortcuts/shared';
import { TaskManager, TasksCommands, TasksDragDropController, TasksTreeDataProvider } from './shortcuts/tasks-viewer';
import { ThemeManager } from './shortcuts/theme-manager';
import {
    PipelineManager,
    PipelinesTreeDataProvider,
    PipelineCommands,
    PipelineTreeItem,
    registerPipelineResultsProvider,
    registerPipelinePreview,
    registerBundledPipelineProvider
} from './shortcuts/yaml-pipeline';

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
        // Initialize shared extension logger first (before any operations)
        const extensionLogger = getExtensionLogger();
        extensionLogger.initialize({ channelName: 'Shortcuts' });
        extensionLogger.info(LogCategory.EXTENSION, 'Shortcuts extension activating', { workspaceRoot });

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

            const tasksDragDropController = new TasksDragDropController();
            tasksTreeView = vscode.window.createTreeView('tasksView', {
                treeDataProvider: tasksTreeDataProvider,
                showCollapseAll: true,
                canSelectMany: true,
                dragAndDropController: tasksDragDropController
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
            tasksCommands.setTreeView(tasksTreeView);
            tasksCommandDisposables = tasksCommands.registerCommands(context);
        }

        // Initialize Pipelines Viewer
        const pipelinesViewerEnabled = vscode.workspace.getConfiguration('workspaceShortcuts.pipelinesViewer').get<boolean>('enabled', true);
        let pipelinesTreeView: vscode.TreeView<PipelineTreeItem> | undefined;
        let pipelineManager: PipelineManager | undefined;
        let pipelinesTreeDataProvider: PipelinesTreeDataProvider | undefined;
        let pipelinesCommands: PipelineCommands | undefined;
        let pipelinesCommandDisposables: vscode.Disposable[] = [];

        if (pipelinesViewerEnabled && workspaceFolder) {
            pipelineManager = new PipelineManager(workspaceRoot, context);
            pipelineManager.ensurePipelinesFolderExists();

            // Register the bundled pipeline read-only provider
            registerBundledPipelineProvider(context);

            pipelinesTreeDataProvider = new PipelinesTreeDataProvider(pipelineManager);

            // Set up file watching for auto-refresh
            const pipelinesWatcherDisposable = pipelineManager.watchPipelinesFolder(() => {
                pipelinesTreeDataProvider?.refresh();
            });

            pipelinesTreeView = vscode.window.createTreeView('pipelinesView', {
                treeDataProvider: pipelinesTreeDataProvider,
                showCollapseAll: false
            });

            // Update view description with pipeline count
            const updatePipelinesViewDescription = async () => {
                if (pipelineManager && pipelinesTreeView) {
                    const pipelines = await pipelineManager.getPipelines();
                    const count = pipelines.length;
                    pipelinesTreeView.description = `${count} pipeline${count !== 1 ? 's' : ''}`;
                }
            };
            pipelinesTreeDataProvider.onDidChangeTreeData(updatePipelinesViewDescription);
            updatePipelinesViewDescription();

            pipelinesCommands = new PipelineCommands(pipelineManager, pipelinesTreeDataProvider, context);
            pipelinesCommands.setTreeView(pipelinesTreeView);
            pipelinesCommandDisposables = pipelinesCommands.registerCommands(context);

            // Register Pipeline Preview custom editor
            const pipelinePreviewDisposable = registerPipelinePreview(context, pipelineManager);
            pipelinesCommandDisposables.push(pipelinePreviewDisposable);

            // Add watcher to disposables
            pipelinesCommandDisposables.push(pipelinesWatcherDisposable);
        }

        // Initialize Debug Panel (always register, visibility controlled by when clause in package.json)
        const debugPanelProvider = new DebugPanelTreeDataProvider();
        const debugPanelView = vscode.window.createTreeView('debugPanelView', {
            treeDataProvider: debugPanelProvider
        });

        const executeDebugCommand = vscode.commands.registerCommand(
            'debugPanel.executeCommand',
            async (commandId: string, args?: any[]) => {
                try {
                    await vscode.commands.executeCommand(commandId, ...(args || []));
                } catch (error) {
                    const message = error instanceof Error ? error.message : 'Unknown error';
                    vscode.window.showErrorMessage(`Failed to execute command: ${message}`);
                }
            }
        );

        // Register command to open new chat with user prompt
        const newChatWithPromptCommand = vscode.commands.registerCommand(
            'debugPanel.newChatWithPrompt',
            async () => {
                const userPrompt = await vscode.window.showInputBox({
                    prompt: 'Enter your prompt for the new chat session',
                    placeHolder: 'Ask anything...',
                    ignoreFocusOut: true
                });

                if (userPrompt) {
                    try {
                        // Try to open chat with the query parameter
                        await vscode.commands.executeCommand('workbench.action.chat.open', {
                            query: userPrompt
                        });
                    } catch {
                        // Fallback: open chat and let user paste
                        await vscode.commands.executeCommand('workbench.action.chat.open');
                        vscode.window.showInformationMessage('Chat opened. Your prompt: ' + userPrompt);
                    }
                }
            }
        );

        // Register command to start a new chat conversation with user prompt
        // This does two steps: 1) create new chat, 2) send the prompt
        const newChatConversationCommand = vscode.commands.registerCommand(
            'debugPanel.newChatConversation',
            async () => {
                const userPrompt = await vscode.window.showInputBox({
                    prompt: 'Enter your prompt for the new conversation',
                    placeHolder: 'Start a new conversation...',
                    ignoreFocusOut: true
                });

                if (userPrompt) {
                    try {
                        // Step 1: Create a new chat conversation (clears history)
                        await vscode.commands.executeCommand('workbench.action.chat.newChat');
                        // Small delay to ensure new chat is ready
                        await new Promise(resolve => setTimeout(resolve, 200));
                        // Step 2: Send the prompt to the new chat
                        await vscode.commands.executeCommand('workbench.action.chat.open', {
                            query: userPrompt
                        });
                    } catch {
                        // Fallback: try to at least open chat
                        await vscode.commands.executeCommand('workbench.action.chat.open');
                        vscode.window.showInformationMessage('Chat opened. Your prompt: ' + userPrompt);
                    }
                }
            }
        );

        // Register command to start a new background agent session with user prompt
        const newBackgroundAgentCommand = vscode.commands.registerCommand(
            'debugPanel.newBackgroundAgent',
            async () => {
                const userPrompt = await vscode.window.showInputBox({
                    prompt: 'Enter your prompt for the background agent',
                    placeHolder: 'Describe what you want the agent to do...',
                    ignoreFocusOut: true
                });

                if (userPrompt) {
                    try {
                        // Try to open background agent with query parameter
                        await vscode.commands.executeCommand(
                            'workbench.action.chat.openNewSessionEditor.copilotcli',
                            { query: userPrompt }
                        );
                    } catch {
                        try {
                            // Fallback: try passing prompt as string directly
                            await vscode.commands.executeCommand(
                                'workbench.action.chat.openNewSessionEditor.copilotcli',
                                userPrompt
                            );
                        } catch {
                            // Last fallback: open without args and show message
                            await vscode.commands.executeCommand(
                                'workbench.action.chat.openNewSessionEditor.copilotcli'
                            );
                            vscode.window.showInformationMessage(
                                'Background agent opened. Your prompt: ' + userPrompt
                            );
                        }
                    }
                }
            }
        );

        // Register command to run any VSCode command with custom parameters
        const runCustomCommand = vscode.commands.registerCommand(
            'debugPanel.runCustomCommand',
            async () => {
                // Step 1: Get command ID
                const commandId = await vscode.window.showInputBox({
                    prompt: 'Enter VSCode command ID',
                    placeHolder: 'e.g., workbench.action.openSettings',
                    ignoreFocusOut: true
                });
                if (!commandId) return;

                // Step 2: Collect parameters
                const args: Record<string, any> = {};
                while (true) {
                    const key = await vscode.window.showInputBox({
                        prompt: 'Enter parameter key (leave empty to finish)',
                        placeHolder: 'Parameter name',
                        ignoreFocusOut: true
                    });
                    if (!key) break;

                    const value = await vscode.window.showInputBox({
                        prompt: `Enter value for "${key}"`,
                        placeHolder: 'Parameter value',
                        ignoreFocusOut: true
                    });
                    if (value === undefined) break; // User cancelled

                    // Try to parse as JSON, fall back to string
                    try {
                        args[key] = JSON.parse(value);
                    } catch {
                        args[key] = value;
                    }
                }

                // Step 3: Execute command
                try {
                    if (Object.keys(args).length > 0) {
                        await vscode.commands.executeCommand(commandId, args);
                    } else {
                        await vscode.commands.executeCommand(commandId);
                    }
                    vscode.window.showInformationMessage(`Executed: ${commandId}`);
                } catch (error) {
                    const message = error instanceof Error ? error.message : 'Unknown error';
                    vscode.window.showErrorMessage(`Failed to execute ${commandId}: ${message}`);
                }
            }
        );

        // Register command to read a VSCode setting by ID
        const readSettingCommand = vscode.commands.registerCommand(
            'debugPanel.readSetting',
            async () => {
                const settingId = await vscode.window.showInputBox({
                    prompt: 'Enter setting ID',
                    placeHolder: 'e.g., editor.fontSize, workspaceShortcuts.sync.enabled',
                    ignoreFocusOut: true
                });
                if (!settingId) return;

                // Split the setting ID into section and key
                // e.g., "editor.fontSize" -> section: "editor", key: "fontSize"
                // e.g., "workspaceShortcuts.sync.enabled" -> section: "workspaceShortcuts.sync", key: "enabled"
                const lastDotIndex = settingId.lastIndexOf('.');
                if (lastDotIndex === -1) {
                    // No dot found, try to get the entire section
                    const config = vscode.workspace.getConfiguration();
                    const value = config.get(settingId);
                    const inspection = config.inspect(settingId);

                    const result = {
                        settingId,
                        value,
                        inspection: {
                            defaultValue: inspection?.defaultValue,
                            globalValue: inspection?.globalValue,
                            workspaceValue: inspection?.workspaceValue,
                            workspaceFolderValue: inspection?.workspaceFolderValue
                        }
                    };

                    vscode.window.showInformationMessage(
                        `${settingId}: ${JSON.stringify(value)}`,
                        'Copy to Clipboard'
                    ).then(selection => {
                        if (selection === 'Copy to Clipboard') {
                            vscode.env.clipboard.writeText(JSON.stringify(result, null, 2));
                        }
                    });
                } else {
                    const section = settingId.substring(0, lastDotIndex);
                    const key = settingId.substring(lastDotIndex + 1);

                    const config = vscode.workspace.getConfiguration(section);
                    const value = config.get(key);
                    const inspection = config.inspect(key);

                    const result = {
                        settingId,
                        section,
                        key,
                        value,
                        inspection: {
                            defaultValue: inspection?.defaultValue,
                            globalValue: inspection?.globalValue,
                            workspaceValue: inspection?.workspaceValue,
                            workspaceFolderValue: inspection?.workspaceFolderValue
                        }
                    };

                    vscode.window.showInformationMessage(
                        `${settingId}: ${JSON.stringify(value)}`,
                        'Copy to Clipboard'
                    ).then(selection => {
                        if (selection === 'Copy to Clipboard') {
                            vscode.env.clipboard.writeText(JSON.stringify(result, null, 2));
                        }
                    });
                }
            }
        );

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

        // Register GitShowTextDocumentProvider for viewing file content at specific commits
        const gitShowProvider = new GitShowTextDocumentProvider();
        const gitShowProviderDisposable = vscode.workspace.registerTextDocumentContentProvider(
            GIT_SHOW_SCHEME,
            gitShowProvider
        );

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
        let gitOpenCommitFileWithMarkdownPreviewCommand: vscode.Disposable | undefined;
        let gitLookupCommitCommand: vscode.Disposable | undefined;
        let gitClearLookedUpCommitCommand: vscode.Disposable | undefined;
        let gitClearAllLookedUpCommitsCommand: vscode.Disposable | undefined;
        let gitDiffCommentsCleanupCommand: vscode.Disposable | undefined;
        let gitStageFileCommand: vscode.Disposable | undefined;
        let gitUnstageFileCommand: vscode.Disposable | undefined;
        let gitStageAllCommand: vscode.Disposable | undefined;
        let gitUnstageAllCommand: vscode.Disposable | undefined;
        let gitRefreshCommitRangeCommand: vscode.Disposable | undefined;
        let gitCopyRangeRefCommand: vscode.Disposable | undefined;
        let gitCopyRangeSummaryCommand: vscode.Disposable | undefined;
        let gitSwitchBranchCommand: vscode.Disposable | undefined;
        let gitCreateBranchCommand: vscode.Disposable | undefined;
        let gitDeleteBranchCommand: vscode.Disposable | undefined;
        let gitRenameBranchCommand: vscode.Disposable | undefined;
        let gitMergeBranchCommand: vscode.Disposable | undefined;
        let gitPushCommand: vscode.Disposable | undefined;
        let gitPullCommand: vscode.Disposable | undefined;
        let gitPullRebaseCommand: vscode.Disposable | undefined;
        let gitFetchCommand: vscode.Disposable | undefined;

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

            // Clear looked-up commit command (clears specific commit from context menu)
            gitClearLookedUpCommitCommand = vscode.commands.registerCommand('gitView.clearLookedUpCommit', (item?: LookedUpCommitItem) => {
                if (item instanceof LookedUpCommitItem) {
                    // Clear specific commit by index
                    gitTreeDataProvider.clearLookedUpCommitByIndex(item.index);
                } else {
                    // Clear all looked-up commits (fallback)
                    gitTreeDataProvider.clearAllLookedUpCommits();
                }
            });

            // Clear all looked-up commits command
            gitClearAllLookedUpCommitsCommand = vscode.commands.registerCommand('gitView.clearAllLookedUpCommits', () => {
                gitTreeDataProvider.clearAllLookedUpCommits();
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
                        getExtensionLogger().error(LogCategory.GIT, 'Failed to open commit file diff', error instanceof Error ? error : undefined);
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

            // Register command to open markdown files from commit history with VSCode's markdown preview
            // This creates a virtual document with the file content at that commit, since the file
            // may have been renamed or deleted in the current workspace
            gitOpenCommitFileWithMarkdownPreviewCommand = vscode.commands.registerCommand(
                'gitView.openCommitFileWithMarkdownPreview',
                async (item: GitCommitFileItem) => {
                    if (!item?.file) {
                        vscode.window.showWarningMessage('No file selected.');
                        return;
                    }

                    const file = item.file;
                    const ext = path.extname(file.path).toLowerCase();
                    if (ext !== '.md') {
                        vscode.window.showWarningMessage('This command only works with markdown files.');
                        return;
                    }

                    try {
                        // Create a git-show URI to get the file content at the commit
                        const gitShowUri = vscode.Uri.parse(
                            `${GIT_SHOW_SCHEME}:${file.path}?commit=${encodeURIComponent(file.commitHash)}&repo=${encodeURIComponent(file.repositoryRoot)}`
                        );

                        // Open the document first to ensure it's loaded
                        const doc = await vscode.workspace.openTextDocument(gitShowUri);

                        // Show the markdown preview using VSCode's built-in preview
                        // The markdown.showPreview command works with any text document
                        await vscode.commands.executeCommand(
                            'markdown.showPreview',
                            gitShowUri
                        );
                    } catch (error) {
                        const err = error instanceof Error ? error : new Error('Unknown error');
                        vscode.window.showErrorMessage(`Failed to open markdown preview: ${err.message}`);
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

            // Register commit range commands
            gitRefreshCommitRangeCommand = vscode.commands.registerCommand(
                'gitView.refreshCommitRange',
                () => {
                    gitTreeDataProvider.refreshCommitRange();
                }
            );

            gitCopyRangeRefCommand = vscode.commands.registerCommand(
                'gitView.copyRangeRef',
                async (item?: any) => {
                    const range = item?.range || gitTreeDataProvider.getCommitRange();
                    if (range) {
                        const rangeRef = `${range.baseRef}...${range.headRef}`;
                        await vscode.env.clipboard.writeText(rangeRef);
                        vscode.window.showInformationMessage(`Copied: ${rangeRef}`);
                    }
                }
            );

            gitCopyRangeSummaryCommand = vscode.commands.registerCommand(
                'gitView.copyRangeSummary',
                async (item?: any) => {
                    const range = item?.range || gitTreeDataProvider.getCommitRange();
                    if (range) {
                        const branchDisplay = range.branchName || 'HEAD';
                        const summary = [
                            `Branch: ${branchDisplay}`,
                            `Commits: ${range.commitCount} ahead of ${range.baseRef}`,
                            `Files changed: ${range.files.length}`,
                            `Changes: +${range.additions}/-${range.deletions}`,
                            '',
                            'Files:',
                            ...range.files.map((f: { status: string; path: string }) => `  ${f.status.charAt(0).toUpperCase()} ${f.path}`)
                        ].join('\n');
                        await vscode.env.clipboard.writeText(summary);
                        vscode.window.showInformationMessage('Copied range summary to clipboard');
                    }
                }
            );

            // Register branch switching command
            gitSwitchBranchCommand = vscode.commands.registerCommand(
                'gitView.switchBranch',
                async () => {
                    const branches = gitTreeDataProvider.getAllBranches();
                    const branchStatus = gitTreeDataProvider.getBranchStatus();
                    const currentBranch = branchStatus?.name || '';

                    // Build quick pick items
                    const items: vscode.QuickPickItem[] = [];

                    // Add separator for local branches
                    if (branches.local.length > 0) {
                        // Current branch first
                        const currentBranchItem = branches.local.find(b => b.isCurrent);
                        if (currentBranchItem) {
                            items.push({
                                label: `$(check) ${currentBranchItem.name}`,
                                description: 'current',
                                detail: currentBranchItem.lastCommitSubject
                            });
                        }

                        // Other local branches
                        for (const branch of branches.local.filter(b => !b.isCurrent)) {
                            items.push({
                                label: branch.name,
                                description: branch.lastCommitDate,
                                detail: branch.lastCommitSubject
                            });
                        }
                    }

                    // Add separator and remote branches
                    if (branches.remote.length > 0) {
                        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
                        items.push({ label: 'Remote Branches', kind: vscode.QuickPickItemKind.Separator });

                        for (const branch of branches.remote) {
                            items.push({
                                label: branch.name,
                                description: `remote: ${branch.remoteName}`,
                                detail: branch.lastCommitSubject
                            });
                        }
                    }

                    // Add special actions
                    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
                    items.push({
                        label: '$(add) Create new branch...',
                        description: '',
                        alwaysShow: true
                    });

                    const selected = await vscode.window.showQuickPick(items, {
                        placeHolder: 'Select a branch to switch to',
                        title: 'Switch Branch'
                    });

                    if (!selected) {
                        return;
                    }

                    // Handle create new branch
                    if (selected.label === '$(add) Create new branch...') {
                        await vscode.commands.executeCommand('gitView.createBranch');
                        return;
                    }

                    // Extract branch name (remove check icon if present)
                    const branchName = selected.label.replace(/^\$\(check\)\s*/, '');

                    // Skip if it's the current branch
                    if (branchName === currentBranch) {
                        vscode.window.showInformationMessage(`Already on branch '${branchName}'`);
                        return;
                    }

                    // Check for uncommitted changes
                    const branchService = gitTreeDataProvider.getBranchService();
                    const repoRoot = gitTreeDataProvider['gitService'].getFirstRepositoryRoot();
                    const hasChanges = repoRoot ? branchService.hasUncommittedChanges(repoRoot) : false;

                    if (hasChanges) {
                        const choice = await vscode.window.showWarningMessage(
                            `You have uncommitted changes. How would you like to proceed?`,
                            { modal: true },
                            'Stash and Switch',
                            'Discard and Switch',
                            'Cancel'
                        );

                        if (choice === 'Cancel' || !choice) {
                            return;
                        }

                        if (choice === 'Stash and Switch') {
                            const result = await gitTreeDataProvider.switchBranch(branchName, { stashFirst: true });
                            if (result.success) {
                                vscode.window.showInformationMessage(
                                    `Switched to '${branchName}'${result.stashed ? ' (changes stashed)' : ''}`
                                );
                            } else {
                                vscode.window.showErrorMessage(`Failed to switch branch: ${result.error}`);
                            }
                            return;
                        }

                        if (choice === 'Discard and Switch') {
                            const result = await gitTreeDataProvider.switchBranch(branchName, { force: true });
                            if (result.success) {
                                vscode.window.showInformationMessage(`Switched to '${branchName}'`);
                            } else {
                                vscode.window.showErrorMessage(`Failed to switch branch: ${result.error}`);
                            }
                            return;
                        }
                    }

                    // Switch to branch
                    const result = await gitTreeDataProvider.switchBranch(branchName);
                    if (result.success) {
                        vscode.window.showInformationMessage(`Switched to '${branchName}'`);
                    } else {
                        vscode.window.showErrorMessage(`Failed to switch branch: ${result.error}`);
                    }
                }
            );

            // Register create branch command
            gitCreateBranchCommand = vscode.commands.registerCommand(
                'gitView.createBranch',
                async () => {
                    const branchName = await vscode.window.showInputBox({
                        prompt: 'Enter new branch name',
                        placeHolder: 'feature/my-new-feature',
                        validateInput: (value) => {
                            if (!value || !value.trim()) {
                                return 'Branch name is required';
                            }
                            // Basic git branch name validation
                            if (value.includes(' ')) {
                                return 'Branch name cannot contain spaces';
                            }
                            if (value.startsWith('-')) {
                                return 'Branch name cannot start with -';
                            }
                            if (value.includes('..')) {
                                return 'Branch name cannot contain ..';
                            }
                            return undefined;
                        }
                    });

                    if (!branchName) {
                        return;
                    }

                    const result = await gitTreeDataProvider.createBranch(branchName.trim(), true);
                    if (result.success) {
                        vscode.window.showInformationMessage(`Created and switched to branch '${branchName}'`);
                    } else {
                        vscode.window.showErrorMessage(`Failed to create branch: ${result.error}`);
                    }
                }
            );

            // Register delete branch command
            gitDeleteBranchCommand = vscode.commands.registerCommand(
                'gitView.deleteBranch',
                async () => {
                    const branches = gitTreeDataProvider.getAllBranches();
                    const branchStatus = gitTreeDataProvider.getBranchStatus();
                    const currentBranch = branchStatus?.name || '';

                    // Filter out current branch
                    const deletableBranches = branches.local.filter(b => !b.isCurrent);

                    if (deletableBranches.length === 0) {
                        vscode.window.showInformationMessage('No branches available to delete');
                        return;
                    }

                    const items = deletableBranches.map(b => ({
                        label: b.name,
                        description: b.lastCommitDate,
                        detail: b.lastCommitSubject
                    }));

                    const selected = await vscode.window.showQuickPick(items, {
                        placeHolder: 'Select a branch to delete',
                        title: 'Delete Branch'
                    });

                    if (!selected) {
                        return;
                    }

                    const confirm = await vscode.window.showWarningMessage(
                        `Are you sure you want to delete branch '${selected.label}'?`,
                        { modal: true },
                        'Delete',
                        'Force Delete (even if not merged)'
                    );

                    if (!confirm) {
                        return;
                    }

                    const force = confirm === 'Force Delete (even if not merged)';
                    const result = await gitTreeDataProvider.deleteBranch(selected.label, force);
                    if (result.success) {
                        vscode.window.showInformationMessage(`Deleted branch '${selected.label}'`);
                    } else {
                        vscode.window.showErrorMessage(`Failed to delete branch: ${result.error}`);
                    }
                }
            );

            // Register rename branch command
            gitRenameBranchCommand = vscode.commands.registerCommand(
                'gitView.renameBranch',
                async () => {
                    const branchStatus = gitTreeDataProvider.getBranchStatus();
                    const currentBranch = branchStatus?.name || '';

                    if (!currentBranch || branchStatus?.isDetached) {
                        vscode.window.showWarningMessage('Cannot rename branch in detached HEAD state');
                        return;
                    }

                    const newName = await vscode.window.showInputBox({
                        prompt: `Rename branch '${currentBranch}' to:`,
                        value: currentBranch,
                        validateInput: (value) => {
                            if (!value || !value.trim()) {
                                return 'Branch name is required';
                            }
                            if (value === currentBranch) {
                                return 'New name must be different';
                            }
                            if (value.includes(' ')) {
                                return 'Branch name cannot contain spaces';
                            }
                            return undefined;
                        }
                    });

                    if (!newName) {
                        return;
                    }

                    const result = await gitTreeDataProvider.renameBranch(currentBranch, newName.trim());
                    if (result.success) {
                        vscode.window.showInformationMessage(`Renamed branch to '${newName}'`);
                    } else {
                        vscode.window.showErrorMessage(`Failed to rename branch: ${result.error}`);
                    }
                }
            );

            // Register merge branch command
            gitMergeBranchCommand = vscode.commands.registerCommand(
                'gitView.mergeBranch',
                async () => {
                    const branches = gitTreeDataProvider.getAllBranches();
                    const branchStatus = gitTreeDataProvider.getBranchStatus();
                    const currentBranch = branchStatus?.name || '';

                    // Filter out current branch
                    const mergeableBranches = branches.local.filter(b => !b.isCurrent);

                    if (mergeableBranches.length === 0) {
                        vscode.window.showInformationMessage('No branches available to merge');
                        return;
                    }

                    const items = mergeableBranches.map(b => ({
                        label: b.name,
                        description: b.lastCommitDate,
                        detail: b.lastCommitSubject
                    }));

                    const selected = await vscode.window.showQuickPick(items, {
                        placeHolder: `Select a branch to merge into '${currentBranch}'`,
                        title: 'Merge Branch'
                    });

                    if (!selected) {
                        return;
                    }

                    const result = await gitTreeDataProvider.mergeBranch(selected.label);
                    if (result.success) {
                        vscode.window.showInformationMessage(`Merged '${selected.label}' into '${currentBranch}'`);
                    } else {
                        vscode.window.showErrorMessage(`Failed to merge branch: ${result.error}`);
                    }
                }
            );

            // Register push command
            gitPushCommand = vscode.commands.registerCommand(
                'gitView.push',
                async () => {
                    const branchStatus = gitTreeDataProvider.getBranchStatus();
                    const setUpstream = !branchStatus?.trackingBranch;

                    const result = await gitTreeDataProvider.push(setUpstream);
                    if (result.success) {
                        vscode.window.showInformationMessage('Pushed successfully');
                    } else {
                        vscode.window.showErrorMessage(`Failed to push: ${result.error}`);
                    }
                }
            );

            // Register pull command
            gitPullCommand = vscode.commands.registerCommand(
                'gitView.pull',
                async () => {
                    const result = await gitTreeDataProvider.pull(false);
                    if (result.success) {
                        vscode.window.showInformationMessage('Pulled successfully');
                    } else {
                        vscode.window.showErrorMessage(`Failed to pull: ${result.error}`);
                    }
                }
            );

            // Register pull with rebase command
            gitPullRebaseCommand = vscode.commands.registerCommand(
                'gitView.pullRebase',
                async () => {
                    const result = await gitTreeDataProvider.pull(true);
                    if (result.success) {
                        vscode.window.showInformationMessage('Pulled with rebase successfully');
                    } else {
                        vscode.window.showErrorMessage(`Failed to pull with rebase: ${result.error}`);
                    }
                }
            );

            // Register fetch command
            gitFetchCommand = vscode.commands.registerCommand(
                'gitView.fetch',
                async () => {
                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: 'Fetching from remote...',
                        cancellable: false
                    }, async () => {
                        const result = await gitTreeDataProvider.fetch();
                        if (result.success) {
                            vscode.window.showInformationMessage('Fetched successfully');
                        } else {
                            vscode.window.showErrorMessage(`Failed to fetch: ${result.error}`);
                        }
                    });
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

        // Initialize Interactive Session Manager
        const interactiveSessionManager = new InteractiveSessionManager();

        // Initialize AI Process tree data provider (with session manager for interactive sessions)
        const aiProcessTreeDataProvider = new AIProcessTreeDataProvider(aiProcessManager, interactiveSessionManager);

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
                    getExtensionLogger().error(LogCategory.AI, 'Failed to parse code review result', error instanceof Error ? error : undefined);
                    vscode.window.showErrorMessage('Failed to display code review result.');
                }
            }
        );

        // Command to view aggregated code review group details in the structured viewer
        const viewCodeReviewGroupDetailsCommand = vscode.commands.registerCommand(
            'clarificationProcesses.viewCodeReviewGroupDetails',
            async (item: { process?: { structuredResult?: string } }) => {
                if (!item?.process?.structuredResult) {
                    vscode.window.showWarningMessage('No aggregated result available for this code review group.');
                    return;
                }

                try {
                    const { CodeReviewViewer } = await import('./shortcuts/code-review');
                    const parsed = JSON.parse(item.process.structuredResult);
                    // Convert the aggregated result back to CodeReviewResult format for the viewer
                    const result = {
                        metadata: parsed.metadata,
                        summary: parsed.summary,
                        findings: parsed.findings,
                        rawResponse: parsed.rawResponse,
                        timestamp: new Date(parsed.timestamp)
                    };
                    CodeReviewViewer.createOrShow(context.extensionUri, result);
                } catch (error) {
                    getExtensionLogger().error(LogCategory.AI, 'Failed to parse code review group result', error instanceof Error ? error : undefined);
                    vscode.window.showErrorMessage('Failed to display aggregated code review result.');
                }
            }
        );

        // Command to view pipeline execution details in the enhanced result viewer
        const viewPipelineExecutionDetailsCommand = vscode.commands.registerCommand(
            'clarificationProcesses.viewPipelineExecutionDetails',
            async (item: { process?: { groupMetadata?: any; structuredResult?: string } }) => {
                // Debug logging
                getExtensionLogger().info(LogCategory.AI, 'View pipeline execution details called', {
                    hasItem: !!item,
                    hasProcess: !!item?.process,
                    hasStructuredResult: !!item?.process?.structuredResult,
                    hasGroupMetadata: !!item?.process?.groupMetadata,
                    groupMetadata: item?.process?.groupMetadata
                });

                if (!item?.process?.structuredResult) {
                    vscode.window.showWarningMessage('No result available for this pipeline execution.');
                    return;
                }

                try {
                    const { PipelineResultViewerProvider } = await import('./shortcuts/yaml-pipeline/ui/result-viewer-provider');
                    const provider = new PipelineResultViewerProvider(context.extensionUri);
                    const result = JSON.parse(item.process.structuredResult);
                    const metadata = item.process.groupMetadata || {};
                    
                    await provider.showResults(
                        result,
                        metadata.pipelineName || 'Pipeline',
                        metadata.packageName || ''
                    );
                } catch (error) {
                    getExtensionLogger().error(LogCategory.AI, 'Failed to display pipeline execution result', error instanceof Error ? error : undefined);
                    vscode.window.showErrorMessage('Failed to display pipeline execution result.');
                }
            }
        );

        // Command to view raw response with markdown review editor
        const viewRawResponseCommand = vscode.commands.registerCommand(
            'clarificationProcesses.viewRawResponse',
            async (item: { process?: { id: string; result?: string; resultFilePath?: string } }) => {
                if (!item?.process?.id) {
                    vscode.window.showWarningMessage('No process available.');
                    return;
                }

                // If there's a result file, open it with markdown review editor
                if (item.process.resultFilePath) {
                    try {
                        const uri = vscode.Uri.file(item.process.resultFilePath);
                        // Check if file exists
                        await vscode.workspace.fs.stat(uri);
                        // Open with markdown review editor
                        await vscode.commands.executeCommand(
                            'vscode.openWith',
                            uri,
                            ReviewEditorViewProvider.viewType
                        );
                        return;
                    } catch (error) {
                        // Fall back to document provider if file doesn't exist
                        console.warn('Result file not found, falling back to document provider:', error);
                    }
                }

                // Fall back to the document provider (as plain text document)
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
                    getExtensionLogger().error(LogCategory.DISCOVERY, 'Failed to parse discovery results', error instanceof Error ? error : undefined);
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

        // Register Interactive Session commands
        const startInteractiveSessionCommand = vscode.commands.registerCommand(
            'interactiveSessions.start',
            async () => {
                // Check the default tool setting
                const config = vscode.workspace.getConfiguration('workspaceShortcuts');
                const defaultTool = config.get<string>('interactiveSessions.defaultTool', 'ask');

                let selectedTool: { label: string; value: 'copilot' | 'claude' } | undefined;

                if (defaultTool === 'copilot') {
                    selectedTool = { label: 'Copilot CLI', value: 'copilot' };
                } else if (defaultTool === 'claude') {
                    selectedTool = { label: 'Claude CLI', value: 'claude' };
                } else {
                    // 'ask' or unknown value - prompt user to select
                    selectedTool = await vscode.window.showQuickPick(
                        [
                            { label: 'Copilot CLI', value: 'copilot' as const },
                            { label: 'Claude CLI', value: 'claude' as const }
                        ],
                        { placeHolder: 'Select AI tool for interactive session' }
                    );
                }

                if (!selectedTool) {
                    return;
                }

                const prompt = await vscode.window.showInputBox({
                    prompt: 'Initial prompt (optional)',
                    placeHolder: 'Enter a prompt to start with or leave empty'
                });

                const sessionId = await interactiveSessionManager.startSession({
                    workingDirectory: workspaceRoot,
                    tool: selectedTool.value,
                    initialPrompt: prompt || undefined
                });

                if (sessionId) {
                    vscode.window.showInformationMessage(`Interactive ${selectedTool.label} session started`);
                }
            }
        );

        const endInteractiveSessionCommand = vscode.commands.registerCommand(
            'interactiveSessions.end',
            (item: InteractiveSessionItem) => {
                if (item?.session?.id) {
                    interactiveSessionManager.endSession(item.session.id);
                }
            }
        );

        const removeInteractiveSessionCommand = vscode.commands.registerCommand(
            'interactiveSessions.remove',
            (item: InteractiveSessionItem) => {
                if (item?.session?.id) {
                    interactiveSessionManager.removeSession(item.session.id);
                }
            }
        );

        const clearEndedSessionsCommand = vscode.commands.registerCommand(
            'interactiveSessions.clearEnded',
            () => {
                interactiveSessionManager.clearEndedSessions();
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
                    getExtensionLogger().error(LogCategory.MARKDOWN, 'Error redirecting markdown to Review Editor', error instanceof Error ? error : undefined);
                    // Clean up the redirect tracking on error
                    redirectedFiles.delete(fileKey);
                }
            }, 50);
        });

        // Collect all disposables for proper cleanup
        const disposables: vscode.Disposable[] = [
            extensionLogger,
            treeView,
            globalNotesTreeView,
            // Tasks Viewer disposables
            ...(tasksTreeView ? [tasksTreeView] : []),
            ...(taskManager ? [taskManager] : []),
            ...(tasksTreeDataProvider ? [tasksTreeDataProvider] : []),
            ...tasksCommandDisposables,
            // Pipelines Viewer disposables
            ...(pipelinesTreeView ? [pipelinesTreeView] : []),
            ...(pipelineManager ? [pipelineManager] : []),
            ...(pipelinesTreeDataProvider ? [pipelinesTreeDataProvider] : []),
            ...pipelinesCommandDisposables,
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
            viewCodeReviewGroupDetailsCommand,
            viewPipelineExecutionDetailsCommand,
            viewRawResponseCommand,
            viewDiscoveryResultsCommand,
            refreshProcessesCommand,
            // Interactive Session disposables
            interactiveSessionManager,
            startInteractiveSessionCommand,
            endInteractiveSessionCommand,
            removeInteractiveSessionCommand,
            clearEndedSessionsCommand,
            // Git view disposables
            gitTreeDataProvider,
            gitShowProvider,
            gitShowProviderDisposable,
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
        if (gitOpenCommitFileWithMarkdownPreviewCommand) disposables.push(gitOpenCommitFileWithMarkdownPreviewCommand);
        if (gitLookupCommitCommand) disposables.push(gitLookupCommitCommand);
        if (gitClearLookedUpCommitCommand) disposables.push(gitClearLookedUpCommitCommand);
        if (gitClearAllLookedUpCommitsCommand) disposables.push(gitClearAllLookedUpCommitsCommand);
        if (gitStageFileCommand) disposables.push(gitStageFileCommand);
        if (gitUnstageFileCommand) disposables.push(gitUnstageFileCommand);
        if (gitStageAllCommand) disposables.push(gitStageAllCommand);
        if (gitUnstageAllCommand) disposables.push(gitUnstageAllCommand);
        if (gitRefreshCommitRangeCommand) disposables.push(gitRefreshCommitRangeCommand);
        if (gitCopyRangeRefCommand) disposables.push(gitCopyRangeRefCommand);
        if (gitCopyRangeSummaryCommand) disposables.push(gitCopyRangeSummaryCommand);

        // Add Debug Panel disposables
        disposables.push(debugPanelView, debugPanelProvider, executeDebugCommand, newChatWithPromptCommand, newChatConversationCommand, newBackgroundAgentCommand, runCustomCommand, readSettingCommand);

        // Register code review commands (requires git log service)
        if (gitInitialized) {
            const gitLogService = gitTreeDataProvider['gitLogService'] as GitLogService;
            const codeReviewDisposables = registerCodeReviewCommands(context, gitLogService, aiProcessManager);
            disposables.push(...codeReviewDisposables);

            // Connect GitLogService to LogicalTreeDataProvider for commit file expansion
            treeDataProvider.setGitLogService(gitLogService);
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

        // Connect AI process manager to pipelines for execution tracking
        if (pipelinesCommands) {
            pipelinesCommands.setAIProcessManager(aiProcessManager);
        }

        // Register pipeline results document provider for readonly result viewing
        const pipelineResultsDisposable = registerPipelineResultsProvider(context);
        disposables.push(pipelineResultsDisposable);

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
        getExtensionLogger().error(LogCategory.EXTENSION, 'Error activating shortcuts extension', error instanceof Error ? error : undefined);
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
