import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * Which of the two list surfaces the mobile Workspace panel is showing. The
 * shared detail pane is NOT a third value — it is pushed *over* whichever pane
 * is active (`detailOpen`), so going back always lands on the segment the user
 * came from.
 */
export type MobileWorkspacePane = 'chat' | 'git';

/** localStorage key for the active mobile segment, per workspace (AC-03). */
export function splitWorkspaceMobilePaneStorageKey(workspaceId: string): string {
    return `coc.workspace.mobilePane.${workspaceId}`;
}

function readPane(storageKey: string): MobileWorkspacePane {
    try {
        // Anything we did not write (missing, stale, hand-edited) falls back to
        // Chats rather than throwing or rendering an empty panel.
        return localStorage.getItem(storageKey) === 'git' ? 'git' : 'chat';
    } catch {
        return 'chat';
    }
}

export interface MobileWorkspacePaneContextValue {
    /** The list pane the segmented control currently shows. */
    pane: MobileWorkspacePane;
    /** Switch segments. Neither pane unmounts — the inactive one is display:none. */
    setPane: (pane: MobileWorkspacePane) => void;
    /** True while the shared detail is pushed full-screen over the list. */
    detailOpen: boolean;
    /**
     * Push (true) or pop (false) the full-screen detail. Called by `RepoChatTab` /
     * `RepoGitTab` when a selection should open the detail, and by the shell's
     * back control.
     */
    setDetailOpen: (open: boolean) => void;
}

const MobileWorkspacePaneContext = createContext<MobileWorkspacePaneContextValue | null>(null);

export const MobileWorkspacePaneProvider = MobileWorkspacePaneContext.Provider;

/**
 * The mobile Workspace pane controller, or `null` when the consumer is not
 * inside the mobile one-pane-at-a-time layout (i.e. every desktop/tablet path).
 * `null` is the signal to keep the existing behavior untouched.
 */
export function useMobileWorkspacePane(): MobileWorkspacePaneContextValue | null {
    return useContext(MobileWorkspacePaneContext);
}

/**
 * Owns the mobile segment + detail-push state for one workspace. The segment
 * persists per workspace under `splitWorkspaceMobilePaneStorageKey`, following
 * the same `storageKey` convention the desktop dividers use. Only a real user
 * switch writes — a mount or a workspace change is a read, so a workspace with
 * no history keeps a clean localStorage.
 */
export function useMobileWorkspacePaneState(workspaceId: string): MobileWorkspacePaneContextValue {
    const storageKey = splitWorkspaceMobilePaneStorageKey(workspaceId);
    const [pane, setPaneState] = useState<MobileWorkspacePane>(() => readPane(storageKey));
    const [detailOpen, setDetailOpen] = useState(false);
    const skipPersistRef = useRef(true);

    useEffect(() => {
        skipPersistRef.current = true;
        setPaneState(readPane(storageKey));
        // A workspace switch always lands on the list, never on a stale detail.
        setDetailOpen(false);
    }, [storageKey]);

    useEffect(() => {
        if (skipPersistRef.current) {
            skipPersistRef.current = false;
            return;
        }
        try {
            localStorage.setItem(storageKey, pane);
        } catch {
            /* ignore */
        }
    }, [pane, storageKey]);

    const setPane = useCallback((next: MobileWorkspacePane) => setPaneState(next), []);

    return { pane, setPane, detailOpen, setDetailOpen };
}
