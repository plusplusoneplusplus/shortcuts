/**
 * AI Service Types (Pure Node.js)
 * 
 * Core types for AI service operations. These types are VS Code-free
 * and can be used in CLI tools, tests, and other Node.js environments.
 */

/**
 * Supported AI backends for invocation.
 * - 'copilot-sdk': Use the @github/copilot-sdk for structured JSON-RPC communication
 * - 'copilot-cli': Use the copilot CLI via child process (legacy)
 * - 'clipboard': Copy prompt to clipboard for manual use
 */
export type AIBackendType = 'copilot-sdk' | 'copilot-cli' | 'clipboard';

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
 * Default prompt templates for different instruction types
 */
export const DEFAULT_PROMPTS = {
    clarify: `Please clarify the following snippet with more depth.

- Explain what it does in plain language.
- Walk through the key steps, including control flow and data flow.
- State any assumptions you are making from limited context.
- Call out ambiguities and ask up to 3 targeted questions.
- Suggest 2 to 3 concrete next checks, such as what to inspect or test next.

Snippet`,
    goDeeper: `Please provide an in-depth explanation and analysis of the following snippet.

Go beyond a summary and explore the surrounding implications.

- Intent and responsibilities in the broader system.
- Step-by-step control flow and data flow.
- Edge cases and failure modes, including correctness, security, and performance.
- Likely dependencies and impacts, and what else to inspect.
- Concrete improvements or refactors with tradeoffs.
- How to validate, including focused tests, repro steps, or logs.

Snippet`,
    customDefault: 'Please explain the following snippet'
} as const;

/**
 * Supported CLI tools for interactive sessions
 */
export type InteractiveToolType = 'copilot' | 'claude';
