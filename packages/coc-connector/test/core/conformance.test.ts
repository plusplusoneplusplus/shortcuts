/**
 * Conformance tests — verify both concrete connectors satisfy the
 * MessagingConnector contract (compile-time and runtime).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MessagingConnector, ConnectorStatus } from '../../src/core';
import { TeamsBot } from '../../src/teams';
import { WhatsAppBot } from '../../src/whatsapp';

const CONNECTOR_STATUSES: ConnectorStatus[] = [
    'disconnected', 'connecting', 'authenticating', 'pairing', 'connected', 'busy', 'error',
];

// Mock the WhatsApp connection module so Baileys is never loaded.
vi.mock('../../src/whatsapp/connection', () => ({
    createBaileysConnection: vi.fn(),
}));

import { createBaileysConnection } from '../../src/whatsapp/connection';
const mockCreateConnection = vi.mocked(createBaileysConnection);

describe('MessagingConnector conformance', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('TeamsBot satisfies MessagingConnector', () => {
        const bot = new TeamsBot({ mode: 'graph', teamId: 't1', onMessage: async () => {} });
        // Compile-time: assignable to the interface.
        const connector: MessagingConnector = bot;

        expect(connector.provider).toBe('teams');
        expect(typeof connector.start).toBe('function');
        expect(typeof connector.stop).toBe('function');
        expect(typeof connector.send).toBe('function');
        expect(typeof connector.listTargets).toBe('function');
        expect(connector.isConnected()).toBe(false);
        expect(CONNECTOR_STATUSES).toContain(connector.getStatus());
        expect(connector.getLastError()).toBeNull();
    });

    it('WhatsAppBot satisfies MessagingConnector', () => {
        const bot = new WhatsAppBot({ sessionDir: '/tmp/conformance', onMessage: async () => {}, printQR: false });
        const connector: MessagingConnector = bot;

        expect(connector.provider).toBe('whatsapp');
        expect(typeof connector.start).toBe('function');
        expect(typeof connector.stop).toBe('function');
        expect(typeof connector.send).toBe('function');
        expect(typeof connector.listTargets).toBe('function');
        expect(typeof connector.resolveTarget).toBe('function');
        expect(connector.isConnected()).toBe(false);
        expect(CONNECTOR_STATUSES).toContain(connector.getStatus());
        expect(connector.getLastError()).toBeNull();
    });

    it('normalizes WhatsApp native status through getStatus()', async () => {
        const bot = new WhatsAppBot({ sessionDir: '/tmp/conformance', onMessage: async () => {}, printQR: false });

        // Drive the connection into the QR (pairing) state via the mocked hook.
        mockCreateConnection.mockImplementation(async (opts) => {
            opts.onQR('qr-code');
            return { ev: { on: vi.fn() }, sendMessage: vi.fn(), end: vi.fn() } as any;
        });
        await bot.start();

        expect(bot.getNativeStatus()).toBe('qr-pending');
        expect(bot.getStatus()).toBe('pairing');
        // getStatus() only ever emits normalized values.
        expect(CONNECTOR_STATUSES).toContain(bot.getStatus());
    });

    it('collects both connectors behind the shared contract', () => {
        const teams = new TeamsBot({ mode: 'graph', teamId: 't1', onMessage: async () => {} });
        const whatsapp = new WhatsAppBot({ sessionDir: '/tmp/conformance', onMessage: async () => {}, printQR: false });
        const connectors: MessagingConnector[] = [teams, whatsapp];

        expect(connectors.map((c) => c.provider)).toEqual(['teams', 'whatsapp']);
    });
});
