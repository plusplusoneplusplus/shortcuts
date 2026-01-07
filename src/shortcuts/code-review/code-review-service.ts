/**
 * Code Review Service
 * 
 * Core service for reviewing Git diffs against code rule files.
 * Handles configuration validation, rule loading, diff retrieval,
 * and prompt construction.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { glob } from '../shared/glob-utils';
import {
    CodeReviewConfig,
    CodeReviewMetadata,
    CodeRule,
    ConfigValidationResult,
    DEFAULT_CODE_REVIEW_CONFIG,
    DiffStats,
    LARGE_DIFF_THRESHOLD,
    PromptBuildOptions,
    RulesLoadResult,
    STRUCTURED_RESPONSE_PROMPT
} from './types';

/**
 * Service for code review operations
 */
export class CodeReviewService implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];

    constructor() {
        // Listen for configuration changes
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('workspaceShortcuts.codeReview')) {
                    // Configuration changed - could trigger refresh if needed
                }
            })
        );
    }

    /**
     * Get the current code review configuration from VSCode settings
     */
    getConfig(): CodeReviewConfig {
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.codeReview');
        return {
            rulesFolder: config.get<string>('rulesFolder', DEFAULT_CODE_REVIEW_CONFIG.rulesFolder),
            rulesPattern: config.get<string>('rulesPattern', DEFAULT_CODE_REVIEW_CONFIG.rulesPattern),
            promptTemplate: config.get<string>('promptTemplate', DEFAULT_CODE_REVIEW_CONFIG.promptTemplate),
            outputMode: config.get<string>('outputMode', DEFAULT_CODE_REVIEW_CONFIG.outputMode) as CodeReviewConfig['outputMode']
        };
    }

    /**
     * Validate the code review configuration
     * @param workspaceRoot The workspace root path
     * @returns Validation result with any errors or warnings
     */
    validateConfig(workspaceRoot: string): ConfigValidationResult {
        const config = this.getConfig();

        // Check if rules folder is configured
        if (!config.rulesFolder || config.rulesFolder.trim() === '') {
            return {
                valid: false,
                error: 'Rules folder is not configured. Please set workspaceShortcuts.codeReview.rulesFolder in settings.'
            };
        }

        // Resolve the rules folder path
        const rulesFolderPath = this.resolveRulesFolder(workspaceRoot);

        // Check if folder exists
        if (!fs.existsSync(rulesFolderPath)) {
            return {
                valid: false,
                error: `Rules folder not found: ${config.rulesFolder}`
            };
        }

        // Check if folder is actually a directory
        const stat = fs.statSync(rulesFolderPath);
        if (!stat.isDirectory()) {
            return {
                valid: false,
                error: `Rules folder path is not a directory: ${config.rulesFolder}`
            };
        }

        // Check if there are any rule files
        const rules = this.loadRulesSync(workspaceRoot);
        if (rules.rules.length === 0) {
            return {
                valid: true,
                warning: `No rule files found matching pattern "${config.rulesPattern}" in ${config.rulesFolder}`
            };
        }

        return { valid: true };
    }

    /**
     * Resolve the rules folder path (handles relative paths)
     * @param workspaceRoot The workspace root path
     * @returns Absolute path to the rules folder
     */
    resolveRulesFolder(workspaceRoot: string): string {
        const config = this.getConfig();
        const rulesFolder = config.rulesFolder;

        // If absolute path, return as-is
        if (path.isAbsolute(rulesFolder)) {
            return rulesFolder;
        }

        // Otherwise, resolve relative to workspace root
        return path.join(workspaceRoot, rulesFolder);
    }

    /**
     * Load all rule files from the configured folder (synchronous)
     * @param workspaceRoot The workspace root path
     * @returns Result containing loaded rules and any errors
     */
    loadRulesSync(workspaceRoot: string): RulesLoadResult {
        const config = this.getConfig();
        const rulesFolderPath = this.resolveRulesFolder(workspaceRoot);
        const rules: CodeRule[] = [];
        const errors: string[] = [];

        try {
            // Find all matching files
            const files = glob(config.rulesPattern, rulesFolderPath);

            // Sort files alphabetically (for consistent ordering)
            files.sort();

            // Load each file
            for (const file of files) {
                try {
                    const content = fs.readFileSync(file, 'utf-8');
                    rules.push({
                        filename: path.basename(file),
                        path: file,
                        content
                    });
                } catch (error) {
                    const err = error instanceof Error ? error.message : String(error);
                    errors.push(`Failed to read ${path.basename(file)}: ${err}`);
                }
            }
        } catch (error) {
            const err = error instanceof Error ? error.message : String(error);
            errors.push(`Failed to scan rules folder: ${err}`);
        }

        return { rules, errors };
    }

    /**
     * Load specific rule files by filename
     * @param workspaceRoot The workspace root path
     * @param filenames Array of filenames to load
     * @returns Result containing loaded rules and any errors
     */
    loadSpecificRules(workspaceRoot: string, filenames: string[]): RulesLoadResult {
        const allRules = this.loadRulesSync(workspaceRoot);
        const selectedRules = allRules.rules.filter(r => filenames.includes(r.filename));
        return {
            rules: selectedRules,
            errors: allRules.errors
        };
    }

    /**
     * Parse diff statistics from a git diff output
     * @param diff The git diff output
     * @returns Diff statistics
     */
    parseDiffStats(diff: string): DiffStats {
        const lines = diff.split('\n');
        let files = 0;
        let additions = 0;
        let deletions = 0;

        for (const line of lines) {
            if (line.startsWith('diff --git')) {
                files++;
            } else if (line.startsWith('+') && !line.startsWith('+++')) {
                additions++;
            } else if (line.startsWith('-') && !line.startsWith('---')) {
                deletions++;
            }
        }

        return { files, additions, deletions };
    }

    /**
     * Check if a diff is large (may exceed token limits)
     * @param diff The git diff output
     * @returns True if the diff exceeds the threshold
     */
    isDiffLarge(diff: string): boolean {
        return Buffer.byteLength(diff, 'utf-8') > LARGE_DIFF_THRESHOLD;
    }

    /**
     * Build a reference-based prompt for code review.
     * Instead of embedding the full diff and rule content, this provides references
     * (commit ID, file paths) that the AI can use to retrieve the content.
     * 
     * @param rules The code rules to check against (only paths are used)
     * @param metadata Metadata about the review (commit info, repository root, etc.)
     * @param options Prompt build options
     * @returns The constructed prompt string with references
     */
    buildReferencePrompt(rules: CodeRule[], metadata: CodeReviewMetadata, options?: PromptBuildOptions): string {
        const config = this.getConfig();
        const parts: string[] = [];

        // Add the prompt template
        parts.push(config.promptTemplate);
        parts.push('');
        parts.push('---');
        parts.push('');

        // Add coding rules section with file paths
        parts.push('# Coding Rules');
        parts.push('');
        parts.push('Please read and apply the following rule files:');
        parts.push('');

        for (const rule of rules) {
            // Use forward slashes for cross-platform compatibility in prompts
            const normalizedPath = this.normalizePathForPrompt(rule.path);
            parts.push(`- ${rule.filename}: \`${normalizedPath}\``);
        }

        parts.push('');
        parts.push('---');
        parts.push('');

        // Add code changes section with references
        parts.push('# Code Changes');
        parts.push('');

        if (metadata.type === 'commit' && metadata.commitSha) {
            parts.push(`Repository: \`${this.normalizePathForPrompt(metadata.repositoryRoot || '')}\``);
            parts.push(`Commit: ${metadata.commitSha}`);
            if (metadata.commitMessage) {
                parts.push(`Message: ${metadata.commitMessage}`);
            }
            parts.push('');
            parts.push('Please retrieve the commit diff using the commit hash above.');
            parts.push('You can use `git show <commit>` or `git diff <commit>~1 <commit>` to get the diff.');
        } else if (metadata.type === 'pending') {
            parts.push(`Repository: \`${this.normalizePathForPrompt(metadata.repositoryRoot || '')}\``);
            parts.push('Type: Pending Changes (staged + unstaged)');
            parts.push('');
            parts.push('Please retrieve the pending changes using:');
            parts.push('- `git diff` for unstaged changes');
            parts.push('- `git diff --cached` for staged changes');
        } else if (metadata.type === 'staged') {
            parts.push(`Repository: \`${this.normalizePathForPrompt(metadata.repositoryRoot || '')}\``);
            parts.push('Type: Staged Changes');
            parts.push('');
            parts.push('Please retrieve the staged changes using `git diff --cached`.');
        }

        parts.push('');

        // Add structured response instructions
        parts.push(STRUCTURED_RESPONSE_PROMPT);

        return parts.join('\n');
    }

    /**
     * Normalize a file path for use in prompts.
     * Converts backslashes to forward slashes for cross-platform compatibility.
     * 
     * @param filePath The file path to normalize
     * @returns Normalized path with forward slashes
     */
    normalizePathForPrompt(filePath: string): string {
        if (!filePath) {
            return '';
        }
        // Convert backslashes to forward slashes for cross-platform compatibility
        return filePath.replace(/\\/g, '/');
    }

    /**
     * Create a title for the AI process based on the review type
     * @param metadata Review metadata
     * @returns A descriptive title
     */
    createProcessTitle(metadata: CodeReviewMetadata): string {
        if (metadata.type === 'commit' && metadata.commitSha) {
            const shortHash = metadata.commitSha.substring(0, 7);
            return `Review: ${shortHash}`;
        } else if (metadata.type === 'pending') {
            return 'Review: pending';
        } else {
            return 'Review: staged';
        }
    }

    /**
     * Show the rule selection quick pick
     * @param workspaceRoot The workspace root path
     * @returns Selected rule filenames or undefined if cancelled
     */
    async showRuleSelection(workspaceRoot: string): Promise<string[] | undefined> {
        const allRules = this.loadRulesSync(workspaceRoot);

        if (allRules.rules.length === 0) {
            vscode.window.showWarningMessage('No rule files found in the configured folder.');
            return undefined;
        }

        const items = allRules.rules.map(rule => ({
            label: rule.filename,
            picked: true, // All selected by default
            description: path.relative(workspaceRoot, rule.path)
        }));

        const selected = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            placeHolder: 'Select rules to check against',
            title: 'Select Code Review Rules'
        });

        if (!selected || selected.length === 0) {
            return undefined;
        }

        return selected.map(s => s.label);
    }

    /**
     * Prompt user to configure the rules folder
     */
    async promptConfigureRulesFolder(): Promise<void> {
        const action = await vscode.window.showInformationMessage(
            'Code review rules folder is not configured.',
            'Configure Rules Folder',
            'Cancel'
        );

        if (action === 'Configure Rules Folder') {
            await vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'workspaceShortcuts.codeReview.rulesFolder'
            );
        }
    }

    /**
     * Show error with option to open settings
     * @param message Error message to display
     */
    async showConfigError(message: string): Promise<void> {
        const action = await vscode.window.showErrorMessage(
            message,
            'Open Settings'
        );

        if (action === 'Open Settings') {
            await vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'workspaceShortcuts.codeReview'
            );
        }
    }

    /**
     * Confirm proceeding with a large diff
     * @param stats Diff statistics
     * @returns True if user confirms, false otherwise
     */
    async confirmLargeDiff(stats: DiffStats): Promise<boolean> {
        const message = `Large diff detected (${stats.files} files, +${stats.additions}/-${stats.deletions} lines). This may exceed token limits. Continue?`;
        const action = await vscode.window.showWarningMessage(
            message,
            'Continue',
            'Cancel'
        );
        return action === 'Continue';
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }
}

