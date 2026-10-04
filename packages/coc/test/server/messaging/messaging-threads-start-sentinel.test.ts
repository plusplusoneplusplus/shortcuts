/**
 * Phone threads start new chats as the sentinel dispatcher (AC-03).
 *
 * Drives the real `createExecutionServer` wiring: the WhatsApp router's
 * `enqueue` dep and the Teams handler's `enqueueChat` / `enqueueRelayChat`
 * deps, with `sentinel.enabled` both off and on. The queue is paused so the
 * first turn stays queued and its payload mode can be read back.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileProcessStore, toQueueProcessId } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../../src/server/index';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import type { CLIConfig } from '../../../src/config';

const captured = vi.hoisted(() => ({ whatsapp: undefined as any, teams: undefined as any }));

vi.mock('../../../src/server/messaging/whatsapp-command-router', async importOriginal => {
    const orig = await importOriginal<typeof import('../../../src/server/messaging/whatsapp-command-router')>();
    class CapturingRouter extends orig.WhatsAppCommandRouter {
        constructor(deps: ConstructorParameters<typeof orig.WhatsAppCommandRouter>[0]) {
            super(deps);
            captured.whatsapp = deps;
        }
    }
    return { ...orig, WhatsAppCommandRouter: CapturingRouter };
});

vi.mock('../../../src/server/messaging/teams-messaging-handler', async importOriginal => {
    const orig = await importOriginal<typeof import('../../../src/server/messaging/teams-messaging-handler')>();
    return {
        ...orig,
        registerTeamsMessagingRoutes: (...args: Parameters<typeof orig.registerTeamsMessagingRoutes>) => {
            captured.teams = args[1];
            return orig.registerTeamsMessagingRoutes(...args);
        },
    };
});

const GLOBAL = 'global-workspace-00';

describe('phone threads start chats in sentinel mode', () => {
    let server: Awaited<ReturnType<typeof createExecutionServer>> | undefined;
    let dataDir: string | undefined;

    afterEach(async () => {
        await server?.close();
        server = undefined;
        if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
        dataDir = undefined;
    });

    async function start(sentinelEnabled: boolean) {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'threads-sentinel-'));
        const { service } = createMockSDKService();
        server = await createExecutionServer({
            store: new FileProcessStore({ dataDir }), dataDir, port: 0, host: '127.0.0.1', aiService: service,
            fileConfig: { sentinel: { enabled: sentinelEnabled } } as CLIConfig,
        });
        const paused = await fetch(`${server.url}/api/queue/pause`, { method: 'POST' });
        expect(paused.ok).toBe(true);
    }

    async function queuedMode(taskId: string): Promise<string | undefined> {
        const res = await fetch(`${server!.url}/api/queue/${encodeURIComponent(taskId)}`);
        expect(res.status).toBe(200);
        const body = await res.json() as { task?: { payload?: { mode?: string } } };
        return body.task?.payload?.mode;
    }

    for (const sentinelEnabled of [false, true]) {
        describe(`sentinel.enabled=${sentinelEnabled}`, () => {
            it('WhatsApp: a plain new-chat message queues a sentinel chat; a mode prefix keeps its mode', { timeout: 20_000 }, async () => {
                await start(sentinelEnabled);
                const plainId = 'wa-plain';
                await captured.whatsapp.enqueue(GLOBAL, 'hi', undefined, toQueueProcessId(plainId), plainId);
                expect(await queuedMode(plainId)).toBe('sentinel');

                const prefixedId = 'wa-autopilot';
                await captured.whatsapp.enqueue(GLOBAL, 'fix it', 'autopilot', toQueueProcessId(prefixedId), prefixedId);
                expect(await queuedMode(prefixedId)).toBe('autopilot');
            });

            it('Teams: plain new chats (ordinary and relay) queue sentinel chats; a mode prefix keeps its mode', { timeout: 20_000 }, async () => {
                await start(sentinelEnabled);
                const ordinaryId = await captured.teams.enqueueChat(GLOBAL, 'hi');
                expect(await queuedMode(ordinaryId)).toBe('sentinel');

                const relayId = await captured.teams.enqueueRelayChat(GLOBAL, 'hi', 'teams-relay');
                expect(await queuedMode(relayId)).toBe('sentinel');

                const askId = await captured.teams.enqueueChat(GLOBAL, 'just asking', 'ask');
                expect(await queuedMode(askId)).toBe('ask');
            });
        });
    }
});
