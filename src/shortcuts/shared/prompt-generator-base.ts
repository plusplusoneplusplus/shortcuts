/**
 * Base Prompt Generator
 * 
 * Provides shared functionality for generating AI prompts from comments.
 * Both markdown and diff prompt generators extend this base.
 */

import * as fs from 'fs';
import * as path from 'path';
import { BaseComment, BaseSelection } from '../markdown-comments/base-types';
import { CommentsManagerBase } from '../markdown-comments/comments-manager-base';

/**
 * Base options for prompt generation
 */
export interface BasePromptGenerationOptions {
    /** Group comments by file */
    groupByFile: boolean;
    /** Include line numbers in output */
    includeLineNumbers?: boolean;
    /** Custom preamble text */
    customPreamble?: string;
    /** Custom instructions at the end */
    customInstructions?: string;
    /** Output format */
    outputFormat: 'markdown' | 'json';
}

/**
 * Default base prompt generation options
 */
export const DEFAULT_BASE_PROMPT_OPTIONS: BasePromptGenerationOptions = {
    groupByFile: true,
    includeLineNumbers: true,
    outputFormat: 'markdown'
};

/**
 * Abstract base class for prompt generators
 */
export abstract class PromptGeneratorBase<
    TComment extends BaseComment<BaseSelection, any>,
    TManager extends CommentsManagerBase<any, any, TComment, any, any, any>,
    TOptions extends BasePromptGenerationOptions
> {
    constructor(protected readonly commentsManager: TManager) {}

    /**
     * Generate a prompt from open comments
     */
    generatePrompt(options: Partial<TOptions> = {}): string {
        const opts = this.mergeOptions(options);
        const openComments = this.getFilteredOpenComments();

        if (openComments.length === 0) {
            return this.getNoCommentsMessage();
        }

        return opts.outputFormat === 'json'
            ? this.generateJsonPrompt(openComments, opts)
            : this.generateMarkdownPrompt(openComments, opts);
    }

    /**
     * Generate a prompt for specific comment IDs
     */
    generatePromptForComments(
        commentIds: string[],
        options: Partial<TOptions> = {}
    ): string {
        const opts = this.mergeOptions(options);
        const comments = commentIds
            .map(id => this.commentsManager.getComment(id))
            .filter((c): c is TComment => c !== undefined);

        if (comments.length === 0) {
            return 'No comments found for the specified IDs.';
        }

        return opts.outputFormat === 'json'
            ? this.generateJsonPrompt(comments, opts)
            : this.generateMarkdownPrompt(comments, opts);
    }

    /**
     * Group comments by file
     */
    protected groupCommentsByFile(comments: TComment[]): Map<string, TComment[]> {
        const grouped = new Map<string, TComment[]>();

        for (const comment of comments) {
            const existing = grouped.get(comment.filePath) || [];
            existing.push(comment);
            grouped.set(comment.filePath, existing);
        }

        // Sort comments within each file by line number
        for (const [, fileComments] of grouped) {
            this.sortCommentsByLine(fileComments);
        }

        return grouped;
    }

    /**
     * Read file content for inclusion in prompt
     */
    protected readFileContent(relativePath: string): string | undefined {
        try {
            const absolutePath = this.commentsManager.getAbsolutePath(relativePath);
            if (fs.existsSync(absolutePath)) {
                return fs.readFileSync(absolutePath, 'utf8');
            }
        } catch (error) {
            console.warn(`Could not read file ${relativePath}:`, error);
        }
        return undefined;
    }

    /**
     * Get language identifier from file extension
     */
    protected getLanguageFromExtension(ext: string): string {
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
     * Estimate token count for the generated prompt (rough estimate)
     */
    estimateTokenCount(prompt: string): number {
        // Rough estimate: ~4 characters per token for English text
        return Math.ceil(prompt.length / 4);
    }

    /**
     * Split comments into chunks if there are too many
     */
    splitCommentsIntoChunks(
        comments: TComment[],
        maxPerChunk: number
    ): TComment[][] {
        const chunks: TComment[][] = [];

        for (let i = 0; i < comments.length; i += maxPerChunk) {
            chunks.push(comments.slice(i, i + maxPerChunk));
        }

        return chunks;
    }

    /**
     * Get a summary of comments for notification
     */
    getCommentsSummary(comments?: TComment[]): string {
        const targetComments = comments ?? this.getFilteredOpenComments();
        const grouped = this.groupCommentsByFile(targetComments);
        const fileNames = Array.from(grouped.keys()).map(f => path.basename(f));
        return `Files: ${fileNames.join(', ')}`;
    }

    // Abstract methods that subclasses must implement

    /**
     * Merge options with defaults
     */
    protected abstract mergeOptions(options: Partial<TOptions>): TOptions;

    /**
     * Get filtered open comments (may exclude certain types like AI comments)
     */
    protected abstract getFilteredOpenComments(): TComment[];

    /**
     * Get the message to show when no comments are available
     */
    protected abstract getNoCommentsMessage(): string;

    /**
     * Sort comments by line number
     */
    protected abstract sortCommentsByLine(comments: TComment[]): void;

    /**
     * Generate a markdown-formatted prompt
     */
    protected abstract generateMarkdownPrompt(comments: TComment[], options: TOptions): string;

    /**
     * Generate a JSON-formatted prompt
     */
    protected abstract generateJsonPrompt(comments: TComment[], options: TOptions): string;
}

