import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { CopilotSDKService, disposeAdoTokenResolver } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../src/server/index';

vi.mock('@plusplusoneplusplus/forge', async importOriginal => ({
    ...await importOriginal<typeof import('@plusplusoneplusplus/forge')>(),
    disposeAdoTokenResolver: vi.fn(),
}));

it('server shutdown retires its host ADO authentication scope', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ado-auth-shutdown-'));
    const service = new CopilotSDKService();
    vi.spyOn(service, 'listModels').mockResolvedValue([]);
    vi.spyOn(service, 'isAvailable').mockResolvedValue({ available: false });
    let server: Awaited<ReturnType<typeof createExecutionServer>> | undefined;
    try {
        server = await createExecutionServer({
            port: 0, host: '127.0.0.1', dataDir: dir, configPath: join(dir, 'config.yaml'), aiService: service,
        });
        expect(disposeAdoTokenResolver).not.toHaveBeenCalled();
        await server.close();
        server = undefined;
        expect(disposeAdoTokenResolver).toHaveBeenCalledExactlyOnceWith(dir);
    } finally {
        await server?.close();
        service.dispose();
        vi.restoreAllMocks();
        await rm(dir, { recursive: true, force: true });
    }
});
