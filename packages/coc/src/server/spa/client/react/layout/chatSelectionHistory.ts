export interface ChatSelectionHistory {
    entries: readonly string[];
    index: number;
}

/** In-memory history keyed by the full workspace selection id, including its server. */
export type ChatSelectionHistoryByWorkspace = ReadonlyMap<string, ChatSelectionHistory>;

const MAX_CHAT_HISTORY = 50;

export function recordChatSelection(
    history: ChatSelectionHistoryByWorkspace,
    workspaceSelectionId: string,
    chatId: string | null | undefined,
): ChatSelectionHistoryByWorkspace {
    const entry = history.get(workspaceSelectionId);
    // Clearing selection opens the new-chat surface; it does not visit a chat.
    // Replaying history already moved the index, so it must not append an entry.
    if (!chatId || entry?.entries[entry.index] === chatId) return history;
    const entries = [...(entry?.entries.slice(0, entry.index + 1) ?? []), chatId].slice(-MAX_CHAT_HISTORY);
    const next = new Map(history);
    next.set(workspaceSelectionId, { entries, index: entries.length - 1 });
    return next;
}

export function moveChatSelection(
    history: ChatSelectionHistoryByWorkspace,
    workspaceSelectionId: string,
    direction: -1 | 1,
    canVisit: (chatId: string) => boolean,
): ChatSelectionHistoryByWorkspace {
    const entry = history.get(workspaceSelectionId);
    if (!entry) return history;
    for (let index = entry.index + direction; index >= 0 && index < entry.entries.length; index += direction) {
        if (!canVisit(entry.entries[index])) continue;
        const next = new Map(history);
        next.set(workspaceSelectionId, { ...entry, index });
        return next;
    }
    return history;
}
