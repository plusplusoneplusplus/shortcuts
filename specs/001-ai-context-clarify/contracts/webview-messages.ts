/**
 * Contract: Webview Message Types for AI Clarification
 *
 * This file defines the message interface between the webview and extension
 * for the AI clarification feature.
 */

/**
 * Document context sent with AI clarification requests
 */
export interface AskAIContext {
    /** The text the user selected for clarification */
    selectedText: string;

    /** Selection position in the document */
    selection: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
    };

    /** Lines surrounding the selection for context (±5 lines) */
    surroundingContent: string;

    /** The nearest markdown heading above the selection, if any */
    nearestHeading: string | null;

    /** All markdown headings in the document for structure context */
    documentHeadings: string[];
}

/**
 * Message sent from webview to extension when user clicks "Ask AI"
 *
 * Add to existing WebviewMessage union type in webview-scripts/types.ts:
 *
 * ```typescript
 * export type WebviewMessage =
 *   | { type: 'ready' }
 *   | { type: 'addComment'; selection: CommentSelection; comment: string; mermaidContext?: MermaidContext }
 *   | { type: 'editComment'; commentId: string; comment: string }
 *   | { type: 'deleteComment'; commentId: string }
 *   | { type: 'resolveComment'; commentId: string }
 *   | { type: 'reopenComment'; commentId: string }
 *   | { type: 'resolveAll' }
 *   | { type: 'deleteAll' }
 *   | { type: 'copyPrompt'; promptOptions: { format: string } }
 *   | { type: 'updateContent'; content: string }
 *   | { type: 'resolveImagePath'; path: string; imgId: string }
 *   | { type: 'openFile'; path: string }
 *   | { type: 'askAI'; context: AskAIContext }  // <-- NEW
 * ```
 */
export interface AskAIMessage {
    type: 'askAI';
    context: AskAIContext;
}

/**
 * VS Code Settings Schema for AI Clarification
 *
 * Add to package.json under contributes.configuration.properties:
 *
 * ```json
 * "workspaceShortcuts.aiClarification.tool": {
 *     "type": "string",
 *     "enum": ["copilot-cli", "clipboard"],
 *     "enumDescriptions": [
 *         "Send clarification request to GitHub Copilot CLI in a new terminal",
 *         "Copy the clarification prompt to clipboard for manual use"
 *     ],
 *     "default": "copilot-cli",
 *     "description": "Select the AI tool to use for clarification requests in the review editor"
 * }
 * ```
 */
export type AIToolSetting = 'copilot-cli' | 'clipboard';

/**
 * Prompt Format Contract
 *
 * The generated prompt should follow this structure:
 *
 * ```markdown
 * # Clarification Request
 *
 * **File:** {filePath}
 * **Section:** {nearestHeading or "Document"}
 *
 * ## Selected Text
 *
 * ```
 * {selectedText}
 * ```
 *
 * ## Context
 *
 * {surroundingContent}
 *
 * ## Request
 *
 * Please help me understand or clarify the selected text above.
 * Explain any concepts, terminology, or implications that may not be immediately clear.
 * ```
 *
 * Maximum total prompt size: 8000 characters
 * Truncation strategy: Reduce surroundingContent first, preserve selectedText
 */
export const PROMPT_MAX_SIZE = 8000;
