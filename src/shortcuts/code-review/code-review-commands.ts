/**
 * Code Review Commands
 *
 * Command handlers for the code review feature.
 * Registers and handles all code review related commands.
 * Uses the map-reduce framework for parallel execution - one AI process per rule file.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as vscode from 'vscode';
import { IAIProcessManager } from '../ai-service/types';
import { copyToClipboard, getAIToolSetting, invokeCopilotCLI } from '../ai-service/copilot-cli-invoker';
import { GitCommitItem } from '../git/git-commit-item';
import { GitLogService } from '../git/git-log-service';
import { LookedUpCommitItem } from '../git/looked-up-commit-item';
import { GitCommit } from '../git/types';
import {
    AIInvoker,
    CodeReviewInput,
    CodeReviewOutput,
    createCodeReviewJob,
    createExecutor,
    ExecutorOptions,
    MapReduceResult,
    Rule,
    RuleReviewResult
} from '../map-reduce';
import { CodeReviewService } from './code-review-service';
import { CodeReviewViewer } from './code-review-viewer';
import { 
    CodeReviewProcessAdapter, 
    createCodeReviewProcessTracker 
} from './process-adapter';
import { formatAggregatedResultAsMarkdown } from './response-parser';
import {
    AggregatedCodeReviewResult,
    CodeReviewMetadata,
    CodeRule,
    ReviewFinding,
    ReviewSummary
} from './types';

/**
 * Adapter to convert CodeRule to Rule (map-reduce framework format)
 */
function codeRuleToRule(codeRule: CodeRule): Rule {
    return {
        id: codeRule.filename.replace(/\.[^/.]+$/, ''), // Remove extension for ID
        filename: codeRule.filename,
        path: codeRule.path,
        content: codeRule.content,
        frontMatter: codeRule.frontMatter as Record<string, unknown> | undefined
    };
}

/**
 * Adapter to convert map-reduce ReviewFinding to code-review ReviewFinding
 * The types are compatible but may need mapping for certain fields
 */
function adaptFinding(mrFinding: import('../map-reduce').ReviewFinding): ReviewFinding {
    return {
        id: mrFinding.id,
        severity: mrFinding.severity,
        rule: mrFinding.rule,
        ruleFile: mrFinding.ruleFile,
        file: mrFinding.file,
        line: mrFinding.line,
        description: mrFinding.description,
        codeSnippet: mrFinding.codeSnippet,
        suggestion: mrFinding.suggestion,
        explanation: mrFinding.explanation
    };
}

// Note: ExtendedProcessTracker and createProcessTrackerAdapter have been moved 
// to process-adapter.ts as createCodeReviewProcessTracker for better decoupling.

/**
 * Convert MapReduceResult to AggregatedCodeReviewResult for compatibility
 */
function convertToAggregatedResult(
    mrResult: MapReduceResult<RuleReviewResult, CodeReviewOutput>,
    metadata: CodeReviewMetadata,
    rules: CodeRule[],
    totalTimeMs: number
): AggregatedCodeReviewResult {
    const output = mrResult.output;
    const findings = output ? output.findings.map(adaptFinding) : [];
    const summary: ReviewSummary = output?.summary || {
        totalFindings: 0,
        bySeverity: { error: 0, warning: 0, info: 0, suggestion: 0 },
        byRule: {},
        overallAssessment: 'pass',
        summaryText: 'No issues found.'
    };

    // Build raw responses from map results
    const rawResponses: string[] = [];
    for (const mapResult of mrResult.mapResults) {
        if (mapResult.success && mapResult.output?.rawResponse) {
            rawResponses.push(`--- Rule: ${mapResult.output.rule.filename} ---\n${mapResult.output.rawResponse}`);
        }
    }

    // Build rule results for compatibility
    const ruleResults = mrResult.mapResults.map((mapResult, index) => {
        const rule = rules[index];
        if (mapResult.success && mapResult.output) {
            return {
                rule,
                processId: mapResult.processId || `rule-${index}`,
                success: true,
                findings: mapResult.output.findings.map(adaptFinding),
                rawResponse: mapResult.output.rawResponse,
                assessment: mapResult.output.assessment
            };
        } else {
            return {
                rule,
                processId: mapResult.processId || `rule-${index}`,
                success: false,
                error: mapResult.error || 'Unknown error',
                findings: []
            };
        }
    });

    return {
        metadata: {
            ...metadata,
            rulesUsed: rules.map(r => r.filename),
            rulePaths: rules.map(r => r.path)
        },
        summary,
        findings,
        ruleResults,
        rawResponse: rawResponses.join('\n\n'),
        timestamp: new Date(),
        executionStats: {
            totalRules: mrResult.executionStats.totalItems,
            successfulRules: mrResult.executionStats.successfulMaps,
            failedRules: mrResult.executionStats.failedMaps,
            totalTimeMs
        },
        reduceStats: mrResult.reduceStats ? {
            originalCount: mrResult.reduceStats.inputCount,
            dedupedCount: mrResult.reduceStats.outputCount,
            mergedCount: mrResult.reduceStats.mergedCount,
            reduceTimeMs: mrResult.reduceStats.reduceTimeMs,
            usedAIReduce: mrResult.reduceStats.usedAIReduce
        } : undefined
    };
}

/**
 * Registers all code review commands
 * @param context Extension context
 * @param gitLogService Git log service instance
 * @param processManager AI process manager instance (IAIProcessManager for testability)
 * @returns Array of disposables
 */
export function registerCodeReviewCommands(
    context: vscode.ExtensionContext,
    gitLogService: GitLogService,
    processManager: IAIProcessManager
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
     * Uses the map-reduce framework for parallel execution
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
                // Run parallel reviews through map-reduce framework
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
                        message: `Starting parallel review against ${totalRules} rules (max ${config.maxConcurrency} concurrent)...`
                    });

                    // Create AI invoker that wraps invokeCopilotCLI
                    const aiInvoker: AIInvoker = async (prompt, options) => {
                        return invokeCopilotCLI(
                            prompt,
                            workspaceRoot,
                            undefined, // No process manager for individual invocations - handled by tracker
                            undefined,
                            options?.model
                        );
                    };

                    // Create process tracker adapter using the decoupled adapter pattern
                    const adapter = new CodeReviewProcessAdapter(processManager);
                    const processTracker = createCodeReviewProcessTracker(adapter, metadata);

                    // Create executor options
                    const executorOptions: ExecutorOptions = {
                        aiInvoker,
                        maxConcurrency: config.maxConcurrency,
                        reduceMode: config.reduceMode === 'ai' ? 'ai' : 'deterministic',
                        showProgress: true,
                        retryOnFailure: false,
                        processTracker,
                        onProgress: (jobProgress) => {
                            progress.report({
                                message: jobProgress.message || `Processing ${jobProgress.completedItems}/${jobProgress.totalItems}...`,
                                increment: jobProgress.phase === 'mapping'
                                    ? (100 / totalRules) * (jobProgress.completedItems > 0 ? 1 : 0)
                                    : 0
                            });
                        }
                    };

                    // Create executor and job
                    const executor = createExecutor(executorOptions);
                    const job = createCodeReviewJob({
                        aiInvoker,
                        useAIReduce: config.reduceMode === 'ai'
                    });

                    // Convert CodeRule[] to Rule[]
                    const rules: Rule[] = rulesResult.rules.map(codeRuleToRule);

                    // Create input for the job
                    const input: CodeReviewInput = {
                        diff,
                        rules,
                        context: {
                            commitSha: metadata.commitSha,
                            commitMessage: metadata.commitMessage,
                            filesChanged: stats.files,
                            isHotfix: false,
                            repositoryRoot: metadata.repositoryRoot
                        }
                    };

                    // Execute the job
                    const mrResult = await executor.execute(job, input);
                    const totalTimeMs = Date.now() - startTime;

                    // Convert to aggregated result format for compatibility
                    const aggregatedResult = convertToAggregatedResult(
                        mrResult,
                        metadata,
                        rulesResult.rules,
                        totalTimeMs
                    );

                    // Update the group's structured result with the full aggregated result
                    // This is needed because the executor completes the group before we have the full result
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
                    processTracker.updateGroupStructuredResult(serializedResult);

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
                        // Show the result in the viewer
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

    /**
     * Review pending changes against rules
     * @param selectRules If true, show rule selection UI
     */
    async function reviewPendingChanges(selectRules: boolean = false): Promise<void> {
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

        // Get selected rules if requested
        let selectedRules: string[] | undefined;
        if (selectRules) {
            selectedRules = await codeReviewService.showRuleSelection(workspaceRoot);
            if (!selectedRules) {
                return; // User cancelled
            }
        }

        const diff = gitLogService.getPendingChangesDiff(repoRoot);

        const metadata: CodeReviewMetadata = {
            type: 'pending',
            rulesUsed: [],
            repositoryRoot: repoRoot
        };

        await executeReview(diff, metadata, selectedRules);
    }

    /**
     * Review staged changes against rules
     * @param selectRules If true, show rule selection UI
     */
    async function reviewStagedChanges(selectRules: boolean = false): Promise<void> {
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

        // Get selected rules if requested
        let selectedRules: string[] | undefined;
        if (selectRules) {
            selectedRules = await codeReviewService.showRuleSelection(workspaceRoot);
            if (!selectedRules) {
                return; // User cancelled
            }
        }

        const diff = gitLogService.getStagedChangesDiff(repoRoot);

        const metadata: CodeReviewMetadata = {
            type: 'staged',
            rulesUsed: [],
            repositoryRoot: repoRoot
        };

        await executeReview(diff, metadata, selectedRules);
    }

    // Command: Review pending changes against rules (all rules)
    disposables.push(
        vscode.commands.registerCommand(
            'shortcuts.reviewPendingAgainstRules',
            async () => {
                await reviewPendingChanges(false);
            }
        )
    );

    // Command: Review pending changes against rules (with rule selection)
    disposables.push(
        vscode.commands.registerCommand(
            'shortcuts.reviewPendingAgainstRulesSelect',
            async () => {
                await reviewPendingChanges(true);
            }
        )
    );

    // Command: Review staged changes against rules (all rules)
    disposables.push(
        vscode.commands.registerCommand(
            'shortcuts.reviewStagedAgainstRules',
            async () => {
                await reviewStagedChanges(false);
            }
        )
    );

    // Command: Review staged changes against rules (with rule selection)
    disposables.push(
        vscode.commands.registerCommand(
            'shortcuts.reviewStagedAgainstRulesSelect',
            async () => {
                await reviewStagedChanges(true);
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
