import { sendError, sendJSON } from '../core/api-handler';
import { parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../types';
import { WhatsAppMessagingManager, type WhatsAppMessagingConfig } from './whatsapp-messaging-manager';

export function registerWhatsAppMessagingRoutes(
    routes: Route[],
    options: { dataDir: string; manager?: WhatsAppMessagingManager },
): WhatsAppMessagingManager {
    const manager = options.manager ?? new WhatsAppMessagingManager(options.dataDir);
    const base = /^\/api\/messaging\/whatsapp\/status$/;
    routes.push({
        method: 'GET',
        pattern: base,
        handler: (_req, res) => sendJSON(res, 200, manager.getStatus()),
    });
    routes.push({
        method: 'POST',
        pattern: /^\/api\/messaging\/whatsapp\/config$/,
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (!body) return;
            const fields = Object.keys(body);
            if (!fields.length || fields.some(field => !['enabled', 'deviceName', 'groupJid', 'groupName'].includes(field))
                || (body.enabled !== undefined && typeof body.enabled !== 'boolean')
                || (body.deviceName !== undefined && (typeof body.deviceName !== 'string' || !body.deviceName.trim() || body.deviceName.length > 100))
                || (body.groupJid !== undefined && body.groupJid !== null && (typeof body.groupJid !== 'string' || !/^[^@\s]+@g\.us$/.test(body.groupJid)))
                || (body.groupName !== undefined && body.groupName !== null && (typeof body.groupName !== 'string' || !body.groupName.trim() || body.groupName.length > 100))) {
                sendError(res, 400, 'Invalid WhatsApp configuration');
                return;
            }
            try {
                await manager.updateConfig(body as Partial<WhatsAppMessagingConfig>);
                sendJSON(res, 200, { ok: true });
            } catch (error) {
                console.error('[whatsapp-messaging] Failed to save settings:', error);
                sendError(res, manager.getStatus().error ? 503 : 500,
                    manager.getStatus().error ? 'WhatsApp connection failed' : 'Could not save WhatsApp configuration');
            }
        },
    });
    routes.push({
        method: 'POST',
        pattern: /^\/api\/messaging\/whatsapp\/reconnect$/,
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (!body) return;
            if (Object.keys(body).some(field => field !== 'repair') || (body.repair !== undefined && typeof body.repair !== 'boolean')) {
                sendError(res, 400, 'Invalid WhatsApp reconnect request');
                return;
            }
            if (!manager.getStatus().enabled) {
                sendError(res, 409, 'WhatsApp not enabled');
                return;
            }
            try {
                await manager.connect(body.repair === true);
                sendJSON(res, 200, { ok: true, status: manager.getStatus() });
            } catch (error) {
                console.error('[whatsapp-messaging] Failed to reconnect:', error);
                sendError(res, 503, 'WhatsApp connection failed');
            }
        },
    });
    routes.push({
        method: 'GET',
        pattern: /^\/api\/messaging\/whatsapp\/groups$/,
        handler: async (_req, res) => {
            if (!manager.getStatus().enabled) {
                sendError(res, 409, 'WhatsApp not enabled');
                return;
            }
            try {
                sendJSON(res, 200, { groups: await manager.listGroups() });
            } catch (error) {
                console.error('[whatsapp-messaging] Failed to list groups:', error);
                sendError(res, 503, 'WhatsApp channel is unavailable');
            }
        },
    });
    routes.push({
        method: 'POST',
        pattern: /^\/api\/messaging\/whatsapp\/groups$/,
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (!body) return;
            if (Object.keys(body).length !== 1 || typeof body.name !== 'string'
                || !body.name.trim() || body.name.length > 100) {
                sendError(res, 400, 'Provide a WhatsApp group name');
                return;
            }
            if (!manager.getStatus().enabled) {
                sendError(res, 409, 'WhatsApp not enabled');
                return;
            }
            try {
                sendJSON(res, 201, await manager.createGroup(body.name.trim()));
            } catch (error) {
                console.error('[whatsapp-messaging] Failed to create group:', error);
                sendError(res, 503, 'WhatsApp group creation failed');
            }
        },
    });
    return manager;
}
