/**
 * Unit coverage for `resolveChatWorkspaceId` — the chat's repo identity.
 *
 * Regression: a chat popped out without `?workspace=` (or floated from a
 * notification with no id) mounted `ChatDetail` with `workspaceId=undefined`.
 * Nothing recovered the id from the conversation data the view already had, so
 * the chat had no canonical origin and the composer PR chips rendered nothing —
 * no request, no error. The process record carries the id in `metadata`.
 */
import { describe, it, expect } from 'vitest';
import { resolveChatWorkspaceId } from '../../../src/server/spa/client/react/utils/resolveChatWorkspaceId';

const WS = 'ws-v2-794333e0c2b11ec90b70ed73';
const OTHER_WS = 'ws-v2-000000000000000000000000';

describe('resolveChatWorkspaceId', () => {
    it('prefers the prop when it is present', () => {
        expect(resolveChatWorkspaceId(WS, { metadata: { workspaceId: OTHER_WS } }, { metadata: { workspaceId: OTHER_WS } }))
            .toBe(WS);
    });

    it('falls back to the process metadata when no prop is given', () => {
        expect(resolveChatWorkspaceId(undefined, { metadata: { workspaceId: WS } })).toBe(WS);
        expect(resolveChatWorkspaceId(null, { metadata: { workspaceId: WS } })).toBe(WS);
    });

    it('falls back to the queue task metadata when the process has not loaded yet', () => {
        expect(resolveChatWorkspaceId(undefined, null, { metadata: { workspaceId: WS } })).toBe(WS);
        expect(resolveChatWorkspaceId(undefined, { metadata: {} }, { metadata: { workspaceId: WS } })).toBe(WS);
    });

    it('prefers the process metadata over the task metadata', () => {
        expect(resolveChatWorkspaceId(undefined, { metadata: { workspaceId: WS } }, { metadata: { workspaceId: OTHER_WS } }))
            .toBe(WS);
    });

    it('is undefined while nothing is known — never a partial/bogus id', () => {
        expect(resolveChatWorkspaceId(undefined)).toBeUndefined();
        expect(resolveChatWorkspaceId(undefined, null, null)).toBeUndefined();
        expect(resolveChatWorkspaceId('', { metadata: null }, { metadata: undefined })).toBeUndefined();
    });

    it('ignores non-string and empty metadata values', () => {
        expect(resolveChatWorkspaceId(undefined, { metadata: { workspaceId: 42 as unknown as string } })).toBeUndefined();
        expect(resolveChatWorkspaceId(undefined, { metadata: { workspaceId: '' } })).toBeUndefined();
        expect(resolveChatWorkspaceId(undefined, { metadata: { workspaceId: {} as unknown as string } }, { metadata: { workspaceId: WS } }))
            .toBe(WS);
    });
});
