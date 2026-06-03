import { afterEach, describe, expect, it, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { CodexSDKService } from '../../src/codex-sdk-service';

function makeCodexSdkMock() {
    return {
        startThread: vi.fn(() => ({
            id: 'thread-1',
            runStreamed: vi.fn(async () => ({
                events: (async function* () {
                    yield { type: 'thread.started' as const, thread_id: 'thread-1' };
                    yield {
                        type: 'item.completed' as const,
                        item: { id: 'item-1', type: 'agent_message', text: 'ok' },
                    };
                })(),
            })),
        })),
        resumeThread: vi.fn(),
    };
}

describe('CodexSDKService skills', () => {
    let svc: CodexSDKService | undefined;

    afterEach(() => {
        svc?.dispose();
        svc = undefined;
    });

    it('maps skillDirectories to Codex additionalDirectories and always grants ~/.coc', async () => {
        svc = new CodexSDKService();
        const codexMock = makeCodexSdkMock();
        (svc as unknown as { sdk: unknown }).sdk = codexMock;
        (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

        await svc.sendMessage({
            prompt: 'test',
            skillDirectories: ['/repo/.github/skills', '/Users/test/.coc/skills'],
        });

        expect(codexMock.startThread).toHaveBeenCalledWith(
            expect.objectContaining({
                additionalDirectories: [
                    '/repo/.github/skills',
                    '/Users/test/.coc/skills',
                    path.join(os.homedir(), '.coc'),
                ],
            }),
        );
    });

    it('grants ~/.coc even when no skillDirectories are provided', async () => {
        svc = new CodexSDKService();
        const codexMock = makeCodexSdkMock();
        (svc as unknown as { sdk: unknown }).sdk = codexMock;
        (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

        await svc.sendMessage({ prompt: 'test' });

        expect(codexMock.startThread).toHaveBeenCalledWith(
            expect.objectContaining({
                additionalDirectories: [path.join(os.homedir(), '.coc')],
            }),
        );
    });

    it('does not duplicate ~/.coc when already supplied by the caller', async () => {
        svc = new CodexSDKService();
        const codexMock = makeCodexSdkMock();
        (svc as unknown as { sdk: unknown }).sdk = codexMock;
        (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

        const cocDir = path.join(os.homedir(), '.coc');
        await svc.sendMessage({
            prompt: 'test',
            additionalDirectories: [cocDir],
        });

        expect(codexMock.startThread).toHaveBeenCalledWith(
            expect.objectContaining({
                additionalDirectories: [cocDir],
            }),
        );
    });

    it('uses workspace-write Codex sandbox options for interactive mode', async () => {
        svc = new CodexSDKService();
        const codexMock = makeCodexSdkMock();
        (svc as unknown as { sdk: unknown }).sdk = codexMock;
        (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

        await svc.sendMessage({ prompt: 'test', mode: 'interactive' });

        expect(codexMock.startThread).toHaveBeenCalledWith(
            expect.objectContaining({
                approvalPolicy: 'never',
                sandboxMode: 'workspace-write',
                networkAccessEnabled: false,
            }),
        );
    });

    it('uses workspace-write Codex sandbox options when mode is omitted', async () => {
        svc = new CodexSDKService();
        const codexMock = makeCodexSdkMock();
        (svc as unknown as { sdk: unknown }).sdk = codexMock;
        (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

        await svc.sendMessage({ prompt: 'test' });

        expect(codexMock.startThread).toHaveBeenCalledWith(
            expect.objectContaining({
                approvalPolicy: 'never',
                sandboxMode: 'workspace-write',
                networkAccessEnabled: false,
            }),
        );
    });

    it('uses full-access Codex sandbox options for plan mode', async () => {
        svc = new CodexSDKService();
        const codexMock = makeCodexSdkMock();
        (svc as unknown as { sdk: unknown }).sdk = codexMock;
        (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

        await svc.sendMessage({ prompt: 'test', mode: 'plan' });

        expect(codexMock.startThread).toHaveBeenCalledWith(
            expect.objectContaining({
                approvalPolicy: 'never',
                sandboxMode: 'danger-full-access',
                networkAccessEnabled: true,
            }),
        );
    });

    it('uses full-access Codex sandbox options for autopilot mode', async () => {
        svc = new CodexSDKService();
        const codexMock = makeCodexSdkMock();
        (svc as unknown as { sdk: unknown }).sdk = codexMock;
        (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

        await svc.sendMessage({ prompt: 'test', mode: 'autopilot' });

        expect(codexMock.startThread).toHaveBeenCalledWith(
            expect.objectContaining({
                approvalPolicy: 'never',
                sandboxMode: 'danger-full-access',
                networkAccessEnabled: true,
            }),
        );
    });

    it('returns the effective Codex model after provider normalization', async () => {
        svc = new CodexSDKService();
        const codexMock = makeCodexSdkMock();
        (svc as unknown as { sdk: unknown }).sdk = codexMock;
        (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

        const result = await svc.sendMessage({ prompt: 'test', model: 'claude-opus-4.8' });

        expect(result.success).toBe(true);
        expect(result.effectiveModel).toBeUndefined();
        expect(codexMock.startThread).toHaveBeenCalledWith(
            expect.not.objectContaining({ model: expect.any(String) }),
        );
    });
});
