/**
 * unifiedTerminalClose — which sessions a terminal tab's ✕ would end, and what
 * ending them does (AC-05).
 *
 * The point of these cases is the two ways a close must NOT behave: prompting
 * about sessions that have no process (never created, or already exited), and
 * reporting success when the server did not actually end one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deleteTerminal = vi.fn(async (_ws: string, _id: string) => undefined);
const getCocClientForWorkspace = vi.fn((_ws: string | null | undefined) => ({
    workspaces: { deleteTerminal },
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: (ws: string | null | undefined) => getCocClientForWorkspace(ws),
    lookupCloneBaseUrl: () => null,
}));

import { CocApiError } from '@plusplusoneplusplus/coc-client';

/** The client's own error shape — status is what the 404 tolerance keys on. */
function apiError(message: string, status: number): CocApiError {
    return new CocApiError({ message, status, statusText: message, url: '/terminals' });
}
import {
    liveTerminalSessionIds,
    terminalCloseConfirmMessage,
    terminateTerminalSessions,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedTerminalClose';

describe('liveTerminalSessionIds', () => {
    it('returns the running sessions that exist on the server', () => {
        expect(liveTerminalSessionIds([
            { id: 'a', serverSessionId: 's-1', status: 'running' },
            { id: 'b', serverSessionId: 's-2', status: 'running' },
        ])).toEqual(['s-1', 's-2']);
    });

    it('ignores exited tombstones — there is no process left to kill', () => {
        expect(liveTerminalSessionIds([
            { id: 'a', serverSessionId: 's-1', status: 'exited' },
            { id: 'b', serverSessionId: 's-2', status: 'running' },
        ])).toEqual(['s-2']);
    });

    it('ignores a session the server has not created yet', () => {
        expect(liveTerminalSessionIds([
            { id: 'a', status: 'running' },
            { id: 'b', serverSessionId: '', status: 'running' },
        ])).toEqual([]);
    });

    it('deduplicates and tolerates an absent report', () => {
        expect(liveTerminalSessionIds([
            { id: 'a', serverSessionId: 's-1', status: 'running' },
            { id: 'b', serverSessionId: 's-1', status: 'running' },
        ])).toEqual(['s-1']);
        expect(liveTerminalSessionIds(undefined)).toEqual([]);
    });
});

describe('terminalCloseConfirmMessage', () => {
    it('counts the sessions it would end', () => {
        expect(terminalCloseConfirmMessage(1)).toContain('its running terminal session');
        expect(terminalCloseConfirmMessage(3)).toContain('its 3 running terminal sessions');
    });
});

describe('terminateTerminalSessions', () => {
    beforeEach(() => {
        deleteTerminal.mockReset();
        deleteTerminal.mockResolvedValue(undefined);
        getCocClientForWorkspace.mockClear();
    });

    it('ends every session on the owning clone', async () => {
        await terminateTerminalSessions('ws-member', ['s-1', 's-2']);
        expect(getCocClientForWorkspace).toHaveBeenCalledWith('ws-member');
        expect(deleteTerminal.mock.calls).toEqual([
            ['ws-member', 's-1'],
            ['ws-member', 's-2'],
        ]);
    });

    it('treats an already-gone session as terminated', async () => {
        deleteTerminal.mockRejectedValueOnce(apiError('gone', 404));
        await expect(terminateTerminalSessions('ws-1', ['s-1', 's-2'])).resolves.toBeUndefined();
        expect(deleteTerminal).toHaveBeenCalledTimes(2);
    });

    it('rejects when the server refuses, so the caller keeps the tab', async () => {
        deleteTerminal.mockRejectedValueOnce(apiError('boom', 500));
        await expect(terminateTerminalSessions('ws-1', ['s-1', 's-2'])).rejects.toThrow('boom');
        // Stops at the failure rather than reporting a partial kill as success.
        expect(deleteTerminal).toHaveBeenCalledTimes(1);
    });
});
