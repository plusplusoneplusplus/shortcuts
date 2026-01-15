/**
 * Browser-specific types for the webview
 */

import { CommentSelection, MarkdownComment, MermaidContext } from '../types';

/**
 * VS Code API interface (provided by acquireVsCodeApi)
 */
export interface VsCodeApi {
    postMessage(message: WebviewMessage): void;
    getState(): WebviewState | undefined;
    setState(state: WebviewState): void;
}

/**
 * Webview state
 */
export interface WebviewState {
    currentContent: string;
    comments: MarkdownComment[];
    filePath: string;
    fileDir: string;
    workspaceRoot: string;
    settings: WebviewSettings;
}

/**
 * Serialized AI command for webview
 */
export interface SerializedAICommand {
    id: string;
    label: string;
    icon?: string;
    order?: number;
    isCustomInput?: boolean;
}

/**
 * Serialized predefined comment for webview
 */
export interface SerializedPredefinedComment {
    id: string;
    label: string;
    text: string;
    order: number;
    description?: string;
}

/**
 * Webview settings
 */
export interface WebviewSettings {
    showResolved: boolean;
    /** Whether the Ask AI feature is enabled (preview) */
    askAIEnabled?: boolean;
    /** Configurable AI commands */
    aiCommands?: SerializedAICommand[];
    /** Predefined comment templates */
    predefinedComments?: SerializedPredefinedComment[];
}

/**
 * Selection info for creating a new comment
 */
export interface PendingSelection extends CommentSelection {
    selectedText: string;
    mermaidContext?: MermaidContext;
}

/**
 * Saved selection for context menu
 */
export interface SavedSelection extends PendingSelection {
    range: Range;
    rect: DOMRect;
}

/**
 * AI instruction type for different kinds of AI queries.
 * This is now a string to support dynamic command IDs from the registry.
 */
export type AIInstructionType = string;

/**
 * Context data sent from webview to extension when "Ask AI" is triggered
 */
export interface AskAIContext {
    /** The selected text to clarify */
    selectedText: string;
    /** Selection start line (1-based) */
    startLine: number;
    /** Selection end line (1-based) */
    endLine: number;
    /** Context lines around selection */
    surroundingLines: string;
    /** Heading above selection */
    nearestHeading: string | null;
    /** Document structure - all headings */
    allHeadings: string[];
    /** Command ID from the AI command registry */
    instructionType: AIInstructionType;
    /** Custom instruction text (only used when command has isCustomInput=true) */
    customInstruction?: string;
}

/**
 * Active comment bubble info
 */
export interface ActiveCommentBubble {
    element: HTMLElement;
    anchor: HTMLElement;
    isFixed: boolean;
}

/**
 * Messages sent from webview to extension
 */
export type WebviewMessage =
    | { type: 'ready' }
    | { type: 'resolveAll' }
    | { type: 'deleteAll' }
    | { type: 'copyPrompt'; promptOptions: { format: string } }
    | { type: 'sendToChat'; promptOptions: { format: string; newConversation?: boolean } }
    | { type: 'sendCommentToChat'; commentId: string; newConversation: boolean }
    | { type: 'addComment'; selection: PendingSelection; comment: string; mermaidContext?: MermaidContext }
    | { type: 'editComment'; commentId: string; comment: string }
    | { type: 'resolveComment'; commentId: string }
    | { type: 'reopenComment'; commentId: string }
    | { type: 'deleteComment'; commentId: string }
    | { type: 'updateContent'; content: string }
    | { type: 'resolveImagePath'; path: string; imgId: string }
    | { type: 'openFile'; path: string }
    | { type: 'askAI'; context: AskAIContext };

/**
 * Messages sent from extension to webview
 */
export type ExtensionMessage =
    | {
        type: 'update';
        content: string;
        comments: MarkdownComment[];
        filePath: string;
        fileDir?: string;
        workspaceRoot?: string;
        settings?: WebviewSettings;
        /** True if this update is from an external change (undo/redo, external editor) */
        isExternalChange?: boolean;
    }
    | { type: 'imageResolved'; imgId: string; uri?: string; alt?: string; error?: string }
    | { type: 'scrollToComment'; commentId: string };

/**
 * Parsed code block structure
 */
export interface CodeBlock {
    language: string;
    startLine: number;
    endLine: number;
    code: string;
    id: string;
    isMermaid: boolean;
}

/**
 * Parsed table structure
 */
export interface ParsedTable {
    startLine: number;
    endLine: number;
    headers: string[];
    alignments: Array<'left' | 'center' | 'right'>;
    rows: string[][];
    id: string;
}

/**
 * Global declarations for libraries loaded via CDN
 */
declare global {
    interface Window {
        mermaid: {
            initialize(config: object): void;
            render(id: string, code: string): Promise<{ svg: string }>;
        };
    }

    const hljs: {
        highlight(code: string, options: { language: string }): { value: string };
        highlightAuto(code: string): { value: string };
        getLanguage(name: string): object | undefined;
    };
}

