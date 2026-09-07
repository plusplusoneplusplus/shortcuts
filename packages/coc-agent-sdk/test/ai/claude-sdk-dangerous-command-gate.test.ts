/**
 * Ask mode's shell gate, at the query-options seam.
 *
 * The load-bearing detail: an allow rule short-circuits Claude's permission
 * engine, so a tool named in `allowedTools` never reaches `canUseTool`. The
 * guard therefore has to *remove* `Bash` from the ask-mode allow list and
 * re-grant benign commands from inside the callback. These tests pin both the
 * removal and the re-grant, plus the flag-off case being byte-identical to
 * before the feature existed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/sdk-esm-loader', () => ({
    dynamicImportModule: vi.fn(),
}));

vi.mock('@plusplusoneplusplus/coc-native', () => ({
    tryMatchDangerousCommand: vi.fn(),
    loadNativeGit: vi.fn(() => {
        throw new Error('not used in this test');
    }),
}));

import { ClaudeSDKService } from '../../src/claude-sdk-service';
import { dynamicImportModule } from '../../src/sdk-esm-loader';
import { tryMatchDangerousCommand } from '@plusplusoneplusplus/coc-native';
import type { SendMessageOptions } from '../../src/types';

const mockDynamicImport = vi.mocked(dynamicImportModule);
const mockMatch = vi.mocked(tryMatchDangerousCommand);

const SUCCESS = { type: 'result', subtype: 'success', result: 'ok', session_id: 's1' };

const RM_VERDICT = {
    matched: true,
    ruleId: 'rm-recursive-dangerous-target',
    description: 'recursive delete of a root or home path',
    matchedSegment: 'rm -rf /',
};

function makeHandle(messages: object[]) {
    return {
        [Symbol.asyncIterator]() {
            return (async function* () { for (const m of messages) yield m; })();
        },
        accountInfo: vi.fn(async () => ({})),
        return: vi.fn(async () => ({ done: true as const, value: undefined })),
    };
}

type QueryOptions = {
    options?: { allowedTools?: string[]; permissionMode?: string; canUseTool?: CanUseTool };
};

type CanUseTool = (
    toolName: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal; toolUseID: string },
) => Promise<{ behavior: 'allow' } | { behavior: 'deny'; message: string }>;

describe('ClaudeSDKService dangerous-command gate', () => {
    let svc: ClaudeSDKService;
    const queryFn = vi.fn();

    beforeEach(() => {
        queryFn.mockReset();
        mockMatch.mockReset();
        mockDynamicImport.mockResolvedValue({ query: queryFn });
        queryFn.mockReturnValue(makeHandle([SUCCESS]));
        svc = new ClaudeSDKService();
    });

    afterEach(() => {
        svc.dispose();
    });

    async function send(extra: Partial<SendMessageOptions> = {}): Promise<QueryOptions> {
        const result = await svc.sendMessage({ prompt: 'hi', ...extra } as SendMessageOptions);
        expect(result.success).toBe(true);
        return queryFn.mock.calls[0][0] as QueryOptions;
    }

    function canUseTool(call: QueryOptions): CanUseTool {
        const fn = call.options?.canUseTool;
        expect(fn).toBeTypeOf('function');
        return fn!;
    }

    const callbackOptions = { signal: new AbortController().signal, toolUseID: 'toolu_1' };

    it('leaves ask mode untouched when the flag is off', async () => {
        const call = await send();
        expect(call.options?.permissionMode).toBe('acceptEdits');
        expect(call.options?.allowedTools).toEqual(['Bash', 'WebFetch', 'WebSearch']);
        expect(call.options?.canUseTool).toBeUndefined();
        expect(mockMatch).not.toHaveBeenCalled();
    });

    it('leaves ask mode untouched when the guard is wired but disabled', async () => {
        const call = await send({
            dangerousCommandGuard: { enabled: false, requestApproval: vi.fn() },
        });
        expect(call.options?.allowedTools).toEqual(['Bash', 'WebFetch', 'WebSearch']);
        expect(call.options?.canUseTool).toBeUndefined();
    });

    it('drops Bash from the allow list and installs the callback when the flag is on', async () => {
        const call = await send({
            dangerousCommandGuard: { enabled: true, requestApproval: vi.fn() },
        });
        expect(call.options?.allowedTools).toEqual(['WebFetch', 'WebSearch']);
        expect(call.options?.canUseTool).toBeTypeOf('function');
    });

    it('does not gate autopilot, which is already user-authorized', async () => {
        const call = await send({
            mode: 'autopilot',
            dangerousCommandGuard: { enabled: true, requestApproval: vi.fn() },
        } as Partial<SendMessageOptions>);
        expect(call.options?.permissionMode).toBe('bypassPermissions');
        expect(call.options?.canUseTool).toBeUndefined();
    });

    it('allows a benign command without prompting', async () => {
        mockMatch.mockReturnValue({ matched: false });
        const requestApproval = vi.fn();
        const call = await send({ dangerousCommandGuard: { enabled: true, requestApproval } });

        const decision = await canUseTool(call)('Bash', { command: 'npm test' }, callbackOptions);
        expect(decision).toEqual({ behavior: 'allow' });
        expect(mockMatch).toHaveBeenCalledWith('npm test');
        expect(requestApproval).not.toHaveBeenCalled();
    });

    it('prompts on a match and allows once approved', async () => {
        mockMatch.mockReturnValue(RM_VERDICT);
        const requestApproval = vi.fn(async () => 'approve-once' as const);
        const call = await send({ dangerousCommandGuard: { enabled: true, requestApproval } });

        const decision = await canUseTool(call)('Bash', { command: 'rm -rf /' }, callbackOptions);
        expect(decision).toEqual({ behavior: 'allow' });
        expect(requestApproval).toHaveBeenCalledTimes(1);
        expect(requestApproval.mock.calls[0][0]).toMatchObject({
            toolName: 'Bash',
            command: 'rm -rf /',
            ruleId: RM_VERDICT.ruleId,
        });
    });

    it('denies with a message naming the rule when the user says no', async () => {
        mockMatch.mockReturnValue(RM_VERDICT);
        const call = await send({
            dangerousCommandGuard: { enabled: true, requestApproval: async () => 'deny' },
        });

        const decision = await canUseTool(call)('Bash', { command: 'rm -rf /' }, callbackOptions);
        expect(decision.behavior).toBe('deny');
        expect((decision as { message: string }).message).toContain(RM_VERDICT.ruleId);
    });

    it('runs the command as before when the native matcher is unavailable', async () => {
        mockMatch.mockReturnValue(null);
        const requestApproval = vi.fn();
        const call = await send({ dangerousCommandGuard: { enabled: true, requestApproval } });

        const decision = await canUseTool(call)('Bash', { command: 'rm -rf /' }, callbackOptions);
        expect(decision).toEqual({ behavior: 'allow' });
        expect(requestApproval).not.toHaveBeenCalled();
    });

    it('keeps auto-denying tools that were auto-denied before the callback existed', async () => {
        const call = await send({
            dangerousCommandGuard: { enabled: true, requestApproval: vi.fn() },
        });

        const decision = await canUseTool(call)('SomeUnapprovedTool', {}, callbackOptions);
        expect(decision.behavior).toBe('deny');
        expect((decision as { message: string }).message).toContain('ask mode');
        expect(mockMatch).not.toHaveBeenCalled();
    });
});
