/**
 * AI Prompt Generator for Git Diff Comments
 * Generates structured prompts for AI to address code review comments
 */

import * as path from 'path';
import { PromptGeneratorBase } from '../shared/prompt-generator-base';
import { DiffCommentsManager } from './diff-comments-manager';
import { CommentCategory } from './diff-comments-tree-provider';
import { DiffComment } from './types';

/**
 * Options for prompt generation
 */
export interface DiffPromptGenerationOptions {
    /** Include code context in prompt */
    includeCodeContext: boolean;
    /** Include git context (branch, commit info) */
    includeGitContext: boolean;
    /** Group comments by file */
    groupByFile: boolean;
    /** Custom preamble text */
    customPreamble?: string;
    /** Custom instructions at the end */
    customInstructions?: string;
    /** Output format */
    outputFormat: 'markdown' | 'json';
}

/**
 * Default prompt generation options
 */
export const DEFAULT_DIFF_PROMPT_OPTIONS: DiffPromptGenerationOptions = {
    includeCodeContext: true,
    includeGitContext: true,
    groupByFile: true,
    outputFormat: 'markdown'
};

/**
 * Generates AI prompts from diff comments
 */
export class DiffPromptGenerator extends PromptGeneratorBase<
    DiffComment,
    DiffCommentsManager,
    DiffPromptGenerationOptions
> {
    constructor(commentsManager: DiffCommentsManager) {
        super(commentsManager);
    }

    /**
     * Merge options with defaults
     */
    protected mergeOptions(options: Partial<DiffPromptGenerationOptions>): DiffPromptGenerationOptions {
        return {
            ...DEFAULT_DIFF_PROMPT_OPTIONS,
            ...options
        };
    }

    /**
     * Get filtered open comments
     */
    protected getFilteredOpenComments(): DiffComment[] {
        return this.commentsManager.getOpenComments();
    }

    /**
     * Get the message to show when no comments are available
     */
    protected getNoCommentsMessage(): string {
        return 'No open comments to process.';
    }

    /**
     * Sort comments by line number
     */
    protected sortCommentsByLine(comments: DiffComment[]): void {
        comments.sort((a, b) => {
            const aLine = a.selection.newStartLine ?? a.selection.oldStartLine ?? 0;
            const bLine = b.selection.newStartLine ?? b.selection.oldStartLine ?? 0;
            if (aLine !== bLine) {
                return aLine - bLine;
            }
            return a.selection.startColumn - b.selection.startColumn;
        });
    }

    /**
     * Generate a prompt for comments in a specific category
     */
    generatePromptForCategory(
        category: CommentCategory,
        commitHash?: string,
        options: Partial<DiffPromptGenerationOptions> = {}
    ): string {
        const opts = { ...DEFAULT_DIFF_PROMPT_OPTIONS, ...options };
        let comments = this.commentsManager.getOpenComments();

        // Filter by category
        if (category === 'pending') {
            comments = comments.filter(c => !c.gitContext.commitHash);
        } else if (category === 'committed' && commitHash) {
            comments = comments.filter(c => c.gitContext.commitHash === commitHash);
        }

        if (comments.length === 0) {
            return 'No open comments in this category.';
        }

        return opts.outputFormat === 'json'
            ? this.generateJsonPrompt(comments, opts)
            : this.generateMarkdownPrompt(comments, opts);
    }

    /**
     * Generate a prompt for comments on a specific file
     */
    generatePromptForFile(
        filePath: string,
        category?: CommentCategory,
        commitHash?: string,
        options: Partial<DiffPromptGenerationOptions> = {}
    ): string {
        const opts = { ...DEFAULT_DIFF_PROMPT_OPTIONS, ...options };
        let comments = this.commentsManager.getCommentsForFile(filePath)
            .filter(c => c.status === 'open');

        // Filter by category if specified
        if (category === 'pending') {
            comments = comments.filter(c => !c.gitContext.commitHash);
        } else if (category === 'committed' && commitHash) {
            comments = comments.filter(c => c.gitContext.commitHash === commitHash);
        }

        if (comments.length === 0) {
            return 'No open comments for this file.';
        }

        return opts.outputFormat === 'json'
            ? this.generateJsonPrompt(comments, opts)
            : this.generateMarkdownPrompt(comments, opts);
    }

    /**
     * Generate a prompt for a single comment
     */
    generatePromptForComment(
        commentId: string,
        options: Partial<DiffPromptGenerationOptions> = {}
    ): string {
        const opts = { ...DEFAULT_DIFF_PROMPT_OPTIONS, ...options };
        const comment = this.commentsManager.getComment(commentId);

        if (!comment) {
            return 'Comment not found.';
        }

        return opts.outputFormat === 'json'
            ? this.generateJsonPrompt([comment], opts)
            : this.generateMarkdownPrompt([comment], opts);
    }


    /**
     * Generate a markdown-formatted prompt
     */
    protected generateMarkdownPrompt(
        comments: DiffComment[],
        options: DiffPromptGenerationOptions
    ): string {
        const lines: string[] = [];

        // Preamble
        if (options.customPreamble) {
            lines.push(options.customPreamble);
            lines.push('');
        } else {
            lines.push('# Code Review: Comments to Address');
            lines.push('');
            lines.push('Please review and address the following code review comments.');
            lines.push('For each comment, provide the corrected code and a brief explanation.');
            lines.push('');
        }

        // Git context summary
        if (options.includeGitContext && comments.length > 0) {
            const gitContext = comments[0].gitContext;
            lines.push(`**Repository:** ${gitContext.repositoryName}`);
            if (gitContext.commitHash) {
                lines.push(`**Commit:** ${gitContext.commitHash.slice(0, 7)}`);
            } else {
                lines.push(`**Changes:** ${gitContext.wasStaged ? 'Staged' : 'Unstaged'} changes`);
            }
            lines.push(`**Total Comments:** ${comments.length} open`);
            lines.push('');
        }

        lines.push('---');
        lines.push('');

        if (options.groupByFile) {
            // Group comments by file
            const grouped = this.groupCommentsByFile(comments);

            for (const [filePath, fileComments] of grouped) {
                lines.push(`## ${filePath}`);
                lines.push('');

                for (let i = 0; i < fileComments.length; i++) {
                    const comment = fileComments[i];
                    lines.push(...this.formatComment(comment, i + 1, options));
                    lines.push('');
                }

                lines.push('---');
                lines.push('');
            }
        } else {
            // List comments without grouping
            for (let i = 0; i < comments.length; i++) {
                const comment = comments[i];
                lines.push(`## Comment ${i + 1}`);
                lines.push('');
                lines.push(`**File:** \`${comment.filePath}\``);
                lines.push('');
                lines.push(...this.formatComment(comment, i + 1, options));
                lines.push('');
                lines.push('---');
                lines.push('');
            }
        }

        // Instructions
        if (options.customInstructions) {
            lines.push(options.customInstructions);
        } else {
            lines.push('## Instructions');
            lines.push('');
            lines.push('Address each comment with corrected code and brief explanation.');
        }

        return lines.join('\n');
    }

    /**
     * Format a single comment for the prompt
     */
    protected formatComment(
        comment: DiffComment,
        index: number,
        options: DiffPromptGenerationOptions
    ): string[] {
        const lines: string[] = [];

        // Line range and side
        const startLine = comment.selection.newStartLine ?? comment.selection.oldStartLine ?? 0;
        const endLine = comment.selection.newEndLine ?? comment.selection.oldEndLine ?? 0;
        const lineRange = startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}-${endLine}`;
        const sideLabel = comment.selection.side === 'old' ? 'deleted' :
            comment.selection.side === 'new' ? 'added' : 'both';

        lines.push(`### Comment ${index} (${lineRange}, ${sideLabel})`);
        lines.push('');

        // Code context
        if (options.includeCodeContext) {
            // Determine language from file extension
            const ext = path.extname(comment.filePath).slice(1);
            const lang = this.getLanguageFromExtension(ext);

            lines.push('**Code:**');
            lines.push(`\`\`\`${lang}`);
            lines.push(comment.selectedText);
            lines.push('```');
            lines.push('');
        }

        // Comment content
        lines.push(`**Comment:** ${comment.comment}`);
        lines.push('');

        // Tags if present
        if (comment.tags && comment.tags.length > 0) {
            lines.push(`**Tags:** ${comment.tags.join(', ')}`);
            lines.push('');
        }

        return lines;
    }

    /**
     * Generate a JSON-formatted prompt
     */
    protected generateJsonPrompt(
        comments: DiffComment[],
        options: DiffPromptGenerationOptions
    ): string {
        const output: any = {
            task: 'Code Review',
            instructions: options.customInstructions || 'Address each comment with corrected code and brief explanation.',
            totalComments: comments.length
        };

        // Add git context if requested
        if (options.includeGitContext && comments.length > 0) {
            const gitContext = comments[0].gitContext;
            output.gitContext = {
                repository: gitContext.repositoryName,
                commit: gitContext.commitHash?.slice(0, 7),
                changeType: gitContext.commitHash ? 'committed' : (gitContext.wasStaged ? 'staged' : 'unstaged')
            };
        }

        if (options.groupByFile) {
            const grouped = this.groupCommentsByFile(comments);
            output.files = [];

            for (const [filePath, fileComments] of grouped) {
                output.files.push({
                    filePath,
                    comments: fileComments.map((c, i) => this.formatCommentAsJson(c, i + 1, options))
                });
            }
        } else {
            output.comments = comments.map((c, i) => ({
                filePath: c.filePath,
                ...this.formatCommentAsJson(c, i + 1, options)
            }));
        }

        return JSON.stringify(output, null, 2);
    }

    /**
     * Format a comment as a JSON object
     */
    protected formatCommentAsJson(
        comment: DiffComment,
        index: number,
        options: DiffPromptGenerationOptions
    ): any {
        const startLine = comment.selection.newStartLine ?? comment.selection.oldStartLine ?? 0;
        const endLine = comment.selection.newEndLine ?? comment.selection.oldEndLine ?? 0;

        const result: any = {
            index,
            location: {
                startLine,
                endLine,
                side: comment.selection.side
            },
            comment: comment.comment
        };

        if (options.includeCodeContext) {
            result.code = comment.selectedText;
        }

        if (comment.tags && comment.tags.length > 0) {
            result.tags = comment.tags;
        }

        return result;
    }

}

