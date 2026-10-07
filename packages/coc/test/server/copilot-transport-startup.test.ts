import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CopilotSDKService } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../src/server/index';

describe('Admin Copilot transport at server startup', () => {
    it.each(['sdk', 'direct'] as const)('uses persisted %s configuration before one-shot consumers run', async transport => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-transport-startup-'));
        const configPath = join(dir, 'config.yaml');
        await writeFile(configPath, `copilot:\n  transformTransport: ${transport}\n`);
        const service = new CopilotSDKService();
        vi.spyOn(service, 'listModels').mockResolvedValue([]);
        vi.spyOn(service, 'isAvailable').mockResolvedValue({ available: false });
        const configure = vi.spyOn(service, 'configureTransformTransport');
        let server: Awaited<ReturnType<typeof createExecutionServer>> | undefined;
        try {
            server = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: dir, configPath, aiService: service });
            expect(configure).toHaveBeenCalledWith(transport);
            expect(server.server.listening).toBe(true);
        } finally {
            await server?.close();
            service.dispose();
            await rm(dir, { recursive: true, force: true });
        }
    });
});
