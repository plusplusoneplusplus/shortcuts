/**
 * AI Prompt Generator for markdown comments
 * Generates structured prompts for AI to resolve comments
 */

import * as path from 'path';
import { PromptGeneratorBase } from '../shared/prompt-generator-base';
import { CommentsManager } from './comments-manager';
import {
    DEFAULT_PROMPT_OPTIONS,
    isUserComment,
    MarkdownComment,
    PromptGenerationOptions
} from './types';

/**
 * Generates AI prompts from markdown comments
 */
export class PromptGenerator extends PromptGeneratorBase<
    MarkdownComment,
    CommentsManager,
    PromptGenerationOptions
> {
    constructor(commentsManager: CommentsManager) {
        super(commentsManager);
    }

    /**
     * Merge options with defaults
     */
    protected mergeOptions(options: Partial<PromptGenerationOptions>): PromptGenerationOptions {
        return {
            ...DEFAULT_PROMPT_OPTIONS,
            ...options
        };
    }

    /**
     * Get filtered open comments (excludes AI-generated comments)
     */
    protected getFilteredOpenComments(): MarkdownComment[] {
        return this.commentsManager.getOpenComments().filter(c => isUserComment(c));
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
    protected sortCommentsByLine(comments: MarkdownComment[]): void {
        comments.sort((a, b) => {
            if (a.selection.startLine !== b.selection.startLine) {
                return a.selection.startLine - b.selection.startLine;
            }
            return a.selection.startColumn - b.selection.startColumn;
        });
    }

    /**
     * Generate a markdown-formatted prompt
     */
    protected generateMarkdownPrompt(
        comments: MarkdownComment[],
        options: PromptGenerationOptions
    ): string {
        const lines: string[] = [];

        // Preamble
        if (options.customPreamble) {
            lines.push(options.customPreamble);
            lines.push('');
        } else {
            lines.push('# Document Revision Request');
            lines.push('');
            lines.push('Please review and address the following comments in the markdown files.');
            lines.push('For each comment, make the necessary changes to the document.');
            lines.push('');
        }

        lines.push('---');
        lines.push('');

        if (options.groupByFile) {
            // Group comments by file
            const grouped = this.groupCommentsByFile(comments);

            Array.from(grouped.entries()).forEach(([filePath, fileComments]) => {
                lines.push(`## File: ${filePath}`);
                lines.push('');

                // Include full file content if requested
                if (options.includeFullFileContent) {
                    const fullContent = this.readFileContent(filePath);
                    if (fullContent) {
                        lines.push('### Full File Content');
                        lines.push('');
                        lines.push('```markdown');
                        lines.push(fullContent);
                        lines.push('```');
                        lines.push('');
                    }
                }

                // Add each comment
                for (let i = 0; i < fileComments.length; i++) {
                    const comment = fileComments[i];
                    lines.push(...this.formatComment(comment, i + 1, options));
                    lines.push('');
                }

                lines.push('---');
                lines.push('');
            });
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
            lines.push('# Instructions');
            lines.push('');
            lines.push('1. For each comment above, modify the corresponding section in the file');
            lines.push('2. Preserve the overall document structure and formatting');
            lines.push('3. After making changes, summarize what was modified');
            lines.push('');
            lines.push('Please provide the updated content for each file.');
        }

        return lines.join('\n');
    }

    /**
     * Format a single comment for the prompt
     */
    protected formatComment(
        comment: MarkdownComment,
        index: number,
        options: PromptGenerationOptions
    ): string[] {
        const lines: string[] = [];

        // Line range
        if (options.includeLineNumbers) {
            const lineRange = comment.selection.startLine === comment.selection.endLine
                ? `Line ${comment.selection.startLine}`
                : `Lines ${comment.selection.startLine}-${comment.selection.endLine}`;
            lines.push(`### Comment ${index} (${lineRange})`);
        } else {
            lines.push(`### Comment ${index}`);
        }

        lines.push('');

        // Selected text
        lines.push('**Selected Text:**');
        lines.push('```');
        lines.push(comment.selectedText);
        lines.push('```');
        lines.push('');

        // Comment content
        lines.push('**Comment:**');
        lines.push(comment.comment);
        lines.push('');

        // Tags if present
        if (comment.tags && comment.tags.length > 0) {
            lines.push(`**Tags:** ${comment.tags.join(', ')}`);
            lines.push('');
        }

        // Action requested
        lines.push('**Requested Action:** Revise this section to address the comment.');

        return lines;
    }

    /**
     * Generate a JSON-formatted prompt
     */
    protected generateJsonPrompt(
        comments: MarkdownComment[],
        options: PromptGenerationOptions
    ): string {
        const output: any = {
            task: 'Document Revision',
            instructions: options.customInstructions || 'For each comment, modify the corresponding section in the file to address the feedback.',
            comments: []
        };

        if (options.groupByFile) {
            const grouped = this.groupCommentsByFile(comments);
            output.files = [];

            Array.from(grouped.entries()).forEach(([filePath, fileComments]) => {
                const fileEntry: any = {
                    filePath,
                    comments: fileComments.map((c, i) => this.formatCommentAsJson(c, i + 1, options))
                };

                if (options.includeFullFileContent) {
                    fileEntry.fullContent = this.readFileContent(filePath);
                }

                output.files.push(fileEntry);
            });
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
        comment: MarkdownComment,
        index: number,
        options: PromptGenerationOptions
    ): any {
        const result: any = {
            index,
            selectedText: comment.selectedText,
            comment: comment.comment
        };

        if (options.includeLineNumbers) {
            result.lineRange = {
                start: comment.selection.startLine,
                end: comment.selection.endLine
            };
        }

        if (comment.tags && comment.tags.length > 0) {
            result.tags = comment.tags;
        }

        return result;
    }


    /**
     * Get a summary of open user comments.
     * AI-generated comments are excluded from the summary.
     * Override to provide markdown-specific formatting.
     */
    override getCommentsSummary(): string {
        const openComments = this.getFilteredOpenComments();
        const grouped = this.groupCommentsByFile(openComments);

        const lines: string[] = [
            `**Open Comments: ${openComments.length}**`,
            ''
        ];

        for (const [filePath, comments] of grouped) {
            lines.push(`- ${path.basename(filePath)}: ${comments.length} comment(s)`);
        }

        return lines.join('\n');
    }

    /**
     * Generate multiple prompts if comments exceed the limit.
     * AI-generated comments are excluded from the prompts.
     */
    generatePrompts(options: Partial<PromptGenerationOptions> = {}): string[] {
        const opts: PromptGenerationOptions = {
            ...DEFAULT_PROMPT_OPTIONS,
            ...options
        };

        // Filter to only include user comments, excluding AI-generated comments
        const openComments = this.commentsManager.getOpenComments()
            .filter(c => isUserComment(c));

        if (openComments.length === 0) {
            return ['No open comments to process.'];
        }

        const maxPerPrompt = opts.maxCommentsPerPrompt || Infinity;

        if (openComments.length <= maxPerPrompt) {
            return [this.generateMarkdownPrompt(openComments, opts)];
        }

        // Split into multiple prompts
        const chunks = this.splitCommentsIntoChunks(openComments, maxPerPrompt);
        return chunks.map((chunk, index) => {
            const header = `# Part ${index + 1} of ${chunks.length}\n\n`;
            return header + this.generateMarkdownPrompt(chunk, opts);
        });
    }
}
