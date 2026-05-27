import { afterEach, describe, expect, it, vi } from 'vitest';
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

    it('maps skillDirectories to Codex additionalDirectories', async () => {
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
                additionalDirectories: ['/repo/.github/skills', '/Users/test/.coc/skills'],
            }),
        );
    });
});
