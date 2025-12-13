/**
 * Browser-specific types for the webview
 */

import { MarkdownComment, CommentsSettings, CommentSelection, MermaidContext } from '../types';

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
 * Webview settings
 */
export interface WebviewSettings {
    showResolved: boolean;
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
    | { type: 'addComment'; selection: PendingSelection; comment: string; mermaidContext?: MermaidContext }
    | { type: 'editComment'; commentId: string; comment: string }
    | { type: 'resolveComment'; commentId: string }
    | { type: 'reopenComment'; commentId: string }
    | { type: 'deleteComment'; commentId: string }
    | { type: 'updateContent'; content: string }
    | { type: 'resolveImagePath'; path: string; imgId: string };

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
    }
    | { type: 'imageResolved'; imgId: string; uri?: string; alt?: string; error?: string };

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

