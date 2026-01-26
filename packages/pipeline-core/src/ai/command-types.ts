/**
 * AI Command Types
 *
 * Type definitions for configurable AI commands.
 * These are pure types with no VS Code dependencies.
 */

import { DEFAULT_PROMPTS } from './types';

/**
 * Mode for AI command execution
 * - 'comment': AI response is added as a comment in the document (default)
 * - 'interactive': Opens an interactive AI session in external terminal
 */
export type AICommandMode = 'comment' | 'interactive';

/**
 * An AI command that can be invoked from the review editor
 */
export interface AICommand {
    /** Unique identifier for the command */
    id: string;

    /** Display label in menus */
    label: string;

    /** Emoji or codicon icon (optional) */
    icon?: string;

    /**
     * Prompt template. Supports variables:
     * - {{selection}} - The selected text
     * - {{file}} - The file path
     * - {{heading}} - The nearest heading above selection
     * - {{context}} - Surrounding content
     */
    prompt: string;

    /** Display order in menus (lower = first) */
    order?: number;

    /** If true, shows input dialog for custom prompt */
    isCustomInput?: boolean;

    /** Label prefix for AI response comments */
    responseLabel?: string;

    /** Comment type for styling differentiation */
    commentType?: 'ai-clarification' | 'ai-critique' | 'ai-suggestion' | 'ai-question';
}

/**
 * Configuration structure for AI commands in settings
 */
export interface AICommandsConfig {
    commands: AICommand[];
}

/**
 * Default AI commands when none are configured
 */
export const DEFAULT_AI_COMMANDS: AICommand[] = [
    {
        id: 'clarify',
        label: 'Clarify',
        icon: '💡',
        prompt: DEFAULT_PROMPTS.clarify,
        order: 1,
        commentType: 'ai-clarification',
        responseLabel: '🤖 **AI Clarification:**'
    },
    {
        id: 'go-deeper',
        label: 'Go Deeper',
        icon: '🔍',
        prompt: DEFAULT_PROMPTS.goDeeper,
        order: 2,
        commentType: 'ai-clarification',
        responseLabel: '🔍 **AI Deep Analysis:**'
    },
    {
        id: 'custom',
        label: 'Custom...',
        icon: '💬',
        prompt: DEFAULT_PROMPTS.customDefault,
        order: 99,
        isCustomInput: true,
        responseLabel: '🤖 **AI Response:**'
    }
];

/**
 * Serialized format of AI command for sending to webview
 */
export interface SerializedAICommand {
    id: string;
    label: string;
    icon?: string;
    order?: number;
    isCustomInput?: boolean;
    /** Prompt text shown in hover preview tooltip */
    prompt?: string;
}

/**
 * Serialized format of AI menu configuration for webview
 * Contains both comment and interactive mode commands
 */
export interface SerializedAIMenuConfig {
    /** Commands for "Ask AI to Comment" menu */
    commentCommands: SerializedAICommand[];
    /** Commands for "Ask AI Interactively" menu */
    interactiveCommands: SerializedAICommand[];
}

/**
 * Convert AICommand to serialized format for webview
 */
export function serializeCommand(command: AICommand): SerializedAICommand {
    return {
        id: command.id,
        label: command.label,
        icon: command.icon,
        order: command.order,
        isCustomInput: command.isCustomInput,
        prompt: command.prompt
    };
}

/**
 * Convert array of AICommands to serialized format
 */
export function serializeCommands(commands: AICommand[]): SerializedAICommand[] {
    return commands.map(serializeCommand);
}
