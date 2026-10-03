import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../../src/server/index';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { WhatsAppBindings, WhatsAppBindingReleaseError } from '../../../src/server/messaging/whatsapp-bindings';
import { WhatsAppCommandRouter } from '../../../src/server/messaging/whatsapp-command-router';
import { WhatsAppAnswerRelay } from '../../../src/server/messaging/whatsapp-answer-relay';
import { WhatsAppMessagingManager } from '../../../src/server/messaging/whatsapp-messaging-manager';

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

    it('isolates release retry errors in production inbound/reconnect handlers without hiding corrupt files', { timeout: 20_000 }, async () => {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-release-startup-'));
        const { service } = createMockSDKService();
        const restore = vi.spyOn(WhatsAppBindings.prototype, 'restore')
            .mockRejectedValue(new WhatsAppBindingReleaseError([new Error('release retry rejected')]));
        const handle = vi.spyOn(WhatsAppCommandRouter.prototype, 'handle').mockResolvedValue(undefined);
        const reconcile = vi.spyOn(WhatsAppAnswerRelay.prototype, 'reconnected').mockResolvedValue(undefined);
        const messageHandler = vi.spyOn(WhatsAppMessagingManager.prototype, 'setMessageHandler');
        const connectedHandler = vi.spyOn(WhatsAppMessagingManager.prototype, 'setConnectedHandler');
        const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
        let server: Awaited<ReturnType<typeof createExecutionServer>> | undefined;
        try {
            server = await createExecutionServer({
                store: new FileProcessStore({ dataDir }), dataDir, port: 0,
                host: '127.0.0.1', aiService: service,
            });
            const message = { chatJid: 'test-group@g.us', senderJid: 'test-group@g.us',
                fromMe: true, messageId: 'unrelated-message', text: 'question' };
            const inbound = messageHandler.mock.calls[0][0];
            const reconnected = connectedHandler.mock.calls[0][0];
            await inbound(message);
            expect(handle).toHaveBeenCalledWith(message);
            await reconnected();
            expect(reconcile).toHaveBeenCalledOnce();
            expect(diagnostic).toHaveBeenCalledWith('[whatsapp-messaging] Binding release reconciliation failed');
            handle.mockClear();
            restore.mockRejectedValueOnce(new Error('corrupt receipt file'));
            await expect(inbound(message)).rejects.toThrow('corrupt receipt file');
            expect(handle).not.toHaveBeenCalled();
            expect(fs.existsSync(path.join(dataDir, 'messaging', 'whatsapp', 'auth'))).toBe(false);
        } finally {
            await server?.close();
            fs.rmSync(dataDir, { recursive: true, force: true });
            vi.restoreAllMocks();
        }
    });
});
