/**
 * Code Review Commands
 * 
 * Command handlers for the code review feature.
 * Registers and handles all code review related commands.
 */

import * as vscode from 'vscode';
import { AIProcessManager } from '../ai-service/ai-process-manager';
import { copyToClipboard, getAIToolSetting, invokeCopilotCLI } from '../ai-service/copilot-cli-invoker';
import { GitCommitItem } from '../git/git-commit-item';
import { GitLogService } from '../git/git-log-service';
import { GitCommit } from '../git/types';
import { LookedUpCommitItem } from '../git/looked-up-commit-item';
import { CodeReviewService } from './code-review-service';
import { CodeReviewViewer } from './code-review-viewer';
import { parseCodeReviewResponse, formatCodeReviewResultAsMarkdown } from './response-parser';
import { CodeReviewMetadata, serializeCodeReviewResult } from './types';

/**
 * Registers all code review commands
 * @param context Extension context
 * @param gitLogService Git log service instance
 * @param processManager AI process manager instance
 * @returns Array of disposables
 */
export function registerCodeReviewCommands(
    context: vscode.ExtensionContext,
    gitLogService: GitLogService,
    processManager: AIProcessManager
): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];
    const codeReviewService = new CodeReviewService();
    disposables.push(codeReviewService);

    // Get workspace root
    const getWorkspaceRoot = (): string | undefined => {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    };

    // Get repository root (from git service or workspace)
    const getRepoRoot = (): string | undefined => {
        // Try to get from git log service first
        const repos = gitLogService.getRepositories();
        if (repos.length > 0) {
            return repos[0].rootUri.fsPath;
        }
        return getWorkspaceRoot();
    };

    /**
     * Execute a code review with the given diff and metadata
     */
    async function executeReview(
        diff: string,
        metadata: CodeReviewMetadata,
        selectedRules?: string[]
    ): Promise<void> {
        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace folder found.');
            return;
        }

        // Validate configuration
        const validation = codeReviewService.validateConfig(workspaceRoot);
        if (!validation.valid) {
            await codeReviewService.showConfigError(validation.error!);
            return;
        }

        if (validation.warning) {
            const proceed = await vscode.window.showWarningMessage(
                validation.warning,
                'Continue Anyway',
                'Cancel'
            );
            if (proceed !== 'Continue Anyway') {
                return;
            }
        }

        // Check for empty diff
        if (!diff || diff.trim() === '') {
            vscode.window.showInformationMessage('No changes to review.');
            return;
        }

        // Check for large diff
        const stats = codeReviewService.parseDiffStats(diff);
        metadata.diffStats = stats;

        if (codeReviewService.isDiffLarge(diff)) {
            const confirmed = await codeReviewService.confirmLargeDiff(stats);
            if (!confirmed) {
                return;
            }
        }

        // Load rules
        const rulesResult = selectedRules
            ? codeReviewService.loadSpecificRules(workspaceRoot, selectedRules)
            : codeReviewService.loadRulesSync(workspaceRoot);

        if (rulesResult.rules.length === 0) {
            vscode.window.showWarningMessage('No rule files found. Please add rule files to the configured folder.');
            return;
        }

        metadata.rulesUsed = rulesResult.rules.map(r => r.filename);

        // Build prompt
        const prompt = codeReviewService.buildPrompt(diff, rulesResult.rules, metadata);
        const config = codeReviewService.getConfig();
        const title = codeReviewService.createProcessTitle(metadata);

        // Execute based on output mode
        switch (config.outputMode) {
            case 'clipboard':
                await copyToClipboard(prompt);
                vscode.window.showInformationMessage(
                    `Code review prompt copied to clipboard (${rulesResult.rules.length} rules, ${stats.files} files)`
                );
                break;

            case 'editor':
                // Run through Copilot CLI and show result in editor
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `${title}...`,
                    cancellable: true
                }, async (progress) => {
                    progress.report({ message: `Reviewing against ${rulesResult.rules.length} rules...` });

                    const result = await invokeCopilotCLI(prompt, workspaceRoot);

                    if (result.success && result.response) {
                        // Parse the structured response
                        const structuredResult = parseCodeReviewResponse(result.response, metadata);
                        
                        // Format as markdown and open in editor
                        const formattedResult = formatCodeReviewResultAsMarkdown(structuredResult);
                        const doc = await vscode.workspace.openTextDocument({
                            content: formattedResult,
                            language: 'markdown'
                        });
                        await vscode.window.showTextDocument(doc, { preview: true });
                    } else if (result.error) {
                        vscode.window.showErrorMessage(`Code review failed: ${result.error}`);
                    }
                });
                break;

            case 'aiProcess':
            default:
                // Run through Copilot CLI and track in AI Processes view
                const aiTool = getAIToolSetting();
                if (aiTool === 'clipboard') {
                    // Fall back to clipboard if AI tool is configured as clipboard
                    await copyToClipboard(prompt);
                    vscode.window.showInformationMessage(
                        `Code review prompt copied to clipboard (${rulesResult.rules.length} rules, ${stats.files} files)`
                    );
                } else {
                    // Register as a code review process with metadata
                    const processId = processManager.registerCodeReviewProcess(
                        prompt,
                        {
                            reviewType: metadata.type,
                            commitSha: metadata.commitSha,
                            commitMessage: metadata.commitMessage,
                            rulesUsed: metadata.rulesUsed,
                            diffStats: metadata.diffStats
                        }
                    );

                    // Show status in notification
                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `${title}...`,
                        cancellable: true
                    }, async (progress) => {
                        progress.report({ message: `Reviewing against ${rulesResult.rules.length} rules...` });
                        
                        const result = await invokeCopilotCLI(prompt, workspaceRoot, processManager, processId);
                        
                        if (result.success && result.response) {
                            // Parse the structured response
                            const structuredResult = parseCodeReviewResponse(result.response, metadata);
                            const serialized = JSON.stringify(serializeCodeReviewResult(structuredResult));
                            
                            // Complete the process with structured result
                            processManager.completeCodeReviewProcess(processId, result.response, serialized);
                            
                            // Show the result in the viewer
                            CodeReviewViewer.createOrShow(context.extensionUri, structuredResult);
                        } else {
                            // Mark as failed
                            processManager.updateProcess(processId, 'failed', undefined, result.error);
                            vscode.window.showErrorMessage(`Code review failed: ${result.error}`);
                        }
                    });
                }
                break;
        }
    }

    /**
     * Review a commit against rules
     */
    async function reviewCommit(commit: GitCommit, selectRules: boolean = false): Promise<void> {
        const repoRoot = commit.repositoryRoot;
        const workspaceRoot = getWorkspaceRoot();

        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace folder found.');
            return;
        }

        // Get diff for the commit
        const diff = gitLogService.getCommitDiff(repoRoot, commit.hash);

        if (!diff || diff.trim() === '') {
            vscode.window.showInformationMessage('No changes in this commit.');
            return;
        }

        // Get selected rules if requested
        let selectedRules: string[] | undefined;
        if (selectRules) {
            selectedRules = await codeReviewService.showRuleSelection(workspaceRoot);
            if (!selectedRules) {
                return; // User cancelled
            }
        }

        const metadata: CodeReviewMetadata = {
            type: 'commit',
            commitSha: commit.hash,
            commitMessage: commit.subject,
            rulesUsed: []
        };

        await executeReview(diff, metadata, selectedRules);
    }

    // Command: Review commit against rules
    disposables.push(
        vscode.commands.registerCommand(
            'shortcuts.reviewCommitAgainstRules',
            async (item: GitCommitItem | LookedUpCommitItem) => {
                if (!item || !item.commit) {
                    vscode.window.showErrorMessage('No commit selected.');
                    return;
                }
                await reviewCommit(item.commit, false);
            }
        )
    );

    // Command: Review commit against rules with selection
    disposables.push(
        vscode.commands.registerCommand(
            'shortcuts.reviewCommitAgainstRulesSelect',
            async (item: GitCommitItem | LookedUpCommitItem) => {
                if (!item || !item.commit) {
                    vscode.window.showErrorMessage('No commit selected.');
                    return;
                }
                await reviewCommit(item.commit, true);
            }
        )
    );

    // Command: Review pending changes against rules
    disposables.push(
        vscode.commands.registerCommand(
            'shortcuts.reviewPendingAgainstRules',
            async () => {
                const repoRoot = getRepoRoot();
                const workspaceRoot = getWorkspaceRoot();

                if (!repoRoot || !workspaceRoot) {
                    vscode.window.showErrorMessage('No git repository found.');
                    return;
                }

                if (!gitLogService.hasPendingChanges(repoRoot)) {
                    vscode.window.showInformationMessage('No pending changes to review.');
                    return;
                }

                const diff = gitLogService.getPendingChangesDiff(repoRoot);

                const metadata: CodeReviewMetadata = {
                    type: 'pending',
                    rulesUsed: []
                };

                await executeReview(diff, metadata);
            }
        )
    );

    // Command: Review staged changes against rules
    disposables.push(
        vscode.commands.registerCommand(
            'shortcuts.reviewStagedAgainstRules',
            async () => {
                const repoRoot = getRepoRoot();
                const workspaceRoot = getWorkspaceRoot();

                if (!repoRoot || !workspaceRoot) {
                    vscode.window.showErrorMessage('No git repository found.');
                    return;
                }

                if (!gitLogService.hasStagedChanges(repoRoot)) {
                    vscode.window.showInformationMessage('No staged changes to review.');
                    return;
                }

                const diff = gitLogService.getStagedChangesDiff(repoRoot);

                const metadata: CodeReviewMetadata = {
                    type: 'staged',
                    rulesUsed: []
                };

                await executeReview(diff, metadata);
            }
        )
    );

    // Command: Configure code review rules
    disposables.push(
        vscode.commands.registerCommand(
            'shortcuts.configureReviewRules',
            async () => {
                await vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'workspaceShortcuts.codeReview'
                );
            }
        )
    );

    return disposables;
}
