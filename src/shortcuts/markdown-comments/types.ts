/**
 * Types and interfaces for the Markdown Comments feature
 *
 * Core domain types are re-exported from pipeline-core.
 * Extension-specific types (AI, prompts, events) remain local.
 */

// Import generic AI types from ai-service
import { AIProcessStatus, AIToolType } from '../ai-service';

// Re-export for backward compatibility
export type { AIProcessStatus, AIToolType };

// Re-export core domain types from pipeline-core (subpath for browser-safe webview bundling)
export {
    CommentStatus,
    CommentType,
    CommentSelection,
    CommentAnchor,
    MermaidContext,
    MarkdownComment,
    isUserComment,
    CommentsSettings,
    CommentsConfig,
    DEFAULT_COMMENTS_SETTINGS,
    DEFAULT_COMMENTS_CONFIG
} from '@plusplusoneplusplus/pipeline-core/editor/types';

import type { CommentSelection, MarkdownComment } from '@plusplusoneplusplus/pipeline-core/editor/types';

/**
 * Result of anchor relocation attempt (extension-specific format with nested selection)
 */
export interface AnchorRelocationResult {
    /** Whether the anchor was successfully relocated */
    found: boolean;
    /** The new selection if found */
    selection?: CommentSelection;
    /** Confidence score of the match (0-1) */
    confidence: number;
    /** Reason for the result */
    reason: 'exact_match' | 'fuzzy_match' | 'context_match' | 'line_fallback' | 'not_found';
}

/**
 * Comments configuration file name
 */
export const COMMENTS_CONFIG_FILE = 'md-comments.json';

/**
 * Options for prompt generation
 */
export interface PromptGenerationOptions {
    /** Include entire file in prompt */
    includeFullFileContent: boolean;
    /** Group comments by file */
    groupByFile: boolean;
    /** Include exact line numbers */
    includeLineNumbers: boolean;
    /** Custom instructions at the start */
    customPreamble?: string;
    /** Custom instructions at the end */
    customInstructions?: string;
    /** Maximum comments per prompt (split large prompts) */
    maxCommentsPerPrompt?: number;
    /** Output format */
    outputFormat: 'markdown' | 'json';
}

/**
 * Default prompt generation options
 */
export const DEFAULT_PROMPT_OPTIONS: PromptGenerationOptions = {
    includeFullFileContent: false,
    groupByFile: true,
    includeLineNumbers: true,
    outputFormat: 'markdown'
};

/**
 * Comment event types for the event emitter
 */
export type CommentEventType =
    | 'comment-added'
    | 'comment-updated'
    | 'comment-deleted'
    | 'comment-resolved'
    | 'comment-reopened'
    | 'comments-loaded';

/**
 * Comment event data
 */
export interface CommentEvent {
    type: CommentEventType;
    comment?: MarkdownComment;
    comments?: MarkdownComment[];
    filePath?: string;
}

/**
 * Tree item data for the comments panel
 */
export interface CommentTreeItemData {
    type: 'file' | 'comment';
    filePath?: string;
    comment?: MarkdownComment;
    commentCount?: number;
}

/**
 * AI instruction types for different kinds of queries.
 * This is now a string to support dynamic command IDs from the registry.
 * Default commands: 'clarify', 'go-deeper', 'custom'
 */
export type AIInstructionType = string;

/**
 * Document context for AI clarification requests
 */
export interface ClarificationContext {
    /** The selected text to clarify */
    selectedText: string;
    /** Selection line range */
    selectionRange: {
        startLine: number;
        endLine: number;
    };
    /** File being reviewed */
    filePath: string;
    /** Surrounding lines for context */
    surroundingContent: string;
    /** Nearest heading above selection */
    nearestHeading: string | null;
    /** All document headings for structure */
    headings: string[];
    /** Type of AI instruction */
    instructionType: AIInstructionType;
    /** Custom instruction text (only used when instructionType is 'custom') */
    customInstruction?: string;
    /** Optional content from a prompt file to include */
    promptFileContent?: string;
    /** Optional name of the skill being used */
    skillName?: string;
}

/**
 * Configuration for AI clarification feature
 */
export interface AIClarificationConfig {
    /** Which AI tool to use */
    tool: AIToolType;
}

/**
 * Legacy type alias for backward compatibility
 * @deprecated Use AIProcessStatus from ai-service instead
 */
export type ClarificationProcessStatus = AIProcessStatus;

/**
 * Legacy interface for backward compatibility
 * @deprecated Use AIProcess from ai-service instead
 */
export interface ClarificationProcess {
    /** Unique identifier */
    id: string;
    /** Preview of the prompt (first ~50 chars) */
    promptPreview: string;
    /** Full prompt text */
    fullPrompt: string;
    /** Current status */
    status: ClarificationProcessStatus;
    /** When the process started */
    startTime: Date;
    /** When the process ended (if finished) */
    endTime?: Date;
    /** Error message if failed */
    error?: string;
    /** The clarification result if completed */
    result?: string;
}
