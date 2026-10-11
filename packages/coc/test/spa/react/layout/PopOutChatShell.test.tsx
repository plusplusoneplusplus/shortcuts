/**
 * Tests for PopOutChatShell route parsing.
 */

import { describe, it, expect } from 'vitest';
import { parsePopOutActivityRoute } from '../../../../src/server/spa/client/react/layout/PopOutChatShell';

describe('parsePopOutActivityRoute', () => {
    it('parses workspace and cloneBaseUrl from the query string', () => {
        expect(parsePopOutActivityRoute(
            '#popout/activity/task%2F1',
            '?workspace=ws1&cloneBaseUrl=http%3A%2F%2F127.0.0.1%3A4000',
        )).toEqual({
            taskId: 'task/1',
            workspaceId: 'ws1',
            cloneBaseUrl: 'http://127.0.0.1:4000',
            sourceSelectionId: undefined,
        });
    });

    it.each(['ws1', 'remote:server-a:ws1', 'remote:server-b:ws1'])(
        'keeps concrete owner %s separate from its workspace and endpoint',
        sourceSelectionId => {
            const search = new URLSearchParams({
                workspace: 'ws1',
                sourceSelectionId,
                cloneBaseUrl: 'https://clone.example.test',
            });
            expect(parsePopOutActivityRoute('#popout/activity/task-1', `?${search}`)).toEqual({
                taskId: 'task-1',
                workspaceId: 'ws1',
                sourceSelectionId,
                cloneBaseUrl: 'https://clone.example.test',
            });
        },
    );

    it('returns null for invalid hash routes', () => {
        expect(parsePopOutActivityRoute('#popout/other/task-1', '?workspace=ws1')).toBeNull();
        expect(parsePopOutActivityRoute('#popout/activity', '?workspace=ws1')).toBeNull();
    });
});
