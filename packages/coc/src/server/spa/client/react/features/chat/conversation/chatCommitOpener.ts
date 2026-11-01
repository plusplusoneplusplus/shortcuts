/**
 * chatCommitOpener — how a commit row inside a conversation opens its commit.
 *
 * `ChatDetail` provides an opener only while the unified right panel is showing
 * this chat and can host the commit's repository; the commit then opens in the
 * panel's Git tab and the chat stays on screen. Without one (pop-outs, lens and
 * side-panel chats, group-level chats) rows keep the workspace Git route.
 */

import { createContext, useContext } from 'react';
import type { DetectedCommit } from './commitDetection';

export type ChatCommitOpener = (commitHash: string) => void;

export const ChatCommitOpenerContext = createContext<ChatCommitOpener | null>(null);

export function useChatCommitOpener(): ChatCommitOpener | null {
    return useContext(ChatCommitOpenerContext);
}

export function activateChatCommit(opener: ChatCommitOpener | null, workspaceId: string, commit: DetectedCommit): void {
    const hash = commit.fullHash || commit.shortHash;
    if (opener) {
        opener(hash);
        return;
    }
    location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/git/' + hash;
}
