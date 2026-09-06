/**
 * unifiedTerminalClose — the terminal half of AC-05's close guard.
 *
 * A unified `terminal` tab hosts the workspace's whole `TerminalView`, so its ✕
 * is not "close a buffer" but "end however many PTYs are running behind it".
 * Everything else in the panel detaches on close; a terminal has to be asked
 * about first, and the answer has to reach the server before the tab goes away.
 *
 * Two invariants this module exists to keep:
 *
 *  - **Only live sessions count.** A session the server never created (a tab
 *    still connecting) and an exited tombstone have no process to kill, so a
 *    tab holding only those closes silently — the goal's "already ended → no
 *    prompt to kill a nonexistent process".
 *  - **A failed terminate is not a close.** `terminateTerminalSessions` rejects
 *    when any session survives, so the caller keeps the tab and shows the
 *    error. A 404 is not a failure: the process is gone, which is what was
 *    asked for.
 *
 * Pure except for the one REST call, which is routed by the owning clone
 * (`getCocClientForWorkspace`) exactly as `TerminalView`'s own ✕ routes it — a
 * group member's terminal is ended on the member's server, not the page origin.
 */

import { CocApiError } from '@plusplusoneplusplus/coc-client';
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';

/** What a terminal view reports about one of its sessions. */
export interface UnifiedTerminalSession {
    /** The terminal view's own tab id (not the panel's). */
    id: string;
    /** The server session, once it exists. */
    serverSessionId?: string;
    status: 'running' | 'exited';
}

/**
 * The server sessions a close would have to end: running, and actually created.
 * Order follows the report so the confirmation counts what the user sees.
 */
export function liveTerminalSessionIds(
    sessions: readonly UnifiedTerminalSession[] | undefined,
): readonly string[] {
    if (!sessions) return [];
    const ids: string[] = [];
    for (const session of sessions) {
        if (session.status !== 'running') continue;
        if (typeof session.serverSessionId !== 'string' || session.serverSessionId === '') continue;
        if (!ids.includes(session.serverSessionId)) ids.push(session.serverSessionId);
    }
    return ids;
}

/** The prompt text for `count` live sessions. */
export function terminalCloseConfirmMessage(count: number): string {
    return count === 1
        ? 'Closing this tab will terminate its running terminal session.'
        : `Closing this tab will terminate its ${count} running terminal sessions.`;
}

/**
 * End every listed session on `workspaceId`'s clone. Resolves only when they are
 * all gone; rejects with the first real failure so the tab survives it.
 */
export async function terminateTerminalSessions(
    workspaceId: string,
    sessionIds: readonly string[],
): Promise<void> {
    const client = getCocClientForWorkspace(workspaceId);
    for (const sessionId of sessionIds) {
        try {
            await client.workspaces.deleteTerminal(workspaceId, sessionId);
        } catch (err) {
            // Already gone is the outcome we wanted, not an error to report.
            if (err instanceof CocApiError && err.status === 404) continue;
            throw err;
        }
    }
}
