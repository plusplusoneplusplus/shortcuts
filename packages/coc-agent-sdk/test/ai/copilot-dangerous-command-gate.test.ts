/**
 * The Copilot side of the dangerous-command guard (AC-07).
 *
 * Copilot already owns a permission channel, so there was no new interception
 * layer to build: its runtime raises a `shell` permission request carrying
 * `fullCommandText`, and the guard screens that text with the same shared
 * `screenDangerousCommand` the Claude gate uses, before the host's own handler
 * is consulted. These tests pin the wrapper's decisions and the fact that
 * `RequestRunner.send()` actually installs it on the session.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@plusplusoneplusplus/coc-native', () => ({
    tryMatchDangerousCommand: vi.fn(),
    loadNativeGit: vi.fn(() => {
        throw new Error('not used in this test');
    }),
}));

vi.mock('../../src/mcp-config-loader', () => ({
    loadEffectiveMcpConfig: vi.fn().mockReturnValue({ success: true, fileExists: false, mcpServers: {}, configPath: '' }),
}));

import { tryMatchDangerousCommand } from '@plusplusoneplusplus/coc-native';
import { applyDangerousCommandGuardToPermissionHandler, RequestRunner } from '../../src/request-runner';
import { SessionManager } from '../../src/session-manager';
import { createMockSession } from '../helpers/mock-sdk';
import type { DangerousCommandGuardOptions } from '../../src/dangerous-command-guard';

const mockMatch = vi.mocked(tryMatchDangerousCommand);

const RM_VERDICT = {
    matched: true,
    ruleId: 'rm-recursive-dangerous-target',
    description: 'recursive delete of a root or home path',
    matchedSegment: 'rm -rf /',
};

const INVOCATION = { sessionId: 'sess-1' };

function shellRequest(fullCommandText: string) {
    return { kind: 'shell', fullCommandText, toolCallId: 'tc-1' } as never;
}

beforeEach(() => {
    mockMatch.mockReset();
    mockMatch.mockReturnValue({ matched: false });
});

// ============================================================================
// The wrapper
// ============================================================================

describe('applyDangerousCommandGuardToPermissionHandler', () => {
    it('returns the handler unchanged when the guard is off', () => {
        const handler = vi.fn(() => ({ kind: 'approve-once' as const }));
        expect(applyDangerousCommandGuardToPermissionHandler(handler, undefined)).toBe(handler);
        expect(applyDangerousCommandGuardToPermissionHandler(handler, { enabled: false })).toBe(handler);
        expect(mockMatch).not.toHaveBeenCalled();
    });

    it('passes a benign shell command through to the host handler with no prompt', async () => {
        const handler = vi.fn(() => ({ kind: 'approve-once' as const }));
        const requestApproval = vi.fn();
        const guarded = applyDangerousCommandGuardToPermissionHandler(handler, { enabled: true, requestApproval });

        const result = await guarded(shellRequest('ls -la'), INVOCATION);

        expect(result).toEqual({ kind: 'approve-once' });
        expect(handler).toHaveBeenCalledOnce();
        expect(requestApproval).not.toHaveBeenCalled();
    });

    it('does not screen non-shell permission requests', async () => {
        const handler = vi.fn(() => ({ kind: 'approve-once' as const }));
        const guarded = applyDangerousCommandGuardToPermissionHandler(handler, { enabled: true, requestApproval: vi.fn() });

        await guarded({ kind: 'write', path: '/tmp/x' } as never, INVOCATION);

        expect(handler).toHaveBeenCalledOnce();
        expect(mockMatch).not.toHaveBeenCalled();
    });

    it('prompts on a match and defers to the host handler once approved', async () => {
        mockMatch.mockReturnValue(RM_VERDICT);
        const handler = vi.fn(() => ({ kind: 'approve-once' as const }));
        const requestApproval = vi.fn(async () => 'approve-once' as const);
        const guarded = applyDangerousCommandGuardToPermissionHandler(handler, { enabled: true, requestApproval });

        const result = await guarded(shellRequest('rm -rf /'), INVOCATION);

        expect(requestApproval).toHaveBeenCalledWith(
            expect.objectContaining({ toolName: 'Bash', command: 'rm -rf /', ruleId: RM_VERDICT.ruleId }),
            undefined,
        );
        expect(handler).toHaveBeenCalledOnce();
        expect(result).toEqual({ kind: 'approve-once' });
    });

    it('rejects with the guard reason when the user denies, without calling the host handler', async () => {
        mockMatch.mockReturnValue(RM_VERDICT);
        const handler = vi.fn(() => ({ kind: 'approve-once' as const }));
        const guarded = applyDangerousCommandGuardToPermissionHandler(handler, {
            enabled: true,
            requestApproval: async () => 'deny',
        });

        const result = (await guarded(shellRequest('rm -rf /'), INVOCATION)) as { kind: string; feedback: string };

        expect(result.kind).toBe('reject');
        expect(result.feedback).toContain(RM_VERDICT.ruleId);
        expect(result.feedback).toContain('The user denied it.');
        expect(handler).not.toHaveBeenCalled();
    });

    it('rejects immediately on a non-interactive turn (no approval channel)', async () => {
        mockMatch.mockReturnValue(RM_VERDICT);
        const handler = vi.fn(() => ({ kind: 'approve-once' as const }));
        const guarded = applyDangerousCommandGuardToPermissionHandler(handler, { enabled: true });

        const result = (await guarded(shellRequest('rm -rf /'), INVOCATION)) as { kind: string; feedback: string };

        expect(result.kind).toBe('reject');
        expect(result.feedback).toContain('not interactive');
        expect(handler).not.toHaveBeenCalled();
    });

    it('fails open when the native matcher is unavailable', async () => {
        mockMatch.mockReturnValue(null);
        const handler = vi.fn(() => ({ kind: 'approve-once' as const }));
        const requestApproval = vi.fn();
        const guarded = applyDangerousCommandGuardToPermissionHandler(handler, { enabled: true, requestApproval });

        const result = await guarded(shellRequest('rm -rf /'), INVOCATION);

        expect(result).toEqual({ kind: 'approve-once' });
        expect(requestApproval).not.toHaveBeenCalled();
    });

    it('forwards the turn signal to the approval prompt', async () => {
        mockMatch.mockReturnValue(RM_VERDICT);
        const controller = new AbortController();
        const requestApproval = vi.fn(async () => 'approve-once' as const);
        const guarded = applyDangerousCommandGuardToPermissionHandler(
            () => ({ kind: 'approve-once' }),
            { enabled: true, requestApproval },
            controller.signal,
        );

        await guarded(shellRequest('rm -rf /'), INVOCATION);

        expect(requestApproval).toHaveBeenCalledWith(expect.anything(), controller.signal);
    });
});

// ============================================================================
// Wiring through RequestRunner.send()
// ============================================================================

describe('RequestRunner.send() — guard installation', () => {
    function makeRunner() {
        const mockSession = createMockSession();
        const mockClient = {
            start: vi.fn().mockResolvedValue(undefined),
            createSession: vi.fn().mockResolvedValue(mockSession),
            resumeSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        const runner = new RequestRunner(
            vi.fn().mockResolvedValue({ available: true, sdkPath: '/fake/sdk' }),
            vi.fn().mockResolvedValue(mockClient),
            new SessionManager(),
        );
        return { runner, mockClient };
    }

    async function sessionPermissionHandler(guard?: DangerousCommandGuardOptions) {
        const { runner, mockClient } = makeRunner();
        await runner.send({
            prompt: 'hi',
            loadDefaultMcpConfig: false,
            onPermissionRequest: () => ({ kind: 'approve-once' }),
            ...(guard ? { dangerousCommandGuard: guard } : {}),
        });
        const config = mockClient.createSession.mock.calls[0][0] as {
            onPermissionRequest: (r: unknown, i: { sessionId: string }) => Promise<unknown> | unknown;
        };
        return config.onPermissionRequest;
    }

    it('screens shell permission requests when the flag is on', async () => {
        mockMatch.mockReturnValue(RM_VERDICT);
        const onPermissionRequest = await sessionPermissionHandler({ enabled: true, requestApproval: async () => 'deny' });

        const result = (await onPermissionRequest(shellRequest('rm -rf /'), INVOCATION)) as { kind: string };

        expect(result.kind).toBe('reject');
    });

    it('leaves the host handler alone when the flag is off', async () => {
        mockMatch.mockReturnValue(RM_VERDICT);
        const onPermissionRequest = await sessionPermissionHandler();

        const result = (await onPermissionRequest(shellRequest('rm -rf /'), INVOCATION)) as { kind: string };

        expect(result.kind).toBe('approve-once');
        expect(mockMatch).not.toHaveBeenCalled();
    });
});
