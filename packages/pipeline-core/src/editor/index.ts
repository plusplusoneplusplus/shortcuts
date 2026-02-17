/**
 * Editor Abstractions
 *
 * Platform-agnostic interfaces and types for the Markdown Review Editor.
 * Both the VS Code extension and the CoC standalone HTTP server implement
 * these contracts.
 */

// Domain types
export {
    CommentStatus,
    CommentType,
    CommentSelection,
    CommentAnchor,
    MermaidContext,
    MarkdownComment,
    isUserComment,
    CommentsSettings,
    CommentsConfig,
    DEFAULT_COMMENTS_SETTINGS,
    DEFAULT_COMMENTS_CONFIG
} from './types';

// Message protocol
export {
    // Re-exported reference types
    PromptFileInfo,
    // Message-specific types
    SkillInfo,
    SerializedPredefinedComment,
    WebviewSettings,
    PendingSelection,
    AIInstructionType,
    AskAIContext,
    RecentPrompt,
    RecentItem,
    AIModelOption,
    FollowPromptDialogOptions,
    LineChange,
    // Message unions
    WebviewToBackendMessage,
    BackendToWebviewMessage,
    EditorMessage
} from './messages';

// Transport abstraction
export {
    MessageListener,
    EditorTransport
} from './transport';

// Host abstraction
export {
    EditorHost
} from './host';

// State persistence abstraction
export {
    StateStore
} from './state-store';

export {
    FileStateStore
} from './file-state-store';

// Rendering primitives
export * from './rendering';
