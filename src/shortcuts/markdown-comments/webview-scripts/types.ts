/**
 * Browser-specific types for the webview
 */

import { CommentSelection, MarkdownComment, MermaidContext } from '../types';
import { LineChange } from '../line-change-tracker';

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
 * Mode for AI command execution
 * - 'comment': AI response is added as a comment in the document (default)
 * - 'interactive': Opens an interactive AI session in external terminal
 * - 'background': Runs in background via SDK, tracks progress in AI Processes panel
 * - 'queued': Adds to queue for sequential execution
 */
export type AICommandMode = 'comment' | 'interactive' | 'background' | 'queued';

/**
 * Serialized AI command for webview
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
 * Serialized AI menu configuration for webview
 * Contains both comment and interactive mode commands
 */
export interface SerializedAIMenuConfig {
    /** Commands for "Ask AI to Comment" menu */
    commentCommands: SerializedAICommand[];
    /** Commands for "Ask AI Interactively" menu */
    interactiveCommands: SerializedAICommand[];
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
    /** Full AI menu configuration with both comment and interactive modes */
    aiMenuConfig?: SerializedAIMenuConfig;
    /** Predefined comment templates */
    predefinedComments?: SerializedPredefinedComment[];
    /** Collapsed section anchor IDs (for heading collapse persistence) */
    collapsedSections?: string[];
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
    /** Mode for AI command execution ('comment' or 'interactive') */
    mode: AICommandMode;
    /** Optional path to prompt file to include as context */
    promptFilePath?: string;
    /** Optional skill name to use for this request */
    skillName?: string;
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
    | { type: 'sendToCLIInteractive'; promptOptions: { format: string } }
    | { type: 'sendToCLIBackground'; promptOptions: { format: string } }
    | { type: 'addComment'; selection: PendingSelection; comment: string; mermaidContext?: MermaidContext }
    | { type: 'editComment'; commentId: string; comment: string }
    | { type: 'resolveComment'; commentId: string }
    | { type: 'reopenComment'; commentId: string }
    | { type: 'deleteComment'; commentId: string }
    | { type: 'updateContent'; content: string }
    | { type: 'resolveImagePath'; path: string; imgId: string }
    | { type: 'openFile'; path: string }
    | { type: 'askAI'; context: AskAIContext }
    | { type: 'askAIInteractive'; context: AskAIContext }
    | { type: 'askAIQueued'; context: AskAIContext }
    | { type: 'collapsedSectionsChanged'; collapsedSections: string[] }
    | { type: 'requestPromptFiles' }
    | { type: 'requestSkills' }
    | { type: 'executeWorkPlan'; promptFilePath: string }
    | { type: 'executeWorkPlanWithSkill'; skillName: string }
    | { type: 'promptSearch' }
    | { type: 'showFollowPromptDialog'; promptFilePath: string; promptName: string; skillName?: string }
    | { type: 'followPromptDialogResult'; promptFilePath: string; skillName?: string; options: FollowPromptDialogOptions }
    | { type: 'copyFollowPrompt'; promptFilePath: string; skillName?: string; additionalContext?: string }
    | { type: 'updateDocument'; instruction: string }
    | { type: 'requestRefreshPlanDialog' }
    | { type: 'refreshPlan'; additionalContext?: string };

/**
 * Options selected in the Follow Prompt dialog
 */
export interface FollowPromptDialogOptions {
    /** Execution mode */
    mode: 'interactive' | 'background' | 'queued';
    /** AI model to use */
    model: string;
    /** Additional context/instructions */
    additionalContext?: string;
    /** Priority for queued mode */
    priority?: 'high' | 'normal' | 'low';
}

/**
 * Prompt file info for Execute Work Plan feature
 */
export interface PromptFileInfo {
    /** Absolute path to the prompt file */
    absolutePath: string;
    /** Path relative to the workspace root */
    relativePath: string;
    /** File name without .prompt.md extension */
    name: string;
    /** The folder this file was found in (from settings) */
    sourceFolder: string;
}

/**
 * Skill info for skills submenu
 */
export interface SkillInfo {
    /** Absolute path to the skill directory */
    absolutePath: string;
    /** Path relative to the workspace root */
    relativePath: string;
    /** Skill name (directory name) */
    name: string;
    /** Optional description from SKILL.md frontmatter */
    description?: string;
}

/**
 * Recent prompt info for quick access
 */
export interface RecentPrompt {
    /** Absolute path to the prompt file */
    absolutePath: string;
    /** Path relative to the workspace root */
    relativePath: string;
    /** File name without .prompt.md extension */
    name: string;
    /** Timestamp when last used */
    lastUsed: number;
}

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
        /** Line changes for showing change indicators (only present on external changes) */
        lineChanges?: LineChange[];
    }
    | { type: 'imageResolved'; imgId: string; uri?: string; alt?: string; error?: string }
    | { type: 'scrollToComment'; commentId: string }
    | { type: 'promptFilesResponse'; promptFiles: PromptFileInfo[]; recentPrompts?: RecentPrompt[]; skills?: SkillInfo[] }
    | { type: 'skillsResponse'; skills: SkillInfo[] }
    | { type: 'showFollowPromptDialog'; promptName: string; promptFilePath: string; skillName?: string; availableModels: AIModelOption[]; defaults: { mode: 'interactive' | 'background' | 'queued'; model: string } }
    | { type: 'showUpdateDocumentDialog' }
    | { type: 'showRefreshPlanDialog' };

/**
 * AI model option for dialog dropdown
 */
export interface AIModelOption {
    /** Model identifier */
    id: string;
    /** Display label */
    label: string;
    /** Optional description */
    description?: string;
    /** Whether this is the default/recommended model */
    isDefault?: boolean;
}

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

