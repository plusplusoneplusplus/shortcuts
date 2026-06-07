/**
 * Behavioral tests for TitleGenerationService.prewarm()
 *
 * prewarm() best-effort warms the provider through the same provider-agnostic
 * SDK transform boundary used by real title generation. These tests lock the
 * migrated (AC-02) transform behavior:
 * - Routes through `transform` with the gpt-5.4-mini product-policy model.
 * - Relies on the transform's safe isolation defaults — never opts into MCP
 *   servers/tools or relaxes permissions (data-minimization), and never reuses
 *   a client.
 * - Passes an abort signal so the warm-up is bounded.
 * - Is best-effort: provider failures are swallowed, never thrown, and nothing
 *   is persisted to the process store.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    TitleGenerationService,
    TITLE_GENERATION_MODEL,
} from '../../src/server/executors/title-generator';
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore } from '../helpers/mock-process-store';

describe('TitleGenerationService.prewarm', () => {
    let sdk: ReturnType<typeof createMockSDKService>;
    let store: ReturnType<typeof createMockProcessStore>;

    function makeService() {
        return new TitleGenerationService({
            store,
            aiService: sdk.service as any,
            defaultWorkingDirectory: '/tmp/title-prewarm',
        });
    }

    beforeEach(() => {
        sdk = createMockSDKService();
        store = createMockProcessStore();
        sdk.resetAll();
    });

    it('routes the warm-up through the SDK transform boundary with the policy model', async () => {
        await makeService().prewarm();

        expect(sdk.mockTransform).toHaveBeenCalledTimes(1);
        const [prompt, options] = sdk.mockTransform.mock.calls[0] as [string, any];
        expect(prompt).toContain('Generate a title for:');
        expect(options).toEqual(expect.objectContaining({ model: TITLE_GENERATION_MODEL }));
        expect(options.cwd).toBe('/tmp/title-prewarm');
    });

    it('passes an abort signal so the warm-up is bounded', async () => {
        await makeService().prewarm();

        const [, options] = sdk.mockTransform.mock.calls[0] as [string, any];
        expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    it('relies on transform isolation defaults (no MCP, no permission relaxation)', async () => {
        await makeService().prewarm();

        const [, options] = sdk.mockTransform.mock.calls[0] as [string, any];
        expect(options.loadDefaultMcpConfig).not.toBe(true);
        expect(options).not.toHaveProperty('onPermissionRequest');
    });

    it('does not reuse a client or fall back to sendMessage', async () => {
        await makeService().prewarm();

        expect(sdk.mockCreateClient).not.toHaveBeenCalled();
        expect(sdk.mockSendMessage).not.toHaveBeenCalled();
    });

    it('is best-effort: swallows provider failures without throwing', async () => {
        sdk.mockTransform.mockResolvedValue({ success: false, text: '', error: 'provider down' });

        await expect(makeService().prewarm()).resolves.toBeUndefined();
    });

    it('is best-effort: swallows transform rejections without throwing', async () => {
        sdk.mockTransform.mockImplementation(() => Promise.reject(new Error('network error')));

        await expect(makeService().prewarm()).resolves.toBeUndefined();
    });

    it('never persists anything to the process store', async () => {
        await makeService().prewarm();

        expect(store.updateProcess).not.toHaveBeenCalled();
    });
});
