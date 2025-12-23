/**
 * Types for the diff webview scripts (browser-side)
 */

/**
 * Which side of the diff
 */
export type DiffSide = 'old' | 'new' | 'both';

/**
 * Comment status
 */
export type DiffCommentStatus = 'open' | 'resolved' | 'pending';

/**
 * Selection in the diff view
 */
export interface DiffSelection {
    side: DiffSide;
    oldStartLine: number | null;
    oldEndLine: number | null;
    newStartLine: number | null;
    newEndLine: number | null;
    startColumn: number;
    endColumn: number;
}

/**
 * Git context for comments
 */
export interface DiffGitContext {
    repositoryRoot: string;
    repositoryName: string;
    oldRef: string;
    newRef: string;
    wasStaged: boolean;
    commitHash?: string;
}

/**
 * A diff comment
 */
export interface DiffComment {
    id: string;
    filePath: string;
    selection: DiffSelection;
    selectedText: string;
    comment: string;
    status: DiffCommentStatus;
    createdAt: string;
    updatedAt: string;
    author?: string;
    tags?: string[];
    gitContext: DiffGitContext;
}

/**
 * Settings for display
 */
export interface DiffCommentsSettings {
    showResolved: boolean;
    highlightColor: string;
    resolvedHighlightColor: string;
    /** Whether Ask AI feature is enabled */
    askAIEnabled?: boolean;
}

/**
 * Initial data passed from extension
 */
export interface InitialData {
    filePath: string;
    oldContent: string;
    newContent: string;
    gitContext: DiffGitContext;
    /** Whether the new content is editable (uncommitted changes) */
    isEditable?: boolean;
}

/**
 * Message from extension to webview
 */
export interface ExtensionMessage {
    type: 'update' | 'commentAdded' | 'commentUpdated' | 'commentDeleted' | 'scrollToComment';
    oldContent?: string;
    newContent?: string;
    comments?: DiffComment[];
    filePath?: string;
    settings?: DiffCommentsSettings;
    comment?: DiffComment;
    /** Comment ID to scroll to (for scrollToComment message) */
    scrollToCommentId?: string;
    /** Whether the new content is editable (uncommitted changes) */
    isEditable?: boolean;
}

/**
 * AI instruction type for Ask AI feature
 */
export type DiffAIInstructionType = 'clarify' | 'go-deeper' | 'custom';

/**
 * Context for Ask AI request
 */
export interface AskAIContext {
    selectedText: string;
    startLine: number;
    endLine: number;
    side: DiffSide;
    surroundingLines: string;
    instructionType: DiffAIInstructionType;
    customInstruction?: string;
}

/**
 * Message from webview to extension
 */
export interface WebviewMessage {
    type: 'addComment' | 'editComment' | 'deleteComment' | 'resolveComment' |
          'reopenComment' | 'ready' | 'requestState' | 'openFile' | 'copyPath' | 'askAI' | 'saveContent' | 'contentModified';
    commentId?: string;
    selection?: DiffSelection;
    selectedText?: string;
    comment?: string;
    /** File path to open (for openFile message) */
    fileToOpen?: string;
    /** File path to copy (for copyPath message) */
    pathToCopy?: string;
    /** AI clarification context (for askAI message) */
    context?: AskAIContext;
    /** New content to save (for saveContent message) */
    newContent?: string;
    /** Whether content has been modified (for contentModified message) */
    isDirty?: boolean;
}

/**
 * Diff line type
 */
export type DiffLineType = 'context' | 'addition' | 'deletion' | 'header';

/**
 * Parsed diff line
 */
export interface DiffLine {
    type: DiffLineType;
    content: string;
    oldLineNumber: number | null;
    newLineNumber: number | null;
}

/**
 * Current selection state
 */
export interface SelectionState {
    side: DiffSide;
    startLine: number;
    endLine: number;
    startColumn: number;
    endColumn: number;
    selectedText: string;
}

/**
 * VSCode API interface (provided by webview)
 */
export interface VSCodeAPI {
    postMessage(message: WebviewMessage): void;
    getState(): any;
    setState(state: any): void;
}

/**
 * Global window extensions
 */
declare global {
    interface Window {
        initialData: InitialData;
        acquireVsCodeApi(): VSCodeAPI;
    }
}

