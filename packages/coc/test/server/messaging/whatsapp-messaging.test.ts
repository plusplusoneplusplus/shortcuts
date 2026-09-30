import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { BotOptions } from '@plusplusoneplusplus/coc-connector/whatsapp';
import type { Route } from '../../../src/server/types';
import { WhatsAppMessagingManager, WhatsAppNotConnectedError } from '../../../src/server/messaging/whatsapp-messaging-manager';
import { registerWhatsAppMessagingRoutes } from '../../../src/server/messaging/whatsapp-messaging-handler';

const directories: string[] = [];
const servers: http.Server[] = [];

function directory(): string {
    const dir = fs.mkdtempSync(path.join(process.cwd(), '.whatsapp-test-'));
    directories.push(dir);
    return dir;
}

function fakeBot() {
    let options!: BotOptions;
    const bot = {
        start: vi.fn(async () => { options.onStatusChange?.('connected'); }),
        stop: vi.fn(async () => {}),
        send: vi.fn(async () => 'sent-1'),
        react: vi.fn(async () => {}),
        listGroups: vi.fn(async () => [{ jid: '123@g.us', name: 'General' }]),
        createGroup: vi.fn(async () => '456@g.us'),
    };
    const createBot = vi.fn(async (opts: BotOptions) => { options = opts; return bot; });
    return { bot, createBot, options: () => options };
}

afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) =>
        server.close(err => err ? reject(err) : resolve()))));
    for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('WhatsAppMessagingManager', () => {
    it('defaults off without loading the connector or creating auth data', async () => {
        const dir = directory();
        const fake = fakeBot();
        const manager = new WhatsAppMessagingManager(dir, { createBot: fake.createBot });
        expect(manager.getStatus()).toMatchObject({
            enabled: false, status: 'disconnected', qr: null, groupJid: null,
        });
        await expect(manager.connect()).rejects.toThrow('disabled');
        expect(fake.createBot).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(dir, 'messaging', 'whatsapp'))).toBe(false);
    });

    it('surfaces corrupt saved configuration rather than silently enabling a different account', () => {
        const dir = directory();
        const config = path.join(dir, 'messaging', 'whatsapp', 'config.json');
        fs.mkdirSync(path.dirname(config), { recursive: true });
        fs.writeFileSync(config, '{"enabled":"unexpected"}');
        expect(() => new WhatsAppMessagingManager(dir)).toThrow('Invalid WhatsApp configuration');
    });

    it('persists config and uses a private auth directory, delivering inbound and reconnect events', async () => {
        const dir = directory();
        const fake = fakeBot();
        const manager = new WhatsAppMessagingManager(dir, { createBot: fake.createBot });
        const received = vi.fn(async () => {});
        const reconnected = vi.fn();
        manager.setMessageHandler(received);
        manager.setConnectedHandler(reconnected);
        await manager.updateConfig({ enabled: true, deviceName: 'Test device' });
        expect(new WhatsAppMessagingManager(dir).getStatus()).toMatchObject({ enabled: true, deviceName: 'Test device' });
        expect(fake.options().sessionDir).toBe(path.join(dir, 'messaging', 'whatsapp', 'auth'));
        expect(manager.getStatus()).toMatchObject({ status: 'connected', qr: null });
        await vi.waitFor(() => expect(reconnected).toHaveBeenCalledOnce());
        const message = { chatJid: '123@g.us', senderJid: '123@g.us', fromMe: false, messageId: 'm1', text: 'hello' };
        await fake.options().onMessage(message);
        expect(received).toHaveBeenCalledWith(message);
        expect(await manager.sendTo('123@g.us', 'hello', 'm1')).toBe('sent-1');
        expect(fake.bot.send).toHaveBeenCalledWith('123@g.us', 'hello', { replyToId: 'm1' });
        await manager.reactTo('123@g.us', 'm1', '👍');
        expect(fake.bot.react).toHaveBeenCalledWith('123@g.us', 'm1', '👍');
        await expect(manager.send('hello')).rejects.toThrow('not configured');
        expect(await manager.listGroups()).toEqual([{ jid: '123@g.us', name: 'General' }]);
        expect(await manager.createGroup('New group')).toEqual({ jid: '456@g.us', name: 'New group' });
        expect(manager.getStatus()).toMatchObject({ groupJid: '456@g.us', groupName: 'New group' });
        expect(await manager.send('reply', 'm1')).toBe('sent-1');
        expect(fake.bot.send).toHaveBeenLastCalledWith('456@g.us', 'reply', { replyToId: 'm1' });
        await manager.react('m1');
        expect(fake.bot.react).toHaveBeenLastCalledWith('456@g.us', 'm1', '👍');
        fake.bot.send.mockRejectedValueOnce(new Error('transport timeout'));
        await expect(manager.send('uncertain')).rejects.toThrow('transport timeout');
        await manager.updateConfig({ enabled: false });
        expect(fake.bot.stop).toHaveBeenCalled();
        await fake.options().onMessage(message);
        expect(received).toHaveBeenCalledTimes(1);
        await expect(manager.send('hello')).rejects.toBeInstanceOf(WhatsAppNotConnectedError);
        expect(fake.bot.send).toHaveBeenCalledTimes(3);
    });

    it('exposes pairing QR only during the current connection and clears it on disable', async () => {
        const fake = fakeBot();
        const manager = new WhatsAppMessagingManager(directory(), { createBot: fake.createBot });
        await manager.updateConfig({ enabled: true });
        fake.options().onQR?.('qr-secret');
        expect(manager.getStatus()).toMatchObject({ status: 'qr-pending', qr: 'qr-secret' });
        await manager.updateConfig({ enabled: false });
        fake.options().onQR?.('stale-qr');
        expect(manager.getStatus()).toMatchObject({ status: 'disconnected', qr: null });
    });

    it('ignores late starts, QR callbacks and inbound after disable', async () => {
        let finish!: () => void;
        const pending = new Promise<void>(resolve => { finish = resolve; });
        const fake = fakeBot();
        fake.bot.start.mockImplementationOnce(async () => { await pending; });
        const manager = new WhatsAppMessagingManager(directory(), { createBot: fake.createBot });
        const inbound = vi.fn(async () => {});
        manager.setMessageHandler(inbound);
        const connecting = manager.updateConfig({ enabled: true });
        await vi.waitFor(() => expect(fake.bot.start).toHaveBeenCalledOnce());
        await manager.updateConfig({ enabled: false });
        fake.options().onQR?.('late');
        await fake.options().onMessage({ chatJid: '1@g.us', senderJid: '1@g.us', fromMe: false, messageId: '1', text: 'late' });
        finish();
        await connecting;
        expect(inbound).not.toHaveBeenCalled();
        expect(manager.getStatus()).toMatchObject({ status: 'disconnected', qr: null, enabled: false });
        expect(fake.bot.stop).toHaveBeenCalled();
    });

    it('repair removes only auth state after stopping the prior bot and refuses symlink auth', async () => {
        const dir = directory();
        const fake = fakeBot();
        const manager = new WhatsAppMessagingManager(dir, { createBot: fake.createBot });
        await manager.updateConfig({ enabled: true });
        const auth = path.join(dir, 'messaging', 'whatsapp', 'auth');
        fs.mkdirSync(auth);
        fs.writeFileSync(path.join(auth, 'creds.json'), 'session');
        const stop = fake.bot.stop;
        stop.mockImplementationOnce(async () => {
            expect(fs.existsSync(path.join(auth, 'creds.json'))).toBe(true);
        });
        await manager.connect(true);
        expect(fs.existsSync(auth)).toBe(false);
        const elsewhere = path.join(dir, 'elsewhere');
        fs.mkdirSync(elsewhere);
        fs.writeFileSync(path.join(elsewhere, 'keep'), 'safe');
        try {
            fs.symlinkSync(elsewhere, auth, 'dir');
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
            throw err;
        }
        await expect(manager.connect(true)).rejects.toThrow('auth path');
        expect(fs.readFileSync(path.join(elsewhere, 'keep'), 'utf8')).toBe('safe');
        expect(fake.createBot).toHaveBeenCalledTimes(2);
    });

    it('waits for a superseded start before deleting auth during repair', async () => {
        const dir = directory();
        const fake = fakeBot();
        let finish!: () => void;
        const pending = new Promise<void>(resolve => { finish = resolve; });
        fake.bot.start.mockImplementationOnce(async () => { await pending; });
        const manager = new WhatsAppMessagingManager(dir, { createBot: fake.createBot });
        const first = manager.updateConfig({ enabled: true });
        const auth = path.join(dir, 'messaging', 'whatsapp', 'auth');
        fs.mkdirSync(auth);
        fs.writeFileSync(path.join(auth, 'creds.json'), 'session');
        await vi.waitFor(() => expect(fake.bot.start).toHaveBeenCalledOnce());
        const repaired = manager.connect(true);
        await vi.waitFor(() => expect(fake.bot.stop).toHaveBeenCalled());
        expect(fs.existsSync(path.join(auth, 'creds.json'))).toBe(true);
        finish();
        await Promise.all([first, repaired]);
        expect(fs.existsSync(auth)).toBe(false);
        expect(manager.getStatus().status).toBe('connected');
    });
});

describe('WhatsApp messaging HTTP routes', () => {
    async function setup() {
        const dir = directory();
        const fake = fakeBot();
        const manager = new WhatsAppMessagingManager(dir, { createBot: fake.createBot });
        const routes: Route[] = [];
        registerWhatsAppMessagingRoutes(routes, { dataDir: dir, manager });
        const server = http.createServer((req, res) => {
            const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
            const route = routes.find(item => item.method === req.method && item.pattern.test(pathname));
            if (route) void Promise.resolve(route.handler(req, res, pathname.match(route.pattern)!));
            else { res.writeHead(404); res.end(); }
        });
        servers.push(server);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/messaging/whatsapp`;
        const post = (endpoint: string, body: unknown) => fetch(base + endpoint, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        });
        return { base, post, fake, manager };
    }

    it('validates configuration, connects on enable and serves group management', async () => {
        const { base, post, fake, manager } = await setup();
        expect(await (await fetch(base + '/status')).json()).toMatchObject({ enabled: false, status: 'disconnected' });
        expect((await post('/reconnect', {})).status).toBe(409);
        expect((await fetch(base + '/groups')).status).toBe(409);
        for (const bad of [{ enabled: 'yes' }, { groupJid: '../unsafe' }, { other: true }, {}]) {
            expect((await post('/config', bad)).status).toBe(400);
        }
        expect((await post('/reconnect', { repair: 'yes' })).status).toBe(400);
        expect((await post('/groups', { name: '' })).status).toBe(400);
        expect((await post('/config', { enabled: true })).status).toBe(200);
        expect(fake.createBot).toHaveBeenCalledTimes(1);
        expect((await fetch(base + '/status')).status).toBe(200);
        expect(await (await fetch(base + '/groups')).json()).toEqual({ groups: [{ jid: '123@g.us', name: 'General' }] });
        expect((await post('/groups', { name: 'My group' })).status).toBe(201);
        expect(manager.getStatus().groupJid).toBe('456@g.us');
        expect((await post('/reconnect', {})).status).toBe(200);
        expect(fake.createBot).toHaveBeenCalledTimes(2);
        expect((await post('/config', { enabled: false })).status).toBe(200);
        expect((await fetch(base + '/groups')).status).toBe(409);
        expect((await post('/config', { enabled: true })).status).toBe(200);
        expect(fake.createBot).toHaveBeenCalledTimes(3);
    });
});
