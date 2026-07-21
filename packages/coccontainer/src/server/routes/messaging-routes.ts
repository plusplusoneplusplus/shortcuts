/**
 * Messaging REST routes for the WhatsApp and Teams bridges: status, config,
 * reconnect, and group/channel listing. Reads the live bridge off the runtime so
 * a bridge started later (e.g. after Teams OAuth) is picked up automatically.
 *
 * When the Teams bridge is not running, config writes fall back to persisting
 * into `config.yaml` via the MessagingConfigService.
 */

import type { ContainerRuntime } from '../runtime';
import type { MessagingConfigService } from '../messaging-config';
import { type RouteTable, sendJson, readBody } from '../http-util';

export function installMessagingRoutes(table: RouteTable, runtime: ContainerRuntime, messagingConfig: MessagingConfigService): void {
    const { config } = runtime;

    // ── WhatsApp ────────────────────────────────────────
    table.on('GET', '/api/container/messaging/status', ({ res }) => {
        if (runtime.whatsappBridge) {
            sendJson(res, runtime.whatsappBridge.getWhatsAppStatus());
            return;
        }
        sendJson(res, {
            enabled: false,
            status: 'disconnected',
            qr: null,
            error: null,
            userName: config.messaging?.whatsapp?.userName ?? 'CoC',
        });
    });

    table.on('POST', '/api/container/messaging/config', async ({ req, res }) => {
        const body = await readBody(req);
        const { userName, groupJid } = body as { userName?: string; groupJid?: string };
        if (runtime.whatsappBridge) {
            await runtime.whatsappBridge.updateConfig({ userName, groupJid });
            sendJson(res, { ok: true, message: 'Config updated' });
            return;
        }
        sendJson(res, { ok: false, error: 'WhatsApp not enabled' });
    });

    table.on('POST', '/api/container/messaging/reconnect', ({ res }) => {
        if (runtime.whatsappBridge) {
            // Run reconnect in background, respond immediately
            runtime.whatsappBridge.reconnect().catch(err => console.error('[container] WhatsApp reconnect error:', err));
            sendJson(res, { ok: true, message: 'Reconnecting — scan QR when prompted' });
            return;
        }
        sendJson(res, { ok: false, error: 'WhatsApp not enabled' });
    });

    table.on('GET', '/api/container/messaging/groups', async ({ res }) => {
        if (runtime.whatsappBridge) {
            try {
                const groups = await runtime.whatsappBridge.listGroups();
                sendJson(res, { groups });
            } catch (err: any) {
                sendJson(res, { groups: [], error: err.message });
            }
            return;
        }
        sendJson(res, { groups: [], error: 'WhatsApp not enabled' });
    });

    // ── Teams ───────────────────────────────────────────
    table.on('GET', '/api/container/messaging/teams/status', ({ res }) => {
        if (runtime.teamsBridge) {
            sendJson(res, runtime.teamsBridge.getTeamsStatus());
            return;
        }
        sendJson(res, {
            enabled: false,
            status: 'disconnected',
            mode: config.messaging?.teams?.mode ?? 'graph',
            error: null,
            botName: config.messaging?.teams?.botName ?? 'CoC',
        });
    });

    table.on('POST', '/api/container/messaging/teams/config', async ({ req, res }) => {
        const body = await readBody(req);
        const { botName, channelId, enabled, teamName, channelName, mode } = body as { botName?: string; channelId?: string; enabled?: boolean; teamName?: string; channelName?: string; mode?: 'graph' | 'mcp' };
        if (runtime.teamsBridge) {
            await runtime.teamsBridge.updateConfig({ botName, channelId, enabled, teamName, channelName, mode });
            sendJson(res, { ok: true, message: 'Teams config updated' });
            return;
        }
        // Even without active bridge, persist the config
        try {
            messagingConfig.saveTeamsConfig({ botName, channelId, enabled, teamName, channelName, mode });
            sendJson(res, { ok: true, message: 'Teams config saved (restart required)' });
        } catch (err: any) {
            sendJson(res, { ok: false, error: err.message });
        }
    });

    table.on('POST', '/api/container/messaging/teams/reconnect', ({ res }) => {
        if (runtime.teamsBridge) {
            runtime.teamsBridge.reconnect().catch(err => console.error('[container] Teams reconnect error:', err));
            sendJson(res, { ok: true, message: 'Reconnecting to Teams' });
            return;
        }
        sendJson(res, { ok: false, error: 'Teams not enabled' });
    });

    table.on('GET', '/api/container/messaging/teams/channels', async ({ res }) => {
        if (runtime.teamsBridge) {
            try {
                const channels = await runtime.teamsBridge.listChannels();
                sendJson(res, { channels });
            } catch (err: any) {
                sendJson(res, { channels: [], error: err.message });
            }
            return;
        }
        sendJson(res, { channels: [], error: 'Teams not enabled' });
    });
}
