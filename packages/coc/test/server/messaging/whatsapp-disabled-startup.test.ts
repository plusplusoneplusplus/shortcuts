import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../../src/server/index';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

vi.mock('@whiskeysockets/baileys', () => {
    throw new Error('Baileys was loaded while WhatsApp is disabled');
});

describe('disabled WhatsApp server startup', () => {
    it('starts, serves status, and shuts down without loading Baileys', { timeout: 20_000 }, async () => {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-disabled-startup-'));
        const { service } = createMockSDKService();
        let server: Awaited<ReturnType<typeof createExecutionServer>> | undefined;
        try {
            server = await createExecutionServer({
                store: new FileProcessStore({ dataDir }), dataDir, port: 0,
                host: '127.0.0.1', aiService: service,
            });
            const response = await fetch(`${server.url}/api/messaging/whatsapp/status`);
            expect(response.status).toBe(200);
            expect(await response.json()).toMatchObject({ enabled: false, status: 'disconnected', qr: null });
            expect(fs.existsSync(path.join(dataDir, 'messaging', 'whatsapp', 'auth'))).toBe(false);
        } finally {
            await server?.close();
            fs.rmSync(dataDir, { recursive: true, force: true });
        }
    });
});
