import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BotOptions, BotStatus, InboundWAMessage, WhatsAppBot } from '@plusplusoneplusplus/coc-connector/whatsapp';

export interface WhatsAppMessagingConfig {
    enabled: boolean;
    deviceName: string;
    groupJid: string | null;
    groupName: string | null;
}

export interface WhatsAppMessagingStatus extends WhatsAppMessagingConfig {
    status: BotStatus;
    error: string | null;
    qr: string | null;
}

type Bot = Pick<WhatsAppBot, 'start' | 'stop' | 'send' | 'react' | 'listGroups' | 'createGroup'>;
type BotFactory = (options: BotOptions) => Promise<Bot>;

const defaults: WhatsAppMessagingConfig = {
    enabled: false,
    deviceName: 'CoC',
    groupJid: null,
    groupName: null,
};

export class WhatsAppNotConnectedError extends Error {
    constructor() {
        super('WhatsApp channel is unavailable');
        this.name = 'WhatsAppNotConnectedError';
    }
}

export class WhatsAppMessagingManager {
    private readonly directory: string;
    private readonly configPath: string;
    private readonly authPath: string;
    private config: WhatsAppMessagingConfig;
    private bot: Bot | null = null;
    private status: BotStatus = 'disconnected';
    private error: string | null = null;
    private qr: string | null = null;
    private generation = 0;
    private messageHandler: ((message: InboundWAMessage) => Promise<void>) | null = null;
    private reconnectHandler: (() => Promise<void> | void) | null = null;
    private disposeHandler: (() => void) | null = null;
    private readonly createBot: BotFactory;
    private readonly pendingStarts = new Set<Promise<void>>();

    constructor(dataDir: string, options: { createBot?: BotFactory } = {}) {
        this.directory = path.join(dataDir, 'messaging', 'whatsapp');
        this.configPath = path.join(this.directory, 'config.json');
        this.authPath = path.join(this.directory, 'auth');
        this.createBot = options.createBot ?? (async botOptions => {
            const { WhatsAppBot } = await import('@plusplusoneplusplus/coc-connector/whatsapp');
            return new WhatsAppBot(botOptions);
        });
        this.config = this.loadConfig();
    }

    private loadConfig(): WhatsAppMessagingConfig {
        try {
            const saved: unknown = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
            if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid WhatsApp configuration');
            const record = saved as Record<string, unknown>;
            if (typeof record.enabled !== 'boolean' || typeof record.deviceName !== 'string'
                || !record.deviceName.trim() || (record.groupJid !== null && typeof record.groupJid !== 'string')
                || (record.groupName !== null && typeof record.groupName !== 'string')) {
                throw new Error('Invalid WhatsApp configuration');
            }
            return {
                enabled: record.enabled,
                deviceName: record.deviceName,
                groupJid: record.groupJid || null,
                groupName: record.groupName || null,
            };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...defaults };
            throw new Error(`Cannot read WhatsApp configuration: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    getStatus(): WhatsAppMessagingStatus {
        return { ...this.config, status: this.status, error: this.error, qr: this.qr };
    }

    setMessageHandler(handler: (message: InboundWAMessage) => Promise<void>): void {
        this.messageHandler = handler;
    }

    setReconnectHandler(handler: () => Promise<void> | void): void {
        this.reconnectHandler = handler;
    }

    setConnectedHandler(handler: () => Promise<void> | void): void {
        this.setReconnectHandler(handler);
    }

    setDisposeHandler(handler: () => void): void {
        this.disposeHandler = handler;
    }

    dispose(): void {
        this.disposeHandler?.();
        this.disposeHandler = null;
    }

    async updateConfig(patch: Partial<WhatsAppMessagingConfig>): Promise<void> {
        const wasEnabled = this.config.enabled;
        if (patch.enabled === false) await this.disconnect();
        const next = { ...this.config, ...patch };
        fs.mkdirSync(this.directory, { recursive: true });
        fs.writeFileSync(this.configPath, JSON.stringify(next, null, 2), { mode: 0o600 });
        this.config = next;
        if (!next.enabled) this.error = null;
        if (next.enabled && !wasEnabled) await this.connect();
    }

    async connect(repair = false): Promise<void> {
        if (!this.config.enabled) throw new Error('WhatsApp integration is disabled');
        const generation = ++this.generation;
        const oldBot = this.bot;
        this.bot = null;
        this.status = 'connecting';
        this.error = null;
        this.qr = null;
        try {
            await oldBot?.stop();
            await Promise.allSettled([...this.pendingStarts]);
            if (generation !== this.generation || !this.config.enabled) return;
            if (repair) {
                try {
                    const stat = fs.lstatSync(this.authPath);
                    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('WhatsApp auth path is not a directory');
                    fs.rmSync(this.authPath, { recursive: true });
                } catch (err) {
                    if (!err || typeof err !== 'object' || !('code' in err) || err.code !== 'ENOENT') throw err;
                }
            }
            if (generation !== this.generation || !this.config.enabled) return;
            const bot = await this.createBot({
                sessionDir: this.authPath,
                deviceName: this.config.deviceName,
                onMessage: async message => {
                    if (generation === this.generation && this.config.enabled) await this.messageHandler?.(message);
                },
                onQR: qr => {
                    if (generation === this.generation) {
                        this.qr = qr;
                        this.status = 'qr-pending';
                    }
                },
                onStatusChange: status => {
                    if (generation !== this.generation) return;
                    this.status = status;
                    if (status === 'connected') {
                        this.qr = null;
                        void Promise.resolve().then(() => this.reconnectHandler?.()).catch(err => {
                            console.error('[whatsapp-messaging] Reconnect callback failed:', err);
                        });
                    }
                },
            });
            if (generation !== this.generation || !this.config.enabled) {
                await bot.stop();
                return;
            }
            this.bot = bot;
            const starting = bot.start();
            this.pendingStarts.add(starting);
            try {
                await starting;
            } finally {
                this.pendingStarts.delete(starting);
            }
            if (generation !== this.generation || !this.config.enabled) await bot.stop();
        } catch (err) {
            if (generation !== this.generation) return;
            const bot = this.bot;
            this.bot = null;
            if (bot) {
                try { await bot.stop(); }
                catch (stopError) { console.error('[whatsapp-messaging] Failed to stop bot after connection failure:', stopError); }
            }
            this.status = 'disconnected';
            this.error = err instanceof Error ? err.message : 'WhatsApp connection failed';
            throw err;
        }
    }

    async disconnect(): Promise<void> {
        ++this.generation;
        const bot = this.bot;
        this.bot = null;
        this.status = 'disconnected';
        this.qr = null;
        await bot?.stop();
    }

    private connectedBot(): Bot {
        if (!this.config.enabled || this.status !== 'connected' || !this.bot) {
            throw new WhatsAppNotConnectedError();
        }
        return this.bot;
    }

    async send(text: string, quotedId?: string): Promise<string> {
        this.connectedBot();
        if (!this.config.groupJid) throw new Error('WhatsApp group is not configured');
        return this.sendTo(this.config.groupJid, text, quotedId);
    }

    async sendTo(jid: string, text: string, replyToId?: string): Promise<string> {
        return this.connectedBot().send(jid, text, replyToId ? { replyToId } : undefined);
    }

    async react(messageId: string): Promise<void> {
        if (!this.config.groupJid) throw new Error('WhatsApp group is not configured');
        return this.reactTo(this.config.groupJid, messageId, '👍');
    }

    async reactTo(jid: string, messageId: string, emoji: string): Promise<void> {
        return this.connectedBot().react(jid, messageId, emoji);
    }

    async listGroups(): Promise<Array<{ jid: string; name: string }>> {
        return this.connectedBot().listGroups();
    }

    async createGroup(name: string): Promise<{ jid: string; name: string }> {
        const jid = await this.connectedBot().createGroup(name);
        await this.updateConfig({ groupJid: jid, groupName: name });
        return { jid, name };
    }
}
