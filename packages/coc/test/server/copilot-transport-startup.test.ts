import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CopilotSDKService, sdkServiceRegistry, SDK_PROVIDER_COPILOT } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../src/server/index';

describe('Admin Copilot transport at server startup', () => {
    describe.each(['injected', 'registered'] as const)('%s Copilot service', source => {
        it.each([undefined, 'sdk', 'direct'] as const)('applies %s configuration before one-shot consumers run', async transport => {
            const dir = await mkdtemp(join(tmpdir(), 'copilot-transport-startup-'));
            const configPath = join(dir, 'config.yaml');
            await writeFile(configPath, transport ? `copilot:\n  transformTransport: ${transport}\n` : '{}\n');
            const service = new CopilotSDKService();
            const configure = vi.spyOn(service, 'configureTransformTransport');
            const listModels = vi.spyOn(service, 'listModels').mockResolvedValue([]);
            vi.spyOn(service, 'isAvailable').mockResolvedValue({ available: false });
            const lookup = source === 'registered'
                ? vi.spyOn(sdkServiceRegistry, 'getOrThrow').mockReturnValue(service)
                : undefined;
            let server: Awaited<ReturnType<typeof createExecutionServer>> | undefined;
            try {
                server = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: dir, configPath,
                    ...(source === 'injected' ? { aiService: service } : {}) });
                expect(configure).toHaveBeenCalledWith(transport ?? 'direct');
                expect(listModels).toHaveBeenCalled();
                expect(configure.mock.invocationCallOrder[0]).toBeLessThan(listModels.mock.invocationCallOrder[0]);
                if (lookup) expect(lookup).toHaveBeenCalledWith(SDK_PROVIDER_COPILOT);
                expect(server.server.listening).toBe(true);
            } finally {
                await server?.close();
                lookup?.mockRestore();
                service.dispose();
                await rm(dir, { recursive: true, force: true });
            }
        });
    });
});
