/**
 * Code Review Commands
 *
 * Command handlers for the code review feature.
 * Registers and handles all code review related commands.
 * Uses parallel execution - one AI process per rule file.
 */

import * as vscode from 'vscode';
import { AIProcessManager } from '../ai-service/ai-process-manager';
import { copyToClipboard, getAIToolSetting, invokeCopilotCLI } from '../ai-service/copilot-cli-invoker';
import { GitCommitItem } from '../git/git-commit-item';
import { GitLogService } from '../git/git-log-service';
import { LookedUpCommitItem } from '../git/looked-up-commit-item';
import { GitCommit } from '../git/types';
import { CodeReviewService } from './code-review-service';
import { CodeReviewViewer } from './code-review-viewer';
import { aggregateReviewResults, formatAggregatedResultAsMarkdown, parseCodeReviewResponse } from './response-parser';
import { CodeReviewMetadata, CodeRule, serializeCodeReviewResult, SingleRuleReviewResult } from './types';

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
     * Execute a single rule review
     * @returns SingleRuleReviewResult with findings or error
     */
    async function executeSingleRuleReview(
        rule: CodeRule,
        metadata: CodeReviewMetadata,
        workspaceRoot: string,
        parentGroupId?: string
    ): Promise<SingleRuleReviewResult> {
        const prompt = codeReviewService.buildSingleRulePrompt(rule, metadata);
        const processId = processManager.registerCodeReviewProcess(
            prompt,
            {
                reviewType: metadata.type,
                commitSha: metadata.commitSha,
                commitMessage: metadata.commitMessage,
                rulesUsed: [rule.filename],
                diffStats: metadata.diffStats
            },
            undefined,
            parentGroupId
        );

        // Get model from rule's front matter (if specified)
        const ruleModel = rule.frontMatter?.model;

        try {
            const result = await invokeCopilotCLI(prompt, workspaceRoot, processManager, processId, ruleModel);

            if (result.success && result.response) {
                // Parse the structured response for this single rule
                const parsed = parseCodeReviewResponse(result.response, {
                    ...metadata,
                    rulesUsed: [rule.filename]
                });

                // Serialize the parsed result for storage
                const serializedResult = JSON.stringify(serializeCodeReviewResult(parsed));

                // Complete the process with the structured result
                processManager.completeCodeReviewProcess(processId, result.response, serializedResult);

                return {
                    rule,
                    processId,
                    success: true,
                    findings: parsed.findings,
                    rawResponse: result.response,
                    assessment: parsed.summary.overallAssessment
                };
            } else {
                processManager.updateProcess(processId, 'failed', undefined, result.error);
                return {
                    rule,
                    processId,
                    success: false,
                    error: result.error || 'Unknown error',
                    findings: []
                };
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            processManager.updateProcess(processId, 'failed', undefined, errorMsg);
            return {
                rule,
                processId,
                success: false,
                error: errorMsg,
                findings: []
            };
        }
    }

    /**
     * Execute a code review with the given diff and metadata
     * Uses parallel execution - one AI process per rule file
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

        const config = codeReviewService.getConfig();
        const baseTitle = codeReviewService.createProcessTitle(metadata);

        // Execute based on output mode
        switch (config.outputMode) {
            case 'clipboard': {
                // For clipboard mode, create prompts for all rules and copy them
                const prompts: string[] = [];
                for (const rule of rulesResult.rules) {
                    prompts.push(`--- Rule: ${rule.filename} ---`);
                    prompts.push(codeReviewService.buildSingleRulePrompt(rule, metadata));
                    prompts.push('');
                }
                await copyToClipboard(prompts.join('\n'));
                vscode.window.showInformationMessage(
                    `Code review prompts copied to clipboard (${rulesResult.rules.length} rules, ${stats.files} files)`
                );
                break;
            }

            case 'editor':
            case 'aiProcess':
            default: {
                // Run parallel reviews through Copilot CLI
                const aiTool = getAIToolSetting();
                if (aiTool === 'clipboard') {
                    // Fall back to clipboard if AI tool is configured as clipboard
                    const prompts: string[] = [];
                    for (const rule of rulesResult.rules) {
                        prompts.push(`--- Rule: ${rule.filename} ---`);
                        prompts.push(codeReviewService.buildSingleRulePrompt(rule, metadata));
                        prompts.push('');
                    }
                    await copyToClipboard(prompts.join('\n'));
                    vscode.window.showInformationMessage(
                        `Code review prompts copied to clipboard (${rulesResult.rules.length} rules, ${stats.files} files)`
                    );
                    return;
                }

                // Show progress notification
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `${baseTitle}...`,
                    cancellable: false
                }, async (progress) => {
                    const startTime = Date.now();
                    const totalRules = rulesResult.rules.length;

                    progress.report({
                        message: `Starting parallel review against ${totalRules} rules...`
                    });

                    // Create a group process if there are multiple rules
                    let groupProcessId: string | undefined;
                    if (totalRules > 1) {
                        groupProcessId = processManager.registerCodeReviewGroup({
                            reviewType: metadata.type,
                            commitSha: metadata.commitSha,
                            commitMessage: metadata.commitMessage,
                            rulesUsed: rulesResult.rules.map(r => r.filename),
                            diffStats: metadata.diffStats
                        });
                    }

                    // Execute all rule reviews in parallel
                    const reviewPromises = rulesResult.rules.map((rule, index) => {
                        return executeSingleRuleReview(rule, metadata, workspaceRoot, groupProcessId).then(result => {
                            // Update progress as each rule completes
                            const completed = index + 1;
                            progress.report({
                                message: `Completed ${completed}/${totalRules} rules...`,
                                increment: (100 / totalRules)
                            });
                            return result;
                        });
                    });

                    // Wait for all reviews to complete
                    const ruleResults = await Promise.all(reviewPromises);
                    const totalTimeMs = Date.now() - startTime;

                    // Aggregate results
                    const aggregatedResult = aggregateReviewResults(ruleResults, metadata, totalTimeMs);

                    // Complete the group process if we created one
                    if (groupProcessId) {
                        const summaryText = aggregatedResult.summary.summaryText;
                        const serializedResult = JSON.stringify({
                            metadata: aggregatedResult.metadata,
                            summary: aggregatedResult.summary,
                            findings: aggregatedResult.findings,
                            rawResponse: aggregatedResult.rawResponse,
                            timestamp: aggregatedResult.timestamp.toISOString(),
                            executionStats: aggregatedResult.executionStats,
                            ruleResults: aggregatedResult.ruleResults.map(r => ({
                                ruleFilename: r.rule.filename,
                                processId: r.processId,
                                success: r.success,
                                error: r.error,
                                findingsCount: r.findings.length,
                                assessment: r.assessment
                            }))
                        });
                        processManager.completeCodeReviewGroup(
                            groupProcessId,
                            summaryText,
                            serializedResult,
                            aggregatedResult.executionStats
                        );
                    }

                    // Show results based on output mode
                    if (config.outputMode === 'editor') {
                        // Format as markdown and open in editor
                        const formattedResult = formatAggregatedResultAsMarkdown(aggregatedResult);
                        const doc = await vscode.workspace.openTextDocument({
                            content: formattedResult,
                            language: 'markdown'
                        });
                        await vscode.window.showTextDocument(doc, { preview: true });
                    } else {
                        // Show the result in the viewer (convert to CodeReviewResult format)
                        const viewerResult = {
                            metadata: aggregatedResult.metadata,
                            summary: aggregatedResult.summary,
                            findings: aggregatedResult.findings,
                            rawResponse: aggregatedResult.rawResponse,
                            timestamp: aggregatedResult.timestamp
                        };
                        CodeReviewViewer.createOrShow(context.extensionUri, viewerResult);
                    }

                    // Show completion message
                    const { successfulRules, failedRules } = aggregatedResult.executionStats;
                    const totalFindings = aggregatedResult.summary.totalFindings;
                    let message = `Review complete: ${totalFindings} issue(s) found across ${successfulRules} rules`;
                    if (failedRules > 0) {
                        message += ` (${failedRules} rule(s) failed)`;
                    }
                    message += ` in ${(totalTimeMs / 1000).toFixed(1)}s`;

                    if (aggregatedResult.summary.overallAssessment === 'pass') {
                        vscode.window.showInformationMessage(message);
                    } else {
                        vscode.window.showWarningMessage(message);
                    }
                });
                break;
            }
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
            rulesUsed: [],
            repositoryRoot: repoRoot
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
                    rulesUsed: [],
                    repositoryRoot: repoRoot
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
                    rulesUsed: [],
                    repositoryRoot: repoRoot
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
