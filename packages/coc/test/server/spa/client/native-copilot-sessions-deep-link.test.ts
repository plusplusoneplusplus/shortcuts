import { describe, it, expect } from 'vitest';
import {
    parseNativeCopilotSessionDeepLink,
    buildNativeCopilotSessionHash,
} from '../../../../src/server/spa/client/react/layout/Router';

describe('parseNativeCopilotSessionDeepLink', () => {
    it('returns null for hashes outside the copilot-sessions tab', () => {
        expect(parseNativeCopilotSessionDeepLink('#repos/ws-1/notes')).toBeNull();
        expect(parseNativeCopilotSessionDeepLink('#repos/ws-1/activity/p-1')).toBeNull();
        expect(parseNativeCopilotSessionDeepLink('#processes/p-1')).toBeNull();
        expect(parseNativeCopilotSessionDeepLink('#repos')).toBeNull();
    });

    it('parses the bare tab with a null sessionId', () => {
        expect(parseNativeCopilotSessionDeepLink('#repos/ws-1/copilot-sessions')).toEqual({
            workspaceId: 'ws-1',
            sessionId: null,
        });
    });

    it('parses a session deep-link', () => {
        expect(parseNativeCopilotSessionDeepLink('#repos/ws-1/copilot-sessions/sess-abc')).toEqual({
            workspaceId: 'ws-1',
            sessionId: 'sess-abc',
        });
    });

    it('decodes URI-encoded workspace and session segments', () => {
        expect(parseNativeCopilotSessionDeepLink('#repos/ws%201/copilot-sessions/sess%2Fx')).toEqual({
            workspaceId: 'ws 1',
            sessionId: 'sess/x',
        });
    });
});

describe('buildNativeCopilotSessionHash', () => {
    it('builds the bare tab hash when sessionId is omitted or null', () => {
        expect(buildNativeCopilotSessionHash('ws-1')).toBe('#repos/ws-1/copilot-sessions');
        expect(buildNativeCopilotSessionHash('ws-1', null)).toBe('#repos/ws-1/copilot-sessions');
    });

    it('builds a session hash with encoded segments', () => {
        expect(buildNativeCopilotSessionHash('ws 1', 'sess/x')).toBe('#repos/ws%201/copilot-sessions/sess%2Fx');
    });

    it('round-trips through the parser', () => {
        const hash = buildNativeCopilotSessionHash('ws-1', 'sess-abc');
        expect(parseNativeCopilotSessionDeepLink(hash)).toEqual({ workspaceId: 'ws-1', sessionId: 'sess-abc' });
    });
});
