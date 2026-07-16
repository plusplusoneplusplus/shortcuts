/**
 * WhatsApp connector — via Baileys (lazy-loaded).
 */

export { WhatsAppBot } from './bot';
export type { InboundWAMessage, BotOptions, BotStatus, WASocket } from './types';
export { createBaileysConnection } from './connection';
