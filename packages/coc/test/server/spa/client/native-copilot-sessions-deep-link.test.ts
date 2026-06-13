import { describe, it, expect } from 'vitest';
import {
    parseNativeCliSessionDeepLink,
    buildNativeCliSessionHash,
    parseNativeCopilotSessionDeepLink,
    buildNativeCopilotSessionHash,
} from '../../../../src/server/spa/client/react/layout/Router';

describe('parseNativeCliSessionDeepLink', () => {
    it('returns null for hashes outside the cli-sessions tab', () => {
        expect(parseNativeCliSessionDeepLink('#repos/ws-1/notes')).toBeNull();
        expect(parseNativeCliSessionDeepLink('#repos/ws-1/activity/p-1')).toBeNull();
        expect(parseNativeCliSessionDeepLink('#processes/p-1')).toBeNull();
        expect(parseNativeCliSessionDeepLink('#repos')).toBeNull();
    });

    it('parses the provider tab with a null sessionId', () => {
        expect(parseNativeCliSessionDeepLink('#repos/ws-1/cli-sessions/codex')).toEqual({
            workspaceId: 'ws-1',
            provider: 'codex',
            sessionId: null,
        });
    });

    it('parses a provider session deep-link', () => {
        expect(parseNativeCliSessionDeepLink('#repos/ws-1/cli-sessions/claude/sess-abc')).toEqual({
            workspaceId: 'ws-1',
            provider: 'claude',
            sessionId: 'sess-abc',
        });
    });

    it('decodes URI-encoded workspace and session segments', () => {
        expect(parseNativeCliSessionDeepLink('#repos/ws%201/cli-sessions/codex/sess%2Fx')).toEqual({
            workspaceId: 'ws 1',
            provider: 'codex',
            sessionId: 'sess/x',
        });
    });

    it('treats legacy copilot-sessions links as Copilot provider links', () => {
        expect(parseNativeCliSessionDeepLink('#repos/ws-1/copilot-sessions/sess-abc')).toEqual({
            workspaceId: 'ws-1',
            provider: 'copilot',
            sessionId: 'sess-abc',
        });
    });
});

describe('buildNativeCliSessionHash', () => {
    it('builds the provider tab hash when sessionId is omitted or null', () => {
        expect(buildNativeCliSessionHash('ws-1', 'codex')).toBe('#repos/ws-1/cli-sessions/codex');
        expect(buildNativeCliSessionHash('ws-1', 'claude', null)).toBe('#repos/ws-1/cli-sessions/claude');
    });

    it('builds a session hash with encoded segments', () => {
        expect(buildNativeCliSessionHash('ws 1', 'codex', 'sess/x')).toBe('#repos/ws%201/cli-sessions/codex/sess%2Fx');
    });

    it('round-trips through the parser', () => {
        const hash = buildNativeCliSessionHash('ws-1', 'claude', 'sess-abc');
        expect(parseNativeCliSessionDeepLink(hash)).toEqual({ workspaceId: 'ws-1', provider: 'claude', sessionId: 'sess-abc' });
    });
});

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
