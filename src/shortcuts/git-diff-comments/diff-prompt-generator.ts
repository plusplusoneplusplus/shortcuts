/**
 * AI Prompt Generator for Git Diff Comments
 * Generates structured prompts for AI to address code review comments
 */

import * as path from 'path';
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
export class DiffPromptGenerator {
    constructor(private readonly commentsManager: DiffCommentsManager) { }

    /**
     * Generate a prompt for all open comments
     */
    generatePrompt(options: Partial<DiffPromptGenerationOptions> = {}): string {
        const opts = { ...DEFAULT_DIFF_PROMPT_OPTIONS, ...options };
        const openComments = this.commentsManager.getOpenComments();

        if (openComments.length === 0) {
            return 'No open comments to process.';
        }

        return opts.outputFormat === 'json'
            ? this.generateJsonPrompt(openComments, opts)
            : this.generateMarkdownPrompt(openComments, opts);
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
     * Generate a prompt for specific comment IDs
     */
    generatePromptForComments(
        commentIds: string[],
        options: Partial<DiffPromptGenerationOptions> = {}
    ): string {
        const opts = { ...DEFAULT_DIFF_PROMPT_OPTIONS, ...options };
        const comments = commentIds
            .map(id => this.commentsManager.getComment(id))
            .filter((c): c is DiffComment => c !== undefined);

        if (comments.length === 0) {
            return 'No comments found for the specified IDs.';
        }

        return opts.outputFormat === 'json'
            ? this.generateJsonPrompt(comments, opts)
            : this.generateMarkdownPrompt(comments, opts);
    }

    /**
     * Generate a markdown-formatted prompt
     */
    private generateMarkdownPrompt(
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
    private formatComment(
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
    private generateJsonPrompt(
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
    private formatCommentAsJson(
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

    /**
     * Group comments by file
     */
    private groupCommentsByFile(comments: DiffComment[]): Map<string, DiffComment[]> {
        const grouped = new Map<string, DiffComment[]>();

        for (const comment of comments) {
            const existing = grouped.get(comment.filePath) || [];
            existing.push(comment);
            grouped.set(comment.filePath, existing);
        }

        // Sort comments within each file by line number
        for (const [, fileComments] of grouped) {
            fileComments.sort((a, b) => {
                const aLine = a.selection.newStartLine ?? a.selection.oldStartLine ?? 0;
                const bLine = b.selection.newStartLine ?? b.selection.oldStartLine ?? 0;
                if (aLine !== bLine) {
                    return aLine - bLine;
                }
                return a.selection.startColumn - b.selection.startColumn;
            });
        }

        return grouped;
    }

    /**
     * Get language identifier from file extension
     */
    private getLanguageFromExtension(ext: string): string {
        const languageMap: Record<string, string> = {
            'ts': 'typescript',
            'tsx': 'typescript',
            'js': 'javascript',
            'jsx': 'javascript',
            'py': 'python',
            'rb': 'ruby',
            'java': 'java',
            'go': 'go',
            'rs': 'rust',
            'cpp': 'cpp',
            'c': 'c',
            'h': 'c',
            'hpp': 'cpp',
            'cs': 'csharp',
            'php': 'php',
            'swift': 'swift',
            'kt': 'kotlin',
            'scala': 'scala',
            'sh': 'bash',
            'bash': 'bash',
            'zsh': 'bash',
            'json': 'json',
            'yaml': 'yaml',
            'yml': 'yaml',
            'xml': 'xml',
            'html': 'html',
            'css': 'css',
            'scss': 'scss',
            'less': 'less',
            'sql': 'sql',
            'md': 'markdown'
        };

        return languageMap[ext.toLowerCase()] || ext || 'text';
    }

    /**
     * Get a summary of comments for notification
     */
    getCommentsSummary(comments: DiffComment[]): string {
        const grouped = this.groupCommentsByFile(comments);
        const fileNames = Array.from(grouped.keys()).map(f => path.basename(f));
        return `Files: ${fileNames.join(', ')}`;
    }
}

