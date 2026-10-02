/**
 * WhatsApp connector — via Baileys (lazy-loaded).
 */

export { WhatsAppBot } from './bot';
export type { InboundWAMessage, BotOptions, BotStatus, WASocket } from './types';
export { createBaileysConnection } from './connection';
export { formatWhatsAppOutbound, formatWhatsAppQuestion, chunkWhatsAppText, stripWhatsAppGlobalPrefix } from './message-utils';
export type { WhatsAppOutbound, WhatsAppQuestion } from './message-utils';
