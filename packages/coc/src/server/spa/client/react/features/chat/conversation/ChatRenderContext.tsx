/**
 * Chat render context — the workspace id and per-conversation markdown render
 * options that `ConversationTurnBubble` already computes for assistant message
 * bodies (`chatMarkdownToHtml`).
 *
 * Nested renderers that also show chat-authored markdown — today the expanded
 * `task_complete` tool-call body — read the same values from here instead of
 * having them threaded through every intermediate tool-call component. This is
 * per-subtree React context, not global state, so multi-repo pages keep each
 * conversation's own workspace id.
 */
import React, { createContext, useContext } from 'react';

export interface ChatRenderContextValue {
    /** Workspace id used to resolve local image paths and canvas embeds. */
    wsId?: string;
    htmlEmbedEnabled?: boolean;
    excalidrawEmbedEnabled?: boolean;
    canvasEmbedEnabled?: boolean;
}

const EMPTY_CHAT_RENDER_CONTEXT: ChatRenderContextValue = {};

const ChatRenderContext = createContext<ChatRenderContextValue>(EMPTY_CHAT_RENDER_CONTEXT);

export const ChatRenderContextProvider: React.Provider<ChatRenderContextValue> =
    ChatRenderContext.Provider;

export function useChatRenderContext(): ChatRenderContextValue {
    return useContext(ChatRenderContext);
}
