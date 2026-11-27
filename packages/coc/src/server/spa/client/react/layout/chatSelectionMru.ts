export interface ChatSelectionMru {
    current: string;
    previous: string | null;
}

/** In-memory history keyed by the full workspace selection id, including its server. */
export type ChatSelectionMruByWorkspace = ReadonlyMap<string, ChatSelectionMru>;

export function recordChatSelection(
    history: ChatSelectionMruByWorkspace,
    workspaceSelectionId: string,
    chatId: string | null | undefined,
): ChatSelectionMruByWorkspace {
    const entry = history.get(workspaceSelectionId);
    // Clearing selection opens the new-chat surface; it does not visit a chat.
    if (!chatId || entry?.current === chatId) return history;
    const next = new Map(history);
    next.set(workspaceSelectionId, { current: chatId, previous: entry?.current ?? null });
    return next;
}
