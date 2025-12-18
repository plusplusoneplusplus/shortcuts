/**
 * Generic AI Service Types
 * 
 * Types and interfaces for the AI service module.
 * These are generic types used across different AI tool integrations.
 */

/**
 * Supported AI tools for invocation
 */
export type AIToolType = 'copilot-cli' | 'clipboard';

/**
 * Valid AI model options for Copilot CLI
 */
export const VALID_MODELS = [
    'claude-sonnet-4.5',
    'claude-haiku-4.5',
    'claude-opus-4.5',
    'gpt-5.1-codex-max',
    'gemini-3-pro-preview'
] as const;

export type AIModel = typeof VALID_MODELS[number];

/**
 * Status of an AI process
 */
export type AIProcessStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Result of an AI invocation
 */
export interface AIInvocationResult {
    /** Whether the invocation was successful */
    success: boolean;
    /** The response text from the AI (if successful) */
    response?: string;
    /** Error message (if failed) */
    error?: string;
}

/**
 * A tracked AI process
 */
export interface AIProcess {
    /** Unique identifier */
    id: string;
    /** Preview of the prompt (first ~50 chars) */
    promptPreview: string;
    /** Full prompt text */
    fullPrompt: string;
    /** Current status */
    status: AIProcessStatus;
    /** When the process started */
    startTime: Date;
    /** When the process ended (if finished) */
    endTime?: Date;
    /** Error message if failed */
    error?: string;
    /** The AI response if completed */
    result?: string;
}

/**
 * Default prompt templates for different instruction types
 */
export const DEFAULT_PROMPTS = {
    clarify: 'Please clarify',
    goDeeper: 'Please provide an in-depth explanation and analysis of',
    customDefault: 'Please explain'
} as const;

/**
 * Event types for process changes
 */
export type ProcessEventType = 'process-added' | 'process-updated' | 'process-removed' | 'processes-cleared';

/**
 * Process change event
 */
export interface ProcessEvent {
    type: ProcessEventType;
    process?: AIProcess;
}

