/**
 * Shared Context Menu Types
 * 
 * Type definitions for the shared context menu module used by both
 * markdown review editor and git diff review editor.
 */

/**
 * Mode for AI command execution
 * - 'comment': AI response is added as a comment in the document (default)
 * - 'interactive': Opens an interactive AI session in external terminal
 */
export type AICommandMode = 'comment' | 'interactive';

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
 * Context menu configuration options
 */
export interface ContextMenuConfig {
    /** Enable Cut/Copy/Paste menu items (default: false) */
    enableClipboardItems?: boolean;
    /** Enable preview tooltips on hover (default: false) */
    enablePreviewTooltips?: boolean;
    /** Minimum width of the context menu in pixels (default: 150) */
    minWidth?: number;
    /** Border radius in pixels (default: 4) */
    borderRadius?: number;
    /** Whether to show rich menu items with icons and shortcuts (default: false) */
    richMenuItems?: boolean;
    /** CSS class prefix for custom styling (default: '') */
    classPrefix?: string;
}

/**
 * Context menu item definition
 */
export interface ContextMenuItem {
    /** Unique identifier for the item */
    id: string;
    /** Display label */
    label: string;
    /** Icon (emoji or symbol) */
    icon?: string;
    /** Keyboard shortcut display */
    shortcut?: string;
    /** Whether this item has a submenu */
    hasSubmenu?: boolean;
    /** Child items for submenu */
    children?: ContextMenuItem[];
    /** Whether this item is disabled */
    disabled?: boolean;
    /** Whether this is a separator */
    isSeparator?: boolean;
    /** CSS class to add to this item */
    className?: string;
    /** Data attributes for the item */
    dataAttributes?: Record<string, string>;
}

/**
 * Selection state passed to context menu callbacks
 */
export interface ContextMenuSelection {
    /** The selected text */
    selectedText: string;
    /** Start line (1-based) */
    startLine: number;
    /** End line (1-based) */
    endLine: number;
    /** Start column (1-based) */
    startColumn: number;
    /** End column (1-based) */
    endColumn: number;
    /** Additional context data */
    context?: Record<string, unknown>;
}

/**
 * Callbacks for context menu actions
 */
export interface ContextMenuCallbacks {
    /** Called when Cut is clicked */
    onCut?: () => void;
    /** Called when Copy is clicked */
    onCopy?: () => void;
    /** Called when Paste is clicked */
    onPaste?: () => void;
    /** Called when Add Comment is clicked */
    onAddComment?: () => void;
    /** Called when a predefined comment is selected */
    onPredefinedComment?: (text: string) => void;
    /** Called when an AI command is selected */
    onAskAI?: (commandId: string, isCustomInput: boolean, mode: AICommandMode) => void;
    /** Called when the menu is hidden */
    onHide?: () => void;
}

/**
 * Custom instruction dialog configuration
 */
export interface CustomInstructionDialogConfig {
    /** Title for the dialog */
    title?: string;
    /** Placeholder text for the input */
    placeholder?: string;
    /** Label for the submit button */
    submitLabel?: string;
    /** Label for the cancel button */
    cancelLabel?: string;
}

/**
 * Custom instruction dialog callbacks
 */
export interface CustomInstructionDialogCallbacks {
    /** Called when the dialog is submitted */
    onSubmit: (instruction: string, commandId: string, mode: AICommandMode) => void;
    /** Called when the dialog is cancelled */
    onCancel?: () => void;
}

/**
 * Default AI commands used when none are configured
 */
export const DEFAULT_AI_COMMANDS: SerializedAICommand[] = [
    {
        id: 'clarify',
        label: 'Clarify',
        icon: '💡',
        order: 1,
        prompt: 'Please clarify the following snippet with more depth.'
    },
    {
        id: 'go-deeper',
        label: 'Go Deeper',
        icon: '🔍',
        order: 2,
        prompt: 'Please provide an in-depth explanation and analysis of the following snippet.'
    },
    {
        id: 'custom',
        label: 'Custom...',
        icon: '💬',
        order: 99,
        isCustomInput: true,
        prompt: 'Please explain the following snippet'
    }
];

/**
 * Default predefined comments used when none are configured
 */
export const DEFAULT_PREDEFINED_COMMENTS: SerializedPredefinedComment[] = [
    { id: 'todo', label: 'TODO', text: 'TODO: ', order: 1 },
    { id: 'fixme', label: 'FIXME', text: 'FIXME: ', order: 2 },
    { id: 'question', label: 'Question', text: 'Question: ', order: 3 }
];
