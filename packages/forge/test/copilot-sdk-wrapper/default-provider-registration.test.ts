import { afterEach, describe, expect, it, vi } from 'vitest';

let loadedForge: typeof import('../../src/index') | undefined;

describe('default SDK provider registration', () => {
    afterEach(() => {
        loadedForge?.resetCopilotSDKService();
        loadedForge = undefined;
        vi.resetModules();
    });

    it('registers the Copilot provider when the public forge entrypoint is imported', async () => {
        vi.resetModules();

        const forge = loadedForge = await import('../../src/index');
        const provider = forge.sdkServiceRegistry.get(forge.SDK_PROVIDER_COPILOT);

        expect(provider).toBeDefined();
        expect(provider).toBe(forge.CopilotSDKService.getInstance());
    });

    it('re-registers the existing Copilot singleton if its registry entry is removed', async () => {
        vi.resetModules();

        const forge = loadedForge = await import('../../src/index');
        const provider = forge.CopilotSDKService.getInstance();

        forge.sdkServiceRegistry.unregister(forge.SDK_PROVIDER_COPILOT);
        expect(forge.sdkServiceRegistry.has(forge.SDK_PROVIDER_COPILOT)).toBe(false);

        expect(forge.CopilotSDKService.getInstance()).toBe(provider);
        expect(forge.sdkServiceRegistry.get(forge.SDK_PROVIDER_COPILOT)).toBe(provider);
    });
});
