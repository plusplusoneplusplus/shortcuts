/**
 * Typed message unions for the Markdown Review Editor protocol.
 *
 * The discriminated unions use direction-agnostic names:
 *   • WebviewToBackendMessage — messages sent from the UI to the backend
 *   • BackendToWebviewMessage — messages sent from the backend to the UI
 *
 * "Backend" can be the VS Code extension host OR a standalone HTTP server.
 */

import type { SerializedAICommand, SerializedAIMenuConfig, AICommandMode } from '../ai';
import type { PromptFileInfo, SkillInfo as DiscoverySkillInfo } from '../discovery';
import type { CommentSelection, MarkdownComment, MermaidContext } from './types';

// ---------------------------------------------------------------------------
// Re-export referenced types for convenience
// ---------------------------------------------------------------------------

export type { PromptFileInfo };

/**
 * Skill info as seen by the webview — a subset of the discovery SkillInfo
 * (omits `sourceFolder` which the UI does not need).
 */
export interface SkillInfo {
    absolutePath: string;
    relativePath: string;
    name: string;
    description?: string;
}

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

/** Serialized predefined comment for webview */
export interface SerializedPredefinedComment {
    id: string;
    label: string;
    text: string;
    order: number;
    description?: string;
}

/** Webview-level settings sent with each state update */
export interface WebviewSettings {
    showResolved: boolean;
    askAIEnabled?: boolean;
    aiCommands?: SerializedAICommand[];
    aiMenuConfig?: SerializedAIMenuConfig;
    predefinedComments?: SerializedPredefinedComment[];
    collapsedSections?: string[];
}

/** Selection info for creating a new comment */
export interface PendingSelection extends CommentSelection {
    selectedText: string;
    mermaidContext?: MermaidContext;
}

/**
 * AI instruction type — a string to support dynamic command IDs.
 * Default commands: 'clarify', 'go-deeper', 'custom'.
 */
export type AIInstructionType = string;

/** Context data sent from webview to backend when "Ask AI" is triggered */
export interface AskAIContext {
    selectedText: string;
    startLine: number;
    endLine: number;
    surroundingLines: string;
    nearestHeading: string | null;
    allHeadings: string[];
    instructionType: AIInstructionType;
    customInstruction?: string;
    mode: AICommandMode;
    promptFilePath?: string;
    skillName?: string;
}

/** Recent prompt info for quick access */
export interface RecentPrompt {
    absolutePath: string;
    relativePath: string;
    name: string;
    lastUsed: number;
}

/** Unified recent item supporting both prompts and skills */
export interface RecentItem {
    type: 'prompt' | 'skill';
    identifier: string;
    name: string;
    relativePath?: string;
    lastUsed: number;
}

/** AI model option for dialog dropdown */
export interface AIModelOption {
    id: string;
    label: string;
    description?: string;
    isDefault?: boolean;
}

/** Options selected in the Follow Prompt dialog */
export interface FollowPromptDialogOptions {
    mode: 'interactive' | 'background';
    model: string;
    additionalContext?: string;
}

/** A single line change indicator */
export interface LineChange {
    line: number;
    type: 'added' | 'modified';
}

// ---------------------------------------------------------------------------
// Webview → Backend messages (34 variants)
// ---------------------------------------------------------------------------

export type WebviewToBackendMessage =
    | { type: 'ready' }
    | { type: 'requestState' }
    | { type: 'addComment'; selection: PendingSelection; comment: string; mermaidContext?: MermaidContext }
    | { type: 'editComment'; commentId: string; comment: string }
    | { type: 'deleteComment'; commentId: string }
    | { type: 'resolveComment'; commentId: string }
    | { type: 'reopenComment'; commentId: string }
    | { type: 'resolveAll' }
    | { type: 'deleteAll' }
    | { type: 'updateContent'; content: string }
    | { type: 'generatePrompt'; promptOptions: { format: string } }
    | { type: 'copyPrompt'; promptOptions: { format: string } }
    | { type: 'sendToChat'; promptOptions: { format: string; newConversation?: boolean } }
    | { type: 'sendCommentToChat'; commentId: string; newConversation: boolean }
    | { type: 'sendToCLIInteractive'; promptOptions: { format: string } }
    | { type: 'sendToCLIBackground'; promptOptions: { format: string } }
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
    | { type: 'requestUpdateDocumentDialog' }
    | { type: 'requestRefreshPlanDialog' }
    | { type: 'refreshPlan'; additionalContext?: string };

// ---------------------------------------------------------------------------
// Backend → Webview messages (8 variants)
// ---------------------------------------------------------------------------

export type BackendToWebviewMessage =
    | {
        type: 'update';
        content: string;
        comments: MarkdownComment[];
        filePath: string;
        fileDir?: string;
        workspaceRoot?: string;
        settings?: WebviewSettings;
        isExternalChange?: boolean;
        lineChanges?: LineChange[];
    }
    | { type: 'imageResolved'; imgId: string; uri?: string; alt?: string; error?: string }
    | { type: 'scrollToComment'; commentId: string }
    | { type: 'promptFilesResponse'; promptFiles: PromptFileInfo[]; recentPrompts?: RecentPrompt[]; recentItems?: RecentItem[]; skills?: SkillInfo[] }
    | { type: 'skillsResponse'; skills: SkillInfo[] }
    | { type: 'showFollowPromptDialog'; promptName: string; promptFilePath: string; skillName?: string; availableModels: AIModelOption[]; defaults: { mode: 'interactive' | 'background'; model: string } }
    | { type: 'showUpdateDocumentDialog' }
    | { type: 'showRefreshPlanDialog' };

// ---------------------------------------------------------------------------
// Convenience alias
// ---------------------------------------------------------------------------

/** Any message exchanged between the webview and the backend */
export type EditorMessage = WebviewToBackendMessage | BackendToWebviewMessage;
